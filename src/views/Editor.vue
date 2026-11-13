<template>
  <div class="editor-container">
    <a class="skip-link" href="#cg-canvas">Ir al lienzo</a>
    <EditorToolbar
      :title="projectStore.currentProject?.name || 'Proyecto sin nombre'"
      :status="autosave.status.value"
      :saving="projectStore.saveStatus === 'saving'"
      :can-undo="projectStore.canUndo"
      :can-redo="projectStore.canRedo"
      :can-show-history="projectStore.isPersisted"
      :guest="authStore.isGuest"
      @back="goBack"
      @save="saveProject"
      @undo="undo"
      @redo="redo"
      @history="history.show()"
      @share="showShare = true"
      @help="showHelp = !showHelp"
    />

    <TransportBar :performance="showPerformance" :midi="midi" @toggle-performance="showPerformance = !showPerformance" />

    <div class="editor-workspace">
      <AppSidebar
        v-show="ui.panels.value.sidebar"
        id="cg-sidebar"
        class="editor-panel editor-panel--left"
        @add-node="onPaletteAdd"
        @auto-layout="nodes.autoLayout"
        @clear="nodes.clearCanvas"
        @import-project="importProject"
        @close="ui.toggleSidebar(false)"
      />

      <div class="canvas-column">
        <div class="canvas-bar">
          <button
            type="button"
            class="canvas-bar__toggle"
            :aria-expanded="ui.panels.value.sidebar"
            aria-controls="cg-sidebar"
            :title="ui.panels.value.sidebar ? 'Ocultar paleta y presets' : 'Mostrar paleta y presets'"
            @click="ui.toggleSidebar()"
          >
            <span aria-hidden="true">☰</span> Paleta
          </button>
          <GraphStatus class="canvas-bar__status" :compiled="compiled" :diagnostics="nodes.globalDiagnostics.value" />
          <span v-if="selectionCount > 1" class="canvas-bar__selection" role="status">{{ selectionCount }} seleccionados</span>
          <button
            type="button"
            class="canvas-bar__toggle"
            :aria-expanded="ui.panels.value.inspector"
            aria-controls="cg-inspector"
            :title="ui.panels.value.inspector ? 'Ocultar inspector' : 'Mostrar inspector'"
            @click="ui.toggleInspector()"
          >
            Inspector <span aria-hidden="true">{{ ui.panels.value.inspector ? '▸' : '◂' }}</span>
          </button>
        </div>

        <div
          id="cg-canvas"
          ref="canvasEl"
          class="canvas-container"
          tabindex="0"
          role="application"
          aria-roledescription="lienzo de nodos"
          aria-label="Lienzo. Tab o doble clic: agregar nodo. Shift y clic: seleccionar varios."
          @dragover="onDragOver"
          @drop="onDrop"
          @dblclick="onCanvasDblClick"
          @pointermove="onPointerMove"
          @pointerleave="pointer = null"
        >
          <div v-if="projectLoading" class="canvas-loading">
            <div class="canvas-loading__spinner"></div>
            <p>Cargando proyecto...</p>
          </div>

          <VueFlow
            :id="FLOW_ID"
            v-model:nodes="projectStore.nodes"
            v-model:edges="projectStore.edges"
            :default-viewport="{ zoom: 1 }"
            :min-zoom="0.2"
            :max-zoom="4"
            :snap-to-grid="true"
            :snap-grid="[20, 20]"
            :zoom-on-double-click="false"
            :delete-key-code="null"
            selection-key-code="Shift"
            :multi-selection-key-code="['Shift', 'Control', 'Meta']"
            connection-mode="strict"
            :is-valid-connection="nodes.isValidConnection"
            @nodes-change="nodes.onNodesChange"
            @edges-change="nodes.onEdgesChange"
            @connect="onConnect"
            @connect-start="onConnectStart"
            @connect-end="onConnectEnd"
            @node-click="nodes.onNodeClick"
            @node-double-click="onNodeDoubleClick"
            @node-context-menu="onNodeContextMenu"
            @pane-context-menu="contextMenu.openForPane"
            @pane-click="nodes.onPaneClick"
            class="vue-flow"
          >
            <Background pattern="dots" :gap="20" />
            <MiniMap v-if="!narrow" />
            <Controls />

            <!-- One template per registered node type: the compact canvas node
                 (ports, summary, thumbnail, seed; ▾ expands its parameters). -->
            <template v-for="type in nodeTypeKeys" :key="type" #[`node-${type}`]="{ id, data, selected }">
              <CanvasNode
                :id="id"
                :type="type"
                :data="data"
                :selected="selected"
                :diagnostics="nodes.diagnosticsFor(id)"
                :diag-class="nodes.diagClass(id)"
                :preview="compiled.previews?.[id] || null"
                :active="activeNodeIds.has(id)"
                @update="(d) => nodes.updateNodeData(id, d)"
              />
            </template>
          </VueFlow>

          <CanvasContextMenu
            :menu="contextMenu.menu.value"
            @add="onMenuAdd"
            @edit="(node) => { openInspector(node.id); contextMenu.close() }"
            @duplicate="onMenuDuplicate"
            @delete="onMenuDelete"
            @copy="(node) => { copyNodes(menuTargets(node)); contextMenu.close() }"
            @new-seed="(node) => { nodes.newSeeds(menuTargets(node)); contextMenu.close() }"
            @randomize="(node) => { nodes.randomizeNodes(menuTargets(node)); contextMenu.close() }"
          />
        </div>
      </div>

      <NodeInspector
        v-show="ui.panels.value.inspector"
        ref="inspectorEl"
        class="editor-panel editor-panel--right"
        :node="selectionCount > 1 ? null : nodes.inspectedNode.value"
        :count="selectionCount"
        :seeded-count="seededSelected"
        :preview="inspected ? compiled.previews?.[String(inspected.id)] || null : null"
        :active="inspected ? activeNodeIds.has(String(inspected.id)) : false"
        :diagnostics="inspected ? nodes.diagnosticsFor(inspected.id) : []"
        @update="nodes.updateNodeData"
        @close="ui.toggleInspector(false)"
        @align="nodes.alignSelection"
        @duplicate="duplicateSelection"
        @copy="copyNodes()"
        @new-seeds="nodes.newSeeds()"
        @randomize="(ids) => nodes.randomizeNodes(Array.isArray(ids) ? ids : undefined)"
        @delete="nodes.requestDelete()"
      />
    </div>

    <TimelinePanel />

    <NodePalette
      :open="palette.open"
      :x="palette.x"
      :y="palette.y"
      :entries="palette.entries"
      :title="palette.title"
      @pick="onPalettePick"
      @close="closePalette"
    />

    <ConfirmDialog
      :visible="nodes.deleteRequest.value.show"
      :title="deleteCount > 1 ? `¿Eliminar ${deleteCount} nodos?` : '¿Eliminar nodo?'"
      :message="deleteCount > 1
        ? 'Se eliminarán los nodos seleccionados y sus conexiones. Se puede deshacer con Ctrl+Z.'
        : 'Se eliminará el nodo y todas sus conexiones. Se puede deshacer con Ctrl+Z.'"
      confirm-text="Eliminar"
      cancel-text="Cancelar"
      type="danger"
      @confirm="nodes.confirmDelete"
      @cancel="nodes.cancelDelete"
    />

    <!-- Save conflict (409): the server has a newer copy -->
    <ConfirmDialog
      :visible="autosave.conflictOpen.value"
      title="El proyecto cambió en el servidor"
      :message="conflictMessage"
      confirm-text="Sobrescribir con lo mío"
      secondary-text="Recargar del servidor"
      cancel-text="Decidir después"
      type="warning"
      @confirm="autosave.resolveOverwrite()"
      @secondary="autosave.resolveReload()"
      @cancel="autosave.resolveLater()"
    />

    <!-- Leaving with unsaved changes -->
    <ConfirmDialog
      :visible="autosave.leavePrompt.value.show"
      title="Hay cambios sin guardar"
      :message="projectStore.isPersisted
        ? 'No se pudieron guardar los últimos cambios. ¿Salir igual?'
        : 'Este proyecto nuevo todavía no está guardado en el servidor.'"
      confirm-text="Guardar y salir"
      secondary-text="Salir sin guardar"
      cancel-text="Quedarme"
      type="warning"
      @confirm="autosave.answerLeave('save')"
      @secondary="autosave.answerLeave('discard')"
      @cancel="autosave.answerLeave('stay')"
    />

    <ShortcutsHelp v-if="showHelp" @close="showHelp = false" />

    <VersionHistoryPanel v-if="history.open.value" :h="history" />

    <PerformancePanel v-if="showPerformance" @close="showPerformance = false" />

    <ShareDialog
      :visible="showShare && projectStore.isPersisted"
      :project="projectStore.currentProject"
      :note="projectStore.isDirty ? 'Hay cambios sin guardar: el enlace muestra lo último guardado (se autoguarda en unos segundos).' : ''"
      @close="showShare = false"
    />
  </div>
