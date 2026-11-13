import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from '../stores/useProjectStore'

describe('useProjectStore', () => {
  let projectStore

  beforeEach(() => {
    setActivePinia(createPinia())
    projectStore = useProjectStore()
  })

  describe('initial state', () => {
    it('should start with empty projects array', () => {
      expect(projectStore.projects).toEqual([])
    })

    it('should start with null currentProject', () => {
      expect(projectStore.currentProject).toBeNull()
    })

    it('should start with empty nodes and edges', () => {
      expect(projectStore.nodes).toEqual([])
      expect(projectStore.edges).toEqual([])
    })

    it('should not be loading initially', () => {
      expect(projectStore.isLoading).toBe(false)
    })

    it('should have null error initially', () => {
      expect(projectStore.error).toBeNull()
    })
  })

  describe('getters', () => {
    it('canUndo should be false with empty history', () => {
      expect(projectStore.canUndo).toBe(false)
    })

    it('canRedo should be false with empty history', () => {
      expect(projectStore.canRedo).toBe(false)
    })

    it('canUndo should be true after adding a node', () => {
      projectStore.loadProject({ id: 1, name: 'Test', nodes: [], edges: [] })
      projectStore.addNode({ id: '1', type: 'pattern', position: { x: 0, y: 0 }, data: {} })
      expect(projectStore.canUndo).toBe(true)
    })

    it('canRedo should be true after undo', () => {
      projectStore.loadProject({ id: 1, name: 'Test', nodes: [], edges: [] })
      projectStore.addNode({ id: '1', type: 'pattern', position: { x: 0, y: 0 }, data: {} })
      projectStore.undo()
      expect(projectStore.canRedo).toBe(true)
    })
  })

  describe('loadProject', () => {
    it('should set currentProject and populate nodes/edges', () => {
      const project = {
        id: 1,
        name: 'My Project',
        nodes: [{ id: 'n1', type: 'pattern', position: { x: 0, y: 0 }, data: {} }],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }]
      }

      projectStore.loadProject(project)

      expect(projectStore.currentProject).toEqual(project)
      expect(projectStore.nodes).toHaveLength(1)
      expect(projectStore.edges).toHaveLength(1)
    })

    it('should initialize history with current state', () => {
      projectStore.loadProject({ id: 1, name: 'Test', nodes: [], edges: [] })
      expect(projectStore.history).toHaveLength(1)
      expect(projectStore.historyIndex).toBe(0)
    })
  })

  describe('node operations', () => {
    beforeEach(() => {
      projectStore.loadProject({ id: 1, name: 'Test', nodes: [], edges: [] })
    })

    it('addNode should add a node and record history', () => {
      const node = { id: 'n1', type: 'pattern', position: { x: 100, y: 200 }, data: {} }
      projectStore.addNode(node)

      expect(projectStore.nodes).toHaveLength(1)
      expect(projectStore.nodes[0].id).toBe('n1')
      expect(projectStore.history).toHaveLength(2)
    })

    it('updateNode should merge updates into existing node', () => {
      projectStore.addNode({ id: 'n1', type: 'pattern', position: { x: 0, y: 0 }, data: { label: 'Old' } })
      projectStore.updateNode('n1', { position: { x: 50, y: 50 }, data: { label: 'New' } })

      expect(projectStore.nodes[0].position).toEqual({ x: 50, y: 50 })
      expect(projectStore.nodes[0].data.label).toBe('New')
    })

    it('removeNode should delete the node and its edges', () => {
      projectStore.addNode({ id: 'n1', type: 'pattern', position: { x: 0, y: 0 }, data: {} })
      projectStore.addNode({ id: 'n2', type: 'voice', position: { x: 100, y: 0 }, data: {} })
      projectStore.addEdge({ id: 'e1', source: 'n1', target: 'n2' })

      projectStore.removeNode('n1')

      expect(projectStore.nodes).toHaveLength(1)
      expect(projectStore.nodes[0].id).toBe('n2')
      expect(projectStore.edges).toHaveLength(0)
    })
  })

  describe('edge operations', () => {
    beforeEach(() => {
      projectStore.loadProject({ id: 1, name: 'Test', nodes: [], edges: [] })
    })

    it('addEdge should add an edge and record history', () => {
      projectStore.addEdge({ id: 'e1', source: 'n1', target: 'n2' })

      expect(projectStore.edges).toHaveLength(1)
      expect(projectStore.edges[0].id).toBe('e1')
      expect(projectStore.history).toHaveLength(2)
    })

    it('removeEdge should delete the edge by id', () => {
      projectStore.addEdge({ id: 'e1', source: 'n1', target: 'n2' })
      projectStore.removeEdge('e1')

      expect(projectStore.edges).toHaveLength(0)
    })
  })

  describe('undo/redo', () => {
    beforeEach(() => {
      projectStore.loadProject({ id: 1, name: 'Test', nodes: [], edges: [] })
    })

    it('undo should restore previous state', () => {
      projectStore.addNode({ id: 'n1', type: 'pattern', position: { x: 0, y: 0 }, data: {} })
      expect(projectStore.nodes).toHaveLength(1)

      projectStore.undo()
      expect(projectStore.nodes).toHaveLength(0)
    })

    it('redo should restore undone state', () => {
      projectStore.addNode({ id: 'n1', type: 'pattern', position: { x: 0, y: 0 }, data: {} })
      projectStore.undo()
      projectStore.redo()

      expect(projectStore.nodes).toHaveLength(1)
    })

    it('undo should be a no-op when no history', () => {
      const nodesBefore = [...projectStore.nodes]
      projectStore.undo()
      expect(projectStore.nodes).toEqual(nodesBefore)
    })

    it('redo should be a no-op at tip of history', () => {
      projectStore.redo()
      expect(projectStore.nodes).toEqual([])
    })
  })

  describe('history management', () => {
    it('should prune future history when branching', () => {
      projectStore.loadProject({ id: 1, name: 'Test', nodes: [], edges: [] })

      projectStore.addNode({ id: 'n1', type: 'pattern', position: { x: 0, y: 0 }, data: {} })
      projectStore.addNode({ id: 'n2', type: 'voice', position: { x: 100, y: 0 }, data: {} })
      expect(projectStore.history).toHaveLength(3)

      projectStore.undo()
      expect(projectStore.historyIndex).toBe(1)

      // New action from middle of history should prune future
      projectStore.addNode({ id: 'n3', type: 'loop', position: { x: 200, y: 0 }, data: {} })
      expect(projectStore.history).toHaveLength(3) // was 3, pruned + added = 3
      expect(projectStore.historyIndex).toBe(2)
    })

    it('should cap history at 50 entries', () => {
      projectStore.loadProject({ id: 1, name: 'Test', nodes: [], edges: [] })

      for (let i = 0; i < 60; i++) {
        projectStore.addNode({ id: `n${i}`, type: 'pattern', position: { x: i * 10, y: 0 }, data: {} })
      }

      expect(projectStore.history.length).toBeLessThanOrEqual(50)
    })
  })

  describe('error handling', () => {
    it('clearError should reset error to null', () => {
      projectStore.error = 'Something failed'
      projectStore.clearError()
      expect(projectStore.error).toBeNull()
    })
  })
})
