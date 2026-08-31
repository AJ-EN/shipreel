import { useState } from 'react'
import { useProject } from '../store/project'
import { useExport } from '../store/exportState'
import { optimizeToTarget, type OptimizeReport } from '../engine/optimize'

/**
 * The main workflow, stated as a goal rather than as a sequence of edits.
 *
 * The button runs exactly the passes `optimize_duration` runs — same module,
 * same report — so a person clicking Optimize and an agent asked for sixty
 * seconds do the same work and can pick up after each other. The run is
 * recorded as the person's edit, so the agent is told about it on its next
 * get_project_state.
 */
export default function TargetPanel() {
  const [target, setTarget] = useState(60)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<OptimizeReport | null>(null)
  const duration = useProject((s) => s.duration())
  const exporting = useExport((s) => s.phase) === 'rendering'

  const run = async () => {
    if (busy || !(target > 0)) return
    setBusy(true)
    setReport(null)
    useProject.getState().note('user', `set a ${target}s target and ran Optimize`)
    try {
      setReport(await optimizeToTarget(target, { emit: true }))
    } finally {
      setBusy(false)
    }
  }

  const over = duration - target
  const fits = duration <= target

  return (
    <section className="bg-ink-900 rounded-xl ring-1 ring-ink-700 px-3.5 py-3">
      <h2 className="text-[11px] uppercase tracking-[0.14em] text-mist-400 font-semibold">Make this video</h2>

      <div className="mt-2.5 flex items-end gap-2.5">
        <label className="flex-1 min-w-0">
          <span className="block text-[11px] text-mist-400 mb-1">Target duration</span>
          <div className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg bg-ink-950 ring-1 ring-ink-600 focus-within:ring-reel-400/60 transition-shadow">
            <input
              type="number" min={5} max={3600} step={5} value={target}
              onChange={(e) => setTarget(Math.max(1, +e.target.value || 0))}
              disabled={busy || exporting}
              className="w-full bg-transparent outline-none font-mono text-[13px] text-mist-200 tabular-nums disabled:opacity-50"
              aria-label="Target duration in seconds"
            />
            <span className="text-[12px] text-mist-400 shrink-0">seconds</span>
          </div>
        </label>

        <button
          onClick={run}
          disabled={busy || exporting || duration === 0}
          className="h-9 px-4 shrink-0 rounded-lg text-[13px] font-medium bg-reel-500 hover:bg-reel-400 disabled:opacity-40 disabled:hover:bg-reel-500 text-white transition-colors"
        >
          {busy ? 'Optimizing…' : 'Optimize'}
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-2 text-[11.5px] font-mono tabular-nums">
        <span className="text-mist-400">Target ≤ {target.toFixed(1)}s</span>
        <span className="text-ink-600">·</span>
        <span className={fits ? 'text-signal-400' : 'text-warn-400'}>
          {report ? 'Final' : 'Now'} {duration.toFixed(1)}s
        </span>
        {!fits && <span className="text-mist-400/70">({over.toFixed(1)}s over)</span>}
        {fits && report && <span className="text-signal-400">✓</span>}
      </div>

      {report && (
        <p className="mt-1.5 text-[11px] leading-snug text-mist-400">
          {report.noop ??
            (report.met
              ? `Reclaimed ${(report.start - report.end).toFixed(1)}s in ${report.steps.length} pass${report.steps.length === 1 ? '' : 'es'}.`
              : `Reclaimed ${(report.start - report.end).toFixed(1)}s — nothing further to cut without emptying the timeline.`)}
          {report.dropped.length > 0 && ` Dropped ${report.dropped.length} line${report.dropped.length === 1 ? '' : 's'} of narration — ask your agent to put any of them back.`}
        </p>
      )}
    </section>
  )
}
