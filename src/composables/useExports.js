/**
 * useExports — every export / import of the editor in one place (Fase 4A):
 * WAV of the mix, stems, MIDI (from usePlayback, same score as playback) and
 * the .cgproj project file (useProjectIO).
 */

import { computed } from 'vue'
import { useProjectStore } from '../stores/useProjectStore'
import { useAudioStore } from '../stores/useAudioStore'
import { useToastStore } from '../stores/useToastStore'
import { usePlayback } from './usePlayback.js'
import { exportProject, importProjectFile } from './useProjectIO.js'
import { persistedGraph } from '../editor/graphState.js'

export function useExports() {
  const projectStore = useProjectStore()
  const audioStore = useAudioStore()
  const toastStore = useToastStore()
  const playback = usePlayback()

  const canExportAudio = computed(() => playback.hasConnectedNodes.value && !audioStore.isExporting)

  const exportWav = () => playback.exportWav()
  const exportStems = () => playback.exportStems()
  const exportMidi = () => playback.exportMidi()

  function setRepeats(value) {
    audioStore.setExportRepeats(value)
    return audioStore.exportRepeats
  }

  /** Download the project as .cgproj (graph + tempo/swing). */
  function exportProjectFile() {
    if (projectStore.nodes.length === 0) {
      toastStore.warning('El proyecto está vacío. Agregá nodos primero.')
      return null
    }
    const graph = persistedGraph(projectStore.nodes, projectStore.edges)
    const data = exportProject({
      name: projectStore.currentProject?.name || 'Proyecto sin título',
      nodes: graph.nodes,
      edges: graph.edges,
      settings: projectStore.settings,
      createdAt: projectStore.currentProject?.created_at || new Date().toISOString()
    })
    toastStore.success('Proyecto exportado como .cgproj')
    return data
  }

  /**
   * Pick a .cgproj and open it as a new, unsaved project (already migrated to
   * the current schema). Undo goes back to the empty canvas.
   * @returns {Promise<boolean>} true when something was imported
   */
  async function importProjectFromFile() {
    const result = await importProjectFile()
    if (!result.success) {
      if (result.error !== 'Cancelado') toastStore.error(result.error || 'Error al importar')
      return false
    }
    projectStore.loadProject({
      id: null,
      name: result.data.name,
      nodes: [],
      edges: [],
      metadata: result.data.metadata
    })
    projectStore.replaceGraph(result.data.nodes, result.data.edges)
    toastStore.success(`Proyecto "${result.data.name}" importado (${result.data.nodes.length} nodos)`)
    return true
  }

  return {
    canExportAudio, exportWav, exportStems, exportMidi, setRepeats,
    exportProjectFile, importProjectFromFile
  }
}
