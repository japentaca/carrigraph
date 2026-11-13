/**
 * voices.js — instruments. One function, createVoice(), builds a note on ANY
 * BaseAudioContext (live AudioContext or OfflineAudioContext), so live
 * playback and the WAV export sound the same.
 *
 * Only native Web Audio nodes. No Vue, no Pinia.
 */

import { createRng, midiToFrequency } from './score.js'

/** Seconds a note may keep sounding after its note-off (used for render tail). */
export const RELEASE_TAIL = { Piano: 0.8, Synth: 0.5, Guitar: 0.4, Bass: 0.3, Drums: 0.7 }

export function releaseTail(instrument) {
  return RELEASE_TAIL[instrument] ?? 0.8
}

const noiseCache = new WeakMap()
const pluckCache = new WeakMap()

/** One second of (deterministic) white noise, cached per context. */
export function getNoiseBuffer(ctx) {
  let buf = noiseCache.get(ctx)
  if (buf) return buf
  const len = Math.floor(ctx.sampleRate)
  buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  const rng = createRng('noise')
  for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1
  noiseCache.set(ctx, buf)
  return buf
}

/**
 * Karplus-Strong plucked string, rendered once per (context, note) into an
 * AudioBuffer. Returns { buffer, playbackRate } (rate corrects the integer
 * delay-line tuning error).
 */
export function getPluckBuffer(ctx, midi) {
  let byNote = pluckCache.get(ctx)
  if (!byNote) { byNote = new Map(); pluckCache.set(ctx, byNote) }
  const hit = byNote.get(midi)
  if (hit) return hit

  const sr = ctx.sampleRate
  const freq = midiToFrequency(midi)
  const period = sr / freq
  const N = Math.max(2, Math.floor(period - 0.5))
  const len = Math.floor(sr * 2.5)
  const buf = ctx.createBuffer(1, len, sr)
  const y = buf.getChannelData(0)
  const rng = createRng(`pluck-${midi}`)
  // Excitation: slightly low-passed noise burst.
  let prev = 0
  for (let i = 0; i < N && i < len; i++) {
    const r = rng() * 2 - 1
    prev = prev * 0.5 + r * 0.5
    y[i] = prev
  }
  // Lower notes ring longer.
  const decay = Math.min(0.998, 0.990 + (period / 2000))
  for (let i = N; i < len; i++) {
    y[i] = decay * 0.5 * (y[i - N] + y[i - N - 1 >= 0 ? i - N - 1 : i - N])
  }
  const entry = { buffer: buf, playbackRate: (N + 0.5) / period }
  byNote.set(midi, entry)
  return entry
}

/**
 * ADSR on an AudioParam using setTargetAtTime (no exponential ramps to 0).
 * Returns the time at which the envelope is (practically) silent.
 */
function adsr(param, t, off, { peak, a, d, s, r }) {
  const attackEnd = t + a
  const releaseStart = Math.max(off, attackEnd)
  param.setValueAtTime(0, t)
  param.linearRampToValueAtTime(peak, attackEnd)
  if (releaseStart > attackEnd) param.setTargetAtTime(peak * s, attackEnd, Math.max(0.001, d / 3))
  param.setTargetAtTime(0, releaseStart, Math.max(0.001, r / 4))
  return releaseStart + r * 1.5
}

const velGain = (v) => Math.pow(Math.min(1, Math.max(0, v)), 1.5)

function osc(ctx, type, freq, t, detune = 0) {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (detune) o.detune.setValueAtTime(detune, t)
  return o
}

function gainNode(ctx, value = 1) {
  const g = ctx.createGain()
  g.gain.value = value
  return g
}

function filter(ctx, type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  return f
}

function noiseSource(ctx) {
  const src = ctx.createBufferSource()
  src.buffer = getNoiseBuffer(ctx)
  src.loop = true
  return src
}

// --- Instruments --------------------------------------------------------

