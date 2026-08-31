import { useEffect, useRef } from 'react'
import { useActivity, type ActivityEntry } from '../store/activity'

/**
 * The agent's work, in the order it happened.
 *
 * Each row leads with what the call achieved in plain English and keeps the
 * tool name and arguments underneath in mono. Someone watching a demo can
 * follow the reasoning without knowing the tool surface; someone who wants the
 * evidence can read the exact call that produced the line.
 */

function Glyph({ e }: { e: ActivityEntry }) {
  if (e.status === 'running') return <span className="w-3 shrink-0 grid place-items-center"><span className="w-1.5 h-1.5 rounded-full bg-reel-400 pulse-dot" /></span>
  if (e.status === 'error') return <span className="w-3 shrink-0 text-warn-400 text-[11px] leading-none">✗</span>
  if (e.kind === 'user') return <span className="w-3 shrink-0 text-warn-400 text-[11px] leading-none">◆</span>
  return <span className="w-3 shrink-0 text-signal-400 text-[11px] leading-none">✓</span>
}

function Row({ e }: { e: ActivityEntry }) {
  // Phases are the optimizer narrating its own passes: subordinate to the tool
  // call that started them, so they sit indented and carry no mono line.
  if (e.kind === 'phase') {
    return (
      <li className="pl-8 pr-3 py-1 flex items-start gap-2">
        <span className="text-signal-400 text-[11px] leading-[1.35] shrink-0">✓</span>
        <span className="text-[11.5px] leading-[1.35] text-mist-300">{e.label}</span>
      </li>
    )
  }

  if (e.kind === 'user') {
    return (
      <li className="px-3 py-1.5 border-b border-ink-850/70 last:border-0 bg-warn-400/[0.06]">
        <div className="flex items-start gap-2">
          <Glyph e={e} />
          <span className="text-[12px] leading-snug text-warn-400">
            You {e.result ?? 'made an edit'}
          </span>
        </div>
      </li>
    )
  }

  const headline = e.headline ?? (e.status === 'running' ? `${e.label}…` : e.label)
  // The raw result only earns a line when the headline did not already say it.
  const showResult = e.status === 'error' || (!e.headline && !!e.result)

  return (
    <li className="px-3 py-1.5 border-b border-ink-850/70 last:border-0">
      <div className="flex items-start gap-2">
        <Glyph e={e} />
        <div className="min-w-0 flex-1">
          <p className={`text-[12px] leading-snug break-words ${e.status === 'error' ? 'text-warn-400' : 'text-mist-200'}`}>
            {headline}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-mist-400/60 truncate">
            {e.label}{e.args ? ` · ${e.args}` : ''}
          </p>
          {showResult && (
            <p className={`mt-0.5 text-[11px] leading-snug break-words line-clamp-3 ${e.status === 'error' ? 'text-warn-400/90' : 'text-mist-400'}`}>
              {e.result}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

export default function ActivityPanel() {
  const entries = useActivity((s) => s.entries)
  const clear = useActivity((s) => s.clear)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  const toolCalls = entries.filter((e) => e.kind === 'tool').length

  return (
    <section className="flex flex-col min-h-0 bg-ink-900 rounded-xl ring-1 ring-ink-700">
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-ink-800 shrink-0">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-mist-400 font-semibold">Agent activity</h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-mist-400 tabular-nums">{toolCalls} calls</span>
          {entries.length > 0 && (
            <button onClick={clear} className="text-[11px] text-mist-400/60 hover:text-mist-200 transition-colors">
              clear
            </button>
          )}
        </div>
      </div>

      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="px-4 py-6 text-[11.5px] leading-relaxed text-mist-400/70">
            Everything your agent does shows up here as it happens, in plain English.
            <br /><br />
            Try: <span className="text-mist-200">“Cut this down to 60 seconds and put the terminal recording
            where I talk about the terminal.”</span>
          </div>
        ) : (
          <ul>{entries.map((e) => <Row key={e.id} e={e} />)}</ul>
        )}
      </div>
    </section>
  )
}
