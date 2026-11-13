import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAudioStore, setAudioEngineFactory } from '../stores/useAudioStore'
import { createEngine } from '../audio/engine/index.js'
import { FakeAudioContext, createFakeTimers } from './helpers/fakeAudioContext.js'
import { scoreFromGraph } from '../composables/usePlayback.js'
import { legacyTrackSpec as getTrackSpec } from '../audio/graph/compile.js' // ex graphTraversal.getTrackSpec

const graph = {
  nodes: [
    { id: 'p', type: 'pattern', data: { algorithm: 'euclidean', density: 1, rotation: 0, seed: 0.5 } },
    { id: 'l', type: 'length', data: { value: 16 } },
    { id: 'v', type: 'voice', data: { instrument: 'Synth', octave: 3, melodyMode: 'fixed', root: 'D', scale: 'minor', volume: 0.4, pan: 0.5 } }
  ],
  edges: [
    { id: 'e1', source: 'l', target: 'p' },
    { id: 'e2', source: 'v', target: 'p' }
  ]
}

describe('useAudioStore (capa fina sobre el motor)', () => {
  let ctx, timers

  beforeEach(() => {
    setActivePinia(createPinia())
    ctx = new FakeAudioContext()
    timers = createFakeTimers()
    setAudioEngineFactory((opts) => createEngine({
      ...opts,
      createContext: () => ctx,
      transportOptions: { timers }
    }))
  })

  afterEach(() => setAudioEngineFactory())

  const advance = (seconds) => {
    const end = ctx.currentTime + seconds
    while (ctx.currentTime < end - 1e-9) {
      ctx.currentTime = Math.min(end, ctx.currentTime + 0.025)
      timers.fire()
    }
  }

  it('estado inicial', () => {
    const store = useAudioStore()
    expect(store.isPlaying).toBe(false)
    expect(store.currentStep).toBe(-1)
    expect(store.tempo).toBe(120)
    expect(store.loopEnabled).toBe(true)
    expect(store.availableInstruments).toEqual(['Piano', 'Synth', 'Guitar', 'Bass', 'Drums'])
  })

  it('play / stop', async () => {
    const store = useAudioStore()
    const score = scoreFromGraph(graph.nodes, graph.edges, store.tempo)
    expect(await store.play(score)).toBe(true)
    expect(store.isPlaying).toBe(true)
    expect(store.currentTrack.instrument).toBe('Synth')
    advance(1)
    expect(ctx.sources().length).toBeGreaterThan(0)
    store.stop()
    expect(store.isPlaying).toBe(false)
    expect(store.currentStep).toBe(-1)
  })

  it('en modo una vez isPlaying vuelve a false solo al terminar', async () => {
    const store = useAudioStore()
    store.setLoop(false)
    await store.play(scoreFromGraph(graph.nodes, graph.edges, store.tempo))
    expect(store.isPlaying).toBe(true)
    advance(16 * 0.125 + 0.3)
    expect(store.isPlaying).toBe(false)
  })

  it('setTempo, setMasterVolume y setExportRepeats acotan valores', () => {
    const store = useAudioStore()
    store.setTempo(500)
    expect(store.tempo).toBe(200)
    store.setMasterVolume(2)
    expect(store.masterVolume).toBe(1)
    store.setExportRepeats(0)
    expect(store.exportRepeats).toBe(1)
    store.setExportRepeats(4)
    expect(store.exportRepeats).toBe(4)
  })

  it('updateScore en caliente no detiene la reproducción', async () => {
    const store = useAudioStore()
    await store.play(scoreFromGraph(graph.nodes, graph.edges, 120))
    advance(0.5)
    const nodes2 = graph.nodes.map(n => n.type === 'voice' ? { ...n, data: { ...n.data, instrument: 'Bass' } } : n)
    store.updateScore(scoreFromGraph(nodes2, graph.edges, 120))
    advance(2.5)
    expect(store.isPlaying).toBe(true)
    expect(store.currentTrack.instrument).toBe('Bass')
  })

  it('exportMidi devuelve un Blob MIDI', () => {
    const store = useAudioStore()
    const blob = store.exportMidi(scoreFromGraph(graph.nodes, graph.edges, 120))
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('audio/midi')
    expect(store.exportMidi(null)).toBe(null)
  })

  it('previewNote toca una nota con el motor', async () => {
    const store = useAudioStore()
    await store.previewNote({ instrument: 'Piano', midi: 60 })
    expect(ctx.sources().length).toBe(3)
    expect(store.isInitialized).toBe(true)
  })
})

describe('grafo → partitura (Fase 2: una pista)', () => {
  it('getTrackSpec toma melodía, mezcla y pieza del VoiceNode', () => {
    const spec = getTrackSpec(graph.nodes, graph.edges)
    expect(spec.instrument).toBe('Synth')
    expect(spec.octave).toBe(3)
    expect(spec.melody).toEqual({ mode: 'fixed', root: 'D', scale: 'minor', range: 2 })
    expect(spec.volume).toBe(0.4)
    expect(spec.pan).toBe(0.5)
    expect(spec.loop).toBeUndefined() // no Loop node connected
  })

  it('el Loop conectado divide el patrón', () => {
    const nodes = [...graph.nodes, { id: 'lp', type: 'loop', data: { value: 4 } }]
    const edges = [...graph.edges, { id: 'e3', source: 'lp', target: 'p' }]
    const spec = getTrackSpec(nodes, edges)
    expect(spec.loop).toBe(4)
    expect(spec.length).toBe(16)
  })

  it('VoiceNode viejo sin parámetros de melodía usa valores por defecto', () => {
    const nodes = graph.nodes.map(n => n.type === 'voice' ? { ...n, data: { instrument: 'Piano' } } : n)
    const spec = getTrackSpec(nodes, graph.edges)
    expect(spec.melody).toEqual({ mode: 'ascending', root: 'C', scale: 'pentatonic', range: 2 })
    expect(spec.drumPiece).toBe('auto')
  })

  it('scoreFromGraph produce una partitura { tempo, tracks }', () => {
    const score = scoreFromGraph(graph.nodes, graph.edges, 90)
    expect(score.tempo).toBe(90)
    expect(score.tracks).toHaveLength(1)
    // fixed D in octave 3 → MIDI 50
    expect(new Set(score.tracks[0].events.map(e => e.midi))).toEqual(new Set([50]))
  })
})
