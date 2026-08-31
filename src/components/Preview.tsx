import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/project'
import type { Player } from '../engine/player'
import { pickMimeType } from '../engine/export'
import { useExport } from '../store/exportState'
import { useSpotlight } from '../store/spotlight'

const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}

export default function Preview({ player }: { player: Player }) {
  const host = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const exportPhase = useExport((s) => s.phase)
  const exportProgress = useExport((s) => s.progress)
  const runExport = useExport((s) => s.run)
  const exporting = exportPhase === 'rendering' ? exportProgress : null
  const exportFile = useExport((s) => s.filename)
  const exportSeconds = useExport((s) => s.videoSeconds)
  const exportFormat = useExport((s) => s.format)
  const exportSize = useExport((s) => s.sizeKB)
  const exportMessage = useExport((s) => s.message)
  const spotToken = useSpotlight((s) => s.token)
  const spotAt = useSpotlight((s) => s.at)
  const spotNote = useSpotlight((s) => s.note)
  const [spotOn, setSpotOn] = useState(false)
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

  // Hold the agent's caption on screen long enough to read, then let it go.
  useEffect(() => {
    if (!spotToken) return
    setSpotOn(true)
    const id = setTimeout(() => setSpotOn(false), 4200)
    return () => clearTimeout(id)
  }, [spotToken])

  const startExport = async () => {
    if (exportPhase === 'rendering') return
    setPlaying(true)
    await runExport(player)
    setPlaying(false)
  }

  const canExport = pickMimeType() !== null

  return (
    <div className="flex flex-col gap-3 min-h-0 h-full">
      <div className="flex-1 min-h-0 grid place-items-center">
        <div
          style={{ aspectRatio: '16 / 9' }}
          className={`relative w-full max-h-full rounded-[10px] transition-shadow duration-500 ${
            spotOn ? 'ring-2 ring-reel-400/70 shadow-[0_0_0_6px_rgba(75,163,255,0.10)]' : 'ring-1 ring-ink-700'
          }`}
        >
          <div ref={host} className="absolute inset-0 bg-ink-900 rounded-[10px] overflow-hidden" />
          {spotOn && spotAt !== null && (
            <div className="absolute left-2.5 top-2.5 flex items-center gap-2 px-2.5 h-7 rounded-lg bg-ink-950/85 ring-1 ring-reel-400/40 backdrop-blur-sm pointer-events-none">
              <span className="w-1.5 h-1.5 rounded-full bg-reel-400 pulse-dot" />
              <span className="text-[11.5px] text-mist-200">
                Agent is previewing <span className="font-mono tabular-nums">{spotAt.toFixed(1)}s</span>
                {spotNote && <span className="text-mist-400"> — {spotNote}</span>}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
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
          onClick={startExport}
          disabled={duration === 0 || exporting !== null || !canExport}
          title={canExport ? 'Render in this tab and save the file' : 'This browser cannot record video'}
          className="shrink-0 px-3.5 h-9 rounded-lg text-[13px] font-medium bg-ink-800 hover:bg-ink-700 ring-1 ring-ink-600 disabled:opacity-40 transition-colors"
        >
          {exporting !== null ? `Rendering ${Math.round(exporting * 100)}%` : 'Export'}
        </button>
      </div>

      {exportPhase === 'rendering' && (
        <div className="shrink-0 rounded-lg bg-warn-400/[0.08] ring-1 ring-warn-400/25 px-3 py-2.5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-warn-400 font-semibold">
            <span>Exporting</span>
            <span className="font-mono tabular-nums tracking-normal">{Math.round(exportProgress * 100)}%</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-ink-800 overflow-hidden">
            <div
              className="h-full bg-warn-400 rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(2, exportProgress * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11.5px] text-mist-400">
            Rendering in this tab in real time — keep it open until the download appears.
          </p>
        </div>
      )}

      {exportPhase === 'ready' && (
        <div className="shrink-0 flex items-center gap-2.5 rounded-lg bg-signal-400/[0.08] ring-1 ring-signal-400/25 px-3 py-2.5">
          <span className="text-signal-400 text-[12px] leading-none">✓</span>
          <div className="min-w-0">
            <p className="text-[12px] text-signal-400 font-medium">Export complete</p>
            <p className="text-[11.5px] font-mono text-mist-400 tabular-nums truncate">
              {exportSeconds?.toFixed(1)}s · {exportFormat} · {exportSize}KB · {exportFile}
            </p>
          </div>
        </div>
      )}

      {exportPhase === 'error' && (
        <div className="shrink-0 text-[12px] text-warn-400 bg-warn-400/10 ring-1 ring-warn-400/25 rounded-lg px-3 py-2">
          Export failed: {exportMessage}
        </div>
      )}
    </div>
  )
}
