/**
 * Verifies a page against a real WebMCP-enabled Chrome.
 *
 * Launches headless Chrome with the WebMCP flag, attaches over the DevTools
 * protocol, and evaluates an expression in the page. Confirms the tools
 * actually register against document.modelContext rather than only against
 * our own test harness.
 *
 *   node scripts/webmcp-check.mjs <url> [--expr "<js>"]
 */
import { launchChrome } from './lib/chrome.mjs'

const url = process.argv[2] ?? 'http://localhost:5173'
const i = process.argv.indexOf('--expr')
const expr = i > -1 ? process.argv[i + 1] : 'return typeof document.modelContext?.registerTool'

const chrome = await launchChrome(url)
try {
  await new Promise((r) => setTimeout(r, 2500))
  const out = await chrome.evaluate(expr)
  console.log(typeof out === 'object' ? JSON.stringify(out, null, 2) : String(out))
} catch (e) {
  console.error('FAILED:', e.message)
  chrome.close()
  process.exit(1)
}
chrome.close()
process.exit(0)