</template>

<script setup>
/**
 * Editor view: composes the pieces, holds no logic of its own.
 *
 *   EditorToolbar        save status, save, undo/redo, history, exports
 *   TransportBar         play/stop, loop, position, tempo + tap, swing, volume, level, oscilloscope
 *   AppSidebar           palette (registry), presets, project actions — collapsible
 *   VueFlow canvas       CanvasNode per registered type (compact; thumbnails; seed)
 *   NodeInspector        parameters of the selected node / group actions — collapsible (Fase 4B)
 *   NodePalette          searchable palette (double click / Tab / connection dropped on empty canvas)
 *   CanvasContextMenu    add node at the cursor / node and group actions
 *   TimelinePanel        piano roll
 *   VersionHistoryPanel, ShortcutsHelp, ConfirmDialogs
 *
 * Logic: useEditorNodes (nodes/edges/selection/group operations),
 * useContextMenu, usePlayback (compile, live updates), useExports,
 * useAutosave, useVersionHistory, useTransport (inside TransportBar),
 * useEditorUi (panels, expanded nodes).
 */
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick, defineAsyncComponent } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { Controls } from '@vue-flow/controls'
import { useProjectStore } from '../stores/useProjectStore'
import { useAuthStore } from '../stores/useAuthStore'
import { fetchShared, fetchGalleryProject } from '../api/sharing.js'
import { preparePublicProject } from '../sharing/publicProject.js'
import { useAudioStore } from '../stores/useAudioStore'
import { useToastStore } from '../stores/useToastStore'
import { usePlayback } from '../composables/usePlayback.js'
import { useEditorNodes } from '../composables/useEditorNodes.js'
import { useContextMenu } from '../composables/useContextMenu.js'
import { useExports } from '../composables/useExports.js'
import { useAutosave } from '../composables/useAutosave.js'
import { useVersionHistory } from '../composables/useVersionHistory.js'
import { useKeyboard } from '../composables/useKeyboard.js'
import { useEditorUi, NARROW_EDITOR } from '../composables/useEditorUi.js'
import { useMidiInput } from '../composables/useMidiInput.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import AppSidebar from '../components/AppSidebar.vue'
import TimelinePanel from '../components/TimelinePanel.vue'
import CanvasNode from '../components/nodes/CanvasNode.vue'
import EditorToolbar from '../components/editor/EditorToolbar.vue'
import TransportBar from '../components/editor/TransportBar.vue'
import CanvasContextMenu from '../components/editor/CanvasContextMenu.vue'
import NodeInspector from '../components/editor/NodeInspector.vue'
import NodePalette from '../components/editor/NodePalette.vue'
import GraphStatus from '../components/editor/GraphStatus.vue'
// Panels that only open on demand load their code on first use (Fase 5B).
const ShortcutsHelp = defineAsyncComponent(() => import('../components/editor/ShortcutsHelp.vue'))
const VersionHistoryPanel = defineAsyncComponent(() => import('../components/editor/VersionHistoryPanel.vue'))
const ShareDialog = defineAsyncComponent(() => import('../components/ShareDialog.vue'))
const PerformancePanel = defineAsyncComponent(() => import('../components/editor/PerformancePanel.vue'))
import {
  nodeTypeKeys, NODE_DRAG_TYPE, paletteEntries, getNodeEntry, getInputPorts, getOutputPorts
} from '../components/nodes/nodeRegistry.js'
import { compatibleNodeTypes } from '../editor/palette.js'
import { PORT_TYPES } from '../audio/graph/nodeTypes.js'
import { hasSeed } from '../audio/graph/nodeParams.js'
import { CURRENT_SCHEMA_VERSION } from '../audio/graph/migrate.js'

