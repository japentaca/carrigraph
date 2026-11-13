<template>
  <div class="timeline-panel" :class="{ 'timeline-panel--collapsed': collapsed }">
    <!-- Toggle bar -->
    <div class="timeline-toggle">
      <button class="timeline-toggle__btn" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
        <span class="timeline-toggle__icon">{{ collapsed ? '▲' : '▼' }}</span>
        <span class="timeline-toggle__label">Piano roll</span>
      </button>
      <span v-if="tracks.length" class="timeline-toggle__info">
        {{ tracks.length }} {{ tracks.length === 1 ? 'pista' : 'pistas' }} · {{ maxLength }} pasos · {{ Math.round(tempo) }} BPM
      </span>
      <div v-if="!collapsed && tracks.length" class="timeline-tools">
        <span class="timeline-tool">
          Zoom
          <button class="timeline-btn" title="Alejar" :disabled="cellWidth <= MIN_CELL_WIDTH" @click="zoom(-1)">−</button>
          <button class="timeline-btn" title="Acercar" :disabled="cellWidth >= MAX_CELL_WIDTH" @click="zoom(1)">+</button>
        </span>
        <label class="timeline-tool" title="Mover la vista para seguir el cursor">
          <input v-model="follow" type="checkbox" /> Seguir
        </label>
      </div>
    </div>

    <div v-if="!collapsed" class="timeline-body">
      <div v-if="!tracks.length && readonly" class="timeline-empty">
        <p>Este proyecto no tiene pistas que suenen.</p>
      </div>
      <div v-else-if="!tracks.length" class="timeline-empty">
        <p>Conectá Patrón → Voz → Salida para ver las pistas acá.</p>
        <p class="timeline-empty__hint">
          Usá <kbd>Space</kbd> para reproducir o el botón ▶ Play de la barra de transporte
        </p>
      </div>

      <div v-else ref="scroller" class="roll" @scroll="onScroll">
        <div class="roll__grid" :style="{ width: `${HEADER_WIDTH + gridWidth}px` }">
          <!-- Ruler -->
          <div class="roll__row roll__row--ruler">
            <div class="roll__head roll__head--ruler">Compás</div>
            <div class="roll__ruler" :style="{ width: `${gridWidth}px` }">
              <span
                v-for="m in marks" :key="m.step"
                class="roll__mark" :style="{ left: `${m.step * cellWidth}px` }"
              >{{ m.label }}</span>
            </div>
          </div>

          <!-- One lane per track -->
          <div
            v-for="lane in lanes" :key="lane.track.id"
            class="roll__row"
            :class="{ 'roll__row--silent': !lane.audible }"
          >
            <div class="roll__head" :style="{ borderLeftColor: lane.color }">
              <div class="roll__name" :title="`${lane.track.name} · ${lane.track.instrument} · ${lane.track.length} pasos`">
                {{ lane.track.name }}
              </div>
              <div class="roll__meta">
                {{ lane.track.length }} pasos
                <span v-if="lane.layout.truncated" title="Demasiadas notas: se muestran las primeras">· recortado</span>
              </div>
              <div class="roll__mix">
                <button
                  class="mix-btn mix-btn--mute" :class="{ active: lane.track.mute }"
                  :aria-pressed="!!lane.track.mute"
                  :disabled="!canMix"
                  :title="canMix ? 'Mute: silenciar esta pista' : mixHint"
                  @click="toggle(lane.track, 'mute')"
                >M</button>
                <button
                  class="mix-btn mix-btn--solo" :class="{ active: lane.track.solo }"
                  :aria-pressed="!!lane.track.solo"
                  :disabled="!canMix"
                  :title="canMix ? 'Solo: escuchar solo las pistas en solo' : mixHint"
                  @click="toggle(lane.track, 'solo')"
                >S</button>
              </div>
            </div>
            <div class="roll__lane-wrap">
              <TimelineLane
                :layout="lane.layout"
                :length="lane.track.length"
                :max-length="maxLength"
                :cell-width="cellWidth"
                :height="LANE_HEIGHT"
                :color="lane.color"
              />
              <!-- Step of this track under the playhead (its own cycle) -->
              <div
                v-if="localStep(lane.track) >= 0"
                class="roll__local"
                :style="{ left: `${localStep(lane.track) * cellWidth}px`, width: `${cellWidth}px`, background: lane.color }"
              ></div>
            </div>
          </div>

          <!-- Global playhead (position inside the longest cycle) -->
          <div
            v-if="playheadStep >= 0"
            class="roll__playhead"
            :style="{ left: `${HEADER_WIDTH + playheadStep * cellWidth}px` }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useAudioStore } from '../stores/useAudioStore'
