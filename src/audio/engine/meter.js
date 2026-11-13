/**
 * meter.js — output level meter (Fase 4A). Pure helpers plus a tap on the
 * master output with an AnalyserNode (live context only; the offline render
 * does not create one). No Vue / Pinia.
 */

/** Silence floor of the meter, dBFS. */
export const METER_FLOOR_DB = -60

/**
 * Peak and RMS of a block of samples (linear, 0..1+).
 * @param {ArrayLike<number>} samples
 * @returns {{ peak: number, rms: number }}
 */
export function measureLevel(samples) {
  const n = samples?.length || 0
  if (!n) return { peak: 0, rms: 0 }
  let peak = 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = Number(samples[i]) || 0
    const a = Math.abs(v)
    if (a > peak) peak = a
    sum += v * v
  }
  return { peak, rms: Math.sqrt(sum / n) }
}

/** Linear amplitude → dBFS, floored at METER_FLOOR_DB. */
export function toDb(value, floor = METER_FLOOR_DB) {
  if (!(value > 0)) return floor
  return Math.max(floor, 20 * Math.log10(value))
}

/** dBFS → 0..1 position on a meter whose bottom is `floor`. */
export function meterPosition(db, floor = METER_FLOOR_DB) {
  if (!Number.isFinite(db)) return 0
  return Math.min(1, Math.max(0, (db - floor) / -floor))
}

/**
 * Tap `source` (e.g. the master output gain) with an AnalyserNode.
 * The analyser is not connected to anything downstream: it only listens.
 * @returns {{ analyser, read(): { peak, rms, peakDb, rmsDb }, disconnect() } | null}
 *   null when the context cannot create analysers.
 */
export function createLevelMeter(ctx, source, { fftSize = 1024 } = {}) {
  if (!ctx?.createAnalyser || !source) return null
  const analyser = ctx.createAnalyser()
  analyser.fftSize = fftSize
  source.connect(analyser)
  const buffer = new Float32Array(analyser.fftSize || fftSize)
  return {
    analyser,
    read() {
      if (analyser.getFloatTimeDomainData) analyser.getFloatTimeDomainData(buffer)
      const { peak, rms } = measureLevel(buffer)
      return { peak, rms, peakDb: toDb(peak), rmsDb: toDb(rms) }
    },
    /**
     * Current waveform (time domain, -1..1) for an oscilloscope (Fase 4B).
     * Fills and returns `target` (or a new Float32Array of the analyser size).
     */
    waveform(target) {
      const out = target || new Float32Array(analyser.fftSize || fftSize)
      if (analyser.getFloatTimeDomainData) analyser.getFloatTimeDomainData(out)
      return out
    },
    disconnect() {
      try { source.disconnect(analyser) } catch { /* ignore */ }
    }
  }
}
