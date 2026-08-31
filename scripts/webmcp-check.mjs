/**
 * Verifies a page against a real WebMCP-enabled Chrome.
 *
 * Launches headless Chrome with the WebMCP origin-trial flag, attaches over
 * the DevTools protocol, and evaluates an expression in the page. Used to
 * confirm the tools actually register against document.modelContext rather
 * than only against our own test harness.
 *
 *   node scripts/webmcp-check.mjs <url> [--expr "<js>"]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const url = process.argv[2] ?? 'http://localhost:5173'
const exprIdx = process.argv.indexOf('--expr')
const expr = exprIdx > -1 ? process.argv[exprIdx + 1] : 'typeof document.modelContext?.registerTool'
const PORT = 9333 + (process.pid % 500)
const profile = mkdtempSync(join(tmpdir(), 'webmcp-check-'))

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--enable-blink-features=WebMCP',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, url,
], { stdio: 'ignore' })

let cleanedUp = false
const cleanup = () => {
  if (cleanedUp) return
  cleanedUp = true
  try { chrome.kill('SIGKILL') } catch { /* already gone */ }
  // Chrome unlinks its profile lazily; a failed sweep is not worth failing on.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* leave it to the OS */ }
}
process.on('exit', cleanup)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targetUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error('Chrome did not expose a debugging target')
}

const ws = new WebSocket(await targetUrl())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')) })

let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
const send = (method, params = {}) =>
  new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })) })

// Give the app a moment to boot and register.
await sleep(4000)

const r = await send('Runtime.evaluate', {
  expression: `(async () => { ${expr} })()`,
  awaitPromise: true,
  returnByValue: true,
})

const out = r.result?.result
if (r.result?.exceptionDetails) {
  console.error('PAGE ERROR:', r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
  cleanup(); process.exit(1)
}
console.log(typeof out?.value === 'object' ? JSON.stringify(out.value, null, 2) : String(out?.value))
cleanup()
process.exit(0)
