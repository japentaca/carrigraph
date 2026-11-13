<template>
  <div
    v-if="geometry"
    class="node-preview"
    :style="{ height: `${height}px` }"
    role="img"
    :aria-label="ariaLabel"
  >
    <canvas ref="canvas" class="node-preview__canvas" :width="width * dpr" :height="height * dpr" :style="{ width: `${width}px`, height: `${height}px` }"></canvas>
    <div
      v-if="step >= 0"
      class="node-preview__head"
      :style="{ left: `${(step / geometry.length) * 100}%`, width: `${Math.max(100 / geometry.length, 1.2)}%` }"
    ></div>
  </div>
</template>

<script setup>
/**
 * Thumbnail of what comes out of a node (Fase 4B): rhythm cells for patterns,
 * a small piano roll for notes. Drawn on a canvas only when the compiled
 * preview changes; the moving playhead is a single positioned element, so a
 * playing graph of 30 nodes updates 30 tiny styles per step and recompiles
 * nothing.
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useAudioStore } from '../../stores/useAudioStore'
import { previewGeometry, playingStep } from '../../editor/nodeView.js'
import { useTheme } from '../../composables/useTheme.js'

const props = defineProps({
  /** compileGraph().previews[nodeId] */
  preview: { type: Object, default: null },
  /** The node feeds a track (its playhead moves while playing). */
  active: { type: Boolean, default: false },
  width: { type: Number, default: 164 },
  height: { type: Number, default: 22 },
  color: { type: String, default: '' }
})

const audioStore = useAudioStore()
const { theme } = useTheme()
const canvas = ref(null)
const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')

const geometry = computed(() => previewGeometry(props.preview, { width: props.width, height: props.height }))
const step = computed(() => (props.active && audioStore.isPlaying
  ? playingStep(audioStore.globalStep, geometry.value?.length)
  : -1))

const ariaLabel = computed(() => {
  const g = geometry.value
  if (!g) return ''
  if (g.kind === 'pattern') return `Patrón de ${g.length} pasos, ${props.preview.steps.filter(Boolean).length} golpes`
  return `${props.preview.events?.length || 0} notas en ${g.length} pasos`
})

function cssVar(el, name, fallback) {
  try {
    return getComputedStyle(el).getPropertyValue(name).trim() || fallback
  } catch {
    return fallback
  }
}

function draw() {
  const el = canvas.value
  const g = geometry.value
  if (!el || !g || isJsdom) return
  const ctx = el.getContext?.('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, props.width, props.height)
  const on = props.color || cssVar(el, '--accent-color', '#22c55e')
  const off = cssVar(el, '--preview-off', 'rgba(163,163,163,0.25)')
  for (const c of g.cells) {
    ctx.globalAlpha = c.alpha
    ctx.fillStyle = c.on ? on : off
    ctx.fillRect(c.x, c.y, c.w, c.h)
  }
  ctx.globalAlpha = 1
}

watch([geometry, theme, () => props.color], () => nextTick(draw))
onMounted(draw)
</script>

<style scoped>
.node-preview {
  position: relative;
  overflow: hidden;
  border-radius: 3px;
  background: var(--background-dark);
}
.node-preview__canvas { display: block; }
.node-preview__head {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--playhead-color, rgba(250, 204, 21, 0.55));
  outline: 1px solid var(--playhead-edge, #facc15);
  pointer-events: none;
}
</style>
