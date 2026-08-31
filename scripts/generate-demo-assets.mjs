/**
 * Generates ShipReel's bundled demo project.
 *
 * Everything here is synthetic and reproducible so the repo stays small and the
 * demo never depends on a recording session:
 *
 *   - voiceover.m4a  : macOS `say`, one clip per phrase, concatenated with
 *                      deliberate silences and filler words ("um", "uh").
 *   - transcript.json: because we synthesise phrase-by-phrase we know each
 *                      phrase's exact start/end, so word timings are derived
 *                      arithmetically instead of guessed by an ASR model.
 *   - *.mp4          : fake screen recordings rendered as real HTML/CSS via
 *                      headless Chrome, then encoded with ffmpeg.
 *
 * Requires: macOS (`say`), ffmpeg, Google Chrome.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = new URL('../public/demo/', import.meta.url).pathname
const TMP = mkdtempSync(join(tmpdir(), 'shipreel-'))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VOICE = 'Samantha'
mkdirSync(OUT, { recursive: true })

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
const dur = (f) =>
  parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).trim())

// ---------------------------------------------------------------- voiceover --
// `gap` is the silence (seconds) that FOLLOWS the phrase. Long gaps exist so
// find_silences has real dead air to detect; fillers exist so the agent has
// something to strip. Neither is faked at runtime.
const SCRIPT = [
  { text: 'Hey, so this is the thing we built this weekend.', gap: 0.6 },
  { text: 'um', filler: true, gap: 0.4 },
  { text: 'The problem is that spinning up a local dev database takes forever, and everyone on the team ends up doing it slightly differently.', gap: 3.4 },
  { text: 'So you get these bugs that only reproduce on one person machine, and nobody can figure out why.', gap: 1.1 },
  { text: 'uh', filler: true, gap: 0.5 },
  { text: 'We wasted about two days on exactly that last month, which is what pushed us to build this.', gap: 2.8 },
  { text: 'So we built Tidepool.', gap: 0.5 },
  { text: 'It is one config file, and one command.', gap: 1.4 },
  { text: 'um', filler: true, gap: 0.35 },
  { text: 'Here is the terminal. You just run tidepool up, and it provisions the whole stack from that config file.', gap: 0.7 },
  { text: 'Postgres, all fourteen migrations, and the seed data, in about four seconds.', gap: 3.6 },
  { text: 'And every developer gets a byte for byte identical environment, because the whole thing is content addressed.', gap: 1.2 },
  { text: 'uh', filler: true, gap: 0.45 },
  { text: 'And this is the live dashboard, where every query hitting your database shows up in real time along with its latency.', gap: 0.8 },
  { text: 'You can see there is one join in there that is taking a hundred and eighty milliseconds.', gap: 3.1 },
  { text: 'um', filler: true, gap: 0.4 },
  { text: 'So you click into any slow query, and you get the full execution plan right there, without ever leaving the browser.', gap: 0.9 },
  { text: 'And in this case it is a sequential scan throwing away two hundred and forty thousand rows, which is the actual bug.', gap: 2.6 },
  { text: 'We found three real performance problems in our own app the first afternoon we had this running.', gap: 1.3 },
  { text: 'so', filler: true, gap: 0.4 },
  { text: 'Next up we want to add branch aware databases, so every pull request gets its own isolated copy.', gap: 2.4 },
  { text: 'That is Tidepool. Thanks for watching.', gap: 0.5 },
]

console.log('→ synthesising voiceover…')
const wavs = []
let t = 0.4 // small lead-in of silence
const segments = []

for (const [i, seg] of SCRIPT.entries()) {
  const aiff = join(TMP, `s${i}.aiff`)
  const wav = join(TMP, `s${i}.wav`)
  sh('say', ['-v', VOICE, '-o', aiff, seg.text])
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '44100', '-ac', '1', wav])
  const d = dur(wav)

  const words = seg.text.split(/\s+/)
  const weights = words.map((w) => w.length + 1)
  const total = weights.reduce((a, b) => a + b, 0)
  let cursor = t
  const wordTimings = words.map((w, k) => {
    const wd = (weights[k] / total) * d
    const entry = { word: w, start: +cursor.toFixed(3), end: +(cursor + wd).toFixed(3) }
    cursor += wd
    return entry
  })

  segments.push({
    id: `seg${i}`,
    text: seg.text,
    start: +t.toFixed(3),
    end: +(t + d).toFixed(3),
    filler: !!seg.filler,
    words: wordTimings,
  })

  wavs.push({ file: wav, d })
  t += d

  if (seg.gap > 0) {
    const sil = join(TMP, `g${i}.wav`)
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-t', String(seg.gap), sil])
    wavs.push({ file: sil, d: seg.gap })
    t += seg.gap
  }
}

const listFile = join(TMP, 'audio.txt')
writeFileSync(listFile, wavs.map((w) => `file '${w.file}'`).join('\n'))
sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
  '-c:a', 'aac', '-b:a', '96k', join(OUT, 'voiceover.m4a')])

const voiceDuration = t
console.log(`  voiceover.m4a — ${voiceDuration.toFixed(2)}s, ${segments.length} phrases`)

// ------------------------------------------------------------ screen clips --
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{width:1280px;height:720px;background:#010409;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}
.win{position:absolute;inset:28px;border-radius:12px;overflow:hidden;background:#0d1117;border:1px solid #21262d;box-shadow:0 24px 64px rgba(0,0,0,.6)}
.bar{height:38px;background:#161b22;border-bottom:1px solid #21262d;display:flex;align-items:center;padding:0 14px;gap:8px}
.dot{width:11px;height:11px;border-radius:50%}
.tt{color:#7d8590;font-size:12px;margin-left:10px;font-family:Menlo,monospace}
.term{padding:26px 30px;font-family:Menlo,monospace;font-size:21px;line-height:1.78;color:#c9d1d9}
.g{color:#3fb950}.d{color:#7d8590}.y{color:#d29922}.b{color:#58a6ff}.w{color:#e6edf3;font-weight:600}
`

const render = async (name, states) => {
  const frames = []
  for (const [i, s] of states.entries()) {
    const html = `<html><head><meta charset="utf-8"><style>${CSS}${s.css || ''}</style></head><body>${s.html}</body></html>`
    const f = join(TMP, `${name}_${String(i).padStart(3, '0')}.html`)
    writeFileSync(f, html)
    const png = join(TMP, `${name}_${String(i).padStart(3, '0')}.png`)
    execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--window-size=1280,720', `--screenshot=${png}`, '--virtual-time-budget=900', `file://${f}`],
      { stdio: 'ignore' })
    frames.push({ png, hold: s.hold })
  }
  const list = frames.map((f) => `file '${f.png}'\nduration ${f.hold}`).join('\n')
  const lf = join(TMP, `${name}.txt`)
  writeFileSync(lf, `${list}\nfile '${frames.at(-1).png}'`)
  const out = join(OUT, `${name}.mp4`)
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lf,
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast',
    '-movflags', '+faststart', out])
  const d = dur(out)
  console.log(`  ${name}.mp4 — ${d.toFixed(2)}s`)
  return d
}

const win = (title, body) =>
  `<div class="win"><div class="bar"><div class="dot" style="background:#ff5f57"></div><div class="dot" style="background:#febc2e"></div><div class="dot" style="background:#28c840"></div><div class="tt">${title}</div></div>${body}</div>`

// --- terminal: lines accumulate like a real provisioning run
const TERM_LINES = [
  { t: '<span class="g">$</span> tidepool up', h: 0.8 },
  { t: '<span class="d">· resolving tidepool.toml…</span>', h: 0.7 },
  { t: '<span class="g">✓</span> config resolved <span class="d">(4 services)</span>', h: 0.7 },
  { t: '<span class="d">· pulling postgres:16-alpine…</span>', h: 1.1 },
  { t: '<span class="g">✓</span> image ready <span class="d">(cached)</span>', h: 0.7 },
  { t: '<span class="d">· starting container…</span>', h: 0.9 },
  { t: '<span class="g">✓</span> container up on <span class="b">:5432</span>', h: 0.8 },
  { t: '<span class="d">· applying 14 migrations…</span>', h: 1.2 },
  { t: '<span class="g">✓</span> migrations applied', h: 0.7 },
  { t: '<span class="d">· seeding fixtures…</span>', h: 1.0 },
  { t: '<span class="g">✓</span> 2,481 rows seeded', h: 0.9 },
  { t: '<br><span class="w">ready in 4.1s</span>', h: 0.8 },
  { t: '<span class="d">dashboard →</span> <span class="b">http://localhost:7070</span>', h: 2.6 },
]
const termStates = TERM_LINES.map((_, i) => ({
  hold: TERM_LINES[i].h,
  html: win('tidepool — zsh', `<div class="term">${TERM_LINES.slice(0, i + 1).map((l) => l.t).join('<br>')}</div>`),
}))

// --- dashboard: query feed fills in, latency bars grow
const QUERIES = [
  ['SELECT * FROM users WHERE org_id = $1', '2.1', 18],
  ['SELECT count(*) FROM events', '4.8', 34],
  ['INSERT INTO sessions (…) VALUES (…)', '1.2', 11],
  ['SELECT … FROM orders JOIN line_items …', '184.6', 96],
  ['UPDATE users SET last_seen = now()', '0.9', 8],
  ['SELECT * FROM invoices WHERE due < $1', '12.4', 42],
  ['SELECT … FROM audit_log ORDER BY ts', '67.2', 71],
]
const DASH_CSS = `
.hd{padding:18px 24px;border-bottom:1px solid #21262d;display:flex;align-items:center;justify-content:space-between}
.h1{color:#e6edf3;font-size:19px;font-weight:600}
.live{color:#3fb950;font-size:12px;font-family:Menlo,monospace}
.row{display:flex;align-items:center;gap:16px;padding:11px 24px;border-bottom:1px solid #161b22;font-family:Menlo,monospace;font-size:14px}
.q{color:#c9d1d9;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms{width:78px;text-align:right}
.track{width:190px;height:7px;background:#161b22;border-radius:4px;overflow:hidden}
.fill{height:100%;border-radius:4px}
.slow{color:#f85149}.mid{color:#d29922}.fast{color:#3fb950}
`
const dashRow = (q) => {
  const cls = q[2] > 80 ? 'slow' : q[2] > 40 ? 'mid' : 'fast'
  const col = q[2] > 80 ? '#f85149' : q[2] > 40 ? '#d29922' : '#3fb950'
  return `<div class="row"><div class="q">${q[0]}</div><div class="ms ${cls}">${q[1]} ms</div>
    <div class="track"><div class="fill" style="width:${q[2]}%;background:${col}"></div></div></div>`
}
const dashStates = QUERIES.map((_, i) => ({
  hold: i === QUERIES.length - 1 ? 3.2 : 1.35,
  css: DASH_CSS,
  html: win('Tidepool — live queries', `
    <div class="hd"><div class="h1">Live query stream</div><div class="live">● ${i + 1} queries · 7070</div></div>
    ${QUERIES.slice(0, i + 1).map(dashRow).join('')}`),
}))

// --- query plan: hover, click, detail panel opens
const PLAN_CSS = DASH_CSS + `
.sel{background:#132030}
.panel{border-top:1px solid #21262d;padding:20px 24px;font-family:Menlo,monospace;font-size:14px;line-height:1.85}
.pt{color:#e6edf3;font-size:15px;font-weight:600;margin-bottom:12px;font-family:-apple-system,sans-serif}
.node{color:#c9d1d9}.cost{color:#7d8590}
`
const PLAN_ROWS = [
  '<span class="y">▸</span> Nested Loop  <span class="cost">(cost=0.42..8241.11 rows=1 width=214)</span>',
  '&nbsp;&nbsp;<span class="y">▸</span> Seq Scan on orders  <span class="cost">(cost=0.00..7982.00 rows=118 width=98)</span>',
  '&nbsp;&nbsp;&nbsp;&nbsp;<span class="slow">Filter: (status = \'pending\'::text)</span>',
  '&nbsp;&nbsp;&nbsp;&nbsp;<span class="slow">Rows Removed by Filter: 241,882</span>',
  '&nbsp;&nbsp;<span class="y">▸</span> Index Scan on line_items  <span class="cost">(cost=0.42..2.19 rows=1 width=116)</span>',
]
const planBase = (selected, panelRows) => win('Tidepool — execution plan', `
  <div class="hd"><div class="h1">Live query stream</div><div class="live">● 7 queries · 7070</div></div>
  ${QUERIES.slice(0, 4).map((q, i) => (i === 3 && selected ? dashRow(q).replace('class="row"', 'class="row sel"') : dashRow(q))).join('')}
  ${panelRows === null ? '' : `<div class="panel"><div class="pt">Execution plan — 184.6 ms</div>
    ${PLAN_ROWS.slice(0, panelRows).map((r) => `<div class="node">${r}</div>`).join('')}</div>`}`)
const planStates = [
  { hold: 1.1, css: PLAN_CSS, html: planBase(false, null) },
  { hold: 0.7, css: PLAN_CSS, html: planBase(true, null) },
  ...PLAN_ROWS.map((_, i) => ({ hold: i === PLAN_ROWS.length - 1 ? 3.4 : 0.85, css: PLAN_CSS, html: planBase(true, i + 1) })),
]

console.log('→ rendering screen recordings…')
const terminalD = await render('terminal', termStates)
const dashboardD = await render('dashboard', dashStates)
const planD = await render('queryplan', planStates)

// ------------------------------------------------------------------ project --
writeFileSync(join(OUT, 'transcript.json'), JSON.stringify({ duration: voiceDuration, segments }, null, 2))
writeFileSync(join(OUT, 'project.json'), JSON.stringify({
  name: 'Tidepool — demo video',
  note: 'Bundled sample project. Synthetic assets generated by scripts/generate-demo-assets.mjs.',
  media: [
    { id: 'vo', kind: 'audio', src: '/demo/voiceover.m4a', label: 'Voiceover (raw take)', duration: +voiceDuration.toFixed(3) },
    { id: 'terminal', kind: 'video', src: '/demo/terminal.mp4', label: 'Screen recording — terminal / tidepool up', duration: +terminalD.toFixed(3) },
    { id: 'dashboard', kind: 'video', src: '/demo/dashboard.mp4', label: 'Screen recording — live query dashboard', duration: +dashboardD.toFixed(3) },
    { id: 'queryplan', kind: 'video', src: '/demo/queryplan.mp4', label: 'Screen recording — execution plan panel', duration: +planD.toFixed(3) },
  ],
  transcript: '/demo/transcript.json',
}, null, 2))

rmSync(TMP, { recursive: true, force: true })
console.log(`\n✓ demo assets written to public/demo/  (voiceover ${voiceDuration.toFixed(1)}s)`)
