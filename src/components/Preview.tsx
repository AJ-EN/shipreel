import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/project'
import type { Player } from '../engine/player'
import { exportTimeline, downloadBlob, pickMimeType } from '../engine/export'

const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}

export default function Preview({ player }: { player: Player }) {
  const host = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState<number | null>(null)
  const playhead = useProject((s) => s.playhead)
  const duration = useProject((s) => s.duration())
  const clipCount = useProject((s) => s.clips.length)

  useEffect(() => {
    const el = player.canvas
    // Absolute + object-contain letterboxes reliably; percentage max-height on
    // a grid child does not bind the way you would hope.
    el.style.position = 'absolute'
    el.style.inset = '0'
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.objectFit = 'contain'
    el.style.display = 'block'
    host.current?.appendChild(el)
    return () => { el.remove() }
  }, [player])

  // Repaint when the edit changes underneath a paused playhead.
  useEffect(() => {
    if (!player.playing) void player.renderAt(useProject.getState().playhead)
  }, [clipCount, duration, player])

  const toggle = async () => {
    if (player.playing) { player.pause(); setPlaying(false) }
    else { await player.play(playhead >= duration ? 0 : playhead); setPlaying(true) }
  }
  useEffect(() => {
    player.onEnded = () => setPlaying(false)
  }, [player])

  const runExport = async () => {
    if (exporting !== null) return
    setExporting(0)
    setPlaying(true)
    try {
      const r = await exportTimeline(player, { onProgress: (f) => setExporting(f) })
      downloadBlob(r.blob, `shipreel-cut.${r.extension}`)
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setExporting(null)
      setPlaying(false)
    }
  }

  const canExport = pickMimeType() !== null

  return (
    <div className="flex flex-col gap-3 min-h-0 h-full">
      <div className="flex-1 min-h-0 grid place-items-center">
        <div
          ref={host}
          style={{ aspectRatio: '16 / 9' }}
          className="relative w-full max-h-full bg-ink-900 rounded-[10px] overflow-hidden ring-1 ring-ink-700"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          disabled={duration === 0 || exporting !== null}
          className="w-10 h-10 shrink-0 rounded-full bg-reel-500 hover:bg-reel-400 disabled:opacity-30 disabled:hover:bg-reel-500 text-white grid place-items-center transition-colors"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing
            ? <svg width="13" height="14" viewBox="0 0 13 14" fill="currentColor"><rect width="4" height="14" rx="1" /><rect x="9" width="4" height="14" rx="1" /></svg>
            : <svg width="13" height="14" viewBox="0 0 13 14" fill="currentColor"><path d="M1 1.4c0-.8.9-1.3 1.6-.9l9.1 5.6c.6.4.6 1.3 0 1.7l-9.1 5.6c-.7.4-1.6-.1-1.6-.9V1.4Z" /></svg>}
        </button>

        <input
          type="range" min={0} max={Math.max(duration, 0.1)} step={0.01} value={Math.min(playhead, duration)}
          onChange={(e) => { player.pause(); setPlaying(false); void player.renderAt(+e.target.value) }}
          disabled={duration === 0}
          className="flex-1 accent-reel-400 cursor-pointer"
        />

        <span className="font-mono text-[13px] text-mist-400 tabular-nums shrink-0">
          {fmt(playhead)} <span className="text-ink-600">/</span> {fmt(duration)}
        </span>

        <button
          onClick={runExport}
          disabled={duration === 0 || exporting !== null || !canExport}
          title={canExport ? 'Render in this tab and save the file' : 'This browser cannot record video'}
          className="shrink-0 px-3.5 h-9 rounded-lg text-[13px] font-medium bg-ink-800 hover:bg-ink-700 ring-1 ring-ink-600 disabled:opacity-40 transition-colors"
        >
          {exporting !== null ? `Rendering ${Math.round(exporting * 100)}%` : 'Export'}
        </button>
      </div>

      {exporting !== null && (
        <div className="text-[12px] text-warn-400 bg-warn-400/10 ring-1 ring-warn-400/25 rounded-lg px-3 py-2">
          Rendering in this tab in real time — keep it visible until the download appears.
        </div>
      )}
    </div>
  )
}
