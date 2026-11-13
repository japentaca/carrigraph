import { describe, it, expect } from 'vitest'
import { FakeAudioContext, FakeBuffer } from './helpers/fakeAudioContext.js'
import { buildScore, unrollScore, DRUM_NOTES, INSTRUMENT_NAMES } from '../audio/engine/score.js'
import { createVoice, drumPieceForMidi, getPluckBuffer, releaseTail } from '../audio/engine/voices.js'
import { createMasterBus } from '../audio/engine/bus.js'
import { createOutput } from '../audio/engine/output.js'
import { renderScore, renderDuration, encodeWav } from '../audio/engine/render.js'
import { buildMidiFromScore, parseMidi, TICKS_PER_QUARTER } from '../audio/midiWriter.js'

const score16 = (extra = {}) => buildScore({
  tempo: 120,
  tracks: [{ id: 't1', instrument: 'Piano', pattern: { algorithm: 'euclidean', density: 0.25 }, length: 16, ...extra }]
})

describe('engine/voices', () => {
  it.each(INSTRUMENT_NAMES)('%s se arma sobre cualquier contexto y se detiene', (instrument) => {
    const ctx = new FakeAudioContext()
    const dest = ctx.createGain()
    const midi = instrument === 'Drums' ? DRUM_NOTES.kick : 60
    const v = createVoice(ctx, dest, { instrument, midi, time: 1, duration: 0.2, velocity: 0.8 })
    const sources = ctx.sources()
    expect(sources.length).toBeGreaterThan(0)
    for (const s of sources) {
      expect(s.startTime).toBe(1)
      expect(s.stopTimes[0]).toBeGreaterThan(1)
    }
    expect(v.end).toBeGreaterThan(1)
    expect(v.end).toBeLessThan(1 + 0.2 + releaseTail(instrument) + 0.6)
    v.stop(1.1)
    expect(sources.every(s => s.stopTimes.at(-1) <= 1.1 + 0.1)).toBe(true)
  })

  it('Drums elige la pieza según la nota', () => {
    expect(drumPieceForMidi(36)).toBe('kick')
    expect(drumPieceForMidi(38)).toBe('snare')
    expect(drumPieceForMidi(42)).toBe('hihat')
    expect(drumPieceForMidi(46)).toBe('openhat')
    // kick = oscillator with a pitch sweep; hi-hat = filtered noise only
    const ctx = new FakeAudioContext()
    createVoice(ctx, ctx.destination, { instrument: 'Drums', midi: 36, time: 0 })
    const kickOsc = ctx.nodes.find(n => n.kind === 'oscillator')
    expect(kickOsc.frequency.events.some(e => e[0] === 'exp' && e[1] < 60)).toBe(true)
    const ctx2 = new FakeAudioContext()
    createVoice(ctx2, ctx2.destination, { instrument: 'Drums', midi: 42, time: 0 })
    expect(ctx2.nodes.some(n => n.kind === 'oscillator')).toBe(false)
    expect(ctx2.nodes.filter(n => n.kind === 'biquad').map(f => f.type)).toContain('highpass')
  })

  it('Guitar usa un buffer Karplus-Strong cacheado por nota', () => {
    const ctx = new FakeAudioContext({ sampleRate: 8000 })
    const a = getPluckBuffer(ctx, 52)
    expect(getPluckBuffer(ctx, 52)).toBe(a)
    const data = a.buffer.getChannelData(0)
    const early = Math.max(...data.slice(0, 400).map(Math.abs))
    const late = Math.max(...data.slice(data.length - 400).map(Math.abs))
    expect(early).toBeGreaterThan(0)
    expect(late).toBeLessThan(early) // decays
  })

  it('bus maestro: compresor y volumen en caliente', () => {
    const ctx = new FakeAudioContext()
    const bus = createMasterBus(ctx, { volume: 0.5 })
    expect(bus.output.gain.value).toBe(0.5)
    expect(bus.input.connections).toContain(bus.compressor)
    expect(bus.compressor.connections).toContain(bus.output)
    expect(bus.output.connections).toContain(ctx.destination)
    bus.setVolume(0.2)
    expect(bus.output.gain.events.at(-1)).toEqual(['target', 0.2, 0, 0.02])
  })

  it('output: una voz por nota, bus por pista con volumen y paneo', () => {
    const ctx = new FakeAudioContext()
    const notes = []
    const out = createOutput(ctx, { voiceFactory: (c, dest, note) => { notes.push({ dest, note }); return { end: 1, stop() {} } } })
    const track = { id: 'x', instrument: 'Bass', volume: 0.3, pan: -0.5 }
    out.syncTracks([track])
    out.play(track, { midi: 40, time: 0, duration: 0.1, velocity: 1 })
    expect(notes[0].note.instrument).toBe('Bass')
    expect(notes[0].dest.gain.value).toBe(0.3)
    const panner = ctx.nodes.find(n => n.kind === 'panner')
    expect(panner.pan.value).toBe(-0.5)
    expect(out.activeCount()).toBe(1)
    out.prune(2)
    expect(out.activeCount()).toBe(0)
  })
})

