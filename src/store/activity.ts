import { create } from 'zustand'

export type ActivityStatus = 'running' | 'ok' | 'error'
export type ActivityKind = 'tool' | 'user' | 'phase'

export interface ActivityEntry {
  id: string
  kind: ActivityKind
  /** Tool name, or a short label for user/phase rows. */
  label: string
  /** Compact argument echo, e.g. `min_seconds: 0.4`. */
  args?: string
  /** First line of the tool's return value. */
  result?: string
  status: ActivityStatus
  at: number
}

let n = 0

interface State {
  entries: ActivityEntry[]
  start: (kind: ActivityKind, label: string, args?: string) => string
  finish: (id: string, result: string, status?: ActivityStatus) => void
  note: (kind: ActivityKind, label: string, result?: string) => void
  clear: () => void
}

/** Compact one-line echo of tool arguments, kept short enough to read live. */
export function summariseArgs(input: unknown): string {
  if (input == null || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  const parts: string[] = []
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue
    if (Array.isArray(v)) parts.push(`${k}: ${v.length}`)
    else if (typeof v === 'number') parts.push(`${k}: ${+v.toFixed(2)}`)
    else if (typeof v === 'string') parts.push(`${k}: ${v.length > 28 ? `${v.slice(0, 28)}…` : v}`)
    else parts.push(k)
  }
  return parts.join(' · ')
}

export const useActivity = create<State>((set) => ({
  entries: [],

  start: (kind, label, args) => {
    const id = `a${++n}`
    set((s) => ({ entries: [...s.entries, { id, kind, label, args, status: 'running', at: Date.now() }] }))
    return id
  },

  finish: (id, result, status = 'ok') =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === id ? { ...e, result: result.split('\n')[0].slice(0, 220), status } : e,
      ),
    })),

  note: (kind, label, result) =>
    set((s) => ({
      entries: [...s.entries, { id: `a${++n}`, kind, label, result, status: 'ok', at: Date.now() }],
    })),

  clear: () => set({ entries: [] }),
}))
