/**
 * useAutosave — saving in the editor (Fase 4A).
 *
 *  - "Unsaved changes" = projectStore.isDirty (graph + tempo/swing differ
 *    from the last load/save; selection and sizes do not count).
 *  - Autosave: projects that already exist on the server are saved `delay` ms
 *    after the last change (debounce). New projects are not created by
 *    themselves: the first save is manual (Ctrl+S / Guardar).
 *  - Conflicts: every save sends the `updated_at` it is based on; if the
 *    server has a newer one it answers 409, autosave pauses and the editor
 *    asks: reload the server copy or overwrite it.
 *  - Guest mode (authStore.isGuest): nothing is saved, ever. Save answers
 *    with a notice, there is no autosave and no leave prompt (only the
 *    browser's own warning when closing / reloading with changes).
 *  - Leaving: `beforeunload` warns while there are unsaved changes; for
 *    in-app navigation the editor calls `confirmLeave()` from its route guard.
 */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useProjectStore } from '../stores/useProjectStore'
import { useToastStore } from '../stores/useToastStore'
import { useAuthStore } from '../stores/useAuthStore'

export const AUTOSAVE_DELAY_MS = 2000

/**
 * Status line for the toolbar (pure).
 * @returns {{ key: string, label: string }}
 */
export function saveStatusLabel({ saveStatus, isDirty, isPersisted, lastSavedAt, hasConflict = false, isGuest = false }) {
  if (isGuest) return { key: 'guest', label: 'Modo invitado · no se guarda' }
  if (saveStatus === 'saving') return { key: 'saving', label: 'Guardando…' }
  if (saveStatus === 'conflict') return { key: 'conflict', label: 'Conflicto con el servidor' }
  if (hasConflict) return { key: 'conflict', label: 'Conflicto sin resolver · autoguardado en pausa' }
  if (saveStatus === 'error') return { key: 'error', label: isDirty ? 'Error al guardar · cambios sin guardar' : 'Error al guardar' }
  if (!isPersisted) return isDirty ? { key: 'dirty', label: 'Sin guardar (proyecto nuevo)' } : { key: 'new', label: 'Proyecto nuevo' }
  if (isDirty) return { key: 'dirty', label: 'Cambios sin guardar' }
  return { key: 'saved', label: lastSavedAt ? 'Guardado' : 'Sin cambios' }
}

/**
 * @param {object} [options]
 * @param {number} [options.delay] debounce of the autosave, ms
 * @param {(project) => void} [options.onCreated] after the first save of a new project (route change)
 */
export function useAutosave({ delay = AUTOSAVE_DELAY_MS, onCreated } = {}) {
  const projectStore = useProjectStore()
  const toastStore = useToastStore()
  const authStore = useAuthStore()

  let timer = null
  const enabled = ref(true)
  /** Leave prompt: { show, resolve } (the editor renders the dialog). */
  const leavePrompt = ref({ show: false, resolve: null })

  const status = computed(() => saveStatusLabel({
    saveStatus: projectStore.saveStatus,
    isDirty: projectStore.isDirty,
    isPersisted: projectStore.isPersisted,
    lastSavedAt: projectStore.lastSavedAt,
    hasConflict: !!projectStore.conflict,
    isGuest: authStore.isGuest
  }))

  const conflictOpen = computed(() => projectStore.saveStatus === 'conflict')

  function cancel() {
    if (timer != null) clearTimeout(timer)
    timer = null
  }

  function canAutosave() {
    return enabled.value && !authStore.isGuest && projectStore.isPersisted && projectStore.isDirty &&
      !projectStore.conflict && projectStore.saveStatus !== 'saving'
  }

  function schedule() {
    cancel()
    if (!canAutosave()) return
    timer = setTimeout(() => {
      timer = null
      autosaveNow()
    }, delay)
  }

  async function autosaveNow() {
    if (!canAutosave()) return null
    const result = await projectStore.saveCurrent()
    if (!result.success && !result.conflict) {
      toastStore.error(`No se pudo autoguardar: ${result.error || 'error'}`)
    }
    // Edits made while saving: save them too
    if (result.success && projectStore.isDirty) schedule()
    return result
  }

  /** Save now (Ctrl+S, button, leave prompt). Creates the project if it is new. */
  async function saveNow({ force = false, quiet = false } = {}) {
    cancel()
    if (authStore.isGuest) {
      if (!quiet) {
        toastStore.info('Modo invitado: los cambios no se guardan. Iniciá sesión para guardar, o exportá el proyecto a un archivo.')
      }
      return { success: false, guest: true }
    }
    const result = await projectStore.saveCurrent({ force })
    if (result.success) {
      if (result.created) {
        if (!quiet) toastStore.success('Proyecto creado')
        onCreated?.(projectStore.currentProject)
      } else if (!quiet && !result.skipped) {
        toastStore.success('Proyecto guardado')
      }
      if (projectStore.isDirty) schedule()
    } else if (!result.conflict) {
      toastStore.error(result.error || 'Error al guardar')
    }
    return result
  }

  // --- Conflict choices ----------------------------------------------------

  /** Discard local changes and load what the server has. */
  async function resolveReload() {
    cancel()
    const result = await projectStore.reloadFromServer()
    if (result.success) toastStore.info('Se cargó la versión del servidor')
    else toastStore.error(result.error || 'No se pudo recargar el proyecto')
    return result
  }

  /** Keep the local copy: overwrite the server (no base sent). */
  function resolveOverwrite() {
    return saveNow({ force: true })
  }

  function resolveLater() {
    cancel()
    projectStore.dismissConflict()
  }

  // --- Leaving -------------------------------------------------------------

  const onBeforeUnload = (event) => {
    if (!projectStore.isDirty) return undefined
    event.preventDefault()
    event.returnValue = ''
    return ''
  }

  /**
   * For the route guard. Resolves true when it is fine to leave: nothing
   * unsaved, an autosaved project that saves right now, or the user chose to
   * save or discard in the prompt.
   */
  async function confirmLeave() {
    if (!projectStore.isDirty) return true
    // Guest mode: there is nothing to save, so nothing to ask.
    if (authStore.isGuest) return true
    if (projectStore.isPersisted && !projectStore.conflict) {
      const result = await saveNow({ quiet: true })
      if (result.success && !projectStore.isDirty) return true
    }
    return new Promise((resolve) => {
      leavePrompt.value = { show: true, resolve }
    })
  }

  /** Answer of the leave prompt: 'save' | 'discard' | 'stay'. */
  async function answerLeave(choice) {
    const resolve = leavePrompt.value.resolve
    leavePrompt.value = { show: false, resolve: null }
    if (!resolve) return
    if (choice === 'discard') return resolve(true)
    if (choice === 'save') {
      const result = await saveNow({ quiet: true })
      return resolve(!!result.success)
    }
    resolve(false)
  }

  // Every change of the graph or settings (re)starts the countdown.
  watch(() => projectStore.currentSignature, schedule)
  // A save that ends with changes still pending, or a conflict resolved by reload
  watch(() => projectStore.saveStatus, (s) => { if (s === 'idle') schedule() })

  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
  onUnmounted(() => {
    cancel()
    window.removeEventListener('beforeunload', onBeforeUnload)
  })

  return {
    status, conflictOpen, leavePrompt, enabled,
    schedule, cancel, autosaveNow, saveNow,
    resolveReload, resolveOverwrite, resolveLater,
    confirmLeave, answerLeave, onBeforeUnload
  }
}
