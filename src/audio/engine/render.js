/**
 * render.js — offline render of a score to a stereo 16-bit WAV, using the
 * same voices, buses and score as live playback.
 */

import { scoreLength, stepDuration, unrollScore, isTrackAudible } from './score.js'
import { createOutput } from './output.js'
import { releaseTail } from './voices.js'
import { effectsTail } from './effects.js'

/**
 * Extra seconds after the last step so releases, effect tails (reverb,
 * delay) and the compressor settle. Only tracks heard in the mix count.
 */
export function renderTail(score) {
  const tracks = (score?.tracks || []).filter(t => isTrackAudible(t, score.tracks))
  let tail = 0
  for (const t of tracks) tail = Math.max(tail, releaseTail(t.instrument) + effectsTail(t.effects))
  return tail + 0.25
}

/**
 * Duration of the render, in seconds. A pass is scoreLength(score) steps
 * (the longest track, muted or not, like the live transport).
 * @returns {{ musical: number, tail: number, total: number, steps: number }}
 */
export function renderDuration(score, { repeats = 1 } = {}) {
  const r = Math.max(1, Math.round(Number(repeats) || 1))
  const steps = scoreLength(score) * r
  const musical = steps * stepDuration(score.tempo, score.stepsPerBeat)
  const tail = renderTail(score)
  return { musical, tail, total: musical + tail, steps }
}

/**
 * Render a score offline: same output graph (track buses with their effect
 * chains, mute/solo, master bus) and same voices as live playback. Muted
 * tracks (or not soloed, when a solo is active) are left out.
 *
 * @param {object} score
 * @param {object} [opts]
 * @param {number} [opts.repeats=1]       passes of the score
 * @param {number} [opts.sampleRate=44100]
 * @param {number} [opts.volume=0.7]      master volume
 * @param {number} [opts.totalSteps]      override: steps to play (stems use the full mix length)
 * @param {number} [opts.duration]        override: seconds to render (stems: all the same length)
 * @param {(channels: number, length: number, sampleRate: number) => OfflineAudioContext} [opts.createContext]
 * @returns {Promise<AudioBuffer>}
 */
export async function renderScore(score, { repeats = 1, sampleRate = 44100, volume = 0.7, totalSteps, duration, createContext } = {}) {
  if (!score || scoreLength(score) === 0) throw new Error('Empty score')
  const total = Number.isFinite(duration) && duration > 0 ? duration : renderDuration(score, { repeats }).total
  const length = Math.ceil(total * sampleRate)
  const make = createContext || ((ch, len, sr) => new OfflineAudioContext(ch, len, sr))
  const ctx = make(2, length, sampleRate)
  const output = createOutput(ctx, { volume })
  output.syncTracks(score.tracks)
  const byId = new Map(score.tracks.map(t => [t.id, t]))
  const audible = new Set(score.tracks.filter(t => isTrackAudible(t, score.tracks)).map(t => t.id))
  for (const ev of unrollScore(score, { repeats, totalSteps })) {
    if (!audible.has(ev.track)) continue
    output.play(byId.get(ev.track), {
      midi: ev.midi,
      velocity: ev.velocity,
      time: ev.seconds,
      duration: ev.durationSeconds
    })
  }
  return ctx.startRendering()
}

/**
 * One render per track ("stems"): each track alone, with its volume, pan
 * and effects, through the same master bus. Every stem has the same length
 * (the mix length, with the longest tail of any track) so they line up in a
 * DAW. Mute/solo do not apply: every track gets its stem.
 *
 * @returns {Promise<{ track: object, buffer: AudioBuffer }[]>}
 */
export async function renderStems(score, opts = {}) {
  if (!score || scoreLength(score) === 0) throw new Error('Empty score')
  const all = score.tracks.map(t => ({ ...t, mute: false, solo: false }))
  const { total, steps } = renderDuration({ ...score, tracks: all }, opts)
  const out = []
  for (const track of all) {
    const buffer = await renderScore({ ...score, tracks: [track] }, { ...opts, totalSteps: steps, duration: total })
    out.push({ track: score.tracks.find(t => t.id === track.id), buffer })
  }
  return out
}

/**
 * Encode an AudioBuffer (or anything with numberOfChannels, sampleRate,
 * length and getChannelData) as a stereo 16-bit PCM WAV. Mono input is
 * duplicated to both channels.
 * @returns {ArrayBuffer}
 */
export function encodeWav(buffer) {
  const channels = 2
  const { sampleRate, length } = buffer
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  const bytesPerSample = 2
  const dataSize = length * channels * bytesPerSample
  const ab = new ArrayBuffer(44 + dataSize)
  const view = new DataView(ab)
  const writeString = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)) }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)                                   // fmt chunk size
  view.setUint16(20, 1, true)                                    // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bytesPerSample, true) // byte rate
  view.setUint16(32, channels * bytesPerSample, true)            // block align
  view.setUint16(34, 16, true)                                   // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < length; i++) {
    for (const data of [left, right]) {
      const s = Math.max(-1, Math.min(1, data[i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }
  return ab
}

/** Render + encode. Returns a Blob('audio/wav'). */
export async function renderWav(score, opts = {}) {
  const buffer = await renderScore(score, opts)
  return new Blob([encodeWav(buffer)], { type: 'audio/wav' })
}

/** Stems + encode. Returns [{ track, blob }]. */
export async function renderStemsWav(score, opts = {}) {
  const stems = await renderStems(score, opts)
  return stems.map(({ track, buffer }) => ({ track, blob: new Blob([encodeWav(buffer)], { type: 'audio/wav' }) }))
}