const FLOW_ID = 'carrigraph-editor'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const authStore = useAuthStore()
const audioStore = useAudioStore()
const toastStore = useToastStore()
const ui = useEditorUi()

// Vue Flow instance of the canvas (same id as the <VueFlow> above): used to
// convert screen points to canvas coordinates (zoom and pan aware) and as the
// source of the node selection.
const flow = useVueFlow(FLOW_ID)
const canvasEl = ref(null)
const inspectorEl = ref(null)
const toFlowPosition = (p) => flow.screenToFlowCoordinate(p)
const viewCenter = () => {
  const rect = canvasEl.value?.getBoundingClientRect()
  if (!rect) return { x: 200, y: 150 }
  return toFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
}

/** Last pointer position over the canvas (screen), null when outside. */
const pointer = ref(null)
const onPointerMove = (event) => { pointer.value = { x: event.clientX, y: event.clientY } }

// Selection from Vue Flow (box, Shift / Ctrl + click, keyboard) and set by us
// after a paste / duplicate / Ctrl+A.
const flowSelection = {
  ids: () => flow.getSelectedNodes.value.map(n => String(n.id)),
  edgeIds: () => flow.getSelectedEdges.value.map(e => String(e.id)),
  select: (ids) => {
    const apply = () => {
      flow.removeSelectedElements()
      const found = ids.map(id => flow.findNode(id)).filter(Boolean)
      if (found.length) flow.addSelectedNodes(found)
    }
    apply()
    // New nodes reach Vue Flow on its next sync.
    nextTick(apply)
  }
}

