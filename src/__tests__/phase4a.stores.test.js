// Fase 4A — project store: grouped undo, unsaved changes, saveCurrent with
// conflicts (409), settings saved with the project, versions (migrated),
// array replacement for Vue Flow (Auto Layout, presets).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../api/http.js', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), defaults: { headers: { common: {} } } } }))

import http from '../api/http.js'
import { useProjectStore, HISTORY_GROUP_MS } from '../stores/useProjectStore'
import { CURRENT_SCHEMA_VERSION } from '../audio/graph/migrate.js'

const node = (id, data = {}) => ({ id, type: 'pattern', position: { x: 0, y: 0 }, data: { density: 0.5, ...data } })
const conflictError = (current) => Object.assign(new Error('409'), {
  response: { status: 409, data: { code: 'conflict', message: 'x', current } }
})

describe('grouped undo (updateNodeData)', () => {
  let store
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    store = useProjectStore()
    store.loadProject({ id: 1, name: 'P', nodes: [node('a'), node('b')], edges: [] })
  })
  afterEach(() => vi.useRealTimers())

  const drag = (id, key, values, gap = 30) => {
    for (const v of values) {
      store.updateNodeData(id, { ...store.nodes.find(n => n.id === id).data, [key]: v })
      vi.advanceTimersByTime(gap)
    }
  }

  it('dragging a slider through many values is one undo entry', () => {
    drag('a', 'density', [0.51, 0.55, 0.6, 0.7, 0.8, 0.9])
    expect(store.history).toHaveLength(2)
    expect(store.nodes[0].data.density).toBe(0.9)
    store.undo()
    expect(store.nodes[0].data.density).toBe(0.5)
    store.redo()
    expect(store.nodes[0].data.density).toBe(0.9)
  })

  it('typing in a text field (one update per key) is one entry', () => {
    const text = 'Bajo'
    for (let i = 1; i <= text.length; i++) {
      store.updateNodeData('a', { ...store.nodes[0].data, label: text.slice(0, i) })
      vi.advanceTimersByTime(200)
    }
    expect(store.history).toHaveLength(2)
  })

  it('ending the gesture (pointer up / focus out) starts a new entry', () => {
    drag('a', 'density', [0.6, 0.7])
    store.endHistoryGroup()
    drag('a', 'density', [0.8, 0.9])
    expect(store.history).toHaveLength(3)
  })

  it('a pause longer than the window starts a new entry', () => {
    drag('a', 'density', [0.6])
    vi.advanceTimersByTime(HISTORY_GROUP_MS + 10)
    drag('a', 'density', [0.7])
    expect(store.history).toHaveLength(3)
  })

  it('another field or another node is another entry', () => {
    drag('a', 'density', [0.6, 0.7])
    drag('a', 'rotation', [1, 2])
    drag('b', 'density', [0.1])
    expect(store.history).toHaveLength(4)
  })

  it('any other action in between (connect, add, undo) closes the group', () => {
    drag('a', 'density', [0.6])
    store.addEdge({ id: 'e', source: 'a', target: 'b' })
    drag('a', 'density', [0.7])
    expect(store.history).toHaveLength(4)
    store.undo()
    drag('a', 'density', [0.8])
    // undo then a new change: the redo branch is dropped, a new entry is added
    expect(store.history).toHaveLength(4)
    expect(store.canRedo).toBe(false)
  })

  it('a gesture that comes back to the start leaves no entry; no-op updates are ignored', () => {
    drag('a', 'density', [0.6, 0.5])
    expect(store.history).toHaveLength(1)
    expect(store.updateNodeData('a', { ...store.nodes[0].data })).toBe(false)
    expect(store.history).toHaveLength(1)
  })

  it('group: false always records separately', () => {
    store.updateNodeData('a', { ...store.nodes[0].data, density: 0.6 }, { group: false })
    store.updateNodeData('a', { ...store.nodes[0].data, density: 0.7 }, { group: false })
    expect(store.history).toHaveLength(3)
  })

  it('updateNodeData replaces the nodes array (Vue Flow resync)', () => {
    const before = store.nodes
    store.updateNodeData('a', { ...store.nodes[0].data, density: 0.6 })
    expect(store.nodes).not.toBe(before)
  })
})

