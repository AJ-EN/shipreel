/**
 * Pure timeline arithmetic. No React, no DOM — so it can be unit tested
 * directly with `npm run test:ripple`.
 */
import type { Clip, ZoomRegion } from '../types'

export interface Range { start: number; end: number }

let seq = 0
export const uid = (p: string) => `${p}_${(++seq).toString(36)}`

/** Length a clip occupies on the timeline (source length compressed by speed). */
export const clipSpan = (c: Clip): number => (c.out - c.in) / c.speed
export const clipEnd = (c: Clip): number => c.start + clipSpan(c)

/** Merge overlapping/adjacent ranges and sort ascending. */
export function normaliseRanges(ranges: Range[], epsilon = 0.01): Range[] {
  const sorted = ranges
    .filter((r) => r.end - r.start > epsilon)
    .sort((a, b) => a.start - b.start)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + epsilon) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/**
 * Delete [from, to) from the timeline and close the gap, across every track.
 * Clips straddling the cut are split; everything downstream ripples left.
 */
export function rippleOne(
  clips: Clip[],
  zooms: ZoomRegion[],
  from: number,
  to: number,
): { clips: Clip[]; zooms: ZoomRegion[] } {
  const len = to - from
  const nextClips: Clip[] = []

  for (const c of clips) {
    const s = c.start
    const e = clipEnd(c)

    if (e <= from) { nextClips.push(c); continue }
    if (s >= to) { nextClips.push({ ...c, start: s - len }); continue }

    // Left survivor: keep [s, from) of the clip.
    if (s < from) {
      nextClips.push({ ...c, out: c.in + (from - s) * c.speed })
    }
    // Right survivor: keep [to, e), pulled back to sit at `from`.
    if (e > to) {
      nextClips.push({
        ...c,
        id: uid('clip'),
        start: from,
        in: c.in + (to - s) * c.speed,
      })
    }
    // Fully inside the cut: dropped.
  }

  const mapT = (t: number) => (t <= from ? t : t >= to ? t - len : from)
  const nextZooms = zooms
    .map((z) => ({ ...z, start: mapT(z.start), end: mapT(z.end) }))
    .filter((z) => z.end - z.start > 0.15)

  return { clips: nextClips, zooms: nextZooms }
}

/** Apply many cuts at once. Ranges are in current timeline coordinates. */
export function rippleDelete(clips: Clip[], zooms: ZoomRegion[], ranges: Range[]) {
  const merged = normaliseRanges(ranges)
  let cur = { clips, zooms }
  let removed = 0
  // Back-to-front so earlier ranges keep their original coordinates.
  for (let i = merged.length - 1; i >= 0; i--) {
    cur = rippleOne(cur.clips, cur.zooms, merged[i].start, merged[i].end)
    removed += merged[i].end - merged[i].start
  }
  return { ...cur, removed, cuts: merged.length }
}
