import { useEffect, useRef } from 'react'
import { useActivity, type ActivityEntry } from '../store/activity'

function Row({ e }: { e: ActivityEntry }) {
  const isUser = e.kind === 'user'
  return (
    <li className="px-3 py-1.5 border-b border-ink-850/70 last:border-0">
      <div className="flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            e.status === 'running' ? 'bg-reel-400 pulse-dot'
            : e.status === 'error' ? 'bg-warn-400'
            : isUser ? 'bg-warn-400' : 'bg-signal-400'
          }`}
        />
        <span className={`font-mono text-[11.5px] shrink-0 ${isUser ? 'text-warn-400' : 'text-mist-200'}`}>
          {e.label}
        </span>
        {e.args && <span className="font-mono text-[10.5px] text-mist-400/70 truncate">{e.args}</span>}
      </div>
      {e.result && (
        <p
          className={`pl-3.5 mt-0.5 text-[11px] leading-snug break-words line-clamp-3 ${
            e.status === 'error' ? 'text-warn-400' : 'text-mist-400'
          }`}
        >
          {e.result}
        </p>
      )}
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
            Every tool your agent calls shows up here as it happens.
            <br /><br />
            Try: <span className="text-mist-200">“Cut the dead air and the filler words, then put the terminal
            recording where I talk about the terminal.”</span>
          </div>
        ) : (
          <ul>{entries.map((e) => <Row key={e.id} e={e} />)}</ul>
        )}
      </div>
    </section>
  )
}
