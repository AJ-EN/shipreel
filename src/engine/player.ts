import type { Clip, ZoomRegion } from '../types'
import { clipSpan } from './ripple'
import type { LoadedMedia } from './media'

export const FRAME_W = 1280
export const FRAME_H = 720

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Starts a repeating callback and returns a function that stops it. */
export type Driver = (cb: () => void) => () => void

export const rafDriver: Driver = (cb) => {
  let id = 0
  const loop = () => { cb(); id = requestAnimationFrame(loop) }
  id = requestAnimationFrame(loop)
  return () => cancelAnimationFrame(id)
}

/**
 * A clock that survives the tab being hidden. Browsers stop rAF and clamp
 * setTimeout in background tabs, but a Worker's timer keeps firing, so export
 * renders correctly even if the person switches away mid-render.
 */
export function workerDriver(fps: number): Driver {
  return (cb) => {
    const src = 'let id;onmessage=e=>{if(e.data.stop){clearInterval(id);return}' +
      'clearInterval(id);id=setInterval(()=>postMessage(0),e.data.interval)}'
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    const w = new Worker(url)
    w.onmessage = () => cb()
    w.postMessage({ interval: Math.max(8, Math.round(1000 / fps)) })
    return () => { w.postMessage({ stop: true }); w.terminate(); URL.revokeObjectURL(url) }
  }
}

export interface Snapshot {
  clips: Clip[]
  zooms: ZoomRegion[]
  duration: number
}

/** Eased zoom state at time t, or null when the camera is at rest. */
export function zoomAt(zooms: ZoomRegion[], t: number) {
  const z = zooms.find((z) => t >= z.start && t <= z.end)
  if (!z) return null
  const ramp = Math.min(0.4, (z.end - z.start) / 3)
  let k = 1
  if (t < z.start + ramp) k = (t - z.start) / ramp
  else if (t > z.end - ramp) k = (z.end - t) / ramp
  k = clamp(k, 0, 1)
  const eased = k * k * (3 - 2 * k) // smoothstep
  return { x: z.x, y: z.y, scale: 1 + (z.scale - 1) * eased }
}

export const videoClipAt = (clips: Clip[], t: number) =>
  clips.find((c) => c.track === 'video' && t >= c.start && t < c.start + clipSpan(c)) ?? null

/**
 * Drives the canvas and the audio graph off a single clock (the AudioContext),
 * so preview and export render through exactly the same path.
 */
export class Player {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private audio: AudioContext
  private media: LoadedMedia
  private gain: GainNode
  readonly streamDest: MediaStreamAudioDestinationNode

  private sources: AudioBufferSourceNode[] = []
  private raf = 0
  private stopDriver: (() => void) | null = null
  /** Called after each painted frame — export uses it to grab the frame. */
  afterFrame: (() => void) | null = null
  private startedAtCtx = 0
  private startOffset = 0
  private parked = 0
  private activeClipId: string | null = null

  playing = false
  onTime: ((t: number) => void) | null = null
  onEnded: (() => void) | null = null
  getSnapshot: () => Snapshot