import { usePlayback } from '../composables/usePlayback'
import { hasSolo, isTrackAudible } from '../audio/engine/score.js'
import TimelineLane from './timeline/TimelineLane.vue'
import {
  laneLayout, trackColor, rulerMarks, defaultCellWidth, followScroll,
  MIN_CELL_WIDTH, MAX_CELL_WIDTH
} from './timeline/pianoRoll.js'

const HEADER_WIDTH = 150
const LANE_HEIGHT = 56

const props = defineProps({
  /**
   * Compilation to show (Fase 5A: the shared/gallery player passes its own).
   * Default: the editor graph (usePlayback().compiled).
   */
  compiled: { type: Object, default: null },
  /** Read-only: mute/solo are disabled (nothing can be written). */
  readonly: { type: Boolean, default: false }
})

const audioStore = useAudioStore()
// The editor's playback only when no compilation is given (props are fixed per mount).
const playback = props.compiled ? null : usePlayback()

// Phones (short or narrow windows): start folded so the canvas keeps room;
// the bar stays visible and opens with one tap (Fase 5B).
const SMALL_SCREEN = '(max-width: 600px), (max-height: 560px)'
const startsFolded = () => {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.(SMALL_SCREEN).matches } catch { return false }
}
const collapsed = ref(startsFolded())
const follow = ref(true)
const zoomOverride = ref(null)
const scroller = ref(null)
let userScrolledAt = 0

// Tracks of the compiled graph (what plays, and updates live while editing).
const compiled = computed(() => props.compiled || playback.compiled.value)
const tracks = computed(() => compiled.value.score.tracks)
// A given compilation (shared player) carries its own tempo.
const tempo = computed(() => (props.compiled ? props.compiled.score.tempo : audioStore.tempo))
const canMix = computed(() => !props.readonly && compiled.value.mode === 'tracks')
const mixHint = props.readonly
  ? 'Vista de solo lectura: mute y solo no se pueden cambiar'
  : 'Mute y solo necesitan un nodo Salida (modo pistas)'

const maxLength = computed(() => Math.max(1, ...tracks.value.map(t => t.length || 0)))
const cellWidth = computed(() => zoomOverride.value ?? defaultCellWidth(maxLength.value))
const gridWidth = computed(() => maxLength.value * cellWidth.value)
const marks = computed(() => rulerMarks(maxLength.value))

// Layout depends only on the score (not on the cursor), so the lanes do not
// re-render while the playhead moves.
const lanes = computed(() => {
  const solo = hasSolo(tracks.value)
  return tracks.value.map((track, i) => ({
    track,
    color: trackColor(i),
    audible: isTrackAudible(track, solo),
    layout: laneLayout(track, { maxLength: maxLength.value })
  }))
})

const playheadStep = computed(() => {
  if (!audioStore.isPlaying || audioStore.globalStep < 0) return -1
  return audioStore.globalStep % maxLength.value
})

function localStep(track) {
  if (!audioStore.isPlaying) return -1
  const s = audioStore.trackSteps[track.id]
  return s == null ? -1 : s
}

function zoom(dir) {
  const next = Math.round(cellWidth.value * (dir > 0 ? 1.5 : 1 / 1.5))
  zoomOverride.value = Math.min(MAX_CELL_WIDTH, Math.max(MIN_CELL_WIDTH, next))
}

function toggle(track, field) {
  if (!canMix.value || !playback) return
  playback.setTrackMix(track.id, { [field]: !track[field] })
}

function onScroll() {
  if (!scroller.value?.__cgAuto) userScrolledAt = Date.now()
}

