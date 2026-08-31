/**
 * Launches headless Chrome with WebMCP enabled and exposes a simple
 * `evaluate(expression)` over the DevTools protocol.
 *
 * Used by both scripts/webmcp-check.mjs and scripts/evals.mjs so the app is
 * always exercised against the real document.modelContext API rather than a
 * stand-in.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launchChrome(url, { port = 9333 + (process.pid % 500) } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'shipreel-chrome-'))
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-blink-features=WebMCP',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, url,
  ], { stdio: 'ignore' })

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    try { chrome.kill('SIGKILL') } catch { /* already gone */ }
    // Chrome unlinks its profile lazily; a failed sweep is not worth failing on.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* leave it */ }
  }
  process.on('exit', close)

  let wsUrl = null
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      wsUrl = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl
    } catch { /* not up yet */ }
    if (!wsUrl) await sleep(250)
  }
  if (!wsUrl) { close(); throw new Error('Chrome did not expose a debugging target') }

  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('could not attach to Chrome'))
  })

  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  const send = (method, params = {}) =>
    new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })) })

  /** Evaluate an async function body in the page and return its value. */
  const evaluate = async (expression, { timeoutMs = 120_000 } = {}) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
    })
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails
      throw new Error(d.exception?.description ?? d.text ?? 'page threw')
    }
    return r.result?.result?.value
  }

  /** Resolve once the app has booted and registered its tools. */
  const waitForApp = () => evaluate(`
    for (let i = 0; i < 120 && !window.shipreel; i++) await new Promise(r => setTimeout(r, 250));
    if (!window.shipreel) throw new Error('app did not boot');
    return true;
  `)

  return { evaluate, waitForApp, close, reload: () => send('Page.reload', { ignoreCache: false }) }
}
