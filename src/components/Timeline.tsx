import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useProject } from '../store/project'
import { clipSpan, clipEnd } from '../engine/ripple'
import type { Player } from '../engine/player'
import type { Clip } from '../types'

const TRACK_H = 54
const PAD = 12

export default function Timeline({ player }: { player: Player }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null)

  const clips = useProject((s) => s.clips)
  const zooms = useProject((s) => s.zooms)
  const assets = useProject((s) => s.assets)
  const playhead = useProject((s) => s.playhead)
  const selected = useProject((s) => s.selectedClipId)
  const duration = useProject((s) => s.duration())

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const span = Math.max(duration, 10)
  const pps = (width - PAD * 2) / span // pixels per second
  const x = (t: number) => PAD + t * pps

  const seek = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect()
    const t = Math.max(0, Math.min(duration, (clientX - rect.left - PAD) / pps))
    player.pause()
    void player.renderAt(t)
  }

  // --- dragging a clip to a new moment; committed once, on release
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => setDrag((d) => (d ? { ...d, dx: d.dx + e.movementX } : d))
    const up = () => {
      setDrag((d) => {
        if (d) {
          const clip = useProject.getState().clips.find((c) => c.id === d.id)
          if (clip && Math.abs(d.dx) > 2) {
            const next = Math.max(0, clip.start + d.dx / pps)
            useProject.getState().moveClip(d.id, next, 'user')
          }
        }
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [drag, pps])

  const renderClip = (c: Clip) => {
    const offset = drag?.id === c.id ? drag.dx : 0
    const left = x(c.start) + offset
    const w = Math.max(3, clipSpan(c) * pps)
    const isVideo = c.track === 'video'
    const label = assets.find((a) => a.id === c.mediaId)?.id ?? c.mediaId
    return (
      <div
        key={c.id}
        onPointerDown={(e) => {
          e.stopPropagation()
          useProject.getState().select(c.id)
          if (isVideo) setDrag({ id: c.id, dx: 0 })
        }}
        style={{ left, width: w, top: 4, height: TRACK_H - 8 }}
        className={`absolute rounded-md overflow-hidden ring-1 select-none ${
          isVideo ? 'cursor-grab active:cursor-grabbing bg-reel-500/25 ring-reel-400/50' : 'bg-signal-400/20 ring-signal-400/40'
        } ${selected === c.id ? 'ring-2 ring-white/70' : ''}`}
        title={`${label} · ${clipSpan(c).toFixed(2)}s`}
      >
        {w > 42 && (
          <div className="px-2 pt-1 text-[10.5px] font-medium truncate text-mist-200/90">
            {label}{c.speed !== 1 && <span className="text-warn-400"> {c.speed}x</span>}
          </div>
        )}
        {w > 42 && <div className="px-2 text-[9.5px] font-mono text-mist-400 truncate">{clipSpan(c).toFixed(1)}s</div>}
      </div>
    )
  }

  const ticks = []
  const step = span > 90 ? 15 : span > 40 ? 10 : span > 15 ? 5 : 1
  for (let s = 0; s <= span; s += step) ticks.push(s)

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between px-1 pb-2">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-mist-400 font-semibold">Timeline</h2>
        <span className="text-[11px] font-mono text-mist-400 tabular-nums">
          {duration.toFixed(1)}s · {clips.filter((c) => c.track === 'video').length} video · {clips.filter((c) => c.track === 'audio').length} audio
        </span>
      </div>

      <div
        ref={wrap}
        onPointerDown={(e) => seek(e.clientX)}
        className="relative bg-ink-900 rounded-xl ring-1 ring-ink-700 cursor-text overflow-hidden"
        style={{ height: TRACK_H * 2 + 46 }}
      >
        {/* ruler */}
        <div className="relative h-[22px] border-b border-ink-800">
          {ticks.map((s) => (
            <div key={s} className="absolute top-0 h-full flex items-center" style={{ left: x(s) }}>
              <div className="absolute left-0 top-0 w-px h-2 bg-ink-600" />
              <span className="pl-1.5 text-[9.5px] font-mono text-mist-400/70">{s}s</span>
            </div>
          ))}
        </div>

        {/* zoom markers */}
        <div className="relative h-[10px]">
          {zooms.map((z) => (
            <div
              key={z.id}
              style={{ left: x(z.start), width: Math.max(4, (z.end - z.start) * pps) }}
              className="absolute top-[2px] h-[5px] rounded-full bg-warn-400/70"
              title={`${z.scale}x zoom`}
            />
          ))}
        </div>

        <div className="relative" style={{ height: TRACK_H }}>
          <span className="absolute left-2 top-1 text-[9px] uppercase tracking-wider text-mist-400/50 z-10 pointer-events-none">Video</span>
          {clips.filter((c) => c.track === 'video').map(renderClip)}
        </div>
        <div className="relative border-t border-ink-800" style={{ height: TRACK_H }}>
          <span className="absolute left-2 top-1 text-[9px] uppercase tracking-wider text-mist-400/50 z-10 pointer-events-none">Voiceover</span>
          {clips.filter((c) => c.track === 'audio').map(renderClip)}
        </div>

        {/* playhead */}
        <div className="absolute top-0 bottom-0 w-px bg-white/85 pointer-events-none" style={{ left: x(Math.min(playhead, span)) }}>
          <div className="absolute -top-0 -left-[4px] w-[9px] h-[9px] rounded-b-[3px] bg-white/85" />
        </div>
      </div>

      <p className="px-1 pt-2 text-[11px] text-mist-400/70">
        Drag a video clip to reposition it — the agent sees your change on its next <code className="text-mist-400">get_project_state</code>.
      </p>
    </div>
  )
}
