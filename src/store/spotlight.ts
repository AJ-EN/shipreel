import { create } from 'zustand'

/**
 * What the agent is pointing at.
 *
 * `preview_at` moves the playhead, which on its own is easy to miss — the
 * frame changes and nothing says why. This holds a short-lived caption so the
 * preview can show whose decision that was, then clear itself.
 */
interface State {
  at: number | null
  note: string | null
  /** Bumped on every call, so repeat previews of the same moment re-trigger. */
  token: number
  show: (at: number, note: string) => void
  hide: () => void
}

export const useSpotlight = create<State>((set, get) => ({
  at: null,
  note: null,
  token: 0,
  show: (at, note) => set({ at, note, token: get().token + 1 }),
  hide: () => set({ at: null, note: null }),
}))