describe('engine/render (OfflineAudioContext inyectado)', () => {
  it('duración completa = pasos × repeticiones + cola de release', () => {
    const score = score16()
    const d1 = renderDuration(score)
    expect(d1.musical).toBeCloseTo(2) // 16 × 0.125 s
    expect(d1.tail).toBeGreaterThan(0.5)
    const d4 = renderDuration(score, { repeats: 4 })
    expect(d4.musical).toBeCloseTo(8)
    expect(d4.total).toBeCloseTo(8 + d1.tail)
    // 512 steps no longer cut at 10 s
    expect(renderDuration(score16({ length: 512 })).musical).toBeCloseTo(64)
  })

  it('renderiza en estéreo, con la misma partitura y las mismas voces', async () => {
    const score = score16()
    let made
    const buffer = await renderScore(score, {
      repeats: 2,
      sampleRate: 8000,
      createContext: (ch, len, sr) => { made = new FakeAudioContext({ channels: ch, length: len, sampleRate: sr }); return made }
    })
    expect(made.channels).toBe(2)
    expect(made.length).toBe(Math.ceil(renderDuration(score, { repeats: 2 }).total * 8000))
    expect(buffer.length).toBe(made.length)
    // one Piano voice (3 oscillators) per event
    const events = unrollScore(score, { repeats: 2 })
    expect(events).toHaveLength(8)
    const oscs = made.nodes.filter(n => n.kind === 'oscillator')
    expect(oscs).toHaveLength(events.length * 3)
    const starts = [...new Set(oscs.map(o => o.startTime))].sort((a, b) => a - b)
    expect(starts).toEqual(events.map(e => e.seconds))
    expect(made.nodes.some(n => n.kind === 'compressor')).toBe(true)
  })

  it('rechaza una partitura vacía', async () => {
    await expect(renderScore(buildScore({ tracks: [] }), { createContext: () => new FakeAudioContext() })).rejects.toThrow()
  })

  it('encodeWav: estéreo, 16 bits, cabecera correcta', () => {
    const buf = new FakeBuffer(2, 100, 44100)
    buf.getChannelData(0).fill(1)
    buf.getChannelData(1).fill(-1)
    const ab = encodeWav(buf)
    const v = new DataView(ab)
    const str = (o, n) => String.fromCharCode(...new Uint8Array(ab, o, n))
    expect(str(0, 4)).toBe('RIFF')
    expect(str(8, 4)).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(2)       // channels
    expect(v.getUint32(24, true)).toBe(44100)   // sample rate
    expect(v.getUint16(34, true)).toBe(16)      // bits
    expect(v.getUint32(40, true)).toBe(100 * 4) // data bytes
    expect(ab.byteLength).toBe(44 + 400)
    expect(v.getInt16(44, true)).toBe(32767)    // L
    expect(v.getInt16(46, true)).toBe(-32768)   // R
    // duration = data / byteRate
    expect(v.getUint32(40, true) / v.getUint32(28, true)).toBeCloseTo(100 / 44100)
  })

  it('encodeWav duplica un buffer mono a los dos canales', () => {
    const buf = new FakeBuffer(1, 4, 8000)
    buf.getChannelData(0).fill(0.5)
    const v = new DataView(encodeWav(buf))
    expect(v.getUint16(22, true)).toBe(2)
    expect(v.getInt16(44, true)).toBe(v.getInt16(46, true))
  })
})

describe('MIDI desde la partitura', () => {
  it('notas, duraciones y velocidades reales', () => {
    const score = buildScore({
      tempo: 100,
      tracks: [{ id: 't1', instrument: 'Bass', pattern: { algorithm: 'euclidean', density: 0.25 }, length: 16, octave: 2, melody: { mode: 'ascending', scale: 'major' } }]
    })
    const bytes = buildMidiFromScore(score)
    const midi = parseMidi(bytes)
    expect(midi.header).toBe('MThd')
    expect(midi.format).toBe(1) // Fase 3B: Type 1 (antes Type 0)
    expect(midi.division).toBe(TICKS_PER_QUARTER)
    expect(midi.tempo).toBe(100)
    const events = score.tracks[0].events
    expect(midi.notes).toHaveLength(events.length)
    midi.notes.forEach((n, i) => {
      const ev = events[i]
      expect(n.note).toBe(ev.midi)
      expect(n.start).toBe(ev.time * 120)
      expect(n.end - n.start).toBe(Math.round(ev.duration * 120))
      expect(n.velocity).toBe(Math.round(ev.velocity * 127))
      expect(n.channel).toBe(0)
    })
    expect(midi.programs).toEqual([{ channel: 0, program: 33 }])
  })

  it('batería en el canal 10 y repeticiones', () => {
    const score = buildScore({ tracks: [{ id: 'd', instrument: 'Drums', pattern: { algorithm: 'euclidean', density: 0.5 }, length: 8 }] })
    const midi = parseMidi(buildMidiFromScore(score, { repeats: 3 }))
    expect(midi.notes).toHaveLength(score.tracks[0].events.length * 3)
    expect(midi.notes.every(n => n.channel === 9)).toBe(true)
    expect(midi.notes.at(-1).start).toBeGreaterThanOrEqual(16 * 120)
  })

  it('sin notas devuelve null', () => {
    const score = buildScore({ tracks: [{ pattern: { algorithm: 'euclidean', density: 0 }, length: 16 }] })
    expect(buildMidiFromScore(score)).toBe(null)
  })
})