const playback = usePlayback()
const { compiled } = playback
const nodes = useEditorNodes({
  viewCenter,
  afterLayout: () => setTimeout(() => flow.fitView({ padding: 0.15, duration: 300 }), 50),
  selection: flowSelection,
  pastePoint: () => (pointer.value ? toFlowPosition(pointer.value) : null)
})
const contextMenu = useContextMenu({ toFlowPosition })
const exports = useExports()
const history = useVersionHistory()
const autosave = useAutosave({
  onCreated: (project) => {
    keepProjectOnNavigation = true
    router.replace(`/editor/${project.id}`)
  }
})

/** Set before a navigation made by the editor itself (first save, import): the canvas stays. */
let keepProjectOnNavigation = false

const showHelp = ref(false)
// Fase 5B: performance mode and MIDI input
const showPerformance = ref(false)
const midi = useMidiInput({
  // Keys play the selected Voz node, or the first voice of the graph.
  getVoiceNode: () => {
    const sel = nodes.inspectedNode.value
    if (sel?.type === 'voice') return sel
    return projectStore.nodes.find(n => n.type === 'voice') || null
  }
})
const showShare = ref(false)
const projectLoading = ref(false)

const selectionCount = computed(() => nodes.selectedIds.value.length)
const seededSelected = computed(() => nodes.selectedIds.value
  .filter(id => hasSeed(nodes.findNode(id)?.type)).length)
const inspected = computed(() => (selectionCount.value > 1 ? null : nodes.inspectedNode.value))
const deleteCount = computed(() => nodes.deleteRequest.value.ids?.length || 1)

