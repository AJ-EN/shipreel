import type { MediaAsset } from '../types'


export interface LoadedMedia {
  videos: Map<string, HTMLVideoElement>
  buffers: Map<string, AudioBuffer>
}

const loadVideo = (src: string) =>
  new Promise<HTMLVideoElement>((resolve, reject) => {
    const el = document.createElement('video')
    el.src = src
    el.preload = 'auto'
    el.muted = true // screen recordings carry no audio; the voiceover track owns sound
    el.playsInline = true
    el.crossOrigin = 'anonymous'
    el.onloadeddata = () => resolve(el)
    el.onerror = () => reject(new Error(`could not load ${src}`))
  })

const loadBuffer = async (src: string, ctx: AudioContext) => {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`could not fetch ${src}`)
  return ctx.decodeAudioData(await res.arrayBuffer())
}

export async function loadMedia(assets: MediaAsset[], ctx: AudioContext): Promise<LoadedMedia> {
  const videos = new Map<string, HTMLVideoElement>()
  const buffers = new Map<string, AudioBuffer>()
  await Promise.all(
    assets.map(async (a) => {
      if (a.kind === 'video') videos.set(a.id, await loadVideo(a.src))
      else buffers.set(a.id, await loadBuffer(a.src, ctx))
    }),
  )
  return { videos, buffers }
}

/** Filename -> a short id an agent can refer to, e.g. "login-flow.mov" -> "login-flow". */
const slug = (name: string) =>
  name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'clip'

/**
 * Loads a recording the person picked off their own disk.
 *
 * The file is wrapped in an object URL and never uploaded — same path the
 * bundled demo takes, so everything downstream (compositing, export, every
 * tool) treats it identically. The id is derived from the filename so the
 * agent can be told "put the login-flow clip at 20s" and resolve it.
 */
export async function loadVideoFile(
  file: File,
  taken: string[],
): Promise<{ asset: MediaAsset; el: HTMLVideoElement }> {
  if (!file.type.startsWith('video/')) {
    throw new Error(`"${file.name}" is not a video file. Screen recordings only — MP4, WebM or MOV.`)
  }
  const src = URL.createObjectURL(file)
  let el: HTMLVideoElement
  try {
    el = await loadVideo(src)
  } catch {
    URL.revokeObjectURL(src)
    throw new Error(`Could not decode "${file.name}". Try an MP4 or WebM.`)
  }
  // Some containers report Infinity until fully buffered; a clip of unknown
  // length would break every duration calculation downstream.
  if (!Number.isFinite(el.duration) || el.duration <= 0) {
    URL.revokeObjectURL(src)
    throw new Error(`Could not read the length of "${file.name}". Try re-encoding it as MP4.`)
  }

  let id = slug(file.name)
  if (taken.includes(id)) {
    let n = 2
    while (taken.includes(`${id}-${n}`)) n++
    id = `${id}-${n}`
  }
  return { asset: { id, kind: 'video', label: `Screen recording — ${file.name}`, src, duration: el.duration }, el }
}
