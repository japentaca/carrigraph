/**
 * Audio engine facade: one AudioContext, one output graph, one transport.
 * No Vue / Pinia here; useAudioStore is a thin reactive layer over this.
 */

import { createOutput } from './output.js'
import { createTransport } from './transport.js'
import { renderWav, renderStemsWav } from './render.js'
import { createLevelMeter } from './meter.js'
import { createRecorder, canRecord } from './recorder.js'

export * from './score.js'
export { createVoice, releaseTail, drumPieceForMidi } from './voices.js'
export { createMasterBus, createTrackBus } from './bus.js'
export { createOutput } from './output.js'
export { createTransport } from './transport.js'
export { renderScore, renderWav, renderDuration, encodeWav, renderStems, renderStemsWav, renderTail } from './render.js'
export * from './effects.js'
export { measureLevel, toDb, meterPosition, createLevelMeter, METER_FLOOR_DB } from './meter.js'
export * from './recorder.js'

/**
 * @param {object} [opts]
 * @param {() => AudioContext} [opts.createContext]  lazy; called on first use
 * @param {number} [opts.volume=0.7]
 * @param {(state) => void} [opts.onStateChange]
 * @param {() => void} [opts.onEnd]
 * @param {object} [opts.transportOptions]           extra createTransport options (timers, clock…)
 */
export function createEngine({ createContext, volume = 0.7, onStateChange, onEnd, transportOptions = {} } = {}) {
  let ctx = null
  let output = null
  let transport = null
  let meter = null
  let recorder = null
  let masterVolume = volume

  const makeContext = createContext || (() => {
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!Ctor) throw new Error('Web Audio API not available')
    return new Ctor()
  })

  function ensure() {
    if (ctx) return
    ctx = makeContext()
    output = createOutput(ctx, { volume: masterVolume })
    transport = createTransport({ context: ctx, output, onStateChange, onEnd, ...transportOptions })
    // Level meter on the master output (after the master volume).
    meter = createLevelMeter(ctx, output.master.output)
  }

  return {
    /** Create (if needed) and resume the AudioContext. Call from a user gesture. */
    async resume() {
      ensure()
      if (ctx.state === 'suspended' && ctx.resume) await ctx.resume()
      return ctx
    },
    get context() { return ctx },
    get transport() { return transport },

    /** Start playing a score from the top. loop=false plays one pass. */
    async play(score, { loop = true } = {}) {
      await this.resume()
      return transport.start({ score, loop })
    },
    stop() { transport?.stop() },
    /** Hot score change (notes at the next bar while playing; mix and effects now). */
    update(score) {
      if (!score) return
      ensure()
      transport.setScore(score)
      if (transport.isPlaying()) output.syncTracks(score.tracks)
    },
    /**
     * Apply the mix of a score right away (volume, pan, effects, mute/solo)
     * without touching the notes. No-op before the first play.
     */
    applyMix(score) {
      if (score?.tracks && output) output.syncTracks(score.tracks)
    },
    setTempo(bpm) { transport?.setTempo(bpm) },
    setLoop(loop) { transport?.setLoop(loop) },
    setVolume(v) {
      masterVolume = v
      output?.setVolume(v)
    },
    isPlaying() { return !!transport?.isPlaying() },
    getPosition() { return transport?.getPosition() ?? null },
    getCurrentStep(trackId) { return transport ? transport.getCurrentStep(trackId) : -1 },
    /** Output level now: { peak, rms, peakDb, rmsDb }, or null before the first play / without analyser. */
    getLevel() { return meter ? meter.read() : null },
    /** Output waveform now (Float32Array, -1..1) or null before the first play. Oscilloscope (Fase 4B). */
    getWaveform(target) { return meter ? meter.waveform(target) : null },

    /** Can the live output be recorded here (MediaRecorder + MediaStream destination)? */
    canRecord() { return canRecord({ context: ctx || undefined }) },
    /**
     * Start recording the master output (after the master volume: what is
     * heard, live edits included). Creates the AudioContext if needed, so
     * call it from a user gesture. Fase 5B.
     */
    async startRecording({ Recorder } = {}) {
      await this.resume()
      if (recorder?.isRecording()) return false
      recorder = createRecorder({ context: ctx, source: output.master.output, ...(Recorder ? { Recorder } : {}) })
      return recorder.start()
    },
    /** Stop recording: { blob, mimeType, duration } or null if it was not recording. */
    async stopRecording() {
      const r = recorder
      recorder = null
      return r ? r.stop() : null
    },
    isRecording() { return !!recorder?.isRecording() },
    recordingElapsed() { return recorder ? recorder.elapsed() : 0 },

    /** Play a single note now (VoiceNode "probar sonido"). */
    async previewNote({ instrument = 'Piano', midi = 60, velocity = 0.8, duration = 0.6, volume: vol = 0.8, pan = 0 } = {}) {
      await this.resume()
      const track = { id: `__preview-${instrument}`, instrument, volume: vol, pan }
      output.ensureTrack(track)
      return output.play(track, { midi, velocity, duration, time: ctx.currentTime + 0.02 })
    },

    /** Offline render to a WAV Blob (same voices and score). */
    renderWav(score, { repeats = 1, sampleRate } = {}) {
      return renderWav(score, { repeats, volume: masterVolume, sampleRate: sampleRate || ctx?.sampleRate || 44100 })
    },

    /** One WAV per track (with its effects), all the length of the mix: [{ track, blob }]. */
    renderStems(score, { repeats = 1, sampleRate } = {}) {
      return renderStemsWav(score, { repeats, volume: masterVolume, sampleRate: sampleRate || ctx?.sampleRate || 44100 })
    }
  }
}
