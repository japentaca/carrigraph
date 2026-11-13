import { onMounted, onUnmounted } from 'vue'

/**
 * Composable para registrar atajos de teclado globales.
 *
 * Uso:
 *   useKeyboard({
 *     'Ctrl+S': (e) => { e.preventDefault(); save(); },
 *     'Space':  () => play(),
 *   })
 *
 * Teclas: letras (A-Z), números (0-9), Backspace, Delete, Space, Enter,
 * Escape, Tab, ArrowUp/Down/Left/Right, ?.
 * Modificadores: Ctrl, Cmd (se traduce a Ctrl en Win/Linux, Meta en Mac),
 * Shift (ej: 'Ctrl+Shift+Z'), Alt.
 *
 * Retorna un array de shortcuts para mostrar en UI de ayuda.
 */

const MOD_MAP = {
  Ctrl: 'Ctrl',
  Cmd: 'Cmd',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: 'Cmd'
}

function normalizeKey(key) {
  // (before Fase 4B ' ' fell into the single-character branch: Space never matched)
  if (key === ' ' || key === 'Spacebar') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  const map = {
    ' ': 'Space',
    'backspace': 'Backspace',
    'delete': 'Delete',
    'enter': 'Enter',
    'escape': 'Escape',
    'tab': 'Tab',
    'arrowup': 'ArrowUp',
    'arrowdown': 'ArrowDown',
    'arrowleft': 'ArrowLeft',
    'arrowright': 'ArrowRight',
    '?': '?',
    '/': '/'
  }
  return map[key.toLowerCase()] || key
}

/**
 * Should a global shortcut ignore this key event? (Fase 4B)
 *  - typing in a field (input, textarea, select, contenteditable);
 *  - inside a dialog (aria-modal, or a role=dialog panel such as the
 *    version history): the dialog owns its keys;
 *  - Space / Enter on a focused button, link, checkbox or <summary>: they
 *    activate it (keyboard users), they do not play / stop.
 */
export function isEditableTarget(target) {
  if (!target || !target.tagName) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.isContentEditable
}

export function shouldIgnoreShortcut(event) {
  const target = event.target
  if (isEditableTarget(target)) return true
  if (target?.closest?.('[aria-modal="true"], [role="dialog"], [role="alertdialog"]')) return true
  if ((event.key === ' ' || event.key === 'Enter') &&
      target?.closest?.('button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], [role="checkbox"]')) {
    return true
  }
  return false
}

/** "Ctrl+Shift+Z"-style name of a key event (Cmd on Mac). */
export function comboOf(event, isMac = false) {
  const parts = []
  if (event.ctrlKey) parts.push(isMac ? 'Cmd' : 'Ctrl')
  if (event.metaKey && !parts.includes('Cmd')) parts.push('Cmd')
  const key = normalizeKey(event.key || '')
  // Shift is part of typing "?" or "+": only count it for letters, digits and named keys.
  const printableSymbol = key.length === 1 && !/[A-Z0-9]/.test(key)
  if (event.shiftKey && event.key !== 'Shift' && !printableSymbol) parts.push('Shift')
  if (event.altKey && event.key !== 'Alt') parts.push('Alt')
  if (!parts.includes(key)) parts.push(key)
  return parts.join('+')
}

export function useKeyboard(shortcuts) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  const handler = (event) => {
    if (shouldIgnoreShortcut(event)) return
    const combo = comboOf(event, isMac)
    const fn = shortcuts[combo]
    if (!fn) return
    // A handler may return false to let the browser handle the key (e.g.
    // Ctrl+C with text selected, Tab outside the canvas).
    if (fn(event) === false) return
    event.preventDefault()
    event.stopPropagation()
  }

  onMounted(() => {
    window.addEventListener('keydown', handler, true)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handler, true)
  })
}

/**
 * Devuelve una lista de atajos para mostrar en ayuda,
 * reemplazando Cmd/Ctrl según la plataforma.
 */
export function getShortcutList() {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  const format = (combo) => {
    if (isMac) {
      return combo.replace(/Ctrl\+/g, '⌃').replace(/Cmd\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥')
    }
    return combo
  }

  return [
    { combo: 'Ctrl+S', label: format('Ctrl+S'), description: 'Guardar proyecto (los ya guardados también se autoguardan)' },
    { combo: 'Ctrl+Z', label: format('Ctrl+Z'), description: 'Deshacer (Undo)' },
    { combo: 'Ctrl+Shift+Z', label: format('Ctrl+Shift+Z'), description: 'Rehacer (Redo)' },
    { combo: 'Ctrl+Y', label: format('Ctrl+Y'), description: 'Rehacer (Redo)' },
    { combo: 'Space', label: format('Space'), description: 'Reproducir / detener' },
    { combo: 'Delete', label: format('Delete'), description: 'Eliminar los nodos seleccionados (o las conexiones seleccionadas)' },
    { combo: 'Backspace', label: format('Backspace'), description: 'Eliminar los nodos seleccionados' },
    { combo: 'Ctrl+C', label: format('Ctrl+C'), description: 'Copiar los nodos seleccionados con sus conexiones internas' },
    { combo: 'Ctrl+X', label: format('Ctrl+X'), description: 'Cortar los nodos seleccionados' },
    { combo: 'Ctrl+V', label: format('Ctrl+V'), description: 'Pegar (en el puntero si está sobre el lienzo)' },
    { combo: 'Ctrl+D', label: format('Ctrl+D'), description: 'Duplicar los nodos seleccionados con sus conexiones' },
    { combo: 'Ctrl+A', label: format('Ctrl+A'), description: 'Seleccionar todos los nodos' },
    { combo: 'Shift+clic', label: format('Shift') + ' + clic', description: 'Agregar o quitar un nodo de la selección' },
    { combo: 'Shift+arrastrar', label: format('Shift') + ' + arrastrar', description: 'Seleccionar con un recuadro' },
    { combo: 'Tab', label: 'Tab', description: 'Con el puntero o el foco en el lienzo: buscar un nodo y crearlo ahí (también doble clic)' },
    { combo: 'Flechas', label: '← ↑ → ↓', description: 'Mover los nodos seleccionados (con el foco en un nodo)' },
    { combo: 'Ctrl+E', label: format('Ctrl+E'), description: 'Exportar audio WAV' },
    { combo: 'Ctrl+M', label: format('Ctrl+M'), description: 'Exportar MIDI' },
    { combo: '?', label: format('?'), description: 'Mostrar / ocultar ayuda' },
    { combo: 'Escape', label: format('Escape'), description: 'Cerrar menú, paleta, diálogo o ayuda; si no hay nada abierto, quitar la selección' }
  ]
}
