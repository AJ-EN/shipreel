import type { Clip } from '../types'
import { clipSpan, type Range } from './ripple'

export interface SilenceOptions {
  /** Ignore anything shorter than this. */
  minDuration?: number
  /** Leave this much breathing room on each side of a cut. */
  padding?: number
  /** Loudness below this fraction of the take's typical level counts as silence. */
  relativeThreshold?: number
}

/**
 * Windowed RMS silence detection. Threshold is relative to the take's own
 * loudness so it adapts to quiet microphones instead of assuming a fixed floor.
 * Returns ranges in SOURCE (asset) time.
 */
export function detectSilence(buffer: AudioBuffer, opts: SilenceOptions = {}): Range[] {
  const { minDuration = 0.35, padding = 0.08, relativeThreshold = 0.08 } = opts
  const data = buffer.getChannelData(0)
  const sr = buffer.sampleRate
  const win = Math.floor(sr * 0.02) // 20 ms
  const levels: number[] = []

  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0
    for (let j = i; j < i + win; j++) sum += data[j] * data[j]
    levels.push(Math.sqrt(sum / win))
  }

  // Reference level = 95th percentile, so a few loud peaks don't set the bar.
  const sorted = [...levels].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
  const threshold = Math.max(0.006, p95 * relativeThreshold)

  const ranges: Range[] = []
  let runStart: number | null = null
  for (let k = 0; k <= levels.length; k++) {
    const quiet = k < levels.length && levels[k] < threshold
    if (quiet && runStart === null) runStart = k
    if (!quiet && runStart !== null) {
      const start = (runStart * win) / sr
      const end = (k * win) / sr
      if (end - start >= minDuration) {
        const s = start + padding
        const e = end - padding
        if (e - s > 0.05) ranges.push({ start: +s.toFixed(3), end: +e.toFixed(3) })
      }
      runStart = null
    }
  }
  return ranges
}

/**
 * Convert a range expressed in SOURCE time into current timeline time.
 *
 * Matching is by overlap rather than full containment: a cut usually clips the
 * trailing silence off a phrase, and that phrase is still very much in the
 * edit. We map against whichever surviving clip covers most of the range and
 * return the portion that is still on the timeline. Returns null only when the
 * material has genuinely been removed.
 */
export function sourceRangeToTimeline(clips: Clip[], mediaId: string, r: Range): Range | null {
  // A phrase can straddle several clips once pauses inside it have been cut.
  // Those survivors are contiguous on the timeline (ripple delete closes the
  // gaps), so we map the head through the first overlapping piece and the tail
  // through the last, and return one span covering the whole phrase.
  const hits = clips
    .filter((c) => c.mediaId === mediaId && Math.min(r.end, c.out) - Math.max(r.start, c.in) > 0.02)
    .sort((a, b) => a.in - b.in)
  if (!hits.length) return null

  const first = hits[0]
  const last = hits[hits.length - 1]
  const from = Math.max(r.start, first.in)
  const to = Math.min(r.end, last.out)
  return {
    start: +(first.start + (from - first.in) / first.speed).toFixed(3),
    end: +(last.start + (to - last.in) / last.speed).toFixed(3),
  }
}

/** Timeline time -> source time, for the clip covering that instant. */
export function timelineToSource(clips: Clip[], mediaId: string, t: number): number | null {
  for (const c of clips) {
    if (c.mediaId !== mediaId) continue
    if (t >= c.start && t <= c.start + clipSpan(c)) return c.in + (t - c.start) * c.speed
  }
  return null
}
