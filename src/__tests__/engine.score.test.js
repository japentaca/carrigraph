import { describe, it, expect } from 'vitest'
import {
  buildRhythm, buildMelody, buildTrack, buildScore, scoreLength, unrollScore,
  eventsAtStep, createRng, rootToPitchClass, SCALES, DRUM_NOTES, stepDuration
} from '../audio/engine/score.js'
import { generatePattern } from '../audio/patternGenerators.js'

describe('engine/score — Length y Loop', () => {
  it('genera el patrón con loop pasos y lo repite hasta length', () => {
    const steps = buildRhythm({ algorithm: 'euclidean', density: 0.5, length: 16, loop: 4 })
    const cell = generatePattern('euclidean', 4, 0.5, 0, 0)
    expect(steps).toHaveLength(16)
    for (let i = 0; i < 16; i++) expect(steps[i]).toBe(cell[i % 4])
  })

  it('si loop >= length genera directamente con length', () => {
    const direct = generatePattern('random', 12, 0.4, 0, 0.3)
    expect(buildRhythm({ algorithm: 'random', density: 0.4, seed: 0.3, length: 12, loop: 12 })).toEqual(direct)
    expect(buildRhythm({ algorithm: 'random', density: 0.4, seed: 0.3, length: 12, loop: 64 })).toEqual(direct)
  })

  it('sin loop usa la longitud completa', () => {
    expect(buildRhythm({ algorithm: 'euclidean', density: 0.25, length: 32 })).toEqual(
      generatePattern('euclidean', 32, 0.25, 0, 0)
    )
  })

  it('length no múltiplo de loop: la última repetición queda cortada', () => {
    const steps = buildRhythm({ algorithm: 'euclidean', density: 0.5, length: 10, loop: 4 })
    const cell = generatePattern('euclidean', 4, 0.5, 0, 0)
    expect(steps).toHaveLength(10)
    expect(steps.slice(8)).toEqual(cell.slice(0, 2))
  })
})

describe('engine/score — melodía', () => {
  const opts = { root: 'C', scale: 'major', octave: 4, range: 1 }

  it('nota fija: siempre la tónica', () => {
    expect(buildMelody(6, { ...opts, mode: 'fixed' })).toEqual([60, 60, 60, 60, 60, 60])
    expect(buildMelody(2, { ...opts, mode: 'fixed', root: 'A', octave: 3 })).toEqual([57, 57])
  })

  it('ascendente: sube por la escala y reinicia dentro del rango', () => {
    const notes = buildMelody(16, { ...opts, mode: 'ascending', range: 1 })
    expect(notes.slice(0, 8)).toEqual([60, 62, 64, 65, 67, 69, 71, 60])
    expect(Math.max(...notes)).toBeLessThan(72)
    const two = buildMelody(100, { ...opts, mode: 'ascending', range: 2 })
    expect(Math.min(...two)).toBe(60)
    expect(Math.max(...two)).toBeLessThan(60 + 24)
  })

  it('un patrón largo no se va a octavas inaudibles (antes el grado era el índice de paso)', () => {
    const track = buildTrack({ instrument: 'Piano', pattern: { algorithm: 'euclidean', density: 1 }, length: 512, octave: 4 })
    const midis = track.events.map(e => e.midi)
    expect(midis).toHaveLength(512)
    expect(Math.max(...midis)).toBeLessThanOrEqual(60 + 24)
  })

  it('arpegio: tríada de la escala, sube y baja', () => {
    expect(buildMelody(8, { ...opts, mode: 'arpeggio', range: 1 })).toEqual([60, 64, 67, 72, 67, 64, 60, 64])
    // menor → tercera menor
    expect(buildMelody(3, { ...opts, scale: 'minor', mode: 'arpeggio' })).toEqual([60, 63, 67])
  })

  it('caminata aleatoria: determinista por semilla, dentro del rango y de la escala', () => {
    const a = buildMelody(64, { ...opts, mode: 'random', range: 2, seed: 0.42 })
    const b = buildMelody(64, { ...opts, mode: 'random', range: 2, seed: 0.42 })
    const c = buildMelody(64, { ...opts, mode: 'random', range: 2, seed: 0.43 })
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    for (const m of a) {
      expect(m).toBeGreaterThanOrEqual(60)
      expect(m).toBeLessThanOrEqual(60 + 24)
      expect(SCALES.major).toContain((m - 60) % 12)
    }
    // pasos de a lo sumo 2 grados
    expect(new Set(a).size).toBeGreaterThan(3)
  })

  it('tónica y escala como parámetros', () => {
    expect(rootToPitchClass('F#')).toBe(6)
    expect(rootToPitchClass('Bb')).toBe(10)
    expect(rootToPitchClass(14)).toBe(2)
    const d = buildMelody(5, { mode: 'ascending', root: 'D', scale: 'pentatonicMinor', octave: 3, range: 1 })
    expect(d).toEqual([50, 53, 55, 57, 60])
  })

  it('escala desconocida cae en pentatónica', () => {
    expect(buildMelody(3, { mode: 'ascending', scale: 'nope', root: 'C', octave: 4 })).toEqual([60, 62, 64])
  })

  it('createRng es determinista', () => {
    const r1 = createRng(0.5); const r2 = createRng(0.5)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
  })
})