watch(playheadStep, (step) => {
  const el = scroller.value
  if (!follow.value || step < 0 || !el) return
  if (Date.now() - userScrolledAt < 1500) return // the user is looking elsewhere
  const left = followScroll(step * cellWidth.value, el.scrollLeft, el.clientWidth - HEADER_WIDTH)
  if (left != null) {
    el.__cgAuto = true
    el.scrollLeft = left
    setTimeout(() => { el.__cgAuto = false }, 100)
  }
})
</script>

<style scoped>
.timeline-panel {
  background: var(--background-dark);
  border-top: 1px solid var(--border-color);
  /* A flex item: without this a 512-step roll would widen the whole page. */
  min-width: 0;
  max-width: 100%;
}

.timeline-panel--collapsed {
  flex-shrink: 0;
}

.timeline-toggle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  padding: 0.3rem 1rem;
  background: var(--background-light);
  border-bottom: 1px solid var(--border-color);
}

.timeline-toggle__btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  padding: 0.1rem 0;
}

.timeline-toggle__icon {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.timeline-toggle__label {
  font-size: 0.8rem;
  font-weight: 600;
}

.timeline-toggle__info {
  color: var(--text-secondary);
  font-size: 0.7rem;
}

.timeline-tools {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-left: auto;
  flex-wrap: wrap;
}

.timeline-tool {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-secondary);
  font-size: 0.7rem;
}

.timeline-tool input[type='range'] {
  width: 80px;
}

.timeline-btn {
  background: var(--background-dark);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  width: 1.6rem;
  cursor: pointer;
}

.timeline-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.timeline-body {
  min-width: 0;
  max-height: 280px;
  display: flex;
  flex-direction: column;
}

.timeline-empty {
  text-align: center;
  padding: 1.5rem 1rem;
  color: var(--text-secondary);
}

.timeline-empty p {
  margin: 0.25rem 0;
  font-size: 0.85rem;
}

.timeline-empty__hint {
  font-size: 0.75rem !important;
  opacity: 0.7;
}

.timeline-empty__hint kbd {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  padding: 0.1rem 0.35rem;
  font-size: 0.7rem;
  font-family: monospace;
}

.roll {
  overflow: auto;
  max-height: 280px;
}

.roll__grid {
  position: relative;
}

.roll__row {
  display: flex;
}

.roll__row--ruler {
  position: sticky;
  top: 0;
  z-index: 4;
  background: var(--background-dark);
  height: 20px;
}

.roll__head {
  position: sticky;
  left: 0;
  z-index: 3;
  width: 150px;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0.25rem 0.5rem;
  background: var(--background-dark);
  border-left: 4px solid transparent;
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.15rem;
}

.roll__head--ruler {
  color: var(--text-secondary);
  font-size: 0.65rem;
  padding: 0 0.5rem;
  border-bottom: 1px solid var(--border-color);
}

.roll__ruler {
  position: relative;
  border-bottom: 1px solid var(--border-color);
}

.roll__mark {
  position: absolute;
  top: 2px;
  padding-left: 3px;
  border-left: 1px solid var(--text-secondary);
  color: var(--text-secondary);
  font-size: 0.62rem;
  line-height: 16px;
}

.roll__name {
  color: var(--text-primary);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.roll__meta {
  color: var(--text-secondary);
  font-size: 0.62rem;
}

.roll__mix {
  display: flex;
  gap: 0.25rem;
}

.mix-btn {
  width: 1.6rem;
  height: 1.2rem;
  font-size: 0.65rem;
  font-weight: 700;
  border-radius: 3px;
  border: 1px solid var(--border-color);
  background: var(--background-light);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
}

.mix-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mix-btn--mute.active { background: var(--mute-color); border-color: var(--mute-color); color: white; }
.mix-btn--solo.active { background: var(--solo-color); border-color: var(--solo-color); color: #171717; }

.roll__row--silent .roll__lane-wrap { opacity: 0.35; }

.roll__lane-wrap {
  position: relative;
}

.roll__local {
  position: absolute;
  top: 0;
  height: 3px;
  pointer-events: none;
}

.roll__playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--danger-color);
  z-index: 2;
  pointer-events: none;
}
</style>
