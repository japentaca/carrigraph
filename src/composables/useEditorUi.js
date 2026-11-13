/**
 * useEditorUi — view state of the editor that is not part of the project
 * (Fase 4B): which nodes are expanded on the canvas, and whether the sidebar
 * and the inspector are open. Not saved with the project and not in undo;
 * the panel states are remembered per browser (localStorage, best effort).
 */

import { reactive, ref, watch } from 'vue'

const PANELS_KEY = 'carrigraph_panels'

/** Below this width the side panels start closed and float over the canvas. */
export const NARROW_EDITOR = 1100

function loadPanels() {
  const wide = typeof window === 'undefined' || window.innerWidth >= NARROW_EDITOR
  const defaults = { sidebar: wide, inspector: wide }
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) || 'null')
    // On a narrow screen always start closed (they cover the canvas).
    if (saved && wide) return { sidebar: !!saved.sidebar, inspector: !!saved.inspector }
  } catch { /* storage unavailable */ }
  return defaults
}

const expanded = reactive(new Set())
const panels = ref(loadPanels())

watch(panels, (value) => {
  try { localStorage.setItem(PANELS_KEY, JSON.stringify(value)) } catch { /* ignore */ }
}, { deep: true })

export function useEditorUi() {
  const isExpanded = (id) => expanded.has(String(id))
  const setExpanded = (id, value) => {
    if (value) expanded.add(String(id))
    else expanded.delete(String(id))
  }
  const toggleExpanded = (id) => setExpanded(id, !isExpanded(id))

  const toggleSidebar = (value = !panels.value.sidebar) => { panels.value = { ...panels.value, sidebar: !!value } }
  const toggleInspector = (value = !panels.value.inspector) => { panels.value = { ...panels.value, inspector: !!value } }

  return { expanded, isExpanded, setExpanded, toggleExpanded, panels, toggleSidebar, toggleInspector }
}

/** Tests: forget expanded nodes and reset the panels. */
export function resetEditorUi(panelState = { sidebar: true, inspector: true }) {
  expanded.clear()
  panels.value = { ...panelState }
}
