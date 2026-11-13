/**
 * nodeView.js — pure helpers for how a node looks on the canvas (Fase 4B):
 * the one-line summary of a compact node, and the geometry of its thumbnail
 * (what comes out of the node, from compileGraph().previews).
 */

import { SCALE_OPTIONS, MELODY_MODE_OPTIONS } from '../components/nodes/options.js'
import { EFFECT_TYPES } from '../audio/engine/effects.js'

const pct = (v, fallback = 0) => `${Math.round((Number.isFinite(Number(v)) ? Number(v) : fallback) * 100)}%`
const labelOf = (options, value, fallback) => options.find(o => o.value === value)?.label || fallback || value

const ALGORITHM_LABELS = {
  euclidean: 'Euclídeo', random: 'Aleatorio', binary: 'Binario', fibonacci: 'Fibonacci',
  cellular: 'Celular', noise: 'Ruido'
}
const TRANSFORM_LABELS = {
  invert: 'Invertir', reverse: 'Reversa', rotate: 'Rotar', double: 'Doble velocidad',
  half: 'Mitad de velocidad', probability: 'Probabilidad'
}
const CHORD_LABELS = { triad: 'Tríada', seventh: 'Séptima', fifths: 'Quintas' }
const EFFECT_LABELS = { distortion: 'Distorsión', filter: 'Filtro', delay: 'Delay', reverb: 'Reverb' }
const DRUM_LABELS = { auto: 'kit', kick: 'bombo', snare: 'redoblante', hihat: 'hi-hat', openhat: 'hi-hat abierto' }

/** Short description of a node's settings for the compact view. */
export function nodeSummary(node) {
  const d = node?.data || {}
  switch (node?.type) {
    case 'pattern': {
      const alg = d.algorithm || 'euclidean'
      const extra = alg === 'cellular' ? ` · regla ${d.rule ?? 30}` : ''
      return `${ALGORITHM_LABELS[alg] || alg} · ${pct(d.density, 0.5)} · rot ${d.rotation || 0}${extra}`
    }
    case 'steps': {
      const steps = Array.isArray(d.steps) ? d.steps : []
      return `${steps.filter(Boolean).length} de ${steps.length || 16} pasos`
    }
    case 'length': return `${d.value ?? 16} pasos`
    case 'loop': return `Celda de ${d.value ?? 8} pasos`
    case 'logic': return String(d.operation || 'and').toUpperCase()
    case 'transform': {
      const op = d.operation || 'reverse'
      const extra = op === 'rotate' ? ` ${d.amount ?? 1}` : op === 'probability' ? ` ${pct(d.probability, 0.75)}` : ''
      return `${TRANSFORM_LABELS[op] || op}${extra}`
    }
    case 'scale':
      return `${d.root || 'C'} ${labelOf(SCALE_OPTIONS, d.scale || 'pentatonic')} · ${labelOf(MELODY_MODE_OPTIONS, d.mode || 'ascending')}`
    case 'chord': return CHORD_LABELS[d.chord] || CHORD_LABELS.triad
    case 'groove': {
      const accent = (d.accentEvery ?? 0) > 0 ? ` · acento c/${d.accentEvery}` : ''
      return `Swing ${pct(d.swing)}${accent}`
    }
    case 'voice': {
      const inst = d.instrument || 'Piano'
      const piece = inst === 'Drums' ? ` (${DRUM_LABELS[d.drumPiece || 'auto'] || d.drumPiece})` : ''
      return `${inst}${piece} · vol ${pct(d.volume, 0.7)}`
    }
    case 'effects': {
      const on = EFFECT_TYPES.filter(t => d[t]?.enabled).map(t => EFFECT_LABELS[t])
      return on.length ? on.join(' + ') : 'Sin efectos activos'
    }
    case 'output': {
      const flags = [d.mute ? 'mute' : '', d.solo ? 'solo' : ''].filter(Boolean).join(' ')
      return `${d.name ? `${d.name} · ` : ''}vol ${pct(d.volume, 1)}${flags ? ` · ${flags}` : ''}`
    }
    default: return ''
  }
}

/**
 * Rectangles of a thumbnail, in a width×height box.
 *   pattern: one cell per step (hits filled), 1px bars when there are many
 *   notes:   a small piano roll (pitch → row; unpitched notes in the middle)
 * @returns {{ kind, length, cells: {x,y,w,h,on,alpha}[] } | null}
 */
export function previewGeometry(preview, { width = 160, height = 22 } = {}) {
  if (!preview || !(preview.length > 0)) return null
  const L = preview.length
  const stepW = width / L
  const gap = stepW >= 4 ? 1 : 0
  if (preview.kind === 'pattern') {
    const cells = []
    for (let i = 0; i < L; i++) {
      const on = !!preview.steps[i]
      if (!on && gap === 0) continue // tiny steps: draw hits only
      cells.push({ x: i * stepW, y: 0, w: Math.max(1, stepW - gap), h: height, on, alpha: 1 })
    }
    return { kind: 'pattern', length: L, cells }
  }
  if (preview.kind === 'notes') {
    const events = preview.events || []
    const pitches = events.map(e => e.midi).filter(Number.isFinite)
    const lo = pitches.length ? Math.min(...pitches) : 60
    const hi = pitches.length ? Math.max(...pitches) : 60
    const rows = Math.max(1, hi - lo + 1)
    const rowH = Math.max(1.5, Math.min(height / rows, 4))
    const span = Math.min(height, rows * rowH)
    const top = (height - span) / 2
    const cells = events.map(e => {
      const t = Number.isFinite(e.time) ? e.time : e.step
      const y = Number.isFinite(e.midi) ? top + (hi - e.midi) * (rows > 1 ? (span - rowH) / (rows - 1) : 0) : (height - rowH) / 2
      return {
        x: (t / L) * width,
        y,
        w: Math.max(1.5, stepW - gap),
        h: rowH,
        on: true,
        alpha: Math.max(0.35, Math.min(1, Number(e.vel ?? 1)))
      }
    })
    return { kind: 'notes', length: L, cells }
  }
  return null
}

/** Step of a node's own cycle that is sounding now (-1 when not playing). */
export function playingStep(globalStep, length) {
  if (!(globalStep >= 0) || !(length > 0)) return -1
  return globalStep % length
}