/** Nodes that feed a track: their thumbnails follow the playhead. */
const activeNodeIds = computed(() => {
  const set = new Set()
  for (const t of compiled.value.tracks || []) {
    for (const id of t.nodeIds || []) set.add(String(id))
    if (t.outputId) set.add(String(t.outputId))
    if (t.voiceId) set.add(String(t.voiceId))
  }
  return set
})

// Narrow screens: side panels float over the canvas, the minimap goes away.
const narrow = ref(typeof window !== 'undefined' && window.innerWidth < NARROW_EDITOR)
const onResize = () => { narrow.value = window.innerWidth < NARROW_EDITOR }
onMounted(() => window.addEventListener('resize', onResize))
onUnmounted(() => window.removeEventListener('resize', onResize))

const conflictMessage = computed(() => {
  const c = projectStore.conflict || {}
  const when = c.updated_at ? ` (guardado el ${c.updated_at} UTC)` : ''
  return `Otra pestaña o dispositivo guardó este proyecto${when} después de que lo abriste. ` +
    'Podés recargar esa versión (perdés tus cambios sin guardar) o sobrescribirla con la tuya ' +
    '(la otra queda en el historial de versiones).'
})

// --- Loading ----------------------------------------------------------------

const routeProjectId = (r = route) => (r.params.id ? parseInt(r.params.id) : null)
const isCurrentProject = (r) => String(routeProjectId(r) ?? '') === String(projectStore.currentProject?.id ?? '')

/**
 * What the route asks for. `/editor/gallery/:id` and `/editor/shared/:token`
 * open a public project as an unsaved copy (guest mode: it is never saved; a
 * signed-in user gets a new project of their own on the first save).
 */
const routeSource = (r = route) => {
  if (r.name === 'EditorGallery') return `gallery:${r.params.galleryId}`
  if (r.name === 'EditorShared') return `shared:${r.params.token}`
  return `project:${r.params.id ?? ''}`
}

async function loadPublicCopy() {
  const kind = route.name === 'EditorShared' ? 'shared' : 'gallery'
  const source = routeSource()
  projectStore.loadProject({ id: null, name: '', nodes: [], edges: [] })
  projectLoading.value = true
  const result = kind === 'shared'
    ? await fetchShared(route.params.token)
    : await fetchGalleryProject(route.params.galleryId)
  if (routeSource() !== source) return // another project was asked for meanwhile
  projectLoading.value = false
  const prepared = result.success ? preparePublicProject(result.data) : null
  if (!prepared?.ok) {
    toastStore.error(!result.success
      ? (result.status === 404 ? 'Ese proyecto ya no está disponible' : result.error)
      : prepared.error)
    router.replace('/gallery')
    return
  }
  const { name, nodes: graphNodes, edges: graphEdges, metadata } = prepared.project
  projectStore.loadProject({ id: null, name, nodes: graphNodes, edges: graphEdges, metadata })
  if (authStore.isGuest) {
    toastStore.info('Modo invitado: podés modificar este proyecto, pero los cambios no se guardan.')
  }
}

async function loadFromRoute() {
  if (route.name === 'EditorGallery' || route.name === 'EditorShared') return loadPublicCopy()
  const id = routeProjectId()
  if (id != null) {
    // The project list only holds summaries: always fetch the full project.
    // Clear the canvas first so a previous project is not shown meanwhile.
    projectStore.loadProject({ id, name: '', nodes: [], edges: [] })
    projectLoading.value = true
    const result = await projectStore.fetchProject(id)
    projectLoading.value = false
    if (!result.success) {
      toastStore.error('Proyecto no encontrado')
      router.replace('/projects')
    }
  } else {
    projectStore.loadProject({
      id: null,
      name: 'Proyecto nuevo',
      nodes: [],
      edges: [],
      metadata: { schemaVersion: CURRENT_SCHEMA_VERSION }
    })
  }
}

