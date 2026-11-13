/**
 * effects.js — per-track insert effects on ANY BaseAudioContext (live
 * AudioContext or OfflineAudioContext), so live playback and the WAV export
 * run the very same chain.
 *
 * Effect spec (what the graph compiler puts in `track.effects`, in order):
 *   { id, type: 'distortion'|'filter'|'delay'|'reverb', amount (0..1, wet mix), ...params }
 *     distortion: drive (0..1), tone (Hz, low-pass after the shaper)
 *     filter:     mode ('lowpass'|'highpass'|'bandpass'), cutoff (Hz), resonance (Q)
 *     delay:      time (s), feedback (0..0.9)
 *     reverb:     decay (s; generated impulse response)
 *
 * Every effect is a dry/wet unit with an equal-power crossfade:
 *   input ─┬─ dry (cos) ──────────────┬→ output
 *          └─ processor → wet (sin) ──┘
 *
 * Pure helpers (normalizeEffect, effectTail, effectsTail, chainSignature,
 * distortionCurve) need no AudioContext. No Vue, no Pinia.
 */

import { createRng } from './score.js'

export const EFFECT_TYPES = ['distortion', 'filter', 'delay', 'reverb']
export const FILTER_MODES = ['lowpass', 'highpass', 'bandpass']

export const EFFECT_DEFAULTS = {
  distortion: { amount: 0.5, drive: 0.5, tone: 6000 },
  filter: { amount: 1, mode: 'lowpass', cutoff: 1200, resonance: 1 },
  delay: { amount: 0.35, time: 0.375, feedback: 0.4 },
  reverb: { amount: 0.3, decay: 2.5 }
}

/** Parameter ranges (also used by the UI). */
export const EFFECT_RANGES = {
  amount: [0, 1],
  drive: [0, 1],
  tone: [500, 12000],
  cutoff: [40, 18000],
  resonance: [0.1, 20],
  time: [0.02, 1.5],
  feedback: [0, 0.9],
  decay: [0.2, 8]
}

/** Longest effect tail taken into account by the render (seconds). */
export const MAX_EFFECT_TAIL = 12

const MAX_DELAY_TIME = 2
const SMOOTH = 0.02 // setTargetAtTime time constant for live changes

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = (v, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const ranged = (name, v, fallback) => clamp(num(v, fallback), ...EFFECT_RANGES[name])

/**
 * Clean, clamped copy of an effect spec, or null if the type is unknown.
 * @param {object} spec
 * @param {number} [index] used for the id when the spec has none
 */
export function normalizeEffect(spec, index = 0) {
  if (!spec || !EFFECT_TYPES.includes(spec.type)) return null
  const d = EFFECT_DEFAULTS[spec.type]
  const base = {
    id: spec.id != null ? String(spec.id) : `${spec.type}-${index}`,
    type: spec.type,
    amount: ranged('amount', spec.amount, d.amount)
  }
  switch (spec.type) {
    case 'distortion':
      return { ...base, drive: ranged('drive', spec.drive, d.drive), tone: ranged('tone', spec.tone, d.tone) }
    case 'filter':
      return {
        ...base,
        mode: FILTER_MODES.includes(spec.mode) ? spec.mode : d.mode,
        cutoff: ranged('cutoff', spec.cutoff, d.cutoff),
        resonance: ranged('resonance', spec.resonance, d.resonance)
      }
    case 'delay':
      return { ...base, time: ranged('time', spec.time, d.time), feedback: ranged('feedback', spec.feedback, d.feedback) }
    case 'reverb':
      return { ...base, decay: ranged('decay', spec.decay, d.decay) }
    default:
      return null
  }
}

export function normalizeEffects(effects) {
  return (Array.isArray(effects) ? effects : []).map(normalizeEffect).filter(Boolean)
}

/**
 * Seconds an effect keeps sounding after its input stops.
 *  - reverb: its decay (impulse length)
 *  - delay: until the echoes fall 60 dB (time × log(0.001)/log(feedback))
 */
export function effectTail(spec) {
  const e = normalizeEffect(spec)
  if (!e || e.amount <= 0) return 0
  if (e.type === 'reverb') return e.decay
  if (e.type === 'delay') {
    if (e.feedback <= 0.001) return e.time
    const repeats = Math.log(0.001) / Math.log(e.feedback)
    return Math.min(MAX_EFFECT_TAIL, e.time * (repeats + 1))
  }
  return 0
}

/** Tail of a chain: tails add up (a delay feeding a reverb rings for both). */
export function effectsTail(effects) {
  const total = normalizeEffects(effects).reduce((s, e) => s + effectTail(e), 0)
  return Math.min(MAX_EFFECT_TAIL, total)
}

/**
 * What forces a chain rebuild (anything else is a live parameter change):
 * the effect ids/types in order, and the reverb decay (a new impulse).
 */
export function chainSignature(effects) {
  return normalizeEffects(effects)
    .map(e => (e.type === 'reverb' ? `${e.id}:${e.type}:${e.decay.toFixed(1)}` : `${e.id}:${e.type}`))
    .join('|')
}

/** Soft-clipping curve: y = (1 + k)·x / (1 + k·|x|), k = drive × 20. */
export function distortionCurve(drive, samples = 1024) {
  const k = clamp(num(drive, 0.5), 0, 1) * 20
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return curve
}

const impulseCache = new WeakMap()

/**
 * Gain after the shaper so that turning the drive up saturates without a big
 * jump in loudness (the curve's small-signal gain is 1 + k).
 */
export function distortionMakeup(drive) {
  return 1 / (1 + 5 * clamp(num(drive, 0.5), 0, 1))
}

/**
 * Stereo impulse response: decaying noise reaching −60 dB at `decay`
 * seconds, slightly different per channel. Deterministic (seeded), cached
 * per context and decay (rounded to 0.1 s).
 */
export function getImpulseResponse(ctx, decay) {
  const d = Math.round(ranged('decay', decay, EFFECT_DEFAULTS.reverb.decay) * 10) / 10
  let byDecay = impulseCache.get(ctx)
  if (!byDecay) { byDecay = new Map(); impulseCache.set(ctx, byDecay) }
  const hit = byDecay.get(d)
  if (hit) return hit
  const sr = ctx.sampleRate
  const len = Math.max(1, Math.floor(sr * d))
  const buf = ctx.createBuffer(2, len, sr)
  const preDelay = Math.floor(sr * 0.012)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    const rng = createRng(`reverb-${d}-${ch}`)
    for (let i = preDelay; i < len; i++) {
      const t = (i - preDelay) / sr
      data[i] = (rng() * 2 - 1) * Math.pow(10, (-3 * t) / d)
    }
  }
  byDecay.set(d, buf)
  return buf
}

