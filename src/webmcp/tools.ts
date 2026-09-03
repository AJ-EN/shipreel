/**
 * ShipReel's WebMCP surface.
 *
 * Every tool drives the same store and the same render engine the human UI
 * uses — there is no parallel "agent path". Tools are registered imperatively
 * on the top-level document (no iframes, no declarative forms) because that is
 * the subset ChatGPT's built-in browser supports.
 *
 * Conventions follow Chrome's WebMCP guidance: one job per tool, no
 * overlapping purposes, <=500 char descriptions, <=1.5K char outputs, and
 * errors that tell the agent how to recover instead of just failing.
 */
import { useProject } from '../store/project'
import { useActivity, summariseArgs } from '../store/activity'
import { clipSpan, clipEnd, type Range } from '../engine/ripple'
import { sourceRangeToTimeline } from '../engine/silence'
import type { Player } from '../engine/player'
import { pickMimeType, exportTimeline } from '../engine/export'
import { optimizeToTarget, type OptimizeReport } from '../engine/optimize'
import { useExport } from '../store/exportState'
import { useSpotlight } from '../store/spotlight'
import type { Clip, MediaAsset } from '../types'

const OUTPUT_BUDGET = 1500
const cap = (s: string) => (s.length <= OUTPUT_BUDGET ? s : `${s.slice(0, OUTPUT_BUDGET - 20)}\n… (truncated)`)
const t = (n: number) => `${n.toFixed(1)}s`
/** Timestamps get two decimals: agents pass these straight back as cut points. */
const ts = (n: number) => `${n.toFixed(2)}s`

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

function findMedia(query: string): MediaAsset | string {
  const assets = useProject.getState().assets
  const q = norm(query)
  const hit =
    assets.find((a) => norm(a.id) === q) ??
    assets.find((a) => norm(a.label).includes(q)) ??
    assets.find((a) => q.includes(norm(a.id)))
  if (hit) return hit
  return `No media matching "${query}". Available: ${assets.map((a) => `${a.id} (${t(a.duration)})`).join(', ')}.`
}

function findClip(id: string): Clip | string {
  const clip = useProject.getState().clips.find((c) => c.id === id)
  if (clip) return clip
  const ids = useProject.getState().clips.filter((c) => c.track === 'video').map((c) => c.id)
  return ids.length
    ? `No clip with id "${id}". Current video clip ids: ${ids.join(', ')}. Call get_project_state for details.`
    : 'There is no footage on the video track yet. Use place_clip to add a recording first.'
}

const describeClip = (c: Clip, assets: MediaAsset[]) => {
  const label = assets.find((a) => a.id === c.mediaId)?.id ?? c.mediaId
  const sp = c.speed === 1 ? '' : ` ${c.speed}x`
  return `${c.id} ${t(c.start)}-${t(clipEnd(c))} ${label} [src ${t(c.in)}-${t(c.out)}]${sp}`
}

// ---------------------------------------------------------------- registry --

/**
 * Tools are built as plain data first and registered second. That keeps the
 * definitions testable without a browser agent: `window.shipreel.tools`
 * exposes this same array, so the whole edit flow can be driven from the
 * console in browsers where document.modelContext is not available.
 */