// During setup, not onMounted: the canvas must be reset before Vue Flow mounts.
// Mounted with the previous project's nodes and emptied right after, Vue Flow
// kept showing them (seen going from an edited project to a blank one).
loadFromRoute()

// Same component for /editor/:id → /editor/:other (e.g. browser back), and
// between a public copy (/editor/gallery/…, /editor/shared/…) and the rest.
watch(() => routeSource(), (now, before) => {
  const keep = keepProjectOnNavigation
  keepProjectOnNavigation = false
  if (keep) return
  const betweenProjects = now.startsWith('project:') && before.startsWith('project:')
  if (!betweenProjects || !isCurrentProject(route)) loadFromRoute()
})

onUnmounted(() => {
  // Playback loops until stopped: don't keep it sounding outside the editor.
  audioStore.stop()
})

// Unsaved changes: autosave (persisted projects) or ask before leaving.
onBeforeRouteLeave(() => autosave.confirmLeave())
onBeforeRouteUpdate((to) => (
  keepProjectOnNavigation || (routeSource(to).startsWith('project:') && routeSource().startsWith('project:') && isCurrentProject(to))
    ? true
    : autosave.confirmLeave()
))

// --- Actions -----------------------------------------------------------------

const goBack = () => router.push(authStore.isGuest ? '/gallery' : '/projects')
const saveProject = () => autosave.saveNow()
const undo = () => projectStore.undo()
const redo = () => projectStore.redo()

async function importProject() {
  const ok = await exports.importProjectFromFile()
  // The imported project is new (not on the server yet)
  if (ok && route.path !== '/editor') {
    keepProjectOnNavigation = true
    router.replace('/editor')
  }
}

function closePanelsIfNarrow() {
  if (narrow.value) ui.toggleSidebar(false)
}

function onPaletteAdd(type) {
  nodes.addNodeAtCenter(type)
  closePanelsIfNarrow()
}

function onMenuAdd(type, flowPosition) {
  nodes.addNodeAt(type, flowPosition)
  contextMenu.close()
}

/** Open the inspector on a node and move the keyboard focus there. */
function openInspector(id) {
  if (id != null) nodes.selectedNodeId.value = id
  ui.toggleInspector(true)
  nextTick(() => inspectorEl.value?.focus())
}

const onNodeDoubleClick = ({ node }) => openInspector(node.id)

// --- Context menu of a node: acts on the group when the node is selected with others

function onNodeContextMenu(params) {
  contextMenu.openForNode(params)
  const ids = nodes.selectedIds.value
  const count = ids.includes(String(params.node.id)) ? ids.length : 1
  contextMenu.menu.value = { ...contextMenu.menu.value, count }
}

const menuTargets = (node) => {
  const ids = nodes.selectedIds.value
  return ids.length > 1 && ids.includes(String(node.id)) ? ids : [String(node.id)]
}

function onMenuDuplicate(node) {
  const ids = menuTargets(node)
  if (ids.length > 1) duplicateSelection(ids)
  else nodes.duplicateNode(node.id)
  contextMenu.close()
}

function onMenuDelete(node) {
  const ids = menuTargets(node)
  if (ids.length > 1) nodes.requestDelete()
  else nodes.requestDelete(node.id)
  contextMenu.close()
}

function copyNodes(ids) {
  const n = nodes.copySelection(ids)
  if (n) toastStore.success(n === 1 ? 'Nodo copiado' : `${n} nodos copiados`)
  return n
}

function duplicateSelection(ids) {
  const created = nodes.duplicateSelection(ids)
  if (created.length) toastStore.success(created.length === 1 ? 'Nodo duplicado' : `${created.length} nodos duplicados`)
  return created
}

// --- Palette drag & drop (sidebar): the node goes where it is dropped ---------

function onDragOver(event) {
  if (event.dataTransfer?.types?.includes(NODE_DRAG_TYPE)) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
}

