/**
 * Cuts an edit down to a target runtime.
 *
 * This is the product's main workflow, so it lives in one place and both
 * callers drive it: the Optimize button in the UI and the `optimize_duration`
 * tool. There is no separate agent path — a person clicking Optimize and an
 * agent asking for 60 seconds run exactly the same passes and get the same
 * report back.
 *
 * The passes escalate in how much they cost the viewer, cheapest first:
 *
 *   1. dead air, at progressively tighter floors
 *   2. filler words ("um", "uh") the transcript already flagged
 *   3. whole sentences, longest first
 *
 * Only the third pass loses content, so it runs last, stops the moment the
 * target is met, and names every line it dropped. The opening sentence is
 * never a candidate: losing the hook to save four seconds is not a trade any
 * editor would take.
 */
import { useProject } from '../store/project'
import { useActivity } from '../store/activity'
import { sourceRangeToTimeline } from './silence'
import type { Range } from './ripple'

/** Floors for the dead-air passes. Below ~0.2s a cut starts to sound clipped. */
const SILENCE_FLOORS = [0.4, 0.3, 0.22]
/** Ignore slivers: cutting them costs a pass and reclaims nothing audible. */
const MIN_USEFUL = 0.05

export interface OptimizeStep {
  /** Human-readable line for the activity feed. */
  label: string
  /** Seconds this pass reclaimed. */
  reclaimed: number
}

export interface DroppedLine {
  text: string
  seconds: number
}

export interface Candidate {
  start: number
  end: number
  seconds: number
  text: string
}

export interface OptimizeReport {
  target: number
  /** Runtime before and after the whole run. */
  start: number
  end: number
  met: boolean
  steps: OptimizeStep[]
  dropped: DroppedLine[]
  /** Longest lines still in the edit — what a caller could drop next. */
  candidates: Candidate[]
  /** Set when nothing could be done, e.g. already inside the target. */
  noop?: string
}

const state = () => useProject.getState()
const voiceoverId = () => state().assets.find((a) => a.kind === 'audio')?.id ?? ''

/** Map a range in voiceover-source time onto the timeline as it stands now. */
function onTimeline(r: Range): Range | null {
  const s = state()
  const mapped = sourceRangeToTimeline(s.clips, voiceoverId(), r)
  return mapped && mapped.end - mapped.start > 0.02 ? mapped : null
}

/** Non-filler sentences still audible in the edit, longest first. */
function spokenLines(): Candidate[] {
  const s = state()
  const segments = s.transcript?.segments ?? []
  return segments
    // The first sentence is the hook. It is off the table.
    .filter((seg, i) => i > 0 && !seg.filler)
    .map((seg) => {
      const at = onTimeline({ start: seg.start, end: seg.end })
      return at && { start: at.start, end: at.end, seconds: at.end - at.start, text: seg.text }
    })
    .filter((c): c is Candidate => c !== null && c.seconds > 0.4)
    .sort((a, b) => b.seconds - a.seconds)
}

export interface OptimizeOptions {
  /**
   * Stop before dropping any narration and report what could go instead.
   * Leaves the editorial call to the caller when they want to make it.
   */
  keepNarration?: boolean
  /** Log each pass to the activity feed as it happens. */
  emit?: boolean
}

/**
 * Runs the passes until the edit fits `target` seconds, or until nothing is
 * left to cut. Mutates the project store; returns what it did.
 *
 * Async only so the feed can paint between passes: the work itself is
 * synchronous, but a run that lands all at once reads as a single jump rather
 * than as the agent working through the problem.
 */
export async function optimizeToTarget(target: number, opts: OptimizeOptions = {}): Promise<OptimizeReport> {
  const { keepNarration = false, emit = true } = opts
  const start = state().duration()
  const steps: OptimizeStep[] = []
  const dropped: DroppedLine[] = []

  const phase = async (label: string) => {
    if (!emit) return
    useActivity.getState().note('phase', label)
    await new Promise<void>((r) => setTimeout(r, 45))
  }
  const report = (over: Partial<OptimizeReport> = {}): OptimizeReport => {
    const end = state().duration()
    return { target, start, end, met: end <= target, steps, dropped, candidates: spokenLines().slice(0, 5), ...over }
  }

  if (!(target > 0)) return report({ noop: 'A target needs to be a positive number of seconds.' })
  if (start <= target) return report({ noop: `Already ${start.toFixed(1)}s, inside the ${target}s target.` })

  // ------------------------------------------------------------ dead air --
  for (const floor of SILENCE_FLOORS) {
    if (state().duration() <= target) break
    const s = state()
    const ranges = s.detectedSilences
      .filter((r) => r.end - r.start >= floor)
      .map(onTimeline)
      .filter((r): r is Range => r !== null)
    if (!ranges.length) continue
    const reclaimed = s.removeRanges(ranges, 'agent')
    if (reclaimed > MIN_USEFUL) {
      const label = `Removed ${reclaimed.toFixed(1)}s of dead air (pauses ≥${floor}s)`
      steps.push({ label, reclaimed })
      await phase(label)
    }
  }

  // ------------------------------------------------------- filler words --
  if (state().duration() > target) {
    const s = state()
    const fillers = (s.transcript?.segments ?? [])
      .filter((seg) => seg.filler)
      .map((seg) => onTimeline({ start: seg.start, end: seg.end }))
      .filter((r): r is Range => r !== null)
    if (fillers.length) {
      const reclaimed = s.removeRanges(fillers, 'agent')
      if (reclaimed > MIN_USEFUL) {
        const label = `Cut ${fillers.length} filler word${fillers.length === 1 ? '' : 's'} — ${reclaimed.toFixed(1)}s`
        steps.push({ label, reclaimed })
        await phase(label)
      }
    }
  }

  // --------------------------------------------------------- narration ---
  if (state().duration() > target && keepNarration) {
    await phase(`Held at ${state().duration().toFixed(1)}s — dropping narration is your call`)
    return report()
  }

  // Recompute candidates every iteration: each cut ripples the timeline, so
  // ranges found before a cut no longer point at the same words after it.
  let guard = 0
  while (state().duration() > target && guard++ < 40) {
    const lines = spokenLines()
    if (!lines.length) break
    const need = state().duration() - target
    // Prefer the shortest line that closes the gap on its own: it gets under
    // the target while losing the least narration. Only when no single line is
    // big enough do we take the longest and come back for another pass.
    const enough = lines.filter((c) => c.seconds >= need)
    const next = enough.length ? enough[enough.length - 1] : lines[0]
    const reclaimed = state().removeRanges([{ start: next.start, end: next.end }], 'agent')
    if (reclaimed <= MIN_USEFUL) break
    dropped.push({ text: next.text, seconds: reclaimed })
  }
  if (dropped.length) {
    const total = dropped.reduce((m, d) => m + d.seconds, 0)
    const label = `Dropped ${dropped.length} line${dropped.length === 1 ? '' : 's'} of narration — ${total.toFixed(1)}s`
    steps.push({ label, reclaimed: total })
    await phase(label)
  }

  const out = report()
  await phase(out.met
    ? `Target met: ${out.end.toFixed(1)}s ≤ ${target}s`
    : `Stopped at ${out.end.toFixed(1)}s — nothing further to cut`)
  return out
}
