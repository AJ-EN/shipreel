import { useEffect, useRef, useState } from 'react'
import { useProject } from './store/project'
import { loadMedia } from './engine/media'
import { detectSilence } from './engine/silence'
import { Player } from './engine/player'
import { installWebMCP } from './webmcp/tools'
import Preview from './components/Preview'
import Timeline from './components/Timeline'
import TranscriptPanel from './components/TranscriptPanel'
import type { MediaAsset, Transcript } from './types'

interface DemoProject {
  name: string
  media: MediaAsset[]
  transcript: string
}

type Phase = { kind: 'loading'; step: string } | { kind: 'ready' } | { kind: 'error'; message: string }

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', step: 'starting up' })
  const [player, setPlayer] = useState<Player | null>(null)
  const [tools, setTools] = useState<number | null>(null)
  const booted = useRef(false)

  useEffect(() => {
    if (booted.current) return // StrictMode double-invoke guard
    booted.current = true

    let cleanupTools = () => {}
    ;(async () => {
      try {
        const audio = new AudioContext()

        setPhase({ kind: 'loading', step: 'loading demo project' })
        const proj: DemoProject = await fetch('/demo/project.json').then((r) => r.json())
        const transcript: Transcript = await fetch(proj.transcript).then((r) => r.json())

        setPhase({ kind: 'loading', step: 'decoding media' })
        const media = await loadMedia(proj.media, audio)

        setPhase({ kind: 'loading', step: 'analysing the voiceover' })
        const voice = proj.media.find((m) => m.kind === 'audio')!
        // Detect down to a fine floor once; find_silences filters upward from
        // here, so an agent cutting to a target runtime can reclaim short
        // pauses that a first pass deliberately leaves alone.
        const silences = detectSilence(media.buffers.get(voice.id)!, { minDuration: 0.2, padding: 0.06 })

        useProject.getState().load(proj.media, transcript, silences)

        const p = new Player(audio, media, () => {
          const s = useProject.getState()
          return { clips: s.clips, zooms: s.zooms, duration: s.duration() }
        })
        // Throttle store writes so a 60fps render loop doesn't re-render the tree 60x/s.
        let last = -1
        p.onTime = (t) => {
          if (Math.abs(t - last) < 0.05) return
          last = t
          useProject.getState().setPlayhead(t)
        }

        cleanupTools = installWebMCP(p)
        await p.renderAt(0)
        setPlayer(p)
        setPhase({ kind: 'ready' })

        const mc = document.modelContext
        if (mc?.getTools) setTools((await mc.getTools()).length)
      } catch (e) {
        setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    })()

    return () => cleanupTools()
  }, [])

  // Keep the tool-count badge honest as tools register and retire.
  const clipCount = useProject((s) => s.clips.length)
  useEffect(() => {
    const mc = document.modelContext
    if (!mc?.getTools) return
    void mc.getTools().then((t) => setTools(t.length))
  }, [clipCount, phase])

  const agentReady = typeof document.modelContext?.registerTool === 'function'

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-5 h-14 border-b border-ink-800 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-reel-500 grid place-items-center">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round">
              <circle cx="7" cy="7" r="5.6" /><path d="M7 1.4v11.2M1.4 7h11.2" opacity=".55" />
            </svg>
          </div>
          <span className="font-semibold tracking-tight text-mist-200">ShipReel</span>
        </div>
        <span className="text-[12px] text-mist-400 hidden sm:inline">agent-native video studio</span>

        <div className="ml-auto flex items-center gap-2">
          <div
            className={`flex items-center gap-2 px-2.5 h-8 rounded-lg text-[12px] ring-1 ${
              agentReady ? 'bg-signal-400/10 ring-signal-400/30 text-signal-400' : 'bg-ink-800 ring-ink-600 text-mist-400'
            }`}
            title={agentReady
              ? 'WebMCP detected — your agent can drive this editor'
              : 'Open in ChatGPT’s built-in browser, or Chrome 149+ with chrome://flags/#enable-webmcp-testing'}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${agentReady ? 'bg-signal-400 pulse-dot' : 'bg-mist-400/50'}`} />
            {agentReady
              ? <>Agent mode{tools !== null && <span className="font-mono opacity-80">· {tools} tools</span>}</>
              : <>No agent — human mode</>}
          </div>
        </div>
      </header>

      {phase.kind === 'loading' && (
        <div className="flex-1 grid place-items-center">
          <div className="text-center">
            <div className="w-7 h-7 mx-auto mb-3 rounded-full border-2 border-ink-600 border-t-reel-400 animate-spin" />
            <p className="text-[13px] text-mist-400">{phase.step}…</p>
          </div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="flex-1 grid place-items-center p-8">
          <div className="max-w-md text-center">
            <p className="text-[13px] text-warn-400 mb-2">Could not load the demo project</p>
            <p className="text-[12px] text-mist-400 font-mono">{phase.message}</p>
          </div>
        </div>
      )}

      {phase.kind === 'ready' && player && (
        <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 p-4">
          <div className="flex flex-col gap-4 min-h-0">
            <div className="flex-1 min-h-0"><Preview player={player} /></div>
            <div className="shrink-0"><Timeline player={player} /></div>
          </div>
          <TranscriptPanel player={player} />
        </main>
      )}
    </div>
  )
}
