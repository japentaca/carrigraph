<template>
  <BaseNode type="loop" :data="data">
    <div class="cg-field">
      <label class="cg-label">Celda que se repite (pasos)</label>
      <div class="cg-control">
        <input
          type="range" step="1" class="cg-range nodrag"
          :min="min" :max="max" :value="value"
          @input="setValue(parseInt($event.target.value))"
        />
        <input
          type="number" class="cg-input cg-number nodrag" aria-label="Celda exacta"
          :min="min" :max="max" :value="value"
          @change="setValue(parseInt($event.target.value))"
        />
      </div>
    </div>

    <div class="cg-field">
      <label class="cg-label">Valores comunes</label>
      <div class="cg-buttons">
        <button
          v-for="p in presets" :key="p"
          class="cg-btn nodrag" :class="{ active: value === p }"
          @click="setValue(p)"
        >{{ p }}</button>
      </div>
    </div>

    <p class="cg-hint">
      El patrón se genera con {{ value }} pasos y se repite hasta completar el largo
      ({{ Math.floor(16 / value) }} veces en 16 pasos{{ 16 % value ? `, sobran ${16 % value}` : '' }}).
    </p>
  </BaseNode>
</template>

<script setup>
/**
 * Loop Size: the pattern is generated with this many steps and repeated up
 * to the length (Fase 2 semantics). The old "mode" and "sync" selectors were
 * removed in Fase 4B: they never had any effect on the sound (the values
 * stay in saved projects, untouched).
 */
import { computed } from 'vue'
import BaseNode from './BaseNode.vue'

const props = defineProps({ data: { type: Object, required: true } })
const emit = defineEmits(['update'])

const presets = [1, 2, 3, 4, 6, 8, 12, 16]
const min = computed(() => props.data.min ?? 1)
const max = computed(() => props.data.max ?? 64)
const value = computed(() => props.data.value ?? 8)

function setValue(v) {
  if (!Number.isFinite(v)) return
  const clamped = Math.max(min.value, Math.min(max.value, v))
  if (clamped !== value.value) emit('update', { ...props.data, value: clamped })
}
</script>

<style scoped>
.cg-number { width: 4.2rem; flex: none; }
</style>
