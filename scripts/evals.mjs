/**
 * Agent task evals for ShipReel.
 *
 * Each task is a sequence of tool calls a competent agent would make for a
 * real request, run in order against one live session so state accumulates the
 * way it would in a real edit. Assertions are on the resulting project state,
 * not on the wording of tool output.
 *
 * These are deterministic end-to-end tests of the tool surface: they prove the
 * tools compose and the workflow completes. They deliberately do NOT score a
 * model's tool *selection* — that needs an agent in the loop, and Chrome's
 * guidance treats it as a separate, probabilistic exercise.
 *
 *   npm run evals                     # against the dev server
 *   npm run evals -- <url>            # against a deployment
 */
import { launchChrome } from './lib/chrome.mjs'

const url = process.argv[2] ?? 'http://localhost:5173'

const SETUP = `
  window.__ev = {
    T: Object.fromEntries(window.shipreel.tools.map(t => [t.name, t])),
    rx: s => [...s.matchAll(/(\\d+\\.\\d+)s-(\\d+\\.\\d+)s/g)].map(m => ({ start:+m[1], end:+m[2] })),
    dur: () => window.shipreel.stores.project.getState().duration(),
    state: () => window.shipreel.stores.project.getState(),
  };
  return true;
`

const TASKS = [
  {
    name: 'Tools register on load',
    run: `
      const names = (await document.modelContext.getTools()).map(t => t.name).sort();
      const want = ['find_silences','get_project_state','optimize_duration','place_clip','preview_at','remove_ranges','search_transcript'];
      return { pass: JSON.stringify(names) === JSON.stringify(want), detail: names.length + ' base tools: ' + names.join(', ') };
    `,
  },
  {
    name: 'Remove all silence',
    run: `
      const { T, rx, dur } = window.__ev;
      const before = dur();
      const found = await T.find_silences.execute({ min_seconds: 0.4 });
      const out = await T.remove_ranges.execute({ ranges: rx(found) });
      const left = await T.find_silences.execute({ min_seconds: 0.4 });
      const clean = left.startsWith('No gaps');
      return { pass: dur() < before - 15 && clean, detail: out + ' | rerun finds: ' + left.split(':')[0] };
    `,
  },
  {
    name: 'Remove filler words',
    run: `
      const { T, rx, dur } = window.__ev;
      const hits = (await T.search_transcript.execute({query:'um'})) + (await T.search_transcript.execute({query:'uh'}));
      const ranges = [...hits.matchAll(/(\\d+\\.\\d+)s-(\\d+\\.\\d+)s \\[filler\\]/g)].map(m => ({start:+m[1], end:+m[2]}));
      const before = dur();
      const out = await T.remove_ranges.execute({ ranges });
      return { pass: ranges.length >= 3 && dur() < before, detail: ranges.length + ' fillers found. ' + out };
    `,
  },
  {
    name: 'Find the terminal section',
    run: `
      const { T } = window.__ev;
      const hit = await T.search_transcript.execute({ query: 'here is the terminal' });
      const m = hit.match(/(\\d+\\.\\d+)s-(\\d+\\.\\d+)s/);
      return { pass: !!m && +m[1] > 0, detail: m ? ('matched at ' + m[1] + 's') : hit };
    `,
  },
  {
    name: 'Place footage according to narration',
    run: `
      const { T, state } = window.__ev;
      const placed = [];
      for (const [q, media, d] of [['here is the terminal','terminal',10],['and this is the live dashboard','dashboard',9],['you get the full execution plan','queryplan',8]]) {
        const m = (await T.search_transcript.execute({ query: q })).match(/(\\d+\\.\\d+)s/);
        await T.place_clip.execute({ media, at: +m[1], source_start: 0, source_end: d });
        placed.push({ media, narrationAt: +m[1] });
      }
      const clips = state().clips.filter(c => c.track === 'video');
      // every clip should start within a second of the line that mentions it
      const aligned = placed.every(p => clips.some(c => c.mediaId === p.media && Math.abs(c.start - p.narrationAt) < 1));
      return { pass: clips.length === 3 && aligned, detail: clips.length + ' clips, each aligned to its narration' };
    `,
  },
  {
    name: 'Editing tools appear once there is footage',
    run: `
      const names = (await document.modelContext.getTools()).map(t => t.name);
      const added = ['add_zoom','export_video','get_export_status','move_clip','remove_clip','set_clip_speed','trim_clip'];
      const missing = added.filter(n => !names.includes(n));
      return { pass: missing.length === 0, detail: names.length + ' tools now registered (was 7)' };
    `,
  },
  {
    name: 'Zoom in on the execution plan',
    run: `
      const { T, state } = window.__ev;
      const st = await T.get_project_state.execute({});
      const qp = st.match(/clip_\\w+ ([\\d.]+)s-[\\d.]+s queryplan/);
      const out = await T.add_zoom.execute({ start:+qp[1]+1, end:+qp[1]+6, x:0.32, y:0.62, scale:2.1 });
      return { pass: state().zooms.length === 1, detail: out };
    `,
  },
  {
    name: 'Preview timestamp 32s',
    run: `
      const { T, state } = window.__ev;
      const out = await T.preview_at.execute({ time: 32 });
      return { pass: Math.abs(state().playhead - 32) < 0.2, detail: out };
    `,
  },
  {
    name: 'Cut the video to under 60 seconds',
    run: `
      const { T, rx, dur } = window.__ev;
      let out = await T.optimize_duration.execute({ target_seconds: 60 });
      // optimize_duration reclaims pauses, then hands back sentences to drop
      for (let i = 0; i < 6 && dur() > 60; i++) {
        const cand = out.match(/(\\d+\\.\\d+)s-(\\d+\\.\\d+)s \\(/);
        if (!cand) break;
        await T.remove_ranges.execute({ ranges: [{ start:+cand[1], end:+cand[2] }] });
        out = await T.optimize_duration.execute({ target_seconds: 60 });
      }
      return { pass: dur() <= 60, detail: 'final runtime ' + dur().toFixed(1) + 's' };
    `,
  },
  {
    name: 'A human edit is reported back to the agent',
    run: `
      const { T, state } = window.__ev;
      await T.get_project_state.execute({});                 // clear the cursor
      const clip = state().clips.find(c => c.track === 'video');
      state().moveClip(clip.id, clip.start + 2, 'user');      // the person drags it
      const st = await T.get_project_state.execute({});
      return { pass: /Since your last check the person/.test(st), detail: (st.split('\\n').pop() || '').slice(0, 90) };
    `,
  },
  {
    name: 'Errors tell the agent how to recover',
    run: `
      const { T } = window.__ev;
      const a = await T.place_clip.execute({ media: 'nope', at: 1 });
      const b = await T.remove_ranges.execute({ ranges: [] });
      const c = await T.add_zoom.execute({ start: 5, end: 2, x:.5, y:.5, scale: 2 });
      const guided = /Available:/.test(a) && /find_silences|search_transcript/.test(b) && /greater than/.test(c);
      return { pass: guided, detail: 'unknown media, empty batch and inverted range each name the fix' };
    `,
  },
  {
    name: 'Export renders and reports completion',
    run: `
      const { T, dur } = window.__ev;
      // Trim to a few seconds first: rendering is realtime, and this asserts the
      // pipeline completes, not that it can run for a minute.
      await T.remove_ranges.execute({ ranges: [{ start: 6, end: dur() }] });
      const idle = await T.get_export_status.execute({});
      const started = await T.export_video.execute({ filename: 'eval-cut' });
      let status = '';
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000));
        status = await T.get_export_status.execute({});
        if (/^Render complete/.test(status) || /failed/.test(status)) break;
      }
      return { pass: /^Render complete/.test(status), detail: status.slice(0, 120) };
    `,
  },
]

const chrome = await launchChrome(url)
let passed = 0
let failed = 0

try {
  await chrome.waitForApp()
  await chrome.evaluate(SETUP)
  console.log(`\nShipReel agent evals — ${url}\n`)

  for (const task of TASKS) {
    let r
    try {
      r = await chrome.evaluate(task.run)
    } catch (e) {
      r = { pass: false, detail: `threw: ${e.message.split('\n')[0]}` }
    }
    if (r?.pass) { passed++; console.log(`  \u2713 ${task.name}`) }
    else { failed++; console.log(`  \u2717 ${task.name}`) }
    if (r?.detail) console.log(`      ${r.detail}`)
  }
} finally {
  chrome.close()
}

console.log(`\n${failed === 0 ? '\u2713' : '\u2717'} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
