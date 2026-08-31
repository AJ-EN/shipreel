/** Core project model. All times are seconds (floats) unless noted. */

export type MediaKind = 'video' | 'audio'

export interface MediaAsset {
  id: string
  kind: MediaKind
  label: string
  src: string
  duration: number
}

/** A clip places a slice of a source asset onto the timeline. */
export interface Clip {
  id: string
  mediaId: string
  track: MediaKind
  /** Position on the timeline where this clip begins. */
  start: number
  /** In/out points within the SOURCE asset. */
  in: number
  out: number
  /** 1 = realtime. 2 = twice as fast (occupies half the timeline span). */
  speed: number
}

/** Timeline-absolute camera move. Eased in and out at the edges. */
export interface ZoomRegion {
  id: string
  start: number
  end: number
  /** Focal point in normalised frame coords (0-1, origin top-left). */
  x: number
  y: number
  /** 1 = no zoom. 2 = 2x magnification. */
  scale: number
  label?: string
}

export interface TranscriptWord {
  word: string
  start: number
  end: number
}

/** A spoken phrase, timed against the ORIGINAL voiceover asset. */
export interface TranscriptSegment {
  id: string
  text: string
  start: number
  end: number
  filler: boolean
  words: TranscriptWord[]
}

export interface Transcript {
  duration: number
  segments: TranscriptSegment[]
}

export interface EditEntry {
  by: 'user' | 'agent'
  description: string
}