export function buildToolset(player: Player) {
  const base: WebMCPToolDescriptor[] = []
  const editing: WebMCPToolDescriptor[] = []

  /**
   * Wraps every tool so each call appears in the Agent Activity panel as it
   * happens — as plain English first, with the tool name and arguments kept
   * underneath as evidence. The person can watch the agent work rather than
   * inferring it from the timeline jumping around.
   */
  const reg = (tool: WebMCPToolDescriptor, group: WebMCPToolDescriptor[]) => {
    group.push({
      ...tool,
      execute: async (input: unknown, ctx?: { signal?: AbortSignal }) => {
        const id = useActivity.getState().start('tool', tool.name, summariseArgs(input))
        try {
          const out = await tool.execute(input, ctx)
          const text = String(out)
          let line: string | undefined
          try {
            line = HEADLINES[tool.name]?.(input as any, text)
          } catch {
            // A cosmetic label must never break the tool call it describes.
          }
          useActivity.getState().finish(id, text, 'ok', line)
          return out
        } catch (e) {
          useActivity.getState().finish(id, e instanceof Error ? e.message : String(e), 'error')
          throw e
        }
      },
    })
  }

  // ------------------------------------------------------------ read tools --
  reg({
    name: 'get_project_state',
    description:
      'Read the current edit: total runtime, every clip with its timeline position and source range, active zooms, and the media available to place. Also reports any changes the person made by hand since you last checked. Call this first, after the person edits something, and to check runtime when cutting to a target length.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    // Reading state is harmless, so the agent should never need to ask permission.
    annotations: { readOnlyHint: true, openWorldHint: false, untrustedContentHint: true },
    execute: () => {
      const s = useProject.getState()
      const video = s.clipsOn('video')
      const audio = s.clipsOn('audio')
      const edits = s.drainUserEdits()
      const lines: string[] = [
        `Runtime: ${t(s.duration())}. Video clips: ${video.length}. Audio segments: ${audio.length}.`,
      ]
      if (video.length) {
        lines.push('Video track:')
        video.slice(0, 8).forEach((c) => lines.push(`  ${describeClip(c, s.assets)}`))
        if (video.length > 8) lines.push(`  … +${video.length - 8} more`)
      } else {
        lines.push('Video track is empty — the voiceover is playing over a blank frame.')
      }
      lines.push(`Audio: ${audio.length} segment(s), ${t(audio.reduce((m, c) => m + clipSpan(c), 0))} of speech.`)
      if (s.zooms.length) {
        lines.push(`Zooms: ${s.zooms.map((z) => `${t(z.start)}-${t(z.end)} ${z.scale}x`).join(', ')}`)
      }
      lines.push(`Media available: ${s.assets.map((a) => `${a.id} (${t(a.duration)})`).join(', ')}`)
      if (edits.length) lines.push(`Since your last check the person: ${edits.join('; ')}.`)
      return cap(lines.join('\n'))
    },
  }, base)

  reg({
    name: 'search_transcript',
    description:
      'Find where something was said in the voiceover. Returns the matching moments as timeline ranges you can pass to remove_ranges, place_clip or add_zoom. Use it to sync footage to narration, or to locate filler words like "um" so they can be cut.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for, e.g. "here is the terminal" or "um".' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    // Transcript text comes from a recording the person supplied: untrusted.
    annotations: { readOnlyHint: true, openWorldHint: false, untrustedContentHint: true },
    execute: ({ query }: { query: string }) => {
      const s = useProject.getState()
      if (!s.transcript) return 'No transcript is loaded yet, so the voiceover cannot be searched.'
      const tokens = norm(query).split(' ').filter(Boolean)
      if (!tokens.length) return 'Provide at least one word to search for.'

      const flat = s.transcript.segments.flatMap((seg) =>
        seg.words.map((w, idx) => ({ ...w, seg, idx, count: seg.words.length })),
      )
      const hits: string[] = []
      for (let i = 0; i + tokens.length <= flat.length; i++) {
        const run = flat.slice(i, i + tokens.length)
        if (!run.every((w, k) => norm(w.word) === tokens[k])) continue

        // When the match spans an entire phrase, return the phrase's own
        // bounds. Word timings sit just inside them, and cutting to the word
        // would leave a sliver of audio behind.
        const head = run[0]
        const tail = run[run.length - 1]
        const wholePhrase = head.seg === tail.seg && head.idx === 0 && tail.idx === tail.count - 1
        const src = wholePhrase
          ? { start: head.seg.start, end: head.seg.end }
          : { start: head.start, end: tail.end }

        const tl = sourceRangeToTimeline(s.clips, flatMediaId(s), src)
        // Skip anything already cut, and anything reduced to a sliver: handing
        // back a zero-width range would only invite a no-op cut.
        if (!tl || tl.end - tl.start < 0.05) continue
        hits.push(
          `${ts(tl.start)}-${ts(tl.end)}${head.seg.filler ? ' [filler]' : ''} — "${head.seg.text.slice(0, 90)}"`,
        )
        if (hits.length >= 8) break
      }
      if (!hits.length) {
        return `Nothing in the voiceover matches "${query}". Try fewer or different words; get_project_state lists what is on the timeline.`
      }
      return cap(`${hits.length} match(es) for "${query}":\n${hits.join('\n')}`)
    },
  }, base)

  reg({
    name: 'find_silences',
    description:
      'Detect dead air in the voiceover and return it as timeline ranges. Pass the whole list straight to remove_ranges to tighten the edit in one pass. Lower min_seconds to reclaim more time when cutting to a target runtime; raise it to keep natural pauses.',
    inputSchema: {
      type: 'object',
      properties: {
        min_seconds: {
          type: 'number',
          description: 'Shortest gap to report. Defaults to 0.4. Use 1.0 to only find long pauses.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: ({ min_seconds }: { min_seconds?: number }) => {
      const s = useProject.getState()
      const floor = min_seconds ?? 0.4
      const mediaId = flatMediaId(s)
      const mapped = s.detectedSilences
        .filter((r) => r.end - r.start >= floor)
        .map((r) => sourceRangeToTimeline(s.clips, mediaId, r))
        .filter((r): r is Range => r !== null)

      if (!mapped.length) {
        return `No gaps of ${floor}s or longer remain in the voiceover. Lower min_seconds to find shorter pauses.`
      }
      // List every range that fits the output budget. Truncating while still
      // reporting the full count would quietly strand the remainder: an agent
      // cuts what it was handed and believes the job is done.
      const MAX_LISTED = 60
      const total = mapped.reduce((m, r) => m + (r.end - r.start), 0)
      const shown = mapped.slice(0, MAX_LISTED)
      const listed = shown.map((r) => `${ts(r.start)}-${ts(r.end)}`).join(', ')
      const more = mapped.length > MAX_LISTED
        ? `\nThese are the first ${MAX_LISTED} of ${mapped.length}. Cut them, then call find_silences again for the rest.`
        : ''
      return cap(
        `${mapped.length} silence(s) of ${floor}s+, ${t(total)} in total. ` +
        `Pass every range below to remove_ranges in one call:\n${listed}${more}`,
      )
    },
  }, base)

  reg({
    name: 'optimize_duration',
    description:
      'Cut the edit down to a target runtime and keep going until it fits. Reclaims dead air first, then filler words, then drops the longest sentences one at a time — stopping the moment the target is met. Reports every pass it ran and names any narration it dropped. Set keep_narration to stop before the last step and hand back candidates instead.',
    inputSchema: {
      type: 'object',
      properties: {
        target_seconds: { type: 'number', description: 'Runtime to come in under, e.g. 60 for a one-minute cut.' },
        keep_narration: {
          type: 'boolean',
          description: 'Stop before dropping any spoken lines and report what could go instead. Defaults to false.',
        },
      },
      required: ['target_seconds'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    execute: async ({ target_seconds, keep_narration }: { target_seconds: number; keep_narration?: boolean }) =>
      cap(describeOptimize(await optimizeToTarget(target_seconds, { keepNarration: keep_narration === true }))),
  }, base)

  // ----------------------------------------------------------- write tools --
  reg({
    name: 'remove_ranges',
    description:
      'Cut one or many spans out of the timeline in a single pass and close the gaps. Every track ripples together so narration and footage stay in sync. This is the fast way to strip silences or filler words: pass the whole list at once rather than calling repeatedly.',
    inputSchema: {
      type: 'object',
      properties: {
        ranges: {
          type: 'array',
          description: 'Spans to delete, in timeline seconds.',
          items: {
            type: 'object',
            properties: {
              start: { type: 'number', description: 'Timeline second where the cut begins.' },
              end: { type: 'number', description: 'Timeline second where the cut ends.' },
            },
            required: ['start', 'end'],
          },
        },
      },
      required: ['ranges'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    execute: ({ ranges }: { ranges: Range[] }) => {
      if (!Array.isArray(ranges) || !ranges.length) {
        return 'Provide at least one range. Call find_silences or search_transcript to get ranges worth cutting.'
      }
      // One unusable range should not throw away a batch of good ones — drop it
      // and say so, so a long list of cuts still lands.
      const usable = ranges.filter(
        (r) => typeof r?.start === 'number' && typeof r?.end === 'number' && r.end - r.start > 0.02,
      )
      const skipped = ranges.length - usable.length
      if (!usable.length) {
        return `None of those ${ranges.length} range(s) were usable — each needs a numeric start and an end at least 0.02s later. Call find_silences for ranges that can be cut.`
      }

      const before = useProject.getState().duration()
      const removed = useProject.getState().removeRanges(usable, 'agent')
      const after = useProject.getState().duration()
      if (!removed) return 'Those ranges did not overlap anything on the timeline. Nothing was cut.'
      const note = skipped ? ` Skipped ${skipped} empty range(s).` : ''
      return `Cut ${t(removed)} across ${usable.length} range(s).${note} Runtime ${t(before)} → ${t(after)}.`
    },
  }, base)

  reg({
    name: 'place_clip',
    description:
      'Put a screen recording onto the video track at a moment in the timeline. Pair it with search_transcript so footage lands exactly where the narration mentions it. Leave source_start and source_end out to use the whole recording.',
    inputSchema: {
      type: 'object',
      properties: {
        media: { type: 'string', description: 'Which recording to place, e.g. "terminal" or "dashboard".' },
        at: { type: 'number', description: 'Timeline second where the clip should begin.' },
        source_start: { type: 'number', description: 'Optional in-point within the recording, in seconds.' },
        source_end: { type: 'number', description: 'Optional out-point within the recording, in seconds.' },
      },
      required: ['media', 'at'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    execute: ({ media, at, source_start, source_end }: { media: string; at: number; source_start?: number; source_end?: number }) => {
      const asset = findMedia(media)
      if (typeof asset === 'string') return asset
      if (asset.kind !== 'video') return `"${asset.id}" is the voiceover, not footage. place_clip takes a screen recording.`
      const i = source_start ?? 0
      const o = source_end ?? asset.duration
      if (o <= i) return `source_end (${o}) must be greater than source_start (${i}).`
      const clip = useProject.getState().placeClip(asset.id, at, i, o, 'agent')
      return `Placed ${asset.id} at ${t(clip.start)}-${t(clipEnd(clip))} as ${clip.id}. Runtime is now ${t(useProject.getState().duration())}.`
    },
  }, base)

  reg({
    name: 'preview_at',
    description:
      'Move the playhead so the person is looking at a specific moment. Use it to show what you just changed, or to point at something you are about to describe. It only moves the view; it never alters the edit.',
    inputSchema: {
      type: 'object',
      properties: { time: { type: 'number', description: 'Timeline second to jump to.' } },
      required: ['time'],
      additionalProperties: false,
    },
    // Purely a view change — safe to call freely.
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async ({ time }: { time: number }) => {
      const s = useProject.getState()
      const dur = s.duration()
      if (dur === 0) return 'The timeline is empty, so there is nothing to preview yet.'
      const at = Math.max(0, Math.min(time, dur))
      s.setPlayhead(at)
      await player.renderAt(at)
      const clip = s.clipsOn('video').find((c) => at >= c.start && at < clipEnd(c))
      // Mark the frame as the agent's doing, so the jump reads as deliberate
      // rather than as the preview wandering off on its own.
      useSpotlight.getState().show(at, clip ? `showing ${clip.mediaId}` : 'blank frame here')
      return `Playhead moved to ${t(at)} of ${t(dur)}. ${clip ? `Showing ${clip.mediaId}.` : 'No footage at this moment — blank frame.'}`
    },
  }, base)

  // -------- tools that only make sense once there is footage on the track --
  {
    {
      reg({
        name: 'trim_clip',
        description: 'Change which part of a recording a clip shows, without moving where it sits on the timeline. Use it to drop a slow lead-in or a dead tail.',
        inputSchema: {
          type: 'object',
          properties: {
            clip_id: { type: 'string', description: 'Clip to trim, from get_project_state.' },
            source_start: { type: 'number', description: 'New in-point within the recording, in seconds.' },
            source_end: { type: 'number', description: 'New out-point within the recording, in seconds.' },
          },
          required: ['clip_id', 'source_start', 'source_end'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        execute: ({ clip_id, source_start, source_end }: { clip_id: string; source_start: number; source_end: number }) => {
          const clip = findClip(clip_id)
          if (typeof clip === 'string') return clip
          if (source_end <= source_start) return `source_end (${source_end}) must be greater than source_start (${source_start}).`
          useProject.getState().trimClip(clip_id, source_start, source_end, 'agent')
          const now = useProject.getState().clips.find((c) => c.id === clip_id)!
          return `${clip_id} now shows ${t(now.in)}-${t(now.out)} of ${now.mediaId} and occupies ${t(clipSpan(now))}.`
        },
      }, editing)

      reg({
        name: 'move_clip',
        description: 'Slide a clip to a different moment on the timeline. The clip keeps its length and its source range.',
        inputSchema: {
          type: 'object',
          properties: {
            clip_id: { type: 'string', description: 'Clip to move, from get_project_state.' },
            to: { type: 'number', description: 'Timeline second the clip should now start at.' },
          },
          required: ['clip_id', 'to'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        execute: ({ clip_id, to }: { clip_id: string; to: number }) => {
          const clip = findClip(clip_id)
          if (typeof clip === 'string') return clip
          useProject.getState().moveClip(clip_id, to, 'agent')
          return `${clip_id} now starts at ${t(Math.max(0, to))}.`
        },
      }, editing)

      reg({
        name: 'set_clip_speed',
        description: 'Speed a clip up or slow it down. Use 2 or 3 to push through a slow build or loading screen so the footage keeps pace with the narration. This changes how long the clip occupies, which only shortens the whole video when that clip is what ends it.',
        inputSchema: {
          type: 'object',
          properties: {
            clip_id: { type: 'string', description: 'Clip to retime, from get_project_state.' },
            speed: { type: 'number', description: 'Playback rate. 1 is realtime, 2 is twice as fast. Range 0.25 to 8.' },
          },
          required: ['clip_id', 'speed'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        execute: ({ clip_id, speed }: { clip_id: string; speed: number }) => {
          const clip = findClip(clip_id)
          if (typeof clip === 'string') return clip
          if (!(speed > 0)) return 'Speed must be a positive number, for example 2 for double speed.'
          const before = useProject.getState().duration()
          useProject.getState().setSpeed(clip_id, speed, 'agent')
          const now = useProject.getState().clips.find((c) => c.id === clip_id)!
          const after = useProject.getState().duration()
          if (Math.abs(after - before) < 0.05) {
            return `${clip_id} is now ${now.speed}x and occupies ${t(clipSpan(now))}. Runtime is unchanged at ${t(after)} because the voiceover runs longer than this footage. To shorten the video, cut narration: find_silences with a smaller min_seconds, or search_transcript for a sentence to drop and pass it to remove_ranges.`
          }
          return `${clip_id} is now ${now.speed}x and occupies ${t(clipSpan(now))}. Runtime ${t(before)} → ${t(after)}.`
        },
      }, editing)

      reg({
        name: 'add_zoom',
        description: 'Push the camera in on part of the frame for a stretch of time, so small text is readable. The move eases in and out on its own. Coordinates are fractions of the frame: 0,0 is top-left and 1,1 is bottom-right.',
        inputSchema: {
          type: 'object',
          properties: {
            start: { type: 'number', description: 'Timeline second the zoom begins.' },
            end: { type: 'number', description: 'Timeline second the zoom ends.' },
            x: { type: 'number', description: 'Horizontal focal point, 0 to 1. 0.5 is centred.' },
            y: { type: 'number', description: 'Vertical focal point, 0 to 1. 0.5 is centred.' },
            scale: { type: 'number', description: 'Magnification. 1.6 is gentle, 2.5 is tight. Range 1 to 4.' },
          },
          required: ['start', 'end', 'x', 'y', 'scale'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        execute: ({ start, end, x, y, scale }: { start: number; end: number; x: number; y: number; scale: number }) => {
          if (end <= start) return `end (${end}) must be greater than start (${start}).`
          if (scale <= 1) return 'Scale must be greater than 1 to zoom in. Try 1.8.'
          const dur = useProject.getState().duration()
          if (start >= dur) return `The timeline is only ${t(dur)} long, so a zoom at ${t(start)} would never be seen.`
          const z = useProject.getState().addZoom(
            { start, end: Math.min(end, dur), x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), scale: Math.min(4, scale) },
            'agent',
          )
          return `Added a ${z.scale}x zoom from ${t(z.start)} to ${t(z.end)} centred on (${z.x}, ${z.y}).`
        },
      }, editing)

      reg({
        name: 'remove_clip',
        description: 'Take a clip off the timeline. Other clips keep their positions, leaving a gap where it was.',
        inputSchema: {
          type: 'object',
          properties: { clip_id: { type: 'string', description: 'Clip to remove, from get_project_state.' } },
          required: ['clip_id'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        execute: ({ clip_id }: { clip_id: string }) => {
          const clip = findClip(clip_id)
          if (typeof clip === 'string') return clip
          useProject.getState().removeClip(clip_id, 'agent')
          return `Removed ${clip_id}. Runtime is now ${t(useProject.getState().duration())}.`
        },
      }, editing)

      reg({
        name: 'get_export_status',
        description:
          'Check how the current render is going. Reports whether it is idle, rendering (with progress), finished, or failed. Poll this after export_video rather than assuming the file is ready; a render takes roughly as long as the video.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
        execute: () => {
          const e = useExport.getState()
          switch (e.phase) {
            case 'idle':
              return 'No render has been started. Call export_video to begin one.'
            case 'rendering':
              return `Rendering ${Math.round(e.progress * 100)}% of "${e.filename}". Check again shortly — the tab must stay open until it finishes.`
            case 'ready':
              return `Render complete: "${e.filename}" — ${e.videoSeconds?.toFixed(1)}s of ${e.format} video, ${e.sizeKB}KB, rendered in ${e.elapsed?.toFixed(1)}s. The file has been saved to the person's downloads.`
            case 'error':
              return `The render failed: ${e.message}. Check the timeline is not empty and try export_video again.`
          }
        },
      }, editing)

      reg({
        name: 'export_video',
        description:
          'Render the finished timeline to a video file and save it to the person\'s computer. Rendering happens in the tab and runs for about as long as the video, so this returns straight away and the download appears when it finishes.',
        inputSchema: {
          type: 'object',
          properties: { filename: { type: 'string', description: 'Name for the saved file, without an extension.' } },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        execute: ({ filename }: { filename?: string }) => {
          const dur = useProject.getState().duration()
          if (dur < 0.5) return 'There is nothing on the timeline to export yet.'
          if (!pickMimeType()) return 'This browser cannot record video, so export is unavailable here. Try Chrome.'
          if (useExport.getState().phase === 'rendering') {
            return 'A render is already in progress. Call get_export_status to follow it.'
          }
          void useExport.getState().run(player, filename)
          return `Render started for a ${t(dur)} cut. It runs in real time, so expect about ${Math.ceil(dur)}s. Call get_export_status to check progress; the file downloads on its own when it is done.`
        },
      }, editing)
    }
  }

  return { base, editing }
}

/**
 * Registers the toolset against document.modelContext.
 *
 * Clip-editing tools are registered only once there is footage on the video
 * track, and retired when there is not, so the agent is never offered an
 * action it cannot meaningfully take.
 */
export function installWebMCP(player: Player): () => void {
  const { base, editing } = buildToolset(player)
  // Debug/eval hook: lets the toolset be driven without a browser agent, the
  // way document.modelContext.executeTool would in a WebMCP-capable browser.
  ;(window as any).shipreel = {
    tools: [...base, ...editing],
    player,
    exportTimeline,
    optimizeToTarget,
    stores: { project: useProject, activity: useActivity, exportState: useExport, spotlight: useSpotlight },
  }

  const mc = document.modelContext
  if (!mc?.registerTool) return () => {}

  const baseAbort = new AbortController()
  for (const tool of base) {
    void mc.registerTool(tool, { signal: baseAbort.signal })
      .catch((e) => console.warn('[webmcp] could not register', tool.name, e))
  }

  let editingAbort: AbortController | null = null
  const sync = () => {
    const hasVideo = useProject.getState().clips.some((c) => c.track === 'video')
    if (hasVideo && !editingAbort) {
      editingAbort = new AbortController()
      for (const tool of editing) {
        void mc.registerTool(tool, { signal: editingAbort.signal })
          .catch((e) => console.warn('[webmcp] could not register', tool.name, e))
      }
    } else if (!hasVideo && editingAbort) {
      editingAbort.abort()
      editingAbort = null
    }
  }

  sync()
  const unsubscribe = useProject.subscribe(sync)
  return () => {
    unsubscribe()
    baseAbort.abort()
    editingAbort?.abort()
  }
}

// --------------------------------------------------------------- narration --

/**
 * How each tool call reads in the Agent Activity panel.
 *
 * The panel leads with these lines and keeps the tool name and arguments
 * underneath, so someone watching a demo can follow what the agent achieved
 * without knowing the tool surface, while anyone who cares can still see the
 * exact call that produced it.
 *
 * Every entry falls back to the tool's own first sentence, so a wording change
 * downgrades the panel to something still truthful rather than to nothing.
 */
const first = (r: string) => r.split('\n')[0].split('. ')[0].replace(/\.$/, '')
const num = (r: string, re: RegExp) => r.match(re)?.[1]

const HEADLINES: Record<string, (input: any, result: string) => string> = {
  get_project_state: (_i, r) => {
    const edit = r.match(/Since your last check the person: (.+?)\.?$/m)
    if (edit) return `Picked up your edit — ${edit[1]}`
    const runtime = num(r, /Runtime: ([\d.]+s)/)
    const clips = num(r, /Video clips: (\d+)/)
    return runtime ? `Checked the timeline — ${runtime}, ${clips ?? 0} clip(s)` : first(r)
  },

  search_transcript: (i: { query: string }, r) => {
    const at = num(r, /([\d.]+)s-[\d.]+s/)
    return at ? `Found “${i.query}” in the narration at ${(+at).toFixed(1)}s` : `No mention of “${i.query}” in the narration`
  },

  find_silences: (_i, r) => {
    const n = num(r, /^(\d+) silence/)
    const total = num(r, /, ([\d.]+s) in total/)
    return n ? `Analysed the voiceover — ${n} silent sections, ${total} of dead air` : 'Analysed the voiceover — no dead air left'
  },

  optimize_duration: (i: { target_seconds: number }, r) => {
    if (/^Target met/.test(r)) return `Hit the ${i.target_seconds}s target — now ${num(r, /→ ([\d.]+s)/) ?? ''}`.trim()
    const now = num(r, /^Now ([\d.]+s)/)
    return now ? `Reached ${now}, still over the ${i.target_seconds}s target` : first(r)
  },

  remove_ranges: (_i, r) => {
    const cut = num(r, /^Cut ([\d.]+s)/)
    const n = num(r, /across (\d+) range/)
    const to = num(r, /→ ([\d.]+s)/)
    return cut ? `Removed ${cut} across ${n} cut(s) — runtime now ${to}` : first(r)
  },

  place_clip: (i: { media: string }, r) => {
    const at = num(r, /at ([\d.]+s)-/)
    return at ? `Placed the ${i.media} recording at ${at}` : first(r)
  },

  preview_at: (_i, r) => {
    const at = num(r, /moved to ([\d.]+s)/)
    const showing = num(r, /Showing ([\w-]+)/)
    if (!at) return first(r)
    return `Previewing ${at} for you${showing ? ` — showing ${showing}` : ''}`
  },

  trim_clip: (_i, r) => {
    const span = num(r, /occupies ([\d.]+s)/)
    const media = num(r, /of ([\w-]+) and/)
    return span ? `Trimmed the ${media ?? ''} clip to ${span}`.replace('  ', ' ') : first(r)
  },

  move_clip: (_i, r) => {
    const at = num(r, /starts at ([\d.]+s)/)
    return at ? `Moved the clip to ${at}` : first(r)
  },

  set_clip_speed: (_i, r) => {
    const sp = num(r, /is now ([\d.]+)x/)
    return sp ? `Set the clip to ${sp}× speed` : first(r)
  },

  add_zoom: (_i, r) => {
    const scale = num(r, /a ([\d.]+)x zoom/)
    const at = num(r, /from ([\d.]+s)/)
    return scale ? `Zoomed in ${scale}× at ${at}` : first(r)
  },

  remove_clip: (_i, r) => (/^Removed/.test(r) ? 'Took a clip off the timeline' : first(r)),

  export_video: (_i, r) => {
    const dur = num(r, /for a ([\d.]+s) cut/)
    return dur ? `Started rendering a ${dur} cut` : first(r)
  },

  get_export_status: (_i, r) => {
    if (/^Render complete/.test(r)) return `Render complete — ${num(r, /"([^"]+)"/) ?? 'file saved'}`
    if (/^Rendering/.test(r)) return `Rendering ${num(r, /Rendering (\d+%)/) ?? ''}`.trim()
    if (/^The render failed/.test(r)) return 'The render failed'
    return 'No render running'
  },
}

/** The voiceover asset id — the only audio source in a project today. */
function flatMediaId(s: ReturnType<typeof useProject.getState>) {
  return s.assets.find((a) => a.kind === 'audio')?.id ?? ''
}

/**
 * Turns an optimizer run into text an agent can act on.
 *
 * The passes are listed in the order they ran so the agent can see how the
 * time was reclaimed, and any dropped narration is quoted back verbatim —
 * losing a line silently would be the one thing an editor could not forgive.
 */
function describeOptimize(r: OptimizeReport): string {
  if (r.noop) return `${r.noop} Nothing to cut.`

  const lines: string[] = []
  if (r.met) {
    lines.push(`Target met: ${t(r.start)} → ${t(r.end)}, inside the ${r.target}s target.`)
  } else {
    lines.push(
      `Now ${t(r.end)} after reclaiming ${t(r.start - r.end)}, still ${t(r.end - r.target)} over the ${r.target}s target.`,
    )
  }
  if (r.steps.length) lines.push(...r.steps.map((s) => `  · ${s.label}`))

  if (r.dropped.length) {
    lines.push(`Narration dropped (${r.dropped.length}), say so if any should come back:`)
    lines.push(...r.dropped.map((d) => `  − "${d.text.slice(0, 70)}" (${t(d.seconds)})`))
  }

  if (!r.met) {
    if (r.candidates.length) {
      lines.push('Longest lines still in the edit:')
      lines.push(...r.candidates.map((c) => `  ${ts(c.start)}-${ts(c.end)} (${t(c.seconds)}) "${c.text.slice(0, 55)}"`))
      lines.push('Pass the ranges you can spare to remove_ranges.')
    } else {
      lines.push('Nothing further can be cut without emptying the timeline.')
    }
  }
  return lines.join('\n')
}