  constructor(audio: AudioContext, media: LoadedMedia, getSnapshot: () => Snapshot) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = FRAME_W
    this.canvas.height = FRAME_H
    this.ctx = this.canvas.getContext('2d', { alpha: false })!
    this.audio = audio
    this.media = media
    this.getSnapshot = getSnapshot
    this.gain = audio.createGain()
    this.gain.connect(audio.destination)
    this.streamDest = audio.createMediaStreamDestination()
  }

  get currentTime() {
    return this.playing ? this.startOffset + (this.audio.currentTime - this.startedAtCtx) : this.parked
  }

  setMuted(muted: boolean) {
    this.gain.gain.value = muted ? 0 : 1
  }

  /** Register footage added after boot, so clips referencing it can paint. */
  addVideo(id: string, el: HTMLVideoElement) {
    this.media.videos.set(id, el)
  }

  // ------------------------------------------------------------------ draw --
  private paintBackdrop() {
    const g = this.ctx.createLinearGradient(0, 0, 0, FRAME_H)
    g.addColorStop(0, '#0b0e14')
    g.addColorStop(1, '#05070b')
    this.ctx.fillStyle = g
    this.ctx.fillRect(0, 0, FRAME_W, FRAME_H)
  }

  private paintVideo(el: HTMLVideoElement, zoom: ReturnType<typeof zoomAt>) {
    const vw = el.videoWidth || FRAME_W
    const vh = el.videoHeight || FRAME_H
    let cw = vw, ch = vh, sx = 0, sy = 0
    if (zoom) {
      cw = vw / zoom.scale
      ch = vh / zoom.scale
      sx = clamp(zoom.x * vw - cw / 2, 0, vw - cw)
      sy = clamp(zoom.y * vh - ch / 2, 0, vh - ch)
    }
    const r = Math.min(FRAME_W / cw, FRAME_H / ch)
    const dw = cw * r, dh = ch * r
    this.ctx.drawImage(el, sx, sy, cw, ch, (FRAME_W - dw) / 2, (FRAME_H - dh) / 2, dw, dh)
  }

  /** Paint a single frame. Does not touch playback state. */
  drawFrame(t: number) {
    const { clips, zooms } = this.getSnapshot()
    this.paintBackdrop()
    const clip = videoClipAt(clips, t)
    if (!clip) return
    const el = this.media.videos.get(clip.mediaId)
    if (!el || el.readyState < 2) return
    this.paintVideo(el, zoomAt(zooms, t))
  }

  /** Seek video elements and paint — used for scrubbing while paused. */
  async renderAt(t: number) {
    this.parked = t
    const { clips } = this.getSnapshot()
    const clip = videoClipAt(clips, t)
    if (clip) {
      const el = this.media.videos.get(clip.mediaId)
      if (el) {
        const want = clip.in + (t - clip.start) * clip.speed
        if (Math.abs(el.currentTime - want) > 0.04) {
          await new Promise<void>((res) => {
            const done = () => { el.removeEventListener('seeked', done); res() }
            el.addEventListener('seeked', done)
            el.currentTime = want
            setTimeout(done, 250) // don't hang the UI on a stubborn seek
          })
        }
      }
    }
    this.drawFrame(t)
    this.onTime?.(t)
  }

  // ------------------------------------------------------------- transport --
  private scheduleAudio(from: number) {
    const { clips } = this.getSnapshot()
    const base = this.audio.currentTime
    for (const c of clips) {
      if (c.track !== 'audio') continue
      const buf = this.media.buffers.get(c.mediaId)
      if (!buf) continue
      const span = clipSpan(c)
      if (c.start + span <= from) continue

      const into = Math.max(0, from - c.start)
      const when = base + Math.max(0, c.start - from)
      const srcOffset = c.in + into * c.speed
      const srcDur = Math.max(0, (span - into) * c.speed)
      if (srcDur <= 0.01) continue

      const node = this.audio.createBufferSource()
      node.buffer = buf
      node.playbackRate.value = c.speed
      node.connect(this.gain)
      node.connect(this.streamDest)
      node.start(when, srcOffset, srcDur)
      this.sources.push(node)
    }
  }

  private stopAudio() {
    for (const s of this.sources) { try { s.stop() } catch { /* already ended */ } }
    this.sources = []
  }

  /** One frame of work. Driven by rAF for preview, by a worker clock for export. */
  step = () => {
    const { clips, zooms, duration } = this.getSnapshot()
    const t = this.currentTime

    if (t >= duration) { this.pause(); this.parked = duration; this.onEnded?.(); return }

    const clip = videoClipAt(clips, t)
    if (clip) {
      const el = this.media.videos.get(clip.mediaId)
      if (el) {
        const want = clip.in + (t - clip.start) * clip.speed
        if (clip.id !== this.activeClipId) {
          this.activeClipId = clip.id
          el.currentTime = want
          void el.play().catch(() => {})
        } else if (Math.abs(el.currentTime - want) > 0.25) {
          el.currentTime = want // correct drift without stuttering every frame
        }
        if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed
        if (el.paused) void el.play().catch(() => {})
      }
    } else if (this.activeClipId) {
      const prev = clips.find((c) => c.id === this.activeClipId)
      if (prev) this.media.videos.get(prev.mediaId)?.pause()
      this.activeClipId = null
    }

    this.paintBackdrop()
    if (clip) {
      const el = this.media.videos.get(clip.mediaId)
      if (el && el.readyState >= 2) this.paintVideo(el, zoomAt(zooms, t))
    }

    this.onTime?.(t)
    this.afterFrame?.()
  }

  /**
   * `driver` supplies the render clock. It defaults to requestAnimationFrame,
   * which is right for preview but stops entirely when the tab is hidden —
   * export passes a worker-backed clock so a backgrounded tab still renders.
   */
  async play(from?: number, driver?: Driver) {
    if (this.playing) return
    if (this.audio.state === 'suspended') await this.audio.resume()
    const start = from ?? this.parked
    const { duration } = this.getSnapshot()
    this.startOffset = start >= duration ? 0 : start
    this.startedAtCtx = this.audio.currentTime
    this.activeClipId = null
    this.playing = true
    this.scheduleAudio(this.startOffset)
    this.stopDriver = (driver ?? rafDriver)(this.step)
  }

  pause() {
    if (!this.playing) return
    this.parked = this.currentTime
    this.playing = false
    this.stopDriver?.()
    this.stopDriver = null
    cancelAnimationFrame(this.raf)
    this.stopAudio()
    for (const el of this.media.videos.values()) el.pause()
    this.activeClipId = null
  }

  dispose() {
    this.pause()
    this.gain.disconnect()
  }
}
