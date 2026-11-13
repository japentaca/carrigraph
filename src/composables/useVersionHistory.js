/**
 * useVersionHistory — version history panel (Fase 4A): list, preview and
 * restore, over the endpoints of Fase 1. Versions are stored as they were
 * saved (possibly in an old schema): previewing and restoring go through
 * migrateProject (in the project store).
 */

import { ref, computed } from 'vue'
import { useProjectStore } from '../stores/useProjectStore'
import { useAudioStore } from '../stores/useAudioStore'
import { useToastStore } from '../stores/useToastStore'
import { compileWithSwing } from './usePlayback.js'
import { settingsFromMetadata } from '../editor/graphState.js'
import { nodeDisplayName } from '../components/nodes/nodeRegistry.js'

/** Short summary of a (migrated) version for the preview (pure). */
export function versionSummary(version) {
  if (!version) return null
  const settings = settingsFromMetadata(version.metadata)
  const compiled = compileWithSwing(version.nodes || [], version.edges || [], settings)
  const counts = {}
  for (const n of version.nodes || []) {
    const name = nodeDisplayName(n)
    counts[name] = (counts[name] || 0) + 1
  }
  return {
    settings,
    compiled,
    mode: compiled.mode,
    tracks: compiled.score.tracks.map(t => ({ id: t.id, name: t.name, instrument: t.instrument, length: t.length })),
    nodeCounts: Object.entries(counts).map(([name, count]) => ({ name, count })),
    schemaVersion: version.metadata?.schemaVersion ?? null
  }
}

export function useVersionHistory() {
  const projectStore = useProjectStore()
  const audioStore = useAudioStore()
  const toastStore = useToastStore()

  const open = ref(false)
  const versions = ref([])
  const loading = ref(false)
  const error = ref(null)
  const selected = ref(null)        // migrated full version
  const loadingVersion = ref(false)
  const restoring = ref(false)
  /** Version number being listened to (its score is playing), or null. */
  const listening = ref(null)

  const projectId = computed(() => projectStore.currentProject?.id ?? null)
  const summary = computed(() => versionSummary(selected.value))

  async function load() {
    if (projectId.value == null) {
      versions.value = []
      return
    }
    loading.value = true
    error.value = null
    const result = await projectStore.fetchVersions(projectId.value)
    loading.value = false
    if (result.success) versions.value = result.versions
    else error.value = result.error
  }

  async function show() {
    open.value = true
    selected.value = null
    await load()
  }

  function hide() {
    stopListening()
    open.value = false
    selected.value = null
  }

  async function select(versionNumber) {
    if (selected.value?.version_number === versionNumber) return selected.value
    stopListening()
    loadingVersion.value = true
    const result = await projectStore.fetchVersion(projectId.value, versionNumber)
    loadingVersion.value = false
    if (result.success) selected.value = result.version
    else toastStore.error(result.error)
    return selected.value
  }

  /** Play the selected version (its own score), without loading it. */
  async function listen() {
    const s = summary.value
    if (!s || !s.compiled.score.tracks.length) {
      toastStore.info('Esta versión no tiene pistas que suenen')
      return false
    }
    const ok = await audioStore.play(s.compiled.score)
    listening.value = ok ? selected.value.version_number : null
    return ok
  }

  function stopListening() {
    if (listening.value != null) {
      audioStore.stop()
      listening.value = null
    }
  }

  /** Restore a version: the server records it as a new version; the editor loads it (migrated). */
  async function restore(versionNumber = selected.value?.version_number) {
    if (versionNumber == null || projectId.value == null) return false
    stopListening()
    restoring.value = true
    const result = await projectStore.restoreVersion(projectId.value, versionNumber)
    restoring.value = false
    if (!result.success) {
      toastStore.error(result.error)
      return false
    }
    toastStore.success(`Versión ${versionNumber} restaurada`)
    selected.value = null
    await load()
    return true
  }

  return {
    open, versions, loading, error, selected, loadingVersion, restoring, listening, summary,
    load, show, hide, select, listen, stopListening, restore
  }
}