function onDrop(event) {
  const type = event.dataTransfer?.getData(NODE_DRAG_TYPE)
  if (!type) return
  event.preventDefault()
  nodes.addNodeAt(type, toFlowPosition({ x: event.clientX, y: event.clientY }))
}

// --- Searchable palette (double click / Tab / connection dropped on empty canvas)

const palette = reactive({ open: false, x: 0, y: 0, flow: { x: 0, y: 0 }, entries: [], title: '', from: null })

function openPalette(screen, from = null) {
  let entries = paletteEntries()
  let title = 'Agregar nodo'
  if (from) {
    const options = compatibleNodeTypes({ type: from.portType, handleType: from.handleType })
    entries = options.map(o => ({ ...paletteEntries().find(e => e.type === o.type), port: o.port, portLabel: o.port.label }))
    title = `Conectar a ${from.portLabel} (${PORT_TYPES[from.portType]?.label || from.portType})`
    if (!entries.length) return
  }
  contextMenu.close()
  Object.assign(palette, { open: true, x: screen.x, y: screen.y, flow: toFlowPosition(screen), entries, title, from })
}

function closePalette() {
  palette.open = false
  palette.from = null
}

function onPalettePick(entry) {
  const { from, flow: point } = palette
  closePalette()
  if (from) nodes.addConnectedNode(entry.type, point, from, entry.port)
  else nodes.addNodeAt(entry.type, point)
  canvasEl.value?.focus({ preventScroll: true })
}

const isEmptyCanvas = (el) => !!el?.closest?.('.vue-flow') &&
  !el.closest('.vue-flow__node, .vue-flow__edge, .vue-flow__handle, .vue-flow__controls, .vue-flow__minimap, .vue-flow__panel')

function onCanvasDblClick(event) {
  if (!isEmptyCanvas(event.target)) return
  openPalette({ x: event.clientX, y: event.clientY })
}

// Connection dragged from a port and dropped on empty canvas → palette of compatible nodes.
let pendingConnection = null
let connectedDuringDrag = false

function onConnectStart({ nodeId, handleId, handleType }) {
  connectedDuringDrag = false
  const node = nodes.findNode(nodeId)
  const ports = handleType === 'source' ? getOutputPorts(node?.type) : getInputPorts(node?.type)
  const port = ports.find(p => p.id === handleId) || ports[0]
  pendingConnection = port ? { nodeId, handleId: port.id, handleType, portType: port.type, portLabel: `${getNodeEntry(node.type)?.label} · ${port.label}` } : null
}

function onConnect(connection) {
  connectedDuringDrag = true
  return nodes.onConnect(connection)
}

function onConnectEnd(event) {
  const from = pendingConnection
  pendingConnection = null
  if (!from || connectedDuringDrag || !event) return
  const p = event.changedTouches?.[0] || event
  const target = document.elementFromPoint?.(p.clientX, p.clientY)
  if (!isEmptyCanvas(target) || !canvasEl.value?.contains(target)) return
  openPalette({ x: p.clientX, y: p.clientY }, from)
}

// --- Keyboard shortcuts --------------------------------------------------------

const hasTextSelection = () => {
  const s = typeof window !== 'undefined' ? window.getSelection?.() : null
  return !!s && !s.isCollapsed && String(s).trim().length > 0
}

/** Is the keyboard "on the canvas"? (focus on the canvas or nowhere, pointer over it for Tab) */
const canvasHasFocus = () => {
  const a = document.activeElement
  return !a || a === document.body || a === canvasEl.value || !!canvasEl.value?.contains(a)
}

function onTab() {
  // Tab moves the focus as usual, except on the canvas: there it opens the palette.
  if (!canvasHasFocus()) return false
  const a = document.activeElement
  if (!pointer.value && a !== canvasEl.value) return false
  const rect = canvasEl.value?.getBoundingClientRect()
  const at = pointer.value || (rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 } : { x: 300, y: 200 })
  openPalette(at)
}

function onCopy() {
  if (hasTextSelection()) return false
  if (!copyNodes()) return false
}

