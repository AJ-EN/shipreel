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