function piano(ctx, out, { freq, t, off, vel }) {
  const amp = gainNode(ctx, 0)
  const lp = filter(ctx, 'lowpass', 1200)
  lp.frequency.setValueAtTime(1500 + 5000 * vel, t)
  lp.frequency.setTargetAtTime(900 + 600 * vel, t + 0.01, 0.4)
  lp.connect(amp).connect(out)
  const partials = [
    osc(ctx, 'triangle', freq, t),
    osc(ctx, 'sine', freq * 2, t, 3),
    osc(ctx, 'sine', freq * 3, t, -4)
  ]
  const levels = [0.6, 0.22, 0.08]
  partials.forEach((o, i) => o.connect(gainNode(ctx, levels[i])).connect(lp))
  // Piano strings decay even while held.
  const end = adsr(amp.gain, t, off, { peak: 0.55 * velGain(vel), a: 0.004, d: 1.6, s: 0.15, r: 0.35 })
  return { sources: partials, output: amp, end }
}

function synth(ctx, out, { freq, t, off, vel }) {
  const amp = gainNode(ctx, 0)
  const lp = filter(ctx, 'lowpass', 800, 5)
  lp.frequency.setValueAtTime(600, t)
  lp.frequency.linearRampToValueAtTime(800 + 4500 * vel, t + 0.02)
  lp.frequency.setTargetAtTime(1400, t + 0.02, 0.15)
  lp.connect(amp).connect(out)
  const sources = [
    osc(ctx, 'sawtooth', freq, t, -8),
    osc(ctx, 'sawtooth', freq, t, 8),
    osc(ctx, 'square', freq / 2, t)
  ]
  const levels = [0.3, 0.3, 0.18]
  sources.forEach((o, i) => o.connect(gainNode(ctx, levels[i])).connect(lp))
  const end = adsr(amp.gain, t, off, { peak: 0.45 * velGain(vel), a: 0.01, d: 0.25, s: 0.6, r: 0.25 })
  return { sources, output: amp, end }
}

function bass(ctx, out, { freq, t, off, vel }) {
  const amp = gainNode(ctx, 0)
  const lp = filter(ctx, 'lowpass', 300, 7)
  lp.frequency.setValueAtTime(200, t)
  lp.frequency.linearRampToValueAtTime(500 + 1500 * vel, t + 0.01)
  lp.frequency.setTargetAtTime(320, t + 0.01, 0.08)
  lp.connect(amp).connect(out)
  const sources = [osc(ctx, 'sawtooth', freq, t), osc(ctx, 'sine', freq, t)]
  const levels = [0.35, 0.6]
  sources.forEach((o, i) => o.connect(gainNode(ctx, levels[i])).connect(lp))
  const end = adsr(amp.gain, t, off, { peak: 0.6 * velGain(vel), a: 0.004, d: 0.2, s: 0.7, r: 0.12 })
  return { sources, output: amp, end }
}

function guitar(ctx, out, { midi, t, off, vel }) {
  const { buffer, playbackRate } = getPluckBuffer(ctx, midi)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = playbackRate
  const amp = gainNode(ctx, 0)
  const lp = filter(ctx, 'lowpass', 2500 + 3000 * vel)
  src.connect(lp).connect(amp).connect(out)
  const end = adsr(amp.gain, t, off, { peak: 0.8 * velGain(vel), a: 0.002, d: 2, s: 0.9, r: 0.15 })
  return { sources: [src], output: amp, end: Math.min(end, t + buffer.duration / playbackRate) }
}

function kick(ctx, out, { t, vel }) {
  const amp = gainNode(ctx, 0)
  amp.connect(out)
  const body = osc(ctx, 'sine', 160, t)
  body.frequency.exponentialRampToValueAtTime(45, t + 0.12)
  body.connect(amp)
  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(1.0 * velGain(vel), t + 0.002)
  amp.gain.setTargetAtTime(0, t + 0.002, 0.12)
  // Beater click
  const click = noiseSource(ctx)
  const clickAmp = gainNode(ctx, 0)
  const hp = filter(ctx, 'highpass', 3000)
  click.connect(hp).connect(clickAmp).connect(out)
  clickAmp.gain.setValueAtTime(0.25 * velGain(vel), t)
  clickAmp.gain.setTargetAtTime(0, t, 0.004)
  return { sources: [body, click], output: amp, extraOutputs: [clickAmp], end: t + 0.7 }
}

