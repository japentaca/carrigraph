/**
 * useRecording — record what plays (master output) and download it (Fase 5B).
 * The take includes live edits, mute/solo and master volume, because it is
 * the live output. Recording keeps going if playback stops (silence is
 * recorded) and ends with the button or when the component unmounts.
 */

import { ref, computed, onUnmounted } from 'vue'
import { useAudioStore } from '../stores/useAudioStore'
import { useToastStore } from '../stores/useToastStore'
import { formatRecordingTime, recordingExtension } from '../audio/engine/recorder.js'
import { download } from './usePlayback.js'

/** "<name> - grabación 2026-11-13 18-05.webm" (safe for every OS). */
export function recordingFileName(name, mimeType, date = new Date()) {
  const clean = String(name || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'proyecto'
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`
  return `${clean} - grabación ${stamp}.${recordingExtension(mimeType)}`
}

/**
 * @param {object} [opts]
 * @param {() => string} [opts.name]  base file name (project name)
 */
export function useRecording({ name = () => 'proyecto' } = {}) {
  const audioStore = useAudioStore()
  const toastStore = useToastStore()
  const supported = ref(audioStore.canRecord())
  const now = ref(Date.now())
  let timer = null

  const isRecording = computed(() => audioStore.isRecording)
  const elapsedLabel = computed(() =>
    formatRecordingTime(audioStore.isRecording ? now.value - audioStore.recordingStartedAt : 0))

  function tick() {
    stopTick()
    timer = setInterval(() => { now.value = Date.now() }, 250)
  }
  function stopTick() {
    if (timer != null) clearInterval(timer)
    timer = null
  }

  async function start() {
    if (!supported.value) {
      toastStore.warning('Este navegador no permite grabar el audio (falta MediaRecorder).')
      return false
    }
    const ok = await audioStore.startRecording()
    if (!ok) {
      toastStore.error('No se pudo empezar a grabar')
      return false
    }
    now.value = Date.now()
    tick()
    return true
  }

  async function stop() {
    stopTick()
    const take = await audioStore.stopRecording()
    if (!take || !take.blob?.size) {
      if (take) toastStore.warning('La grabación quedó vacía')
      return null
    }
    download(take.blob, recordingFileName(name(), take.mimeType))
    toastStore.success(`Grabación descargada (${formatRecordingTime(take.duration * 1000)})`)
    return take
  }

  function toggle() {
    return audioStore.isRecording ? stop() : start()
  }

  // Leaving the editor while recording: keep the take (download it).
  onUnmounted(() => {
    stopTick()
    if (audioStore.isRecording) stop()
  })

  return { supported, isRecording, elapsedLabel, start, stop, toggle }
}
