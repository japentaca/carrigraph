/**
 * useEditorNodes — everything the editor does with nodes and edges (Fase 4A):
 * creating (from the registry), selecting, duplicating, deleting (with
 * confirmation), editing data (grouped undo), connecting (typed ports),
 * Vue Flow change events, compiler diagnostics on the nodes, Auto Layout and
 * clearing the canvas.
 *
 * Fase 4B: multiple selection and group operations — copy / cut / paste /
 * duplicate a group with its internal edges (new ids, same seeds), delete
 * several, align / distribute, new seeds, randomize parameters, and creating
 * a node already connected to a port. Every group operation is ONE undo entry.
 *
 * Live editing needs nothing here: usePlayback recompiles on every change and
 * updates the engine if it is playing. Nothing starts playing by itself.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useProjectStore, cloneNode } from '../stores/useProjectStore'
import { useToastStore } from '../stores/useToastStore'
import { usePlayback } from './usePlayback.js'
import { createNode, edgeStyleFor } from '../components/nodes/nodeRegistry.js'
import { checkConnection } from '../audio/graph/connections.js'
import { diagnosticsByNode } from '../audio/graph/compile.js'
import { autoLayoutPositions } from '../editor/layout.js'
import { copySubgraph, pasteSubgraph, alignPositions } from '../editor/selection.js'
import { nodePositionForDrop } from '../editor/palette.js'
import { randomizeNodeData, withNewSeed, hasSeed, canRandomize } from '../audio/graph/nodeParams.js'

/** New edge id. */
export const newEdgeId = () => `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

// The clipboard is shared by every editor of the tab (copy in one project,
// paste in another).
let clipboard = null
/** Current clipboard ({ nodes, edges } | null). */
export const getClipboard = () => clipboard
export const setClipboard = (value) => { clipboard = value }

/**
 * Default selection source: the `selected` flag Vue Flow puts on the node
 * objects (the store holds Vue Flow's own objects). The editor passes Vue
 * Flow's API instead (see Editor.vue).
 */
function storeSelection(projectStore) {
  return {
    ids: () => projectStore.nodes.filter(n => n.selected).map(n => String(n.id)),
    select: (ids) => {
      const want = new Set(ids.map(String))
      for (const n of projectStore.nodes) n.selected = want.has(String(n.id))
    },
    edgeIds: () => projectStore.edges.filter(e => e.selected).map(e => String(e.id))
  }
}

/**
 * @param {object} [options]
 * @param {() => {x:number,y:number}} [options.viewCenter] canvas point at the
 *   center of the visible area (palette clicks create nodes there)
 * @param {() => void} [options.afterLayout] e.g. fit the view after Auto Layout
 * @param {{ ids(): string[], select(ids: string[]): void, edgeIds(): string[] }} [options.selection]
 *   where the node selection lives (default: the `selected` flags in the store)
 * @param {() => ({x:number,y:number}|null)} [options.pastePoint] canvas point
 *   where a paste goes (the pointer over the canvas), null for "next to the originals"
 */
export function useEditorNodes({
  viewCenter = () => ({ x: 200, y: 150 }),
  afterLayout,
  selection,
  pastePoint = () => null
} = {}) {
  const projectStore = useProjectStore()
  const toastStore = useToastStore()
  const { compiled } = usePlayback()
  const sel = selection || storeSelection(projectStore)

  /** Last node clicked or created (the one the inspector shows among several). */
  const selectedNodeId = ref(null)
  const deleteRequest = ref({ show: false, nodeId: null, ids: [] })
  /** Bumped when the selection may have changed outside Vue's reactivity. */
  const selectionTick = ref(0)

  // --- Diagnostics (from the shared compilation) ---------------------------
  const diagnosticMap = computed(() => diagnosticsByNode(compiled.value.diagnostics))
  const diagnosticsFor = (id) => diagnosticMap.value[String(id)] || []
  const globalDiagnostics = computed(() => diagnosticMap.value[''] || [])
  const diagClass = (id) => {
    const items = diagnosticsFor(id)
    if (items.some(d => d.level === 'error')) return 'cg-node-wrap--error'
    if (items.some(d => d.level === 'warning')) return 'cg-node-wrap--warning'
    return ''
  }

  const findNode = (id) => projectStore.nodes.find(n => String(n.id) === String(id)) || null

  // --- Selection --------------------------------------------------------------

  /** Ids of the selected nodes (box, Shift+click, Ctrl+A, after a paste…). */
  const selectedIds = computed(() => {
    void selectionTick.value
    void projectStore.nodes
    return sel.ids()
  })

  /**
   * The node the inspector shows: the only selected one; with several, the
   * last clicked among them; with none, the last clicked or created.
   */
  const inspectedNode = computed(() => {
    const ids = selectedIds.value
    let id = null
    if (ids.length === 1) id = ids[0]
    else if (ids.length > 1) id = ids.includes(String(selectedNodeId.value)) ? String(selectedNodeId.value) : null
    else id = selectedNodeId.value
    return id == null ? null : findNode(id)
  })

  function selectNodes(ids, primary = ids[ids.length - 1]) {
    sel.select(ids.map(String))
    selectedNodeId.value = primary ?? null
    selectionTick.value++
  }

  /** Ids a command acts on: the selection, else the last clicked node. */
  const targetIds = () => {
    const ids = selectedIds.value
    if (ids.length) return ids
    return selectedNodeId.value != null && findNode(selectedNodeId.value) ? [String(selectedNodeId.value)] : []
  }

  // --- Create / duplicate / delete -----------------------------------------

  /** Add a node of `type` with its top-left corner at a canvas point. */
  function addNodeAt(type, position) {
    const node = createNode(type, { x: Math.round(position.x), y: Math.round(position.y) })
    projectStore.addNode(node)
    selectedNodeId.value = node.id
    selectionTick.value++
    return node
  }

  /** Palette click: in the middle of what is visible (slightly staggered). */
  function addNodeAtCenter(type) {
    const c = viewCenter()
    const jitter = (projectStore.nodes.length % 5) * 30
    return addNodeAt(type, { x: c.x - 120 + jitter, y: c.y - 80 + jitter })
  }

  /** Duplicate one node (context menu of a single node). */
  function duplicateNode(id = selectedNodeId.value) {
    const node = findNode(id)
    if (!node) return null
    const copy = cloneNode(node)
    projectStore.addNode(copy)
    selectedNodeId.value = copy.id
    selectionTick.value++
    return copy
  }

  /**
   * Ask before deleting: one node (`id`), or the selection when called
   * without one. With no nodes selected, selected edges are removed right
   * away (undoable).
   * @returns {boolean} whether something was asked / done
   */
  function requestDelete(id) {
    const ids = (id != null ? [String(id)] : targetIds()).filter(i => findNode(i))
    if (!ids.length) {
      const edgeIds = id == null ? sel.edgeIds() : []
      if (edgeIds.length) {
        projectStore.removeEdges(edgeIds)
        toastStore.success(edgeIds.length === 1 ? 'Conexión eliminada' : `${edgeIds.length} conexiones eliminadas`)
        return true
      }
      return false
    }
    deleteRequest.value = { show: true, nodeId: ids[0], ids }
    return true
  }

  function confirmDelete() {
    const ids = deleteRequest.value.ids?.length ? deleteRequest.value.ids
      : (deleteRequest.value.nodeId != null ? [deleteRequest.value.nodeId] : [])
    deleteRequest.value = { show: false, nodeId: null, ids: [] }
    if (!ids.length) return
    projectStore.removeNodes(ids)
    if (ids.includes(String(selectedNodeId.value))) selectedNodeId.value = null
    selectionTick.value++
    toastStore.success(ids.length === 1 ? 'Nodo eliminado' : `${ids.length} nodos eliminados`)
  }

  function cancelDelete() {
    deleteRequest.value = { show: false, nodeId: null, ids: [] }
  }

  // --- Group operations (Fase 4B) ------------------------------------------

  let pasteCount = 0

  /** Copy the selection (with the edges between its nodes) to the clipboard. */
  function copySelection(ids = targetIds()) {
    const clip = copySubgraph(projectStore.nodes, projectStore.edges, ids)
    if (!clip) return 0
    clipboard = clip
    pasteCount = 0
    return clip.nodes.length
  }

  /** Copy and remove (one undo entry, no confirmation: Ctrl+Z brings it back). */
  function cutSelection(ids = targetIds()) {
    const n = copySelection(ids)
    if (!n) return 0
    projectStore.removeNodes(ids)
    selectedNodeId.value = null
    selectionTick.value++
    return n
  }

  function insertClip(clip, opts) {
    const { nodes, edges } = pasteSubgraph(clip, opts)
    if (!nodes.length) return []
    projectStore.insertGraph(nodes, edges)
    selectNodes(nodes.map(n => String(n.id)))
    return nodes
  }

  /**
   * Paste the clipboard: at the pointer when it is over the canvas, else
   * shifted from the originals (a bit more on every paste).
   * @returns {object[]} the new nodes
   */
  function paste({ at } = {}) {
    if (!clipboard?.nodes?.length) return []
    const point = at || pastePoint()
    pasteCount++
    return insertClip(clipboard, point ? { at: point } : { offset: { x: 40 * pasteCount, y: 40 * pasteCount } })
  }

  /** Duplicate the selection with its internal edges (the clipboard is not touched). */
  function duplicateSelection(ids = targetIds()) {
    const clip = copySubgraph(projectStore.nodes, projectStore.edges, ids)
    if (!clip) return []
    return insertClip(clip, { offset: { x: 40, y: 40 } })
  }

  function selectAll() {
    selectNodes(projectStore.nodes.map(n => String(n.id)), selectedNodeId.value)
    return projectStore.nodes.length
  }

  function clearSelection() {
    selectNodes([], null)
  }

  /** Align or distribute the selection (selection.js ALIGN_MODES). One undo entry. */
  function alignSelection(mode, ids = selectedIds.value) {
    const positions = alignPositions(projectStore.nodes, ids, mode)
    return Object.keys(positions).length ? projectStore.setNodePositions(positions) : false
  }

  /** New seed for every unlocked node with a seed among `ids`. One undo entry. */
  function newSeeds(ids = targetIds()) {
    const map = {}
    for (const id of ids) {
      const data = withNewSeed(findNode(id))
      if (data) map[String(id)] = data
    }
    return projectStore.updateNodesData(map)
  }

  /** Randomize parameters inside their valid ranges (locked seeds kept). One undo entry. */
  function randomizeNodes(ids = targetIds()) {
    const map = {}
    for (const id of ids) {
      const node = findNode(id)
      if (node && canRandomize(node.type)) map[String(id)] = randomizeNodeData(node.type, node.data)
    }
    return projectStore.updateNodesData(map)
  }

  /**
   * Create a node of `type` connected to the port a connection was dragged
   * from and dropped on empty canvas. Node and edge are one undo entry.
   * @param {string} type
   * @param {{x:number,y:number}} point drop point (canvas coordinates)
   * @param {{ nodeId, handleId, handleType: 'source'|'target' }} from
   * @param {{ id: string }} port the port of the new node to connect
   * @returns {{ node, edge } | null}
   */
  function addConnectedNode(type, point, from, port) {
    const node = createNode(type, nodePositionForDrop(point, from.handleType))
    const connection = from.handleType === 'source'
      ? { source: from.nodeId, sourceHandle: from.handleId, target: node.id, targetHandle: port.id }
      : { source: node.id, sourceHandle: port.id, target: from.nodeId, targetHandle: from.handleId }
    // Dragging from a used input replaces its edge (an input takes one).
    const others = projectStore.edges.filter(e =>
      !(String(e.target) === String(connection.target) && e.targetHandle === connection.targetHandle))
    const check = checkConnection(connection, [...projectStore.nodes, node], others)
    if (!check.valid) {
      toastStore.warning(check.reason || 'Conexión inválida')
      return null
    }
    const edge = {
      id: newEdgeId(),
      source: connection.source,
      target: connection.target,
      sourceHandle: check.sourcePort.id,
      targetHandle: check.targetPort.id,
      style: edgeStyleFor(check.sourcePort.type)
    }
    if (others.length !== projectStore.edges.length) projectStore.edges = others
    projectStore.insertGraph([node], [edge])
    selectNodes([node.id])
    return { node, edge }
  }

  // --- Data -----------------------------------------------------------------

  /** A node component emitted new data: one undo entry per continuous gesture. */
  function updateNodeData(id, data) {
    return projectStore.updateNodeData(id, data)
  }

  // --- Vue Flow events ------------------------------------------------------

  const onNodeClick = ({ node }) => { selectedNodeId.value = node.id; selectionTick.value++ }
  const onPaneClick = () => { selectedNodeId.value = null; selectionTick.value++ }

  /** A whole drag = one undo step (see projectStore.applyPositionChanges). */
  const onNodesChange = (changes) => {
    if (changes.some(c => c.type === 'select')) selectionTick.value++
    return projectStore.applyPositionChanges(changes)
  }

  const onEdgesChange = (changes) => {
    for (const change of changes) {
      if (change.type === 'remove') projectStore.removeEdge(change.id)
    }
  }

  /** Vue Flow asks before creating an edge: typed ports, direction, no cycles. */
  const isValidConnection = (connection) =>
    checkConnection(connection, projectStore.nodes, projectStore.edges).valid

  /**
   * New connection. Each input takes one edge: connecting to a used input
   * replaces the old edge (a single undo entry). If it is playing, the new
   * graph is heard at the next bar; if not, nothing starts.
   */
  function onConnect(connection) {
    const check = checkConnection(connection, projectStore.nodes, projectStore.edges)
    if (!check.valid) {
      toastStore.warning(check.reason || 'Conexión inválida')
      return null
    }
    const edge = {
      id: newEdgeId(),
      source: connection.source,
      target: connection.target,
      sourceHandle: check.sourcePort.id,
      targetHandle: check.targetPort.id,
      style: edgeStyleFor(check.sourcePort.type)
    }
    projectStore.edges = projectStore.edges.filter(e =>
      !(String(e.target) === String(edge.target) && e.targetHandle === edge.targetHandle))
    projectStore.addEdge(edge)
    return edge
  }

  // --- Whole graph ----------------------------------------------------------

  /** Arrange the nodes in columns following the signal (one undo entry). */
  function autoLayout() {
    if (!projectStore.nodes.length) return false
    const moved = projectStore.setNodePositions(autoLayoutPositions(projectStore.nodes, projectStore.edges))
    afterLayout?.()
    return moved
  }

  function clearCanvas() {
    projectStore.replaceGraph([], [])
    selectedNodeId.value = null
    selectionTick.value++
  }

  // --- Undo grouping: a gesture ends on pointer up or when a field loses focus
  const endGroup = () => projectStore.endHistoryGroup()
  onMounted(() => {
    window.addEventListener('pointerup', endGroup, true)
    window.addEventListener('focusout', endGroup, true)
  })
  onUnmounted(() => {
    window.removeEventListener('pointerup', endGroup, true)
    window.removeEventListener('focusout', endGroup, true)
  })

  return {
    selectedNodeId, selectedIds, inspectedNode, deleteRequest, findNode,
    diagnosticsFor, globalDiagnostics, diagClass,
    addNodeAt, addNodeAtCenter, duplicateNode, requestDelete, confirmDelete, cancelDelete,
    updateNodeData,
    copySelection, cutSelection, paste, duplicateSelection, selectAll, clearSelection, selectNodes,
    alignSelection, newSeeds, randomizeNodes, addConnectedNode, hasSeed, canRandomize,
    onNodeClick, onPaneClick, onNodesChange, onEdgesChange, isValidConnection, onConnect,
    autoLayout, clearCanvas
  }
}
