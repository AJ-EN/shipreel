import { workerDriver, type Player } from './player'

/**
 * Renders the timeline to a file entirely in the tab.
 *
 * We drive the real player in real time and capture its canvas + audio graph
 * with MediaRecorder. That is slower than a WebCodecs pipeline, but it reuses
 * the exact preview code path, so what you export is what you watched.
 *
 * The render clock is a Worker rather than requestAnimationFrame, and frames
 * are pushed explicitly, so a render keeps going if the tab is backgrounded.
 */

const CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

export const extensionFor = (mime: string) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm')

export interface ExportResult {
  blob: Blob
  mimeType: string
  extension: string
  duration: number
}

export async function exportTimeline(
  player: Player,
  opts: { fps?: number; onProgress?: (fraction: number) => void } = {},
): Promise<ExportResult> {
  const { fps = 30, onProgress } = opts
  const mimeType = pickMimeType()
  if (!mimeType) throw new Error('This browser cannot record video (MediaRecorder unavailable).')

  const duration = player.getSnapshot().duration
  if (duration < 0.2) throw new Error('Nothing on the timeline to export yet.')

  // fps 0 = capture only when we explicitly ask, so frames stay tied to the
  // render clock instead of to the compositor's own refresh.
  const canvasStream = player.canvas.captureStream(0)
  const videoTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
  const manual = typeof videoTrack.requestFrame === 'function'
  const track = manual ? videoTrack : player.canvas.captureStream(fps).getVideoTracks()[0]
  const audioTrack = player.streamDest.stream.getAudioTracks()[0]
  const stream = new MediaStream(audioTrack ? [track, audioTrack] : [track])

  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }

  const finished = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })

  player.pause()
  await player.renderAt(0)
  if (manual) player.afterFrame = () => videoTrack.requestFrame()
  recorder.start(250)

  const done = new Promise<void>((resolve) => {
    const prevEnded = player.onEnded
    const prevTime = player.onTime
    player.onTime = (t) => { onProgress?.(Math.min(1, t / duration)); prevTime?.(t) }
    player.onEnded = () => {
      player.onEnded = prevEnded
      player.onTime = prevTime
      resolve()
    }
  })

  await player.play(0, workerDriver(fps))
  await done
  player.afterFrame = null
  // Let the tail of the last frame and audio flush before closing the file.
  await new Promise((r) => setTimeout(r, 250))
  recorder.stop()
  await finished
  track.stop()

  onProgress?.(1)
  return { blob: new Blob(chunks, { type: mimeType }), mimeType, extension: extensionFor(mimeType), duration }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
