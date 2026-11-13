import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mockHttp = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  defaults: { headers: { common: {} } }
}))

vi.mock('../api/http.js', () => ({ default: mockHttp }))

import { useProjectStore } from '../stores/useProjectStore'
import { usePresetStore, BUILT_IN_PRESETS } from '../stores/usePresetStore'
import { compileGraph } from '../audio/graph/compile.js'
import { migrateProject } from '../audio/graph/migrate.js'
import { isValidConnection } from '../audio/graph/connections.js'

/** The built-in presets as they were stored before Fase 3 (schema 1). */
const OLD_PRESETS = {
  'preset-kick': {
    nodes: [
      { id: 'preset-pattern-kick', type: 'pattern', data: { algorithm: 'euclidean', seed: 0.42, density: 0.5, rotation: 0 } },
      { id: 'preset-length-kick', type: 'length', data: { value: 16, min: 4, max: 512 } },
      { id: 'preset-voice-kick', type: 'voice', data: { instrument: 'Drums', volume: 0.8, pan: 0 } }
    ],
    edges: [
      { id: 'preset-edge-1', source: 'preset-length-kick', target: 'preset-pattern-kick', sourceHandle: 'output', targetHandle: 'length' },
      { id: 'preset-edge-2', source: 'preset-voice-kick', target: 'preset-pattern-kick', sourceHandle: 'output', targetHandle: 'voice' }
    ]
  },
  'preset-bassline': {
    nodes: [
      { id: 'preset-pattern-bass', type: 'pattern', data: { algorithm: 'random', seed: 0.23, density: 0.4, rotation: 0 } },
      { id: 'preset-length-bass', type: 'length', data: { value: 16, min: 4, max: 512 } },
      { id: 'preset-loop-bass', type: 'loop', data: { value: 4, min: 1, max: 64 } },
      { id: 'preset-voice-bass', type: 'voice', data: { instrument: 'Bass', volume: 0.9, pan: 0 } }
    ],
    edges: [
      { id: 'preset-edge-1', source: 'preset-length-bass', target: 'preset-pattern-bass', sourceHandle: 'output', targetHandle: 'length' },
      { id: 'preset-edge-2', source: 'preset-loop-bass', target: 'preset-pattern-bass', sourceHandle: 'output', targetHandle: 'loop' },
      { id: 'preset-edge-3', source: 'preset-voice-bass', target: 'preset-pattern-bass', sourceHandle: 'output', targetHandle: 'voice' }
    ]
  }
}

const stripTrackId = (score) => score.tracks.map(t => ({ ...t, id: null, events: t.events.map(({ track, ...e }) => e) }))

describe('presets incorporados (esquema 2)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('todos compilan en modo pistas con al menos una pista que suena', () => {
    const store = usePresetStore()
    // Fase 3B: 6 de una pista + 5 multipista (antes 6)
    expect(store.builtInPresets).toHaveLength(11)
    for (const preset of BUILT_IN_PRESETS) {
      const r = compileGraph(preset.nodes, preset.edges)
      expect(r.mode).toBe('tracks')
      expect(r.score.tracks.length).toBeGreaterThan(0)
      expect(r.score.tracks[0].events.length).toBeGreaterThan(0)
      expect(r.diagnostics.filter(d => d.level !== 'info')).toEqual([])
      for (const e of preset.edges) {
        expect(isValidConnection(e, preset.nodes, preset.edges.filter(x => x !== e))).toBe(true)
      }
    }
  })

  it('suenan igual que los presets viejos', () => {
    for (const [id, old] of Object.entries(OLD_PRESETS)) {
      const preset = BUILT_IN_PRESETS.find(p => p.id === id)
      const before = compileGraph(old.nodes, old.edges).score
      const after = compileGraph(preset.nodes, preset.edges).score
      expect(stripTrackId(after)).toEqual(stripTrackId(before))
    }
  })

  it('un preset de usuario viejo se migra al aplicarlo', () => {
    const old = OLD_PRESETS['preset-kick']
    const g = migrateProject({ nodes: old.nodes, edges: old.edges, metadata: { schemaVersion: undefined } })
    expect(g.edges.find(e => e.id === 'preset-edge-2')).toMatchObject({ source: 'preset-pattern-kick', target: 'preset-voice-kick' })
  })

  it('los presets de usuario nuevos se guardan con schemaVersion', () => {
    const store = usePresetStore()
    const p = store.saveCurrentAsPreset('x', [], [])
    expect(p.schemaVersion).toBe(3)
  })
})

describe('useProjectStore + migración', () => {
  let store
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    store = useProjectStore()
  })

  it('fetchProject migra un proyecto viejo al abrirlo', async () => {
    const old = OLD_PRESETS['preset-kick']
    mockHttp.get.mockResolvedValue({ data: { id: 4, name: 'Old', nodes: old.nodes, edges: old.edges, metadata: { version: 2 } } })
    await store.fetchProject(4)
    expect(store.currentProject.metadata.schemaVersion).toBe(3)
    expect(store.currentProject.metadata.version).toBe(2)
    expect(store.edges.find(e => e.id === 'preset-edge-2')).toMatchObject({
      source: 'preset-pattern-kick', sourceHandle: 'pattern', target: 'preset-voice-kick', targetHandle: 'notes'
    })
  })

  it('saveProject y createProject mandan metadata.schemaVersion', async () => {
    store.loadProject({ id: 5, name: 'P', nodes: [], edges: [] })
    mockHttp.put.mockResolvedValue({ data: { id: 5, name: 'P', nodes: [], edges: [] } })
    await store.saveProject(5, { name: 'P' })
    expect(mockHttp.put.mock.calls[0][1].metadata).toEqual({ schemaVersion: 3 })

    mockHttp.post.mockResolvedValue({ data: { id: 6, name: 'N', nodes: [], edges: [] } })
    await store.createProject({ name: 'N', nodes: [], edges: [] })
    expect(mockHttp.post.mock.calls[0][1].metadata).toEqual({ schemaVersion: 3 })
  })
})

describe('.cgproj', () => {
  it('importar un .cgproj viejo lo migra al esquema actual', async () => {
    const { validateProjectData } = await import('../composables/useProjectIO.js')
    const old = OLD_PRESETS['preset-bassline']
    const r = validateProjectData({ format: 'cgproj', version: '1.0', metadata: { name: 'Bajo' }, nodes: old.nodes, edges: old.edges })
    expect(r.valid).toBe(true)
    expect(r.data.name).toBe('Bajo')
    expect(r.data.metadata.schemaVersion).toBe(3)
    expect(r.data.edges.find(e => e.id === 'preset-edge-3')).toMatchObject({ source: 'preset-pattern-bass', target: 'preset-voice-bass' })
    // Same sound as before the migration
    expect(compileGraph(r.data.nodes, r.data.edges).score).toEqual(compileGraph(old.nodes, old.edges).score)
  })

  it('un .cgproj en esquema 2 conserva aristas y estilos', async () => {
    const { validateProjectData } = await import('../composables/useProjectIO.js')
    const preset = BUILT_IN_PRESETS[0]
    const r = validateProjectData({ format: 'cgproj', metadata: { name: 'K', schemaVersion: 2 }, nodes: preset.nodes, edges: preset.edges })
    expect(r.data.edges).toEqual(preset.edges)
  })
})
