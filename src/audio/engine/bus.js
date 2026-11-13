/**
 * bus.js — master bus and per-track buses. Works on any BaseAudioContext.
 *
 *   track voices → track bus (volume → effects → pan → mute) ─┐
 *   track voices → track bus (volume → effects → pan → mute) ─┼→ master: headroom → compressor → volume → destination
 */

import { createEffectChain, chainSignature } from './effects.js'

/**
 * @param {BaseAudioContext} ctx
 * @param {{ volume?: number, destination?: AudioNode }} opts
 * @returns {{ input: AudioNode, output: AudioNode, compressor: DynamicsCompressorNode,
 *             setVolume(v: number): void, disconnect(): void }}
 */
export function createMasterBus(ctx, { volume = 0.7, destination = ctx.destination } = {}) {
  const input = ctx.createGain()
  input.gain.value = 0.7 // headroom before the compressor

  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -12
  compressor.knee.value = 10
  compressor.ratio.value = 4
  compressor.attack.value = 0.003
  compressor.release.value = 0.25

  const output = ctx.createGain()
  output.gain.value = clamp01(volume)

  input.connect(compressor)
  compressor.connect(output)
  output.connect(destination)

  return {
    input,
    output,
    compressor,
    /** Change the master volume live (short smoothing, no clicks). */
    setVolume(v) {
      const value = clamp01(v)
      try {
        output.gain.setTargetAtTime(value, ctx.currentTime, 0.02)
      } catch {
        output.gain.value = value
      }
    },
    disconnect() {
      for (const n of [input, compressor, output]) {
        try { n.disconnect() } catch { /* ignore */ }
      }
    }
  }
}

/**
 * One track's bus:
 *
 *   voices → input (volume) → effect chain → panner → mute gain → destination
 *
 * `set()` changes everything live: volume/pan/mute with short smoothing; the
 * effect parameters in place; and, when the chain's structure changes (an
 * effect added, removed or reordered, or a new reverb decay), a new chain is
 * built and crossfaded in (~50 ms) while the old one fades out and is
 * disconnected later. So nothing is cut and the same bus works offline.
 *
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} destination  usually master.input
 * @param {{ volume?: number, pan?: number, effects?: object[], audible?: boolean,
 *           timers?: { setTimeout: Function } }} opts
 */
export function createTrackBus(ctx, destination, { volume = 0.8, pan = 0, effects = [], audible = true, timers } = {}) {
  const later = timers?.setTimeout || ((fn, ms) => globalThis.setTimeout?.(fn, ms))
  const input = ctx.createGain()
  input.gain.value = clamp01(volume)
  const muteGain = ctx.createGain()
  muteGain.gain.value = audible ? 1 : 0
  muteGain.connect(destination)
  const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null
  const post = panner || muteGain
  if (panner) {
    panner.pan.value = clampPan(pan)
    panner.connect(muteGain)
  }

  let isAudible = !!audible
  let slot = mountChain(effects, true)

  /** chain + its crossfade gain, connected between input and post. */
  function mountChain(fx, immediate) {
    const chain = createEffectChain(ctx, fx)
    const fade = ctx.createGain()
    input.connect(chain.input)
    chain.output.connect(fade)
    fade.connect(post)
    if (immediate) {
      fade.gain.value = 1
    } else {
      fade.gain.value = 0
      fade.gain.setValueAtTime(0, ctx.currentTime)
      fade.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.05)
    }
    return { chain, fade }
  }

  function unmountChain(old) {
    try {
      old.fade.gain.setValueAtTime(old.fade.gain.value, ctx.currentTime)
      old.fade.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05)
    } catch {
      old.fade.gain.value = 0
    }
    const drop = () => {
      try { input.disconnect(old.chain.input) } catch { /* ignore */ }
      old.chain.dispose()
      try { old.fade.disconnect() } catch { /* ignore */ }
    }
    later(drop, 300)
  }

  return {
    input,
    get chain() { return slot.chain },
    get audible() { return isAudible },
    set({ volume: v, pan: p, effects: fx, audible: a } = {}) {
      const now = ctx.currentTime
      if (v != null) input.gain.setTargetAtTime(clamp01(v), now, 0.02)
      if (p != null && panner) panner.pan.setTargetAtTime(clampPan(p), now, 0.02)
      if (a != null && !!a !== isAudible) {
        isAudible = !!a
        muteGain.gain.setTargetAtTime(isAudible ? 1 : 0, now, 0.015)
      }
      if (fx != null) {
        if (chainSignature(fx) === slot.chain.signature) {
          slot.chain.update(fx)
        } else {
          const old = slot
          slot = mountChain(fx, false)
          unmountChain(old)
        }
      }
    },
    /** Seconds the effects keep ringing after the last note. */
    tail() { return slot.chain.tail() },
    disconnect() {
      try { input.disconnect() } catch { /* ignore */ }
      slot.chain.dispose()
      try { slot.fade.disconnect() } catch { /* ignore */ }
      try { panner?.disconnect() } catch { /* ignore */ }
      try { muteGain.disconnect() } catch { /* ignore */ }
    }
  }
}

function clamp01(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.7
}

function clampPan(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(-1, n)) : 0
}
