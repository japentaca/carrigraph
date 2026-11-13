<template>
  <canvas
    ref="canvas"
    class="scope"
    :width="width * dpr"
    :height="height * dpr"
    :style="{ width: `${width}px`, height: `${height}px` }"
    role="img"
    aria-label="Osciloscopio de la salida maestra"
  ></canvas>
</template>

<script setup>
/**
 * Oscilloscope of the master output (Fase 4B), in the transport bar. Reads
 * the engine's AnalyserNode (audioStore.getWaveform, not reactive) once per
 * animation frame only while playing, and draws a downsampled line (one
 * point per pixel). Stopped: a flat line, no loop running.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useAudioStore } from '../../stores/useAudioStore'
import { waveformPoints } from '../../editor/transport.js'

const props = defineProps({
  width: { type: Number, default: 96 },
  height: { type: Number, default: 26 }
})

const audioStore = useAudioStore()
const canvas = ref(null)
const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')
let frame = null
let buffer = null

function color(name, fallback) {
  try { return getComputedStyle(canvas.value).getPropertyValue(name).trim() || fallback } catch { return fallback }
}

function draw(samples) {
  const el = canvas.value
  if (!el || isJsdom) return
  const ctx = el.getContext?.('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, props.width, props.height)
  ctx.strokeStyle = color('--accent-color', '#22c55e')
  ctx.lineWidth = 1.25
  ctx.beginPath()
  const pts = waveformPoints(samples, props.width, props.height)
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.stroke()
}

function loop() {
  frame = null
  if (!audioStore.isPlaying) { draw(null); return }
  buffer = audioStore.getWaveform(buffer) || buffer
  draw(buffer)
  frame = requestAnimationFrame(loop)
}

function start() {
  if (frame == null && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(loop)
}

watch(() => audioStore.isPlaying, (playing) => (playing ? start() : draw(null)))
onMounted(() => { draw(null); if (audioStore.isPlaying) start() })
onBeforeUnmount(() => { if (frame != null) cancelAnimationFrame(frame) })
</script>

<style scoped>
.scope {
  display: block;
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}
</style>
