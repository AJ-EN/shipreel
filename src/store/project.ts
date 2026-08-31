import { create } from 'zustand'
import type { Clip, MediaAsset, Transcript, ZoomRegion, EditEntry } from '../types'
import { rippleDelete, clipSpan, clipEnd, uid, type Range } from '../engine/ripple'
import { useActivity } from './activity'

interface State {
  loaded: boolean
  assets: MediaAsset[]
  clips: Clip[]
  zooms: ZoomRegion[]
  transcript: Transcript | null
  /** Silence ranges detected in the voiceover, in ORIGINAL asset time. */
  detectedSilences: Range[]
  editLog: EditEntry[]
  /** Marks how much of editLog the agent has already been told about. */
  readCursor: number
  playhead: number
  selectedClipId: string | null

  load: (assets: MediaAsset[], transcript: Transcript, silences: Range[]) => void
  note: (by: 'user' | 'agent', description: string) => void
  drainUserEdits: () => string[]

  duration: () => number
  clipsOn: (track: 'video' | 'audio') => Clip[]

  removeRanges: (ranges: Range[], by: 'user' | 'agent') => number
  placeClip: (mediaId: string, at: number, inPt: number, outPt: number, by: 'user' | 'agent') => Clip
  moveClip: (id: string, start: number, by: 'user' | 'agent') => void
  trimClip: (id: string, inPt: number, outPt: number, by: 'user' | 'agent') => void
  setSpeed: (id: string, speed: number, by: 'user' | 'agent') => void
  removeClip: (id: string, by: 'user' | 'agent') => void
  addZoom: (z: Omit<ZoomRegion, 'id'>, by: 'user' | 'agent') => ZoomRegion
  clearZooms: (by: 'user' | 'agent') => void
  setPlayhead: (t: number) => void
  select: (id: string | null) => void
}

export const useProject = create<State>((set, get) => ({
  loaded: false,
  assets: [],
  clips: [],
  zooms: [],
  transcript: null,
  detectedSilences: [],
  editLog: [],
  readCursor: 0,
  playhead: 0,
  selectedClipId: null,

  load: (assets, transcript, silences) => {
    const vo = assets.find((a) => a.kind === 'audio')!
    set({
      loaded: true,
      assets,
      transcript,
      detectedSilences: silences,
      // Raw take: the full voiceover on the audio track, nothing on video yet.
      clips: [{ id: uid('clip'), mediaId: vo.id, track: 'audio', start: 0, in: 0, out: vo.duration, speed: 1 }],
      zooms: [],
      editLog: [],
      readCursor: 0,
      playhead: 0,
    })
  },

  note: (by, description) => {
    set((s) => ({ editLog: [...s.editLog, { by, description }] }))
    // Agent actions are already logged by the tool wrapper; only surface the
    // person's own edits here so the feed reads as one shared history.
    if (by === 'user') useActivity.getState().note('user', 'you edited', description)
  },

  drainUserEdits: () => {
    const { editLog, readCursor } = get()
    const fresh = editLog.slice(readCursor).filter((e) => e.by === 'user').map((e) => e.description)
    set({ readCursor: editLog.length })
    return fresh
  },

  duration: () => get().clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0),

  clipsOn: (track) => get().clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start),

  removeRanges: (ranges, by) => {
    const { clips, zooms, removed, cuts } = rippleDelete(get().clips, get().zooms, ranges)
    if (!cuts) return 0
    set({ clips, zooms })
    get().note(by, `cut ${cuts} range(s), ${removed.toFixed(1)}s removed`)
    return removed
  },

  placeClip: (mediaId, at, inPt, outPt, by) => {
    const asset = get().assets.find((a) => a.id === mediaId)!
    const clip: Clip = {
      id: uid('clip'), mediaId, track: asset.kind,
      start: Math.max(0, at), in: Math.max(0, inPt), out: Math.min(asset.duration, outPt), speed: 1,
    }
    set((s) => ({ clips: [...s.clips, clip] }))
    get().note(by, `placed "${asset.label}" at ${at.toFixed(1)}s`)
    return clip
  },

  moveClip: (id, start, by) => {
    set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, start: Math.max(0, start) } : c)) }))
    get().note(by, `moved clip to ${start.toFixed(1)}s`)
  },

  trimClip: (id, inPt, outPt, by) => {
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c
        const asset = s.assets.find((a) => a.id === c.mediaId)!
        const i = Math.max(0, Math.min(inPt, asset.duration - 0.1))
        const o = Math.max(i + 0.1, Math.min(outPt, asset.duration))
        return { ...c, in: i, out: o }
      }),
    }))
    get().note(by, `trimmed clip to ${(outPt - inPt).toFixed(1)}s`)
  },

  setSpeed: (id, speed, by) => {
    const sp = Math.max(0.25, Math.min(8, speed))
    set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, speed: sp } : c)) }))
    get().note(by, `set clip speed to ${sp}x`)
  },

  removeClip: (id, by) => {
    set((s) => ({ clips: s.clips.filter((c) => c.id !== id) }))
    get().note(by, 'removed a clip')
  },

  addZoom: (z, by) => {
    const zoom: ZoomRegion = { ...z, id: uid('zoom') }
    set((s) => ({ zooms: [...s.zooms, zoom] }))
    get().note(by, `added ${z.scale}x zoom at ${z.start.toFixed(1)}s`)
    return zoom
  },

  clearZooms: (by) => {
    set({ zooms: [] })
    get().note(by, 'cleared all zooms')
  },

  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  select: (id) => set({ selectedClipId: id }),
}))

export { clipSpan, clipEnd }
export type { Range }
