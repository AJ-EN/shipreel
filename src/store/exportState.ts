import { create } from 'zustand'
import { exportTimeline, downloadBlob } from '../engine/export'
import type { Player } from '../engine/player'

export type ExportPhase = 'idle' | 'rendering' | 'ready' | 'error'

interface State {
  phase: ExportPhase
  /** 0..1 while rendering. */
  progress: number
  filename: string | null
  message: string | null
  /** Wall-clock seconds the last render took. */
  elapsed: number | null
  sizeKB: number | null
  run: (player: Player, filename?: string) => Promise<void>
}

/**
 * Rendering is real time, so it cannot complete inside a single tool call
 * without blocking the agent for a minute. Both the UI button and the
 * export_video tool drive this store, and get_export_status reads it.
 */
export const useExport = create<State>((set, get) => ({
  phase: 'idle',
  progress: 0,
  filename: null,
  message: null,
  elapsed: null,
  sizeKB: null,

  run: async (player, filename) => {
    if (get().phase === 'rendering') return
    const name = (filename || 'shipreel-cut').replace(/[^\w-]+/g, '-')
    const t0 = performance.now()
    set({ phase: 'rendering', progress: 0, filename: name, message: null, elapsed: null, sizeKB: null })
    try {
      const r = await exportTimeline(player, { onProgress: (p) => set({ progress: p }) })
      downloadBlob(r.blob, `${name}.${r.extension}`)
      set({
        phase: 'ready',
        progress: 1,
        filename: `${name}.${r.extension}`,
        elapsed: (performance.now() - t0) / 1000,
        sizeKB: Math.round(r.blob.size / 1024),
        message: null,
      })
    } catch (e) {
      set({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  },
}))
