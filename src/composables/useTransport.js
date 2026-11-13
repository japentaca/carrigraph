/**
 * useTransport — state and actions of the transport bar (Fase 4A).
 *
 * Tempo and swing are saved with the project (projectStore.settings →
 * metadata.tempo / metadata.swing) and applied to the engine through the
 * audio store; when a project is loaded its settings are applied. The master
 * volume is a listening preference (not saved with the project).
 * Changing tempo or swing recompiles the score; while playing it is applied at
 * the next bar (the live-update watcher of usePlayback).
 */

import { computed, watch } from 'vue'
import { useProjectStore } from '../stores/useProjectStore'
import { useAudioStore } from '../stores/useAudioStore'
import { usePlayback } from './usePlayback.js'
import { createTapTempo, formatPosition } from '../editor/transport.js'

export function useTransport() {
  const projectStore = useProjectStore()
  const audioStore = useAudioStore()
  const playback = usePlayback()
  const tapper = createTapTempo()

  // Loading a project brings its tempo and swing.
  watch(() => projectStore.loadCount, () => {
    audioStore.setTempo(projectStore.settings.tempo)
    audioStore.setSwing(projectStore.settings.swing)
  }, { immediate: true })

  const isPlaying = computed(() => audioStore.isPlaying)
  const canPlay = computed(() => playback.hasConnectedNodes.value)
  const position = computed(() => formatPosition(audioStore.globalStep))
  /** Length of the longest track, in bars (rounded up). */
  const cycleBars = computed(() => {
    const tracks = playback.compiled.value.score.tracks
    const steps = tracks.length ? Math.max(...tracks.map(t => t.length || 0)) : 0
    return steps ? Math.ceil(steps / 16) : 0
  })

  function setTempo(value) {
    audioStore.setTempo(value)
    projectStore.setSettings({ tempo: audioStore.tempo })
  }

  function setSwing(value) {
    audioStore.setSwing(value)
    projectStore.setSettings({ swing: audioStore.swing })
  }

  /** One tap; from the second one on the tempo follows the taps. */
  function tap(now = (globalThis.performance?.now?.() ?? Date.now())) {
    const bpm = tapper.tap(now)
    if (bpm != null) setTempo(bpm)
    return bpm
  }

  const setVolume = (value) => audioStore.setMasterVolume(value)
  const setLoop = (value) => audioStore.setLoop(value)
  const togglePlay = () => playback.togglePlay()

  return {
    isPlaying, canPlay, position, cycleBars,
    tempo: computed(() => audioStore.tempo),
    swing: computed(() => audioStore.swing),
    volume: computed(() => audioStore.masterVolume),
    loop: computed(() => audioStore.loopEnabled),
    setTempo, setSwing, tap, setVolume, setLoop, togglePlay
  }
}