describe('engine/score — pistas y partitura', () => {
  const spec = {
    id: 'lead',
    instrument: 'Synth',
    pattern: { algorithm: 'euclidean', density: 0.25, rotation: 0, seed: 0.1 },
    length: 16,
    octave: 4,
    melody: { mode: 'fixed', root: 'C', scale: 'major' },
    volume: 0.5,
    pan: -0.3
  }

  it('eventos con la forma { track, step, time, duration, midi, velocity }', () => {
    const track = buildTrack(spec)
    expect(track.id).toBe('lead')
    expect(track.length).toBe(16)
    expect(track.steps.filter(Boolean)).toHaveLength(4)
    expect(track.events).toHaveLength(4)
    for (const ev of track.events) {
      expect(Object.keys(ev).sort()).toEqual(['duration', 'midi', 'step', 'time', 'track', 'velocity'])
      expect(ev.track).toBe('lead')
      expect(ev.time).toBe(ev.step)
      expect(track.steps[ev.step]).toBe(true)
      expect(ev.duration).toBeGreaterThan(0)
      expect(ev.velocity).toBeGreaterThan(0)
      expect(ev.velocity).toBeLessThanOrEqual(1)
      expect(ev.midi).toBe(60)
    }
    expect(track.volume).toBe(0.5)
    expect(track.pan).toBe(-0.3)
  })

  it('la duración no pisa la nota siguiente', () => {
    const track = buildTrack({ ...spec, pattern: { algorithm: 'euclidean', density: 1 } })
    for (const ev of track.events) expect(ev.duration).toBeLessThan(1)
  })

  it('Drums: kit automático elige bombo / redoblante / hi-hat según el paso', () => {
    const track = buildTrack({ instrument: 'Drums', pattern: { algorithm: 'euclidean', density: 1 }, length: 8 })
    const byStep = Object.fromEntries(track.events.map(e => [e.step, e.midi]))
    expect(byStep[0]).toBe(DRUM_NOTES.kick)
    expect(byStep[4]).toBe(DRUM_NOTES.snare)
    expect(byStep[2]).toBe(DRUM_NOTES.hihat)
  })

  it('Drums: pieza fija desde la config', () => {
    const track = buildTrack({ instrument: 'Drums', drumPiece: 'snare', pattern: { algorithm: 'euclidean', density: 0.5 }, length: 8 })
    expect(new Set(track.events.map(e => e.midi))).toEqual(new Set([DRUM_NOTES.snare]))
  })

  it('buildScore produce { tempo, stepsPerBeat, tracks }', () => {
    const score = buildScore({ tempo: 90, tracks: [spec] })
    expect(score.tempo).toBe(90)
    expect(score.stepsPerBeat).toBe(4)
    expect(score.tracks).toHaveLength(1)
    expect(scoreLength(score)).toBe(16)
  })

  it('es determinista: misma entrada, misma partitura', () => {
    const s = { ...spec, pattern: { algorithm: 'random', density: 0.5, seed: 0.77 }, melody: { mode: 'random' } }
    expect(buildScore({ tracks: [s] })).toEqual(buildScore({ tracks: [s] }))
  })

  it('instrumento desconocido → Piano', () => {
    expect(buildTrack({ instrument: 'Kazoo' }).instrument).toBe('Piano')
  })

  it('eventsAtStep cicla cada pista sobre su longitud (polimetría)', () => {
    const track = buildTrack({ ...spec, length: 12 })
    const first = eventsAtStep(track, 0)
    expect(eventsAtStep(track, 12)).toEqual(first)
    expect(eventsAtStep(track, 24)).toEqual(first)
  })

  it('unrollScore despliega repeticiones con tiempos absolutos', () => {
    const score = buildScore({ tempo: 120, tracks: [spec] })
    const once = unrollScore(score)
    const twice = unrollScore(score, { repeats: 2 })
    expect(twice).toHaveLength(once.length * 2)
    const sd = stepDuration(120)
    expect(sd).toBeCloseTo(0.125)
    expect(twice[once.length].time).toBe(once[0].time + 16)
    expect(twice[once.length].seconds).toBeCloseTo((once[0].time + 16) * sd)
    expect(once[0].durationSeconds).toBeCloseTo(once[0].duration * sd)
  })
})
