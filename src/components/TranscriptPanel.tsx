import { useMemo } from 'react'
import { useProject } from '../store/project'
import { sourceRangeToTimeline } from '../engine/silence'
import type { Player } from '../engine/player'

export default function TranscriptPanel({ player }: { player: Player }) {
  const transcript = useProject((s) => s.transcript)
  const clips = useProject((s) => s.clips)
  const assets = useProject((s) => s.assets)
  const playhead = useProject((s) => s.playhead)

  const voiceId = assets.find((a) => a.kind === 'audio')?.id ?? ''

  // A phrase that no longer maps onto the timeline has been cut out of the edit.
  const rows = useMemo(() => {
    if (!transcript) return []
    return transcript.segments.map((seg) => ({
      seg,
      at: sourceRangeToTimeline(clips, voiceId, { start: seg.start, end: seg.end }),
    }))
  }, [transcript, clips, voiceId])

  const kept = rows.filter((r) => r.at).length

  return (
    <aside className="flex flex-col min-h-0 bg-ink-900 rounded-xl ring-1 ring-ink-700">
      <div className="flex items-baseline justify-between px-3.5 py-3 border-b border-ink-800">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-mist-400 font-semibold">Voiceover</h2>
        <span className="text-[11px] font-mono text-mist-400 tabular-nums">{kept}/{rows.length} kept</span>
      </div>

      <div className="overflow-y-auto px-2 py-2 flex-1 min-h-0">
        {rows.map(({ seg, at }) => {
          const live = at !== null
          const current = live && playhead >= at!.start && playhead < at!.end
          return (
            <button
              key={seg.id}
              disabled={!live}
              onClick={() => { player.pause(); void player.renderAt(at!.start) }}
              className={`w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-colors ${
                !live ? 'opacity-30 line-through cursor-default'
                : current ? 'bg-reel-500/20 ring-1 ring-reel-400/40'
                : 'hover:bg-ink-800'
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-mono text-[10px] text-mist-400 tabular-nums">
                  {live ? `${at!.start.toFixed(1)}s` : 'cut'}
                </span>
                {seg.filler && (
                  <span className="text-[9px] uppercase tracking-wide px-1.5 py-px rounded bg-warn-400/15 text-warn-400 ring-1 ring-warn-400/25">
                    filler
                  </span>
                )}
              </div>
              <p className="text-[12.5px] leading-snug text-mist-200/90">{seg.text}</p>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