function setParam(param, value, ctx, immediate) {
  if (immediate) { param.value = value; return }
  try {
    param.setTargetAtTime(value, ctx.currentTime, SMOOTH)
  } catch {
    param.value = value
  }
}

const dryGain = (amount) => Math.cos((amount * Math.PI) / 2)
const wetGain = (amount) => Math.sin((amount * Math.PI) / 2)

/**
 * Build one effect unit.
 * @returns {{ id, type, input, output, update(spec), dispose() }}
 */
export function createEffect(ctx, rawSpec) {
  let spec = normalizeEffect(rawSpec)
  if (!spec) throw new Error(`Unknown effect: ${rawSpec?.type}`)
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  input.connect(dry)
  dry.connect(output)
  wet.connect(output)
  const nodes = [input, output, dry, wet]
  let apply // (spec, immediate) → void, processor parameters

  switch (spec.type) {
    case 'distortion': {
      const shaper = ctx.createWaveShaper()
      shaper.oversample = '4x'
      const makeup = ctx.createGain()
      const tone = ctx.createBiquadFilter()
      tone.type = 'lowpass'
      input.connect(shaper)
      shaper.connect(makeup)
      makeup.connect(tone)
      tone.connect(wet)
      nodes.push(shaper, makeup, tone)
      let lastDrive = null
      apply = (s, immediate) => {
        if (s.drive !== lastDrive) { shaper.curve = distortionCurve(s.drive); lastDrive = s.drive }
        setParam(makeup.gain, distortionMakeup(s.drive), ctx, immediate)
        setParam(tone.frequency, s.tone, ctx, immediate)
      }
      break
    }
    case 'filter': {
      const filter = ctx.createBiquadFilter()
      input.connect(filter)
      filter.connect(wet)
      nodes.push(filter)
      apply = (s, immediate) => {
        filter.type = s.mode
        setParam(filter.frequency, s.cutoff, ctx, immediate)
        setParam(filter.Q, s.resonance, ctx, immediate)
      }
      break
    }
    case 'delay': {
      const delay = ctx.createDelay(MAX_DELAY_TIME)
      const feedback = ctx.createGain()
      const damp = ctx.createBiquadFilter() // darker echoes
      damp.type = 'lowpass'
      damp.frequency.value = 5000
      input.connect(delay)
      delay.connect(wet)
      delay.connect(damp)
      damp.connect(feedback)
      feedback.connect(delay)
      nodes.push(delay, feedback, damp)
      apply = (s, immediate) => {
        setParam(delay.delayTime, s.time, ctx, immediate)
        setParam(feedback.gain, s.feedback, ctx, immediate)
      }
      break
    }
    case 'reverb': {
      const convolver = ctx.createConvolver()
      convolver.buffer = getImpulseResponse(ctx, spec.decay)
      input.connect(convolver)
      convolver.connect(wet)
      nodes.push(convolver)
      apply = () => {} // decay changes rebuild the chain (see chainSignature)
      break
    }
  }

  const applyAll = (s, immediate) => {
    setParam(dry.gain, dryGain(s.amount), ctx, immediate)
    setParam(wet.gain, wetGain(s.amount), ctx, immediate)
    apply(s, immediate)
  }
  applyAll(spec, true)

  return {
    id: spec.id,
    type: spec.type,
    input,
    output,
    get spec() { return spec },
    /** Live parameter change (smoothed, no cut). */
    update(raw) {
      const next = normalizeEffect({ ...raw, id: spec.id, type: spec.type })
      if (!next) return
      spec = next
      applyAll(spec, false)
    },
    dispose() {
      for (const n of nodes) {
        try { n.disconnect() } catch { /* ignore */ }
      }
    }
  }
}

/**
 * A chain of effects in series: input → e1 → e2 → … → output. An empty
 * chain is a single pass-through gain.
 * @returns {{ input, output, signature, effects, update(effects), tail(), dispose() }}
 */
export function createEffectChain(ctx, rawEffects = []) {
  const specs = normalizeEffects(rawEffects)
  const units = specs.map(s => createEffect(ctx, s))
  const input = ctx.createGain()
  const output = ctx.createGain()
  let prev = input
  for (const u of units) { prev.connect(u.input); prev = u.output }
  prev.connect(output)
  let current = specs
  return {
    input,
    output,
    signature: chainSignature(specs),
    get effects() { return current },
    /** Live update; the caller must rebuild when chainSignature() changes. */
    update(effects) {
      const next = normalizeEffects(effects)
      next.forEach((s, i) => units[i]?.update(s))
      current = next
    },
    tail() { return effectsTail(current) },
    dispose() {
      for (const u of units) u.dispose()
      for (const n of [input, output]) {
        try { n.disconnect() } catch { /* ignore */ }
      }
    }
  }
}
