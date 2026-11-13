import { defineStore } from 'pinia'
import http from '../api/http.js'
import { useAuthStore } from './useAuthStore.js'
import { migrateProject, CURRENT_SCHEMA_VERSION } from '../audio/graph/migrate.js'
import {
  persistedGraph, graphSignature, settingsFromMetadata, changedKeys, DEFAULT_SETTINGS
} from '../editor/graphState.js'
import { defaultMacros, normalizeMacros, isDefaultMacros, macrosSignature } from '../audio/graph/macros.js'

const deepClone = (value) => JSON.parse(JSON.stringify(value ?? null))

/**
 * Continuous edits of the same node fields (a slider being dragged, a text
 * being typed) within this window, and without an explicit end of gesture
 * (pointer up, focus out — see endHistoryGroup), make a single undo entry.
 */
export const HISTORY_GROUP_MS = 1500

/** Max undo entries. */
export const HISTORY_LIMIT = 50

// The save in flight (outside the reactive state on purpose).
let savingPromise = null

/**
 * Summary shape used in `projects` (the list endpoint returns no nodes/edges).
 */
export const toProjectSummary = (project) => {
  const { nodes, edges, message, ...rest } = project
  return {
    ...rest,
    node_count: Array.isArray(nodes) ? nodes.length : (project.node_count ?? 0),
    edge_count: Array.isArray(edges) ? edges.length : (project.edge_count ?? 0)
  }
}

/**
 * Deep copy of a node with a new id, offset position. Shared by the context
 * menu and Ctrl+D so both produce independent copies.
 */
export const cloneNode = (node, { offset = 50, idSuffix = Date.now() } = {}) => {
  const copy = deepClone(node)
  return {
    ...copy,
    id: `${node.type}-${idSuffix}`,
    position: {
      x: (node.position?.x ?? 0) + offset,
      y: (node.position?.y ?? 0) + offset
    },
    selected: false
  }
}