function snare(ctx, out, { t, vel }) {
  const noise = noiseSource(ctx)
  const hp = filter(ctx, 'highpass', 900)
  const bp = filter(ctx, 'bandpass', 3000, 0.6)
  const noiseAmp = gainNode(ctx, 0)
  noise.connect(hp).connect(bp).connect(noiseAmp).connect(out)
  noiseAmp.gain.setValueAtTime(0, t)
  noiseAmp.gain.linearRampToValueAtTime(0.7 * velGain(vel), t + 0.002)
  noiseAmp.gain.setTargetAtTime(0, t + 0.002, 0.06)
  const body = osc(ctx, 'triangle', 200, t)
  body.frequency.exponentialRampToValueAtTime(150, t + 0.08)
  const bodyAmp = gainNode(ctx, 0)
  body.connect(bodyAmp).connect(out)
  bodyAmp.gain.setValueAtTime(0, t)
  bodyAmp.gain.linearRampToValueAtTime(0.5 * velGain(vel), t + 0.002)
  bodyAmp.gain.setTargetAtTime(0, t + 0.002, 0.04)
  return { sources: [noise, body], output: noiseAmp, extraOutputs: [bodyAmp], end: t + 0.45 }
}

function hihat(ctx, out, { t, vel }, open = false) {
  const noise = noiseSource(ctx)
  const hp = filter(ctx, 'highpass', 7000)
  const bp = filter(ctx, 'bandpass', 10000, 0.8)
  const amp = gainNode(ctx, 0)
  noise.connect(hp).connect(bp).connect(amp).connect(out)
  const tc = open ? 0.12 : 0.02
  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(0.45 * velGain(vel), t + 0.001)
  amp.gain.setTargetAtTime(0, t + 0.001, tc)
  return { sources: [noise], output: amp, end: t + tc * 6 }
}

/** Drum piece for a MIDI note (GM-ish: 35/36 kick, 37–40 snare, 46 open hat). */
export function drumPieceForMidi(midi) {
  if (midi <= 36) return 'kick'
  if (midi <= 40) return 'snare'
  if (midi === 46) return 'openhat'
  return 'hihat'
}

function drums(ctx, out, p) {
  switch (drumPieceForMidi(p.midi)) {
    case 'kick': return kick(ctx, out, p)
    case 'snare': return snare(ctx, out, p)
    case 'openhat': return hihat(ctx, out, p, true)
    default: return hihat(ctx, out, p, false)
  }
}

const BUILDERS = { Piano: piano, Synth: synth, Guitar: guitar, Bass: bass, Drums: drums }

/**
 * Build and schedule one note.
 *
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} destination  where the note goes (track bus input)
 * @param {object} note { instrument, midi, time (s, context time), duration (s), velocity 0..1 }
 * @returns {{ end: number, stop: (when?: number) => void }}
 *   end: context time when the note is silent; stop(): fast fade + stop.
 */
export function createVoice(ctx, destination, { instrument = 'Piano', midi = 60, time = 0, duration = 0.25, velocity = 0.8 } = {}) {
  const build = BUILDERS[instrument] || piano
  const t = Math.max(time, 0)
  const off = t + Math.max(0.01, duration)
  const voice = build(ctx, destination, { midi, freq: midiToFrequency(midi), t, off, vel: velocity })
  const stopAt = voice.end + 0.05
  for (const src of voice.sources) {
    src.start(t)
    src.stop(stopAt)
  }
  const outputs = [voice.output, ...(voice.extraOutputs || [])]
  let stopped = false
  return {
    end: voice.end,
    stop(when = ctx.currentTime) {
      if (stopped) return
      stopped = true
      for (const g of outputs) {
        try {
          if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(when)
          else g.gain.cancelScheduledValues(when)
          g.gain.setTargetAtTime(0, when, 0.01)
        } catch { /* already gone */ }
      }
      for (const src of voice.sources) {
        try { src.stop(when + 0.06) } catch { /* not started or already stopped */ }
      }
    }
  }
}
