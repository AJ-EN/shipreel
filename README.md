# ShipReel

**An agent-native video studio. Your agent edits; you direct. Nothing ever uploads.**

ShipReel turns a raw voiceover and unedited screen recordings into a finished demo
video. The editing happens in the browser tab, and your AI agent drives it through
[WebMCP](https://github.com/webmachinelearning/webmcp) tools — cutting dead air,
syncing footage to what you actually said, and hitting a runtime budget — while you
watch the timeline change and take over whenever you want.

> Built for the [WebMCP Challenge](https://webmcp.devpost.com/).

---

## Why this is a WebMCP problem, not an MCP problem

Most agent integrations can be a backend MCP server. This one cannot.

The media is a set of `Blob`s in page memory. Decoding, compositing, and encoding
run on `WebCodecs`, `Canvas`, `MediaRecorder`, and the `WebAudio` graph — inside the
tab, against the person's own files. **There is no server to expose.** A remote MCP
server has nothing to connect to: it cannot see the timeline, cannot read the
decoded audio, and cannot render a frame.

That makes the split unusually clean:

|                     | A backend MCP server | ShipReel over WebMCP |
| ------------------- | -------------------- | -------------------- |
| Where the media is  | would need uploading | already in the tab |
| Where editing runs  | a render farm        | the page's own engine |
| What you see        | a finished file      | the timeline changing live |
| Cost of a 4K take   | a long upload        | zero — nothing leaves |

The agent is a guest in the editor, not the other way round.

## What people and agents can do together that was hard before

- **43 cuts in one gesture.** `remove_ranges` takes an *array*. The agent detects
  every silence and removes them in a single call, rippling all tracks together.
  Doing that by hand is 40+ precise drag operations; here it is one tool call.
- **Editing by meaning, not by timecode.** "Show the terminal when I mention the
  terminal" is `search_transcript` → `place_clip`. The agent works from what was
  *said*, which is not a thing you can express in a timeline UI.
- **Cutting to a hard runtime.** Set a target and `optimize_duration` escalates
  through passes that cost the viewer progressively more — dead air at tightening
  floors, then filler words, then whole sentences, stopping the moment it fits and
  naming every line it dropped. 108.7s → 60.0s in one call. That is a
  constraint-satisfaction problem humans are bad at and agents are good at.
- **Shared, inspectable state.** Drag a clip and the agent sees your change on its
  next `get_project_state`, reported as *"since your last check the person moved a
  clip to 14.0s"*, and works around it.

## The tools

Registered imperatively on the top-level document — no iframes, no declarative
form annotations — which is the subset [ChatGPT's built-in browser
supports](https://developers.openai.com/codex/webmcp).

| Tool | What it does |
| --- | --- |
| `optimize_duration` | **The main workflow.** Cut to a target runtime, escalating pass by pass until it fits |
| `get_project_state` | Runtime, every clip, active zooms, and what the person changed by hand |
| `search_transcript` | Find where something was said; returns timeline ranges |
| `find_silences` | Detect dead air via RMS analysis of the decoded audio |
| `remove_ranges` | **Batch.** Cut many spans at once; all tracks ripple together |
| `place_clip` | Put a recording on the video track at a moment |
| `trim_clip` | Change which part of a recording a clip shows |
| `move_clip` | Slide a clip to a different moment |
| `set_clip_speed` | Retime footage to keep pace with narration |
| `add_zoom` | Eased push-in on part of the frame, so small text is readable |
| `remove_clip` | Take a clip off the timeline |
| `preview_at` | Move the playhead so the person looks where you mean |
| `export_video` | Render in-tab and save the file |
| `get_export_status` | Poll a render's progress; rendering outlives the call that starts it |

**Dynamic registration.** At boot the agent sees 7 tools. Once footage is on the
video track, the clip-editing tools register and it sees 14 — verified in Chrome:

```
registeredAtBoot:        find_silences, get_project_state, optimize_duration,
                         place_clip, preview_at, remove_ranges, search_transcript
afterPlacingFootage:     + add_zoom, export_video, get_export_status, move_clip,
                           remove_clip, set_clip_speed, trim_clip
```

`preview_at` is the tool that best explains WebMCP: it changes nothing about the
edit and exists only to move *your* eyes to what the agent is talking about — the
preview rings and captions itself so the jump reads as the agent's decision. It
would be meaningless over a backend protocol.

**One code path.** The Optimize button and `optimize_duration` call the same
module and get the same report back, so a person and an agent can pick up after
each other mid-edit. There is no parallel agent path anywhere in the app.

**Narrated, not logged.** The Agent Activity panel leads with what each call
achieved in plain English — *"Removed 26.4s of dead air"*, *"Dropped 4 lines of
narration — 20.3s"* — and keeps the tool name and arguments underneath as
evidence. Your own edits land in the same feed, so collaboration reads as one
shared history.

### Tool design

Follows Chrome's [WebMCP guidance](https://developer.chrome.com/docs/ai/webmcp/best-practices):
one job per tool with no overlapping purposes, ≤30 char names, ≤500 char
descriptions, ≤150 char parameter descriptions, ≤1.5K char outputs.
`readOnlyHint` is set on tools that cannot change the edit; `untrustedContentHint`
is set on everything that returns recording-derived text.

Errors are written to help an agent recover rather than to fail:

```
set_clip_speed → "clip_k is now 2x and occupies 5.5s. Runtime is unchanged at
                  82.4s because the voiceover runs longer than this footage. To
                  shorten the video, cut narration: find_silences with a smaller
                  min_seconds, or search_transcript for a sentence to drop."
```

## Try it

A demo project is **already loaded** — a voiceover and three screen recordings —
so there is nothing to record or upload before you start.

1. Open the live URL in **ChatGPT's built-in browser**, or in **Chrome 149+** with
   `chrome://flags/#enable-webmcp-testing` enabled.
2. Check the badge, top right: *Agent mode · N tools* means WebMCP was detected.
   (`/probe.html` reports the same thing if you want to check your browser alone.)
3. Ask your agent for something like:

```
Cut all the dead air and the filler words out of this voiceover.

Put the terminal recording where I talk about the terminal, the dashboard
where I mention the dashboard, and the query plan where I talk about the
execution plan.

Zoom in on the "Rows Removed by Filter" line while I'm describing the bug.

Now get the whole thing under 70 seconds and export it.
```

Then drag a clip yourself and say *"what did I just change?"* — the agent reads it
back from `get_project_state`.

Without WebMCP the app degrades to an ordinary manual editor: everything is still
usable by hand, which is the progressive-enhancement contract WebMCP asks for.

## Running locally

```bash
npm install
npm run dev
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run test:ripple` | Unit tests for the timeline arithmetic (16 assertions) |
| `npm run check:webmcp` | Launch Chrome with WebMCP enabled and assert tools register |
| `npm run gen:assets` | Regenerate the bundled demo project |

`check:webmcp` attaches over the DevTools protocol to a real WebMCP-enabled Chrome
and asserts the tools register and execute — the app is verified against the actual
browser API, not only against a local harness.

## How it works

```
src/
  types.ts               project model — clips carry source in/out + speed
  engine/
    ripple.ts            pure timeline arithmetic (unit tested)
    silence.ts           windowed RMS silence detection; source↔timeline mapping
    media.ts             video elements + decoded AudioBuffers
    player.ts            compositor + transport, driven by the AudioContext clock
    export.ts            canvas capture → MediaRecorder
  store/project.ts       single source of truth for the UI and the tools alike
  webmcp/tools.ts        the toolset, built as data then registered
  components/            preview, timeline, transcript
```

Three decisions worth calling out:

**One render path.** Preview and export run the exact same compositor, so what you
export is what you watched. Export drives it in real time and captures with
`MediaRecorder`.

**The audio clock is the master.** Playback time comes from `AudioContext`, not
from `requestAnimationFrame`, so audio and video cannot drift apart.

**Export survives a hidden tab.** Browsers stop `requestAnimationFrame` and clamp
`setTimeout` in background tabs, which would silently truncate a render. The export
clock is a `Worker` timer and frames are pushed explicitly via `requestFrame()`, so
a render completes even if you switch away.

**Ripple deletes are the hard part.** Cutting a span splits straddling clips, maps
timeline time into source time through each clip's `speed`, and shifts everything
downstream — across every track at once, so narration and footage stay locked.
That logic is pure and has its own tests.

## The demo assets are synthetic

`public/demo/` is generated by `scripts/generate-demo-assets.mjs` and committed so
the demo works instantly:

- The voiceover is macOS `say`, rendered one phrase at a time and concatenated with
  deliberate silences and filler words. Because it is assembled phrase by phrase,
  every phrase's exact start and end is known, so `transcript.json` carries real
  timestamps rather than ASR guesses.
- The "screen recordings" are real HTML/CSS pages rendered by headless Chrome and
  encoded with ffmpeg.

**The silence detection is not faked.** `find_silences` runs windowed RMS analysis
over the decoded audio at runtime and finds the gaps for itself.

## Limitations

- Export renders in real time (a 70s video takes ~70s), because it captures the
  live compositor. A `WebCodecs` encode path would be faster and is the obvious
  next step.
- Transcription is not yet computed in-browser; the bundled project ships a
  pre-computed transcript. Recording your own voiceover would need Whisper via
  `transformers.js` or a transcription API.
- One video track and one audio track. No transitions beyond hard cuts.
- Needs a WebMCP-capable browser for agent mode; manual editing works anywhere.

## License

MIT — see [LICENSE](LICENSE).
