/**
 * recorder.js — live recording of the master output (Fase 5B).
 *
 * Taps the output after the master volume (what you hear, live edits
 * included) into a MediaStreamAudioDestinationNode and records that stream
 * with MediaRecorder. No Vue / Pinia; context and MediaRecorder are
 * injectable so it can be tested without a browser.
 */

/** Containers tried in order; the first one the browser supports wins. */
export const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4'
]

/** First supported mime type, '' to let the browser choose, null without MediaRecorder. */
export function pickRecordingMimeType(Recorder = globalThis.MediaRecorder) {
  if (!Recorder) return null
  if (typeof Recorder.isTypeSupported !== 'function') return ''
  return RECORDING_MIME_TYPES.find(t => { try { return Recorder.isTypeSupported(t) } catch { return false } }) || ''
}

/** File extension for a recorded mime type. */
export function recordingExtension(mimeType = '') {
  const t = String(mimeType).toLowerCase()
  if (t.includes('ogg')) return 'ogg'
  if (t.includes('mp4') || t.includes('aac')) return 'm4a'
  return 'webm'
}

/** Can this context be recorded? (MediaRecorder + createMediaStreamDestination) */
export function canRecord({ context, Recorder = globalThis.MediaRecorder } = {}) {
  if (typeof Recorder !== 'function') return false
  if (context) return typeof context.createMediaStreamDestination === 'function'
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext
  return !!Ctor && typeof Ctor.prototype?.createMediaStreamDestination === 'function'
}

/** "m:ss" (or "h:mm:ss") for an elapsed time in milliseconds. */
export function formatRecordingTime(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/**
 * @param {object} opts
 * @param {BaseAudioContext} opts.context
 * @param {AudioNode} opts.source        node whose output is recorded (master output)
 * @param {Function} [opts.Recorder]     MediaRecorder constructor
 * @param {() => number} [opts.now]      ms clock (Date.now)
 * @param {number} [opts.timeslice=1000] ms per chunk (long takes do not sit in one buffer)
 */
export function createRecorder({ context, source, Recorder = globalThis.MediaRecorder, now = () => Date.now(), timeslice = 1000 }) {
  let recorder = null
  let destination = null
  let chunks = []
  let startedAt = 0
  let mimeType = ''

  function cleanup() {
    try { source.disconnect(destination) } catch { /* already disconnected */ }
    recorder = null
    destination = null
  }

  return {
    get mimeType() { return mimeType },
    isRecording() { return !!recorder && recorder.state !== 'inactive' },
    /** Milliseconds since start (0 when not recording). */
    elapsed() { return this.isRecording() ? now() - startedAt : 0 },

    /** Start recording. Throws if recording is not possible here. */
    start() {
      if (this.isRecording()) return false
      if (!canRecord({ context, Recorder })) throw new Error('Recording not supported')
      destination = context.createMediaStreamDestination()
      source.connect(destination)
      const preferred = pickRecordingMimeType(Recorder)
      try {
        recorder = preferred ? new Recorder(destination.stream, { mimeType: preferred }) : new Recorder(destination.stream)
      } catch (error) {
        cleanup()
        throw error
      }
      mimeType = recorder.mimeType || preferred || 'audio/webm'
      chunks = []
      recorder.ondataavailable = (event) => { if (event.data && event.data.size > 0) chunks.push(event.data) }
      recorder.start(timeslice)
      startedAt = now()
      return true
    },

    /**
     * Stop and collect the take.
     * @returns {Promise<{ blob: Blob, mimeType: string, duration: number }|null>} duration in seconds
     */
    stop() {
      if (!recorder) return Promise.resolve(null)
      const rec = recorder
      const duration = (now() - startedAt) / 1000
      return new Promise((resolve) => {
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType })
          chunks = []
          cleanup()
          resolve({ blob, mimeType, duration })
        }
        if (rec.state === 'inactive') rec.onstop()
        else rec.stop()
      })
    }
  }
}