function onCut() {
  if (hasTextSelection()) return false
  const n = nodes.cutSelection()
  if (!n) return false
  toastStore.success(n === 1 ? 'Nodo cortado' : `${n} nodos cortados (Ctrl+Z para deshacer)`)
}

function onPaste() {
  const created = nodes.paste()
  if (!created.length) return false
}

function onSelectAll() {
  if (!canvasHasFocus()) return false
  nodes.selectAll()
}

function onEscape() {
  if (contextMenu.menu.value.show || showHelp.value) {
    contextMenu.close()
    showHelp.value = false
    return
  }
  if (selectionCount.value) nodes.clearSelection()
  else return false
}

useKeyboard({
  'Ctrl+S': () => { saveProject() },
  'Cmd+S': () => { saveProject() },
  'Ctrl+Z': () => { undo() },
  'Cmd+Z': () => { undo() },
  'Ctrl+Shift+Z': () => { redo() },
  'Cmd+Shift+Z': () => { redo() },
  'Ctrl+Y': () => { redo() },
  'Space': () => { playback.togglePlay() },
  'Delete': () => { nodes.requestDelete() },
  'Backspace': () => { nodes.requestDelete() },
  'Ctrl+C': onCopy,
  'Cmd+C': onCopy,
  'Ctrl+X': onCut,
  'Cmd+X': onCut,
  'Ctrl+V': onPaste,
  'Cmd+V': onPaste,
  'Ctrl+D': () => { duplicateSelection() },
  'Cmd+D': () => { duplicateSelection() },
  'Ctrl+A': onSelectAll,
  'Cmd+A': onSelectAll,
  'Tab': onTab,
  'Ctrl+E': () => { exports.exportWav() },
  'Cmd+E': () => { exports.exportWav() },
  'Ctrl+M': () => { exports.exportMidi() },
  'Cmd+M': () => { exports.exportMidi() },
  '?': () => { showHelp.value = !showHelp.value },
  'Escape': onEscape
})
</script>

<style scoped>
.editor-container {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--background-dark);
  /* flex item of the app layout: a wide piano roll must scroll, not widen the page */
  flex: 1;
  min-width: 0;
}

.skip-link {
  position: absolute;
  left: 0.5rem;
  top: -3rem;
  z-index: 3000;
  background: var(--primary-color);
  color: #fff;
  padding: 0.4rem 0.75rem;
  border-radius: 4px;
}
.skip-link:focus { top: 0.5rem; }

.editor-workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.canvas-column {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.canvas-bar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: var(--background-light);
  border-bottom: 1px solid var(--border-color);
  padding: 0 0.25rem;
  min-height: 2rem;
  flex: none;
}

.canvas-bar__status {
  flex: 1;
  min-width: 0;
  border-bottom: none;
  background: transparent;
}

.canvas-bar__toggle {
  flex: none;
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}
.canvas-bar__toggle:hover { color: var(--text-primary); border-color: var(--border-color); }
.canvas-bar__toggle:first-child { margin-right: auto; }

.canvas-bar__selection {
  font-size: 0.75rem;
  color: var(--primary-color);
  font-weight: 600;
  padding: 0 0.4rem;
}

.canvas-container {
  flex: 1;
  position: relative;
  background: var(--background-dark);
  min-width: 0;
  min-height: 0;
}

.canvas-container:focus { outline: none; }
.canvas-container:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }

.vue-flow {
  background: var(--background-dark);
}

.canvas-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--background-overlay);
  z-index: 100;
  gap: 1rem;
  color: var(--text-secondary);
}

.canvas-loading__spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Narrow screens (tablets, 768 px): the side panels float over the canvas
   instead of squeezing it; each closes with its × or the bar toggles. */
@media (max-width: 1099px) {
  .editor-panel {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 30;
    box-shadow: 0 0 24px var(--shadow-color);
    max-width: calc(100vw - 3rem);
  }
  .editor-panel--left { left: 0; }
  .editor-panel--right { right: 0; }
}
</style>
