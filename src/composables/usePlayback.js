/**
 * usePlayback — play / stop / export shared by the editor components.
 *
 * Graph → score goes through the graph compiler (src/audio/graph/compile.js):
 * multitrack when the graph has Output nodes, single track (compat) otherwise.
 * The global swing of the transport bar is applied on top (applySwing).
 *
 * Fase 4A:
 *  - one shared compilation per store instance (it used to be compiled once
 *    per component that called usePlayback());
 *  - live editing: any change of the compiled score (parameters, connections,
 *    tempo, swing) is sent to the engine while it plays (notes at the next
 *    bar, mix and effects right away). Nothing starts playing by itself.
 */

import { computed, watch, effectScope, toRaw } from 'vue'
import { useProjectStore } from '../stores/useProjectStore'
import { useAudioStore } from '../stores/useAudioStore'
import { useToastStore } from '../stores/useToastStore'
import { compileGraph } from '../audio/graph/compile.js'
import { applySwing } from '../audio/engine/score.js'
import { createZip } from '../editor/zip.js'

/** Pure: graph (nodes, edges) + tempo (+ global swing) → engine score. */
export function scoreFromGraph(nodes, edges, tempo = 120, swing = 0) {
  return applySwing(compileGraph(nodes, edges, { tempo }).score, swing)
}

/** Pure: compile a graph and apply the global swing to its score. */
export function compileWithSwing(nodes, edges, { tempo = 120, swing = 0 } = {}) {
  const result = compileGraph(nodes, edges, { tempo })
  return swing ? { ...result, score: applySwing(result.score, swing) } : result
}

/** Pure: what the compiler reads from a graph, as a string (positions and selection excluded). */
export function compileKey(nodes = [], edges = []) {
  return JSON.stringify([
    (nodes || []).map(n => [n?.id, n?.type, n?.data]),
    (edges || []).map(e => [e?.id, e?.source, e?.target, e?.sourceHandle ?? null, e?.targetHandle ?? null])
  ])
}

// One compilation (and one live-update watcher) per project store instance.
const shared = new WeakMap()

function sharedState(projectStore, audioStore) {
  let state = shared.get(projectStore)
  if (state && state.audioStore === audioStore) return state
  state?.scope.stop()
  const scope = effectScope(true)
  state = scope.run(() => {
    // Fase 4B: compile only when something the compiler reads changed (ids,
    // types, data, edge ends and ports). Dragging nodes or selecting them
    // replaces node objects in the store too; with this key they no longer
    // recompile the graph nor resend the score to the engine on every move.
    const graphKey = computed(() => compileKey(projectStore.nodes, projectStore.edges))
    const compiled = computed(() => {
      void graphKey.value
      return compileWithSwing(toRaw(projectStore.nodes), toRaw(projectStore.edges), {
        tempo: audioStore.tempo, swing: audioStore.swing
      })
    })
    // Live editing: while it plays, every recompilation goes to the engine.
    watch(compiled, (result) => {
      if (audioStore.isPlaying) audioStore.updateScore(result.score)
    })
    return { compiled }
  })
  state = { ...state, scope, audioStore }
  shared.set(projectStore, state)
  return state
}

/** File names of the stems: "<project> - 01 <track name>.wav" (unique, safe). */
export function stemFileNames(base, tracks = []) {
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').trim()
  const width = Math.max(2, String(tracks.length).length)
  return tracks.map((t, i) => `${clean(base) || 'proyecto'} - ${String(i + 1).padStart(width, '0')} ${clean(t?.name || t?.instrument) || 'pista'}.wav`)
}

