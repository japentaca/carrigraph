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

import { useProjectStore, cloneNode, toProjectSummary } from '../stores/useProjectStore'

const node = (id, x = 0, y = 0, data = {}) => ({ id, type: 'pattern', position: { x, y }, data })

describe('useProjectStore (Phase 1)', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    store = useProjectStore()
  })

  describe('drag and undo history', () => {
    beforeEach(() => {
      store.loadProject({ id: 1, name: 'T', nodes: [node('a')], edges: [] })
    })

    it('a whole drag creates a single history entry', () => {
      const moves = [10, 20, 30, 40, 50].map(x => ({ id: 'a', type: 'position', dragging: true, position: { x, y: 0 } }))
      for (const m of moves) store.applyPositionChanges([m])
      expect(store.history).toHaveLength(1)
      expect(store.nodes[0].position).toEqual({ x: 50, y: 0 })

      // Drag end (Vue Flow sends dragging=false, possibly without position)
      store.applyPositionChanges([{ id: 'a', type: 'position', dragging: false }])
      expect(store.history).toHaveLength(2)

      store.undo()
      expect(store.nodes[0].position).toEqual({ x: 0, y: 0 })
      store.redo()
      expect(store.nodes[0].position).toEqual({ x: 50, y: 0 })
    })

    it('a drag end without movement does not add an entry', () => {
      store.applyPositionChanges([{ id: 'a', type: 'position', dragging: false, position: { x: 0, y: 0 } }])
      expect(store.history).toHaveLength(1)
    })

    it('ignores non-position changes', () => {
      store.applyPositionChanges([{ id: 'a', type: 'select', selected: true }])
      expect(store.history).toHaveLength(1)
    })

    it('updateNode with history:false does not record, commitHistory does', () => {
      store.updateNode('a', { data: { v: 1 } }, { history: false })
      expect(store.history).toHaveLength(1)
      store.commitHistory()
      expect(store.history).toHaveLength(2)
    })
  })

  describe('loadProject deep clone', () => {
    it('does not share objects with the loaded project or the first history entry', () => {
      const project = { id: 1, name: 'T', nodes: [node('a', 1, 2, { seed: 0.5 })], edges: [{ id: 'e', source: 'a', target: 'b' }] }
      store.loadProject(project)

      store.nodes[0].position.x = 999
      store.nodes[0].data.seed = 0.9
      store.edges[0].target = 'zzz'

      expect(project.nodes[0].position.x).toBe(1)
      expect(project.nodes[0].data.seed).toBe(0.5)
      expect(project.edges[0].target).toBe('b')
      expect(store.history[0].nodes[0].position.x).toBe(1)
      expect(store.history[0].nodes[0].data.seed).toBe(0.5)
    })
  })

  describe('cloneNode', () => {
    it('makes a deep copy with a new id and offset', () => {
      const original = node('pattern-1', 100, 50, { nested: { list: [1, 2] } })
      const copy = cloneNode(original, { idSuffix: 'x' })

      expect(copy.id).toBe('pattern-x')
      expect(copy.position).toEqual({ x: 150, y: 100 })
      expect(copy.data).toEqual(original.data)

      copy.data.nested.list.push(3)
      expect(original.data.nested.list).toEqual([1, 2])
    })

    it('editing the duplicate does not change the original in the store', () => {
      store.loadProject({ id: 1, name: 'T', nodes: [node('a', 0, 0, { density: 0.5 })], edges: [] })
      const copy = cloneNode(store.nodes[0], { idSuffix: 'b' })
      store.addNode(copy)
      store.nodes[1].data.density = 0.9
      expect(store.nodes[0].data.density).toBe(0.5)
    })
  })

  describe('project list summaries', () => {
    it('toProjectSummary drops nodes/edges and keeps counts', () => {
      const s = toProjectSummary({ id: 1, name: 'P', nodes: [1, 2], edges: [1], message: 'ok' })
      expect(s).toEqual({ id: 1, name: 'P', node_count: 2, edge_count: 1 })
    })

    it('fetchProjects stores the summaries as returned', async () => {
      mockHttp.get.mockResolvedValue({ data: [{ id: 1, name: 'P', node_count: 3, edge_count: 2 }] })
      await store.fetchProjects()
      expect(mockHttp.get).toHaveBeenCalledWith('/projects')
      expect(store.projects[0].node_count).toBe(3)
    })

    it('fetchProject always asks the server for the full project', async () => {
      store.projects = [{ id: 7, name: 'P', node_count: 1, edge_count: 0 }]
      mockHttp.get.mockResolvedValue({ data: { id: 7, name: 'P', nodes: [node('a')], edges: [] } })
      const result = await store.fetchProject(7)
      expect(mockHttp.get).toHaveBeenCalledWith('/projects/7')
      expect(result.success).toBe(true)
      expect(store.nodes).toHaveLength(1)
    })

    it('createProject adds a summary to the list', async () => {
      mockHttp.post.mockResolvedValue({ data: { id: 3, name: 'New', nodes: [node('a')], edges: [], message: 'Project created successfully' } })
      const result = await store.createProject({ name: 'New' })
      expect(result.project.id).toBe(3)
      expect(store.projects[0]).toEqual({ id: 3, name: 'New', node_count: 1, edge_count: 0 })
    })

    it('updateProjectInfo sends only name/description and does not touch the editor graph', async () => {
      store.loadProject({ id: 99, name: 'Other', nodes: [node('x')], edges: [] })
      store.projects = [{ id: 5, name: 'Old', node_count: 4, edge_count: 3 }]
      mockHttp.put.mockResolvedValue({ data: { id: 5, name: 'New', description: 'D', nodes: [1, 2, 3, 4], edges: [1, 2, 3] } })

      const result = await store.updateProjectInfo(5, { name: 'New', description: 'D' })

      expect(result.success).toBe(true)
      expect(mockHttp.put).toHaveBeenCalledWith('/projects/5', { name: 'New', description: 'D' })
      expect(store.projects[0]).toMatchObject({ id: 5, name: 'New', node_count: 4, edge_count: 3 })
      expect(store.nodes.map(n => n.id)).toEqual(['x'])
    })

    it('saveProject sends the editor graph and refreshes the summary', async () => {
      store.loadProject({ id: 5, name: 'P', nodes: [node('a'), node('b')], edges: [] })
      store.projects = [{ id: 5, name: 'P', node_count: 0, edge_count: 0 }]
      mockHttp.put.mockResolvedValue({ data: { id: 5, name: 'P', nodes: [node('a'), node('b')], edges: [] } })

      await store.saveProject(5, { name: 'P' })

      const body = mockHttp.put.mock.calls[0][1]
      expect(body.nodes).toHaveLength(2)
      expect(store.projects[0].node_count).toBe(2)
      expect(store.projects[0]).not.toHaveProperty('nodes')
    })
  })
})
