/**
 * useContextMenu — right-click menu of the canvas (Fase 4A).
 *
 * The menu is drawn at the cursor (screen coordinates) but a node created from
 * it goes to the matching point of the canvas: `toFlowPosition(screenPoint)`
 * converts with the current zoom and pan (Vue Flow's screenToFlowCoordinate).
 * Before Fase 4A the node used the screen coordinates directly, so with zoom
 * or pan it appeared far from the cursor.
 */

import { ref, onMounted, onUnmounted } from 'vue'

/** Keep a menu of `width`×`height` inside the viewport (pure). */
export function menuPlacement(x, y, { width = 220, height = 320, viewportWidth = 1024, viewportHeight = 768, margin = 8 } = {}) {
  const left = Math.max(margin, Math.min(x, viewportWidth - width - margin))
  const top = Math.max(margin, Math.min(y, viewportHeight - Math.min(height, viewportHeight - 2 * margin) - margin))
  return { left, top, maxHeight: viewportHeight - top - margin }
}

/**
 * @param {object} [options]
 * @param {(p: {x:number,y:number}) => {x:number,y:number}} [options.toFlowPosition]
 *   screen → canvas coordinates (identity by default)
 */
export function useContextMenu({ toFlowPosition = (p) => ({ ...p }) } = {}) {
  const menu = ref({ show: false, x: 0, y: 0, flow: { x: 0, y: 0 }, node: null })

  function open(clientX, clientY, node = null) {
    menu.value = {
      show: true,
      x: clientX,
      y: clientY,
      flow: toFlowPosition({ x: clientX, y: clientY }),
      node
    }
  }

  /** Vue Flow @pane-context-menu (a MouseEvent). */
  function openForPane(event) {
    event?.preventDefault?.()
    open(event.clientX, event.clientY, null)
  }

  /** Vue Flow @node-context-menu ({ event, node }). */
  function openForNode({ event, node }) {
    event?.preventDefault?.()
    open(event.clientX, event.clientY, node)
  }

  function close() {
    if (menu.value.show) menu.value = { ...menu.value, show: false }
  }

  const onKey = (e) => { if (e.key === 'Escape') close() }

  onMounted(() => {
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
  })
  onUnmounted(() => {
    document.removeEventListener('click', close)
    document.removeEventListener('keydown', onKey)
  })

  return { menu, open, openForPane, openForNode, close }
}