/** Name of the stems archive: "<project> - stems.zip". */
export function stemsZipName(base) {
  const clean = String(base || '').replace(/[\/:*?"<>|]+/g, '_').trim()
  return `${clean || 'proyecto'} - stems.zip`
}

/** Pack the stem WAVs ([{ blob }] + names) into one .zip Blob. */
export async function stemsZip(stems, names) {
  const files = []
  for (let i = 0; i < stems.length; i++) {
    files.push({ name: names[i], data: new Uint8Array(await blobBytes(stems[i].blob)) })
  }
  return new Blob([createZip(files)], { type: 'application/zip' })
}

// Blob#arrayBuffer, with a FileReader fallback (older engines, jsdom).
function blobBytes(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  // In the document: Firefox ignores clicks on detached links.
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Generous delay: a "save as" prompt may read the blob later.
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export function usePlayback() {
  const projectStore = useProjectStore()
  const audioStore = useAudioStore()
  const toastStore = useToastStore()

  // Compiled at the store tempo and swing; recomputed when nodes/edges change.
  const { compiled } = sharedState(projectStore, audioStore)
  const hasConnectedNodes = computed(() =>
    projectStore.edges.length > 0 && projectStore.nodes.length > 1 && compiled.value.score.tracks.length > 0)
  const isPlaying = computed(() => audioStore.isPlaying)

  const currentScore = () => compiled.value.score
  const baseName = () => projectStore.currentProject?.name || 'proyecto'

  async function play() {
    if (!hasConnectedNodes.value) {
      toastStore.info('Conectá nodos para generar audio')
      return false
    }
    try {
      return await audioStore.play(currentScore())
    } catch (err) {
      console.error(err)
      toastStore.error('Error al reproducir audio')
      return false
    }
  }

  function stop() {
    audioStore.stop()
  }

  async function togglePlay() {
    if (audioStore.isPlaying) {
      stop()
      return false
    }
    return play()
  }

  /**
   * Send the current score to the engine if it is playing (live update).
   * Never starts playback: if it is stopped, nothing happens. The shared
   * watcher already does this on every change; this is for explicit calls.
   * @returns {boolean} true when the playing score was updated
   */
  function refresh() {
    if (!audioStore.isPlaying || !hasConnectedNodes.value) return false
    audioStore.updateScore(currentScore())
    return true
  }

  async function exportWav({ repeats = audioStore.exportRepeats } = {}) {
    if (!hasConnectedNodes.value) {
      toastStore.warning('No hay patrón para exportar. Conectá nodos primero.')
      return null
    }
    const result = await audioStore.exportWav(currentScore(), { repeats })
    if (!result) {
      toastStore.error('No se pudo exportar el audio')
      return null
    }
    download(result.blob, `${baseName()}.wav`)
    toastStore.success(`Audio exportado como WAV (${result.duration.toFixed(1)} s)`)
    return result
  }

  /** One WAV per track, downloaded as separate files (stems). */
  async function exportStems({ repeats = audioStore.exportRepeats } = {}) {
    if (!hasConnectedNodes.value) {
      toastStore.warning('No hay patrón para exportar. Conectá nodos primero.')
      return null
    }
    const result = await audioStore.exportStems(currentScore(), { repeats })
    if (!result) {
      toastStore.error('No se pudieron exportar las pistas')
      return null
    }
    const names = stemFileNames(baseName(), result.stems.map(s => s.track))
    const count = result.stems.length
    if (count === 1) {
      download(result.stems[0].blob, names[0])
    } else {
      // One .zip with one WAV per track (Fase 5B): browsers block or ask
      // before several downloads from one click (Chrome kept only the first).
      download(await stemsZip(result.stems, names), stemsZipName(baseName()))
    }
    toastStore.success(count === 1
      ? `Pista exportada como WAV (${result.duration.toFixed(1)} s)`
      : `${count} pistas exportadas como WAV separados en un .zip (${result.duration.toFixed(1)} s)`)
    return result
  }

  /**
   * Mute / solo a track from outside the node (timeline). Writes the Output
   * node (persisted, undoable) and applies the mix right away if playing.
   * @returns {boolean} false in compatibility mode (no Output node)
   */
  function setTrackMix(trackId, changes) {
    const info = compiled.value.tracks.find(t => t.id === trackId)
    const node = info?.outputId && projectStore.nodes.find(n => String(n.id) === String(info.outputId))
    if (!node) return false
    projectStore.updateNode(node.id, { data: { ...node.data, ...changes } })
    if (audioStore.isPlaying) audioStore.applyMix(currentScore())
    return true
  }

  function exportMidi({ repeats = audioStore.exportRepeats } = {}) {
    if (!hasConnectedNodes.value) {
      toastStore.warning('No hay patrón para exportar. Conectá nodos primero.')
      return null
    }
    const blob = audioStore.exportMidi(currentScore(), { repeats, name: baseName() })
    if (!blob) {
      toastStore.warning('El patrón no tiene notas para exportar.')
      return null
    }
    download(blob, `${baseName()}.mid`)
    toastStore.success('MIDI exportado')
    return blob
  }

  return {
    compiled, hasConnectedNodes, isPlaying, play, stop, togglePlay, refresh,
    exportWav, exportStems, exportMidi, setTrackMix, currentScore
  }
}
