<template>
  <BaseNode type="length" :data="data">
    <div class="cg-field">
      <label class="cg-label">Largo (pasos)</label>
      <div class="cg-control">
        <input
          type="range" step="1" class="cg-range nodrag"
          :min="min" :max="max" :value="value"
          @input="setValue(parseInt($event.target.value))"
        />
        <input
          type="number" class="cg-input cg-number nodrag" aria-label="Largo exacto"
          :min="min" :max="max" :value="value"
          @change="setValue(parseInt($event.target.value))"
        />
      </div>
    </div>

    <div class="cg-field">
      <label class="cg-label">Largos comunes</label>
      <div class="cg-buttons">
        <button
          v-for="p in presets" :key="p"
          class="cg-btn nodrag" :class="{ active: value === p }"
          @click="setValue(p)"
        >{{ p }}</button>
      </div>
    </div>

    <details class="cg-field">
      <summary class="cg-label cg-summary">Rango del control</summary>
      <div class="cg-row">
        <div class="cg-col">
          <label class="cg-label">Mín.</label>
          <input
            type="number" class="cg-input nodrag" min="1" :max="max - 1" :value="min"
            @change="setMin(parseInt($event.target.value))"
          />
        </div>
        <div class="cg-col">
          <label class="cg-label">Máx.</label>
          <input
            type="number" class="cg-input nodrag" :min="min + 1" max="512" :value="max"
            @change="setMax(parseInt($event.target.value))"
          />
        </div>
      </div>
    </details>

    <p class="cg-hint">{{ bars }} · {{ duration }} a {{ tempo }} BPM</p>
  </BaseNode>
</template>

<script setup>
/** Pattern Length: number of steps of the pattern it feeds (4–512). */
import { computed } from 'vue'
import BaseNode from './BaseNode.vue'
import { useAudioStore } from '../../stores/useAudioStore'

const props = defineProps({ data: { type: Object, required: true } })
const emit = defineEmits(['update'])
const audioStore = useAudioStore()

const presets = [4, 8, 12, 16, 24, 32, 48, 64]
const min = computed(() => props.data.min ?? 4)
const max = computed(() => props.data.max ?? 512)
const value = computed(() => props.data.value ?? 16)
const tempo = computed(() => audioStore.tempo || 120)

const update = (changes) => emit('update', { ...props.data, ...changes })

function setValue(v) {
  if (!Number.isFinite(v)) return
  const clamped = Math.max(min.value, Math.min(max.value, v))
  if (clamped !== value.value) update({ value: clamped })
}
function setMin(v) {
  if (Number.isFinite(v) && v >= 1 && v < max.value) update({ min: v, value: Math.max(v, value.value) })
}
function setMax(v) {
  if (Number.isFinite(v) && v <= 512 && v > min.value) update({ max: v, value: Math.min(v, value.value) })
}

const bars = computed(() => {
  const b = value.value / 16
  return Number.isInteger(b) ? `${b} ${b === 1 ? 'compás' : 'compases'}` : `${b.toFixed(2)} compases`
})
const duration = computed(() => {
  const secs = value.value * 60 / (tempo.value * 4)
  return secs >= 60 ? `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')} min` : `${secs.toFixed(1)} s`
})
</script>

<style scoped>
.cg-number { width: 4.2rem; flex: none; }
.cg-summary { cursor: pointer; }
</style>
