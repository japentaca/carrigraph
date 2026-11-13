import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { createEngine, buildScore, INSTRUMENT_NAMES, renderDuration, canRecord } from '../audio/engine/index.js'
import { buildMidiFromScore } from '../audio/midiWriter.js'

/**
 * Thin reactive layer over the audio engine (src/audio/engine).
 * The engine itself lives outside Pinia's state (no reactive proxies around
 * AudioNodes); the store mirrors what the UI needs.
 */

let engine = null
let playheadTimer = null

// Playhead polling period. A plain timer (not requestAnimationFrame) so the
// cursor keeps moving even where rAF is paused (occluded windows); the value
// itself always comes from the audio clock.
const PLAYHEAD_MS = 30

let engineFactory = createEngine

/**
 * Replace how the engine is created (tests pass a factory that builds it on a
 * fake context). Resets the current engine.
 * @param {(opts: { volume, onStateChange }) => object} [factory] default: createEngine
 */
export function setAudioEngineFactory(factory = createEngine) {
  engine?.stop()
  stopPlayhead()
  engine = null
  engineFactory = factory
}

export const useAudioStore = defineStore('audio', {
  state: () => ({
    isPlaying: false,
    /** Step (of the first track) under the playhead, -1 when stopped. */
    currentStep: -1,
    /** Step under the playhead of every track ({ [trackId]: step }); {} when stopped. */
    trackSteps: {},
    /** Global step (since play) under the playhead, -1 when stopped. */
    globalStep: -1,
    tempo: 120,
    /** Global swing 0..1 (transport bar; applied to the compiled score). */
    swing: 0,
    loopEnabled: true,
    masterVolume: 0.7,
    isInitialized: false,
    /** Last score sent to the engine (for the timeline and exports). */
    currentScore: null,
    isExporting: false,
    /** Passes of the score in the WAV/MIDI export. */
    exportRepeats: 1,
    /** Live recording of the master output (Fase 5B). */
    isRecording: false,
    /** Date.now() when the current recording started (0 when not recording). */
    recordingStartedAt: 0
  }),

  getters: {
    availableInstruments: () => [...INSTRUMENT_NAMES],
    /** First track of the current score. */
    currentTrack: (state) => state.currentScore?.tracks?.[0] || null,
    /** All tracks of the current score (timeline). */
    currentTracks: (state) => state.currentScore?.tracks || []
  },

  actions: {
    async initializeAudio() {
      if (this.isInitialized) return true
      try {
        await ensureEngine(this).resume()
        this.isInitialized = true
        return true
      } catch (error) {
        console.error('Failed to initialize audio context:', error)
        return false
      }
    },

    /** Build a score from track specs with the store tempo. */
    buildScore(trackSpecs) {
      return buildScore({ tempo: this.tempo, tracks: trackSpecs })
    },

    /**
     * Start playing a score from the top (loop or one pass, per loopEnabled).
     * @returns {Promise<boolean>} false if there was nothing to play
     */
    async play(score) {
      const e = ensureEngine(this)
      this.currentScore = markRaw(score)
      const ok = await e.play(score, { loop: this.loopEnabled })
      this.isInitialized = true
      this.isPlaying = e.isPlaying()
      if (this.isPlaying) startPlayhead(this)
      return ok
    },

    /**
     * Hot update while playing: notes at the next bar; mix (volume, pan,
     * mute/solo) and effects right away.
     */
    updateScore(score) {
      this.currentScore = markRaw(score)
      if (engine) engine.update(score)
    },

    /** Apply only the mix of a score now (mute/solo, volume, pan, effects). */
    applyMix(score) {
      if (!score) return
      this.currentScore = markRaw(score)
      engine?.applyMix?.(score)
    },

    stop() {
      engine?.stop()
      this.isPlaying = false
      this.currentStep = -1
      this.globalStep = -1
      this.trackSteps = {}
      stopPlayhead()
    },

    /** Compatibility alias (old name). */
    stopPreview() {
      this.stop()
    },

    setMasterVolume(volume) {
      this.masterVolume = Math.max(0, Math.min(1, Number(volume)))
      engine?.setVolume(this.masterVolume)
    },

    setTempo(tempo) {
      this.tempo = Math.max(60, Math.min(200, Math.round(Number(tempo)) || 120))
      engine?.setTempo(this.tempo)
      if (this.currentScore) this.currentScore = markRaw({ ...this.currentScore, tempo: this.tempo })
    },

    /** Global swing 0..1. The score is recompiled with it (usePlayback) and applied live at the next bar. */
    setSwing(amount) {
      const v = Number(amount)
      this.swing = Number.isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 100) / 100)) : 0
    },

    /**
     * Output level now ({ peak, rms, peakDb, rmsDb }), read from the engine's
     * analyser. Not reactive on purpose (the meter polls it). null before the
     * first play.
     */
    getLevel() {
      return engine?.getLevel?.() ?? null
    },

    /** Output waveform (oscilloscope, Fase 4B). Not reactive; null before the first play. */
    getWaveform(target) {
      return engine?.getWaveform?.(target) ?? null
    },

    setExportRepeats(n) {
      const v = Math.round(Number(n))
      this.exportRepeats = Number.isFinite(v) ? Math.min(64, Math.max(1, v)) : 1
    },

    setLoop(enabled) {
      this.loopEnabled = !!enabled
      engine?.setLoop(this.loopEnabled)
    },

    /** Play one note of a voice now (VoiceNode test button). */
    async previewNote(options) {
      const e = ensureEngine(this)
      await e.previewNote(options)
      this.isInitialized = true
    },

    /**
     * Render a score to WAV (same voices and score as playback).
     * @returns {Promise<{ blob: Blob, duration: number }|null>}
     */
    async exportWav(score = this.currentScore, { repeats = 1 } = {}) {
      if (!score || !score.tracks?.length) return null
      this.isExporting = true
      try {
        const blob = await ensureEngine(this).renderWav(score, { repeats })
        return { blob, duration: renderDuration(score, { repeats }).total }
      } catch (error) {
        console.error('Failed to export audio:', error)
        return null
      } finally {
        this.isExporting = false
      }
    },

    /**
     * One WAV per track (with its effects; every track, mute/solo ignored),
     * all as long as the mix.
     * @returns {Promise<{ stems: { track, blob }[], duration: number }|null>}
     */
    async exportStems(score = this.currentScore, { repeats = 1 } = {}) {
      if (!score || !score.tracks?.length) return null
      this.isExporting = true
      try {
        const stems = await ensureEngine(this).renderStems(score, { repeats })
        const all = { ...score, tracks: score.tracks.map(t => ({ ...t, mute: false, solo: false })) }
        return { stems, duration: renderDuration(all, { repeats }).total }
      } catch (error) {
        console.error('Failed to export stems:', error)
        return null
      } finally {
        this.isExporting = false
      }
    },

    /** MIDI Type 1 from the same score (one track and channel per score track). */
    exportMidi(score = this.currentScore, { repeats = 1, name } = {}) {
      if (!score) return null
      const bytes = buildMidiFromScore(score, { repeats, name })
      return bytes ? new Blob([bytes], { type: 'audio/midi' }) : null
    },

    /** Is live recording possible in this browser? */
    canRecord() {
      try {
        return engine ? !!engine.canRecord?.() : canRecord()
      } catch {
        return false
      }
    },

    /**
     * Start recording what the master output plays (Fase 5B). Call from a
     * user gesture (it may create the AudioContext).
     * @returns {Promise<boolean>}
     */
    async startRecording() {
      if (this.isRecording) return false
      try {
        const e = ensureEngine(this)
        const ok = await e.startRecording()
        this.isInitialized = true
        this.isRecording = !!ok
        this.recordingStartedAt = ok ? Date.now() : 0
        return !!ok
      } catch (error) {
        console.error('Failed to start recording:', error)
        this.isRecording = false
        this.recordingStartedAt = 0
        return false
      }
    },

    /** @returns {Promise<{ blob: Blob, mimeType: string, duration: number }|null>} */
    async stopRecording() {
      if (!this.isRecording) return null
      this.isRecording = false
      this.recordingStartedAt = 0
      try {
        return (await engine?.stopRecording?.()) || null
      } catch (error) {
        console.error('Failed to stop recording:', error)
        return null
      }
    },

    /** Called by the engine when its state changes by itself (one-shot end). */
    _onEngineState(state) {
      this.isPlaying = state === 'playing'
      if (!this.isPlaying) {
        this.currentStep = -1
        this.globalStep = -1
        this.trackSteps = {}
        stopPlayhead()
      }
    }
  }
})

function ensureEngine(store) {
  if (!engine) {
    engine = engineFactory({
      volume: store.masterVolume,
      onStateChange: (state) => engine?.__store?._onEngineState(state)
    })
  }
  engine.__store = store
  return engine
}

function startPlayhead(store) {
  stopPlayhead()
  playheadTimer = setInterval(() => {
    if (!engine?.isPlaying()) {
      stopPlayhead()
      return
    }
    const step = engine.getCurrentStep()
    if (step !== store.currentStep) store.currentStep = step
    const pos = engine.getPosition?.()
    const steps = pos && pos.step >= 0 ? pos.trackSteps : {}
    const global = pos && pos.step >= 0 ? pos.step : -1
    if (global !== store.globalStep) store.globalStep = global
    const prev = store.trackSteps
    const keys = Object.keys(steps)
    if (keys.length !== Object.keys(prev).length || keys.some(k => prev[k] !== steps[k])) {
      store.trackSteps = { ...steps }
    }
  }, PLAYHEAD_MS)
}

function stopPlayhead() {
  if (playheadTimer != null) clearInterval(playheadTimer)
  playheadTimer = null
}
