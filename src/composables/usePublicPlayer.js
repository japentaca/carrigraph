/**
 * usePublicPlayer — playback of a project that is not loaded in the editor
 * (shared link, gallery; Fase 5A). It never touches the project store: the
 * graph is compiled here, with the project's own tempo and swing, and sent to
 * the audio store. Returns a transport with the shape of useTransport(), so
 * the transport bar can drive it (read-only: tempo and swing are not edited).
 *
 * The project passed in must already be prepared (preparePublicProject:
 * migrated and shape-checked).
 */

import { computed, ref, watch, onBeforeUnmount, getCurrentInstance } from 'vue'
import { useAudioStore } from '../stores/useAudioStore'
import { useToastStore } from '../stores/useToastStore'
import { compileWithSwing } from './usePlayback.js'
import { formatPosition } from '../editor/transport.js'

const EMPTY = Object.freeze({
  score: { tempo: 120, stepsPerBeat: 4, tracks: [] }, mode: 'empty', tracks: [], diagnostics: [], previews: {}
})

/**
 * Pure: prepared project → compilation with its tempo and swing.
 * @param {{ nodes, edges, settings: { tempo, swing } } | null} project
 */
export function compilePublicProject(project) {
  if (!project) return EMPTY
  return compileWithSwing(project.nodes || [], project.edges || [], project.settings || {})
}

/**
 * Play a prepared project right away (gallery "play directly"): stops what
 * was playing, applies its tempo/swing to the audio store and plays its score.
 * @returns {Promise<boolean>} false if it has no tracks or audio failed
 */
export async function playPublicProject(project, audioStore = useAudioStore()) {
  const compiled = compilePublicProject(project)
  if (!compiled.score.tracks.length) return false
  audioStore.stop()
  audioStore.setTempo(project.settings?.tempo ?? 120)
  audioStore.setSwing(project.settings?.swing ?? 0)
  return audioStore.play(compiled.score)
}

/**
 * @param {import('vue').Ref<object|null>} projectRef prepared project
 */
export function usePublicPlayer(projectRef) {
  const audioStore = useAudioStore()
  const toastStore = useToastStore()

  const compiled = computed(() => compilePublicProject(projectRef.value))
  /** True while what the audio store plays was started by this player. */
  const owns = ref(false)

  const isPlaying = computed(() => owns.value && audioStore.isPlaying)
  const canPlay = computed(() => compiled.value.score.tracks.length > 0)
  const position = computed(() => (isPlaying.value ? formatPosition(audioStore.globalStep) : null))
  const cycleBars = computed(() => {
    const tracks = compiled.value.score.tracks
    const steps = tracks.length ? Math.max(...tracks.map(t => t.length || 0)) : 0
    return steps ? Math.ceil(steps / 16) : 0
  })

  // One-pass mode ends by itself; so does anything else that stops the store.
  watch(() => audioStore.isPlaying, (playing) => { if (!playing) owns.value = false })
  // Another project (navigation between links) stops this one.
  watch(projectRef, () => stop())

  async function play() {
    const project = projectRef.value
    if (!canPlay.value || !project) {
      toastStore.info('Este proyecto no tiene pistas que suenen')
      return false
    }
    try {
      const ok = await playPublicProject(project, audioStore)
      owns.value = !!ok && audioStore.isPlaying
      return ok
    } catch (err) {
      console.error(err)
      toastStore.error('Error al reproducir audio')
      return false
    }
  }

  function stop() {
    if (owns.value) audioStore.stop()
    owns.value = false
  }

  const togglePlay = () => (isPlaying.value ? (stop(), false) : play())

  if (getCurrentInstance()) onBeforeUnmount(stop)

  return {
    compiled,
    // useTransport() shape (read-only tempo/swing)
    isPlaying, canPlay, position, cycleBars,
    tempo: computed(() => projectRef.value?.settings?.tempo ?? 120),
    swing: computed(() => projectRef.value?.settings?.swing ?? 0),
    volume: computed(() => audioStore.masterVolume),
    loop: computed(() => audioStore.loopEnabled),
    setTempo: () => {}, setSwing: () => {}, tap: () => null,
    setVolume: (v) => audioStore.setMasterVolume(v),
    setLoop: (v) => audioStore.setLoop(v),
    togglePlay, play, stop
  }
}