describe('whole-graph changes replace the arrays (Vue Flow resync)', () => {
  let store
  beforeEach(() => {
    setActivePinia(createPinia())
    store = useProjectStore()
    store.loadProject({ id: 1, name: 'P', nodes: [node('a'), node('b')], edges: [] })
  })

  it('setNodePositions moves several nodes with a new array and one undo entry', () => {
    const before = store.nodes
    expect(store.setNodePositions({ a: { x: 100, y: 0 }, b: { x: 300, y: 40 } })).toBe(true)
    expect(store.nodes).not.toBe(before)
    expect(store.nodes.map(n => n.position)).toEqual([{ x: 100, y: 0 }, { x: 300, y: 40 }])
    expect(store.history).toHaveLength(2)
    expect(store.setNodePositions({ a: { x: 100, y: 0 } })).toBe(false)
    expect(store.history).toHaveLength(2)
    store.undo()
    expect(store.nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('replaceGraph (presets, import, clear) is one undo entry with new arrays', () => {
    const n = store.nodes
    store.replaceGraph([node('x')], [])
    expect(store.nodes).not.toBe(n)
    expect(store.nodes.map(x => x.id)).toEqual(['x'])
    store.undo()
    expect(store.nodes.map(x => x.id)).toEqual(['a', 'b'])
  })

  it('history snapshots do not keep Vue Flow runtime fields', () => {
    store.nodes[0].computedPosition = { x: 0, y: 0, z: 0 }
    store.nodes[0].selected = true
    store.addEdge({ id: 'e', source: 'a', target: 'b', sourceNode: store.nodes[0], targetNode: store.nodes[1] })
    const last = store.history[store.historyIndex]
    expect(last.nodes[0]).not.toHaveProperty('computedPosition')
    expect(last.nodes[0]).not.toHaveProperty('selected')
    expect(last.edges[0]).not.toHaveProperty('sourceNode')
  })
})

describe('unsaved changes (isDirty)', () => {
  let store
  beforeEach(() => {
    setActivePinia(createPinia())
    store = useProjectStore()
  })

  it('a loaded project is clean; editing makes it dirty; undo back to the loaded state is clean again', () => {
    store.loadProject({ id: 1, name: 'P', nodes: [node('a')], edges: [] })
    expect(store.isDirty).toBe(false)
    store.updateNodeData('a', { ...store.nodes[0].data, density: 0.9 })
    expect(store.isDirty).toBe(true)
    store.undo()
    expect(store.isDirty).toBe(false)
  })

  it('selecting a node is not a change; tempo and swing are', () => {
    store.loadProject({ id: 1, name: 'P', nodes: [node('a')], edges: [], metadata: { tempo: 100, swing: 0.1 } })
    expect(store.settings).toEqual({ tempo: 100, swing: 0.1 })
    store.nodes[0].selected = true
    expect(store.isDirty).toBe(false)
    store.setSettings({ tempo: 101 })
    expect(store.isDirty).toBe(true)
    store.setSettings({ tempo: 100 })
    expect(store.isDirty).toBe(false)
    store.setSettings({ swing: 0.3 })
    expect(store.isDirty).toBe(true)
  })

  it('loadProject increments loadCount (the transport applies the loaded settings)', () => {
    const c = store.loadCount
    store.loadProject({ id: 1, name: 'P', nodes: [], edges: [] })
    expect(store.loadCount).toBe(c + 1)
  })
})

describe('saveCurrent: create, update with base, conflict, overwrite', () => {
  let store
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    store = useProjectStore()
  })

  it('a new project is created with its graph (without runtime fields) and settings, then becomes the current one', async () => {
    store.loadProject({ id: null, name: 'Nuevo', nodes: [], edges: [] })
    store.addNode({ ...node('a'), selected: true, computedPosition: { x: 0, y: 0 } })
    store.setSettings({ tempo: 95, swing: 0.2 })
    http.post.mockResolvedValue({ data: { message: 'ok', id: 9, name: 'Nuevo', nodes: [node('a')], edges: [], updated_at: '2026-01-01 00:00:00.000' } })
    const result = await store.saveCurrent()
    expect(result).toMatchObject({ success: true, created: true })
    const body = http.post.mock.calls[0][1]
    expect(body.nodes[0]).toEqual(node('a'))
    expect(body.metadata).toEqual({ tempo: 95, swing: 0.2, schemaVersion: CURRENT_SCHEMA_VERSION })
    expect(store.currentProject).toMatchObject({ id: 9, updated_at: '2026-01-01 00:00:00.000' })
    expect(store.currentProject).not.toHaveProperty('message')
    expect(store.isDirty).toBe(false)
    expect(store.isPersisted).toBe(true)
  })

  it('an existing project is PUT with base_updated_at and takes the new updated_at', async () => {
    store.loadProject({ id: 5, name: 'P', nodes: [node('a')], edges: [], updated_at: 'T1' })
    store.updateNodeData('a', { ...store.nodes[0].data, density: 0.9 })
    http.put.mockResolvedValue({ data: { id: 5, name: 'P', nodes: [], edges: [], updated_at: 'T2' } })
    const r = await store.saveCurrent()
    expect(r.success).toBe(true)
    expect(http.put).toHaveBeenCalledWith('/projects/5', expect.objectContaining({ base_updated_at: 'T1', name: 'P' }))
    expect(store.currentProject.updated_at).toBe('T2')
    expect(store.isDirty).toBe(false)
    expect(store.saveStatus).toBe('idle')
    // next save is based on T2
    store.updateNodeData('a', { ...store.nodes[0].data, density: 0.1 })
    await store.saveCurrent()
    expect(http.put.mock.calls[1][1].base_updated_at).toBe('T2')
  })

  it('a 409 leaves the changes unsaved and the conflict recorded; force overwrites without base', async () => {
    store.loadProject({ id: 5, name: 'P', nodes: [node('a')], edges: [], updated_at: 'T1' })
    store.updateNodeData('a', { ...store.nodes[0].data, density: 0.9 })
    http.put.mockRejectedValueOnce(conflictError({ id: 5, updated_at: 'T9', node_count: 1, edge_count: 0 }))
    const r = await store.saveCurrent()
    expect(r).toMatchObject({ success: false, conflict: true })
    expect(store.saveStatus).toBe('conflict')
    expect(store.conflict.updated_at).toBe('T9')
    expect(store.isDirty).toBe(true)

    store.dismissConflict()
    expect(store.saveStatus).toBe('error')
    expect(store.conflict).not.toBeNull()

    http.put.mockResolvedValueOnce({ data: { id: 5, name: 'P', nodes: [], edges: [], updated_at: 'T10' } })
    const forced = await store.saveCurrent({ force: true })
    expect(forced.success).toBe(true)
    expect(http.put.mock.calls[1][1]).not.toHaveProperty('base_updated_at')
    expect(store.conflict).toBeNull()
    expect(store.isDirty).toBe(false)
  })

  it('reloadFromServer drops local changes and loads the server copy (migrated)', async () => {
    store.loadProject({ id: 5, name: 'P', nodes: [node('a')], edges: [], updated_at: 'T1' })
    store.updateNodeData('a', { ...store.nodes[0].data, density: 0.9 })
    http.put.mockRejectedValueOnce(conflictError({ id: 5, updated_at: 'T9' }))
    await store.saveCurrent()
    http.get.mockResolvedValueOnce({ data: { id: 5, name: 'P', nodes: [node('a'), node('z')], edges: [], updated_at: 'T9', metadata: {} } })
    const r = await store.reloadFromServer()
    expect(r.success).toBe(true)
    expect(store.nodes.map(n => n.id)).toEqual(['a', 'z'])
    expect(store.saveStatus).toBe('idle')
    expect(store.conflict).toBeNull()
    expect(store.isDirty).toBe(false)
    expect(store.currentProject.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('other errors keep the changes and report them', async () => {
    store.loadProject({ id: 5, name: 'P', nodes: [node('a')], edges: [], updated_at: 'T1' })
    store.updateNodeData('a', { ...store.nodes[0].data, density: 0.9 })
    http.put.mockRejectedValueOnce(Object.assign(new Error('x'), { friendlyMessage: 'Sin conexión' }))
    const r = await store.saveCurrent()
    expect(r.success).toBe(false)
    expect(store.saveStatus).toBe('error')
    expect(store.saveError).toBe('Sin conexión')
    expect(store.isDirty).toBe(true)
  })

  it('edits made while a save is in flight stay unsaved; a second call waits for the first', async () => {
    store.loadProject({ id: 5, name: 'P', nodes: [node('a')], edges: [], updated_at: 'T1' })
    store.updateNodeData('a', { ...store.nodes[0].data, density: 0.9 })
    let resolve
    http.put.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const first = store.saveCurrent()
    store.updateNodeData('a', { ...store.nodes[0].data, density: 0.1 }, { group: false })
    const second = store.saveCurrent()
    expect(http.put).toHaveBeenCalledTimes(1)
    http.put.mockResolvedValueOnce({ data: { id: 5, name: 'P', nodes: [], edges: [], updated_at: 'T3' } })
    resolve({ data: { id: 5, name: 'P', nodes: [], edges: [], updated_at: 'T2' } })
    await first
    expect(store.isDirty).toBe(true)
    await second
    expect(http.put).toHaveBeenCalledTimes(2)
    expect(http.put.mock.calls[1][1].base_updated_at).toBe('T2')
    expect(http.put.mock.calls[1][1].nodes[0].data.density).toBe(0.1)
    expect(store.isDirty).toBe(false)
  })
})

describe('versions', () => {
  let store
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    store = useProjectStore()
    store.loadProject({ id: 7, name: 'P', nodes: [], edges: [], updated_at: 'T1' })
  })

  // A version saved before Fase 3 (schema 1): Voice → Pattern edge, no seed
  const oldVersion = {
    id: 3, project_id: 7, version_number: 2, created_at: '2025-07-01 10:00:00',
    nodes: [
      { id: 'p', type: 'pattern', position: { x: 0, y: 0 }, data: { algorithm: 'euclidean', density: 0.5 } },
      { id: 'v', type: 'voice', position: { x: 200, y: 0 }, data: { instrument: 'Bass' } }
    ],
    edges: [{ id: 'e', source: 'v', target: 'p', sourceHandle: 'voice-input', targetHandle: 'output' }],
    metadata: { version: 2 }
  }

  it('fetchVersions returns the light list', async () => {
    http.get.mockResolvedValueOnce({ data: [{ version_number: 2 }, { version_number: 1 }] })
    const r = await store.fetchVersions()
    expect(http.get).toHaveBeenCalledWith('/projects/7/versions')
    expect(r.versions).toHaveLength(2)
  })

  it('fetchVersion migrates an old version for the preview (without touching the editor)', async () => {
    http.get.mockResolvedValueOnce({ data: oldVersion })
    const r = await store.fetchVersion(7, 2)
    expect(http.get).toHaveBeenCalledWith('/projects/7/versions/2')
    expect(r.version.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(r.version.edges[0]).toMatchObject({ source: 'p', target: 'v', sourceHandle: 'pattern', targetHandle: 'notes' })
    expect(Number.isFinite(r.version.nodes[0].data.seed)).toBe(true)
    expect(r.version.version_number).toBe(2)
    expect(store.nodes).toEqual([])
  })

  it('restoreVersion loads the restored project migrated and clean', async () => {
    http.post.mockResolvedValueOnce({ data: { message: 'restored', id: 7, name: 'P', nodes: oldVersion.nodes, edges: oldVersion.edges, metadata: { restored_from_version: 2 }, updated_at: 'T5' } })
    const r = await store.restoreVersion(7, 2)
    expect(http.post).toHaveBeenCalledWith('/projects/7/restore/2')
    expect(r.success).toBe(true)
    expect(store.nodes.map(n => n.id)).toEqual(['p', 'v'])
    expect(store.edges[0]).toMatchObject({ source: 'p', target: 'v', targetHandle: 'notes' })
    expect(store.currentProject.updated_at).toBe('T5')
    expect(store.currentProject).not.toHaveProperty('message')
    expect(store.isDirty).toBe(false)
    expect(store.history).toHaveLength(1)
  })

  it('errors are reported', async () => {
    http.post.mockRejectedValueOnce(Object.assign(new Error('x'), { friendlyMessage: 'Version not found' }))
    expect(await store.restoreVersion(7, 99)).toEqual({ success: false, error: 'Version not found' })
  })
})