export const useProjectStore = defineStore('project', {
  state: () => ({
    projects: [],
    currentProject: null,
    isLoading: false,
    error: null,
    nodes: [],
    edges: [],
    history: [],
    historyIndex: -1,
    /** Open group of continuous changes: { key, at } (see saveToHistory). */
    historyGroup: null,
    /** Transport settings saved with the project (metadata.tempo / metadata.swing). */
    settings: { ...DEFAULT_SETTINGS },
    /** Performance macros saved with the project (metadata.macros, Fase 5B). */
    macros: defaultMacros(),
    /** Whether the server copy has macros (so clearing them must be sent). */
    macrosOnServer: false,
    /** graphSignature() of what the server has (last load / save). */
    savedSignature: null,
    /** 'idle' | 'saving' | 'error' | 'conflict' */
    saveStatus: 'idle',
    saveError: null,
    /** Server state when a save was rejected with 409: { id, name, updated_at, node_count, edge_count }. */
    conflict: null,
    lastSavedAt: null,
    /** Incremented by every loadProject (watchers apply the loaded settings). */
    loadCount: 0
  }),

  getters: {
    canUndo: (state) => state.historyIndex > 0,
    canRedo: (state) => state.historyIndex < state.history.length - 1,
    /** Signature of the current editor state (graph + settings). */
    currentSignature: (state) => graphSignature(state.nodes, state.edges, state.settings) + macrosSignature(state.macros),
    /** Something differs from what was last loaded from / saved to the server. */
    isDirty() {
      return this.savedSignature !== null && this.currentSignature !== this.savedSignature
    },
    /** The project exists on the server (autosave applies). */
    isPersisted: (state) => state.currentProject?.id != null
  },

  actions: {
    async fetchProjects() {
      this.isLoading = true
      this.error = null

      try {
        const response = await http.get('/projects')
        this.projects = response.data
        return { success: true }
      } catch (error) {
        this.error = error.friendlyMessage || error.response?.data?.message || 'No se pudieron cargar los proyectos.'
        return { success: false, error: this.error }
      } finally {
        this.isLoading = false
      }
    },

    async fetchProject(projectId) {
      this.isLoading = true
      this.error = null

      try {
        const response = await http.get(`/projects/${projectId}`)
        // Old projects (no metadata.schemaVersion) are brought to the
        // current schema on open; the server copy changes on the next save.
        const project = migrateProject(response.data)
        this.loadProject(project)
        return { success: true, project }
      } catch (error) {
        this.error = error.friendlyMessage || error.response?.data?.message || 'No se pudo cargar el proyecto.'
        return { success: false, error: this.error }
      } finally {
        this.isLoading = false
      }
    },

    async createProject(projectData) {
      this.isLoading = true
      this.error = null

      try {
        const response = await http.post('/projects/create', {
          ...projectData,
          metadata: { ...(projectData.metadata || {}), schemaVersion: CURRENT_SCHEMA_VERSION }
        })
        const newProject = response.data
        this.projects.unshift(toProjectSummary(newProject))
        return { success: true, project: newProject }
      } catch (error) {
        this.error = error.friendlyMessage || error.response?.data?.message || 'No se pudo crear el proyecto.'
        return { success: false, error: this.error }
      } finally {
        this.isLoading = false
      }
    },

    /**
     * PUT the editor graph (without Vue Flow's runtime fields). Low level:
     * the editor uses saveCurrent().
     * @param {object} [options]
     * @param {string} [options.baseUpdatedAt] updated_at the local copy is based
     *   on: the server answers 409 if it has a newer one (conflict).
     * @returns {Promise<{ success, project?, conflict?, current?, error? }>}
     */
    async saveProject(projectId, projectData, { baseUpdatedAt } = {}) {
      this.isLoading = true
      this.error = null

      try {
        const graph = persistedGraph(this.nodes, this.edges)
        const response = await http.put(`/projects/${projectId}`, {
          ...projectData,
          nodes: graph.nodes,
          edges: graph.edges,
          metadata: { ...(projectData.metadata || {}), schemaVersion: CURRENT_SCHEMA_VERSION },
          ...(baseUpdatedAt ? { base_updated_at: baseUpdatedAt } : {})
        })

        const { message, ...updatedProject } = response.data
        this.upsertSummary(updatedProject)

        this.currentProject = updatedProject
        return { success: true, project: updatedProject }
      } catch (error) {
        if (error.response?.status === 409 && error.response.data?.code === 'conflict') {
          this.error = 'El proyecto cambió en el servidor'
          return { success: false, conflict: true, current: error.response.data.current, error: this.error }
        }
        this.error = error.friendlyMessage || error.response?.data?.message || 'No se pudo guardar el proyecto.'
        return { success: false, error: this.error }
      } finally {
        this.isLoading = false
      }
    },

    /**
     * Save what the editor has (Fase 4A). Creates the project on the server if
     * it has no id yet; otherwise PUTs it based on the loaded `updated_at`
     * (409 → saveStatus 'conflict'). `force` overwrites the server copy.
     * One save at a time: a call during a save waits for it first.
     * @returns {Promise<{ success, created?, conflict?, error?, skipped? }>}
     */
    async saveCurrent({ force = false } = {}) {
      // Guest mode: nothing is ever sent to the server.
      if (useAuthStore().isGuest) {
        return { success: false, guest: true, error: 'Modo invitado: los cambios no se guardan' }
      }
      if (savingPromise) {
        await savingPromise.catch(() => {})
        if (!force && this.isPersisted && !this.isDirty && this.saveStatus === 'idle') {
          return { success: true, skipped: true }
        }
      }
      const run = this._doSave({ force })
      savingPromise = run
      try {
        return await run
      } finally {
        if (savingPromise === run) savingPromise = null
      }
    },

    async _doSave({ force }) {
      const signature = this.currentSignature
      const settings = { ...this.settings }
      // Macros only travel when there are some, or to clear the server's
      // copy (the PUT merges metadata, so a missing key would keep it).
      const macroMeta = !isDefaultMacros(this.macros)
        ? { macros: normalizeMacros(this.macros) }
        : (this.macrosOnServer ? { macros: null } : {})
      const project = this.currentProject || {}
      this.saveStatus = 'saving'
      this.saveError = null

      let result
      if (project.id != null) {
        result = await this.saveProject(project.id, {
          name: project.name || 'Proyecto sin título',
          metadata: { tempo: settings.tempo, swing: settings.swing, ...macroMeta }
        }, { baseUpdatedAt: force ? undefined : project.updated_at })
      } else {
        const graph = persistedGraph(this.nodes, this.edges)
        result = await this.createProject({
          name: project.name || 'Proyecto nuevo',
          nodes: graph.nodes,
          edges: graph.edges,
          metadata: { tempo: settings.tempo, swing: settings.swing, ...macroMeta }
        })
        if (result.success) {
          const { message, ...created } = result.project
          this.currentProject = created
          result = { ...result, created: true }
        }
      }

      if (result.success) {
        // What was sent is on the server now; edits made while the request
        // was in flight stay "unsaved" (the signature taken before sending is
        // the saved one).
        this.savedSignature = signature
        this.macrosOnServer = !!macroMeta.macros
        this.saveStatus = 'idle'
        this.conflict = null
        this.lastSavedAt = Date.now()
      } else if (result.conflict) {
        this.saveStatus = 'conflict'
        this.conflict = result.current || {}
      } else {
        this.saveStatus = 'error'
        this.saveError = result.error
      }
      return result
    },

    /** Drop the local changes and load the server copy (conflict → "Recargar"). */
    async reloadFromServer() {
      const id = this.currentProject?.id
      if (id == null) return { success: false }
      return this.fetchProject(id)
    },

    /** Close the conflict prompt without choosing: autosave stays paused until a save resolves it. */
    dismissConflict() {
      if (this.saveStatus !== 'conflict') return
      this.saveStatus = 'error'
      this.saveError = 'Conflicto sin resolver: el servidor tiene una versión más nueva'
    },

    /** Replace the performance macros (saved with the project; not in undo). */
    setMacros(macros) {
      this.macros = normalizeMacros(macros)
    },

    /** Change the transport settings saved with the project (tempo, swing). */
    setSettings(changes = {}) {
      const next = settingsFromMetadata({ ...this.settings, ...changes })
      if (next.tempo !== this.settings.tempo || next.swing !== this.settings.swing) this.settings = next
    },

    // --- Version history (endpoints from Fase 1) ---------------------------

    /** Lightweight list, newest first: { version_number, created_at, node_count, edge_count, metadata }. */
    async fetchVersions(projectId = this.currentProject?.id) {
      try {
        const response = await http.get(`/projects/${projectId}/versions`)
        return { success: true, versions: response.data }
      } catch (error) {
        return { success: false, error: error.friendlyMessage || 'No se pudo cargar el historial' }
      }
    },

    /** One full version, migrated to the current schema (the server keeps old versions as they were). */
    async fetchVersion(projectId, versionNumber) {
      try {
        const response = await http.get(`/projects/${projectId}/versions/${versionNumber}`)
        return { success: true, version: migrateProject(response.data) }
      } catch (error) {
        return { success: false, error: error.friendlyMessage || 'No se pudo cargar la versión' }
      }
    },

    /**
     * Restore a version on the server (it becomes a new version) and load the
     * result, migrated, into the editor. Unsaved local changes are dropped.
     */
    async restoreVersion(projectId, versionNumber) {
      try {
        const response = await http.post(`/projects/${projectId}/restore/${versionNumber}`)
        const { message, ...restored } = response.data
        const project = migrateProject(restored)
        this.loadProject(project)
        this.upsertSummary(restored)
        return { success: true, project }
      } catch (error) {
        return { success: false, error: error.friendlyMessage || 'No se pudo restaurar la versión' }
      }
    },

    /**
     * Update only name/description (from the project list). The server keeps
     * the stored graph when nodes/edges are not sent.
     */
    async updateProjectInfo(projectId, { name, description }) {
      this.isLoading = true
      this.error = null

      try {
        const response = await http.put(`/projects/${projectId}`, { name, description })
        const updatedProject = response.data
        this.upsertSummary(updatedProject)
        if (this.currentProject?.id === projectId) {
          this.currentProject = {
            ...this.currentProject,
            name: updatedProject.name,
            description: updatedProject.description,
            ...(updatedProject.updated_at ? { updated_at: updatedProject.updated_at } : {})
          }
        }
        return { success: true, project: updatedProject }
      } catch (error) {
        this.error = error.friendlyMessage || error.response?.data?.message || 'No se pudo actualizar el proyecto.'
        return { success: false, error: this.error }
      } finally {
        this.isLoading = false
      }
    },

    upsertSummary(project) {
      const summary = toProjectSummary(project)
      const index = this.projects.findIndex(p => p.id === project.id)
      if (index !== -1) {
        this.projects[index] = summary
      } else {
        this.projects.unshift(summary)
      }
    },

    async deleteProject(projectId) {
      this.isLoading = true
      this.error = null

      try {
        await http.delete(`/projects/${projectId}`)
        this.projects = this.projects.filter(p => p.id !== projectId)

        if (this.currentProject?.id === projectId) {
          this.currentProject = null
          this.nodes = []
          this.edges = []
        }

        return { success: true }
      } catch (error) {
        this.error = error.friendlyMessage || error.response?.data?.message || 'No se pudo eliminar el proyecto.'
        return { success: false, error: this.error }
      } finally {
        this.isLoading = false
      }
    },

    loadProject(project) {
      this.currentProject = project
      // Deep copies: the editor mutates nodes in place (Vue Flow), which must
      // not alter the loaded object nor the first history entry.
      this.nodes = deepClone(project.nodes || [])
      this.edges = deepClone(project.edges || [])
      this.history = [{ nodes: deepClone(this.nodes), edges: deepClone(this.edges) }]
      this.historyIndex = 0
      this.historyGroup = null
      this.settings = settingsFromMetadata(project.metadata)
      this.macros = normalizeMacros(project.metadata?.macros)
      this.macrosOnServer = Array.isArray(project.metadata?.macros)
      // What was loaded is what the server has (a new project: nothing to save yet)
      this.savedSignature = this.currentSignature
      this.saveStatus = 'idle'
      this.saveError = null
      this.conflict = null
      this.loadCount++
    },

    /**
     * Replace the whole graph (preset, import, clear canvas): new arrays so
     * Vue Flow resyncs; one undo entry.
     */
    replaceGraph(nodes = [], edges = []) {
      this.historyGroup = null
      this.nodes = deepClone(nodes)
      this.edges = deepClone(edges)
      this.saveToHistory()
    },

    /**
     * Move several nodes at once from code (Auto Layout). Replaces the array:
     * Vue Flow only resyncs its v-model on a new array (or length), so
     * updating positions in place left the canvas unchanged until the next
     * drag. One undo entry.
     * @param {Record<string, {x:number,y:number}>} positions by node id
     * @returns {boolean} whether something moved
     */
    setNodePositions(positions = {}) {
      let changed = false
      const next = this.nodes.map(n => {
        const p = positions[String(n.id)]
        if (!p || (n.position?.x === p.x && n.position?.y === p.y)) return n
        changed = true
        return { ...n, position: { x: p.x, y: p.y } }
      })
      if (!changed) return false
      this.historyGroup = null
      this.nodes = next
      this.saveToHistory()
      return true
    },

    addNode(node) {
      this.nodes.push(node)
      this.saveToHistory()
    },

    // --- Group operations (Fase 4B): new arrays (Vue Flow resyncs) and ONE
    // undo entry each, however many nodes they touch. -----------------------

    /** Add several nodes and edges at once (paste, duplicate, node created from a port). */
    insertGraph(nodes = [], edges = []) {
      if (!nodes.length && !edges.length) return false
      this.historyGroup = null
      this.nodes = [...this.nodes, ...nodes]
      this.edges = [...this.edges, ...edges]
      this.saveToHistory()
      return true
    },

    /** Remove several nodes and every edge touching them. */
    removeNodes(ids = []) {
      const gone = new Set(ids.map(String))
      if (!this.nodes.some(n => gone.has(String(n.id)))) return false
      this.historyGroup = null
      this.nodes = this.nodes.filter(n => !gone.has(String(n.id)))
      this.edges = this.edges.filter(e => !gone.has(String(e.source)) && !gone.has(String(e.target)))
      this.saveToHistory()
      return true
    },

    /** Remove several edges. */
    removeEdges(ids = []) {
      const gone = new Set(ids.map(String))
      if (!this.edges.some(e => gone.has(String(e.id)))) return false
      this.historyGroup = null
      this.edges = this.edges.filter(e => !gone.has(String(e.id)))
      this.saveToHistory()
      return true
    },

    /**
     * Replace the data of several nodes ({ [id]: data }), e.g. new seeds for
     * a selection.
     * @returns {number} how many nodes changed
     */
    updateNodesData(dataById = {}, { group = null } = {}) {
      let changed = 0
      const next = this.nodes.map(n => {
        const data = dataById[String(n.id)]
        if (!data || !changedKeys(n.data, data).length) return n
        changed++
        return { ...n, data }
      })
      if (!changed) return 0
      // A continuous gesture (a macro slider, Fase 5B) passes a group key:
      // the whole gesture is one undo entry, like updateNodeData.
      if (!group) this.historyGroup = null
      this.nodes = next
      this.saveToHistory({ group })
      return changed
    },

    /**
     * @param {object} [options]
     * @param {boolean} [options.history=true] - false while a change is still
     *   in progress (e.g. dragging); call `commitHistory()` when it ends.
     */
    updateNode(nodeId, updates, { history = true } = {}) {
      const index = this.nodes.findIndex(n => n.id === nodeId)
      if (index !== -1) {
        const next = { ...this.nodes[index], ...updates }
        if ('data' in updates) {
          // Vue Flow syncs its v-model only when the array reference (or its
          // length) changes: replacing one element in place left the node on
          // the canvas showing stale data (Fase 3B fix). Positions keep the
          // in-place update (it runs on every drag move).
          this.nodes = this.nodes.map((n, i) => (i === index ? next : n))
        } else {
          this.nodes[index] = next
        }
        if (history) this.saveToHistory()
      }
    },

    /**
     * Change a node's data from the editor (Fase 4A). Continuous changes of
     * the same fields of the same node (slider drag, typing) are grouped into
     * one undo entry; `group: false` always records a separate entry.
     * @returns {boolean} false when nothing changed
     */
    updateNodeData(nodeId, data, { group = true } = {}) {
      const node = this.nodes.find(n => n.id === nodeId)
      if (!node) return false
      const keys = changedKeys(node.data, data)
      if (!keys.length) return false
      this.updateNode(nodeId, { data }, { history: false })
      this.saveToHistory({ group: group ? `data:${nodeId}:${keys.join(',')}` : null })
      return true
    },

    /**
     * Apply Vue Flow position changes. While dragging (change.dragging=true)
     * positions are updated without touching the history; when the drag ends
     * (dragging=false) a single history entry is recorded.
     */
    applyPositionChanges(changes = []) {
      let dragEnded = false
      for (const change of changes) {
        if (change.type !== 'position') continue
        if (change.position) {
          this.updateNode(change.id, { position: { ...change.position } }, { history: false })
        }
        if (!change.dragging) dragEnded = true
      }
      if (dragEnded) this.commitHistory()
    },

    /** Record the current state if it differs from the last history entry. */
    commitHistory() {
      this.saveToHistory()
    },

    removeNode(nodeId) {
      this.nodes = this.nodes.filter(n => n.id !== nodeId)
      this.edges = this.edges.filter(e => e.source !== nodeId && e.target !== nodeId)
      this.saveToHistory()
    },

    addEdge(edge) {
      this.edges.push(edge)
      this.saveToHistory()
    },

    removeEdge(edgeId) {
      this.edges = this.edges.filter(e => e.id !== edgeId)
      this.saveToHistory()
    },

    /**
     * Record the current state (without Vue Flow's runtime fields).
     * @param {object} [options]
     * @param {string|null} [options.group] key of a continuous change: if the
     *   last entry was recorded with the same key less than HISTORY_GROUP_MS
     *   ago (and the group was not ended), it is replaced instead of adding one.
     */
    saveToHistory({ group = null } = {}) {
      const snapshot = persistedGraph(this.nodes, this.edges)
      const now = Date.now()
      const open = this.historyGroup

      // Skip duplicates (e.g. a drag-end that did not move the node)
      const last = this.history[this.historyIndex]
      if (last && JSON.stringify(last) === JSON.stringify(snapshot)) {
        if (group && open?.key === group) open.at = now
        return
      }

      if (group && open && open.key === group && now - open.at < HISTORY_GROUP_MS &&
          this.historyIndex === this.history.length - 1 && this.historyIndex > 0) {
        const previous = this.history[this.historyIndex - 1]
        if (JSON.stringify(previous) === JSON.stringify(snapshot)) {
          // Back where the gesture started: it leaves no entry.
          this.history.pop()
          this.historyIndex--
          this.historyGroup = null
        } else {
          // Same gesture: its entry now holds the latest state.
          this.history[this.historyIndex] = snapshot
          open.at = now
        }
        return
      }

      // Remove any future history if we're not at the end
      if (this.historyIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.historyIndex + 1)
      }

      // Add current state to history
      this.history.push(snapshot)

      this.historyIndex = this.history.length - 1
      this.historyGroup = group ? { key: group, at: now } : null

      // Limit history size
      if (this.history.length > HISTORY_LIMIT) {
        this.history.shift()
        this.historyIndex--
      }
    },

    /** End the open group of continuous changes (pointer up, focus out, undo…). */
    endHistoryGroup() {
      this.historyGroup = null
    },

    undo() {
      this.historyGroup = null
      if (this.canUndo) {
        this.historyIndex--
        const state = this.history[this.historyIndex]
        this.nodes = JSON.parse(JSON.stringify(state.nodes))
        this.edges = JSON.parse(JSON.stringify(state.edges))
      }
    },

    redo() {
      this.historyGroup = null
      if (this.canRedo) {
        this.historyIndex++
        const state = this.history[this.historyIndex]
        this.nodes = JSON.parse(JSON.stringify(state.nodes))
        this.edges = JSON.parse(JSON.stringify(state.edges))
      }
    },

    clearError() {
      this.error = null
    }
  }
})
