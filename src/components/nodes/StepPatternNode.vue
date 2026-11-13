<template>
  <BaseNode type="steps" :data="data" width="230px">
    <div class="cg-field">
      <label class="cg-label">Pasos (clic para activar)</label>
      <div class="step-grid">
        <button
          v-for="(on, i) in steps"
          :key="i"
          class="step-cell nodrag"
          :class="{ 'step-cell--on': on, 'step-cell--beat': i % 4 === 0 }"
          :title="`Paso ${i + 1}`"
          :aria-pressed="on"
          @click="toggle(i)"
        ></button>
      </div>
    </div>
    <div class="cg-field cg-row">
      <div class="cg-col">
        <label class="cg-label">Largo</label>
        <select class="cg-select nodrag" :value="steps.length" @change="resize(parseInt($event.target.value))">
          <option v-for="n in lengths" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
      <div class="cg-col step-actions">
        <button class="cg-btn nodrag" @click="setAll(false)">Limpiar</button>
      </div>
    </div>
  </BaseNode>
</template>

<script setup>
import { computed } from 'vue'
import BaseNode from './BaseNode.vue'

const props = defineProps({ data: { type: Object, required: true } })
const emit = defineEmits(['update'])

const lengths = [4, 6, 8, 12, 16, 24, 32, 48, 64]
const steps = computed(() => (Array.isArray(props.data.steps) && props.data.steps.length
  ? props.data.steps.map(Boolean)
  : new Array(16).fill(false)))
const update = (changes) => emit('update', { ...props.data, ...changes })

const toggle = (i) => {
  const next = steps.value.slice()
  next[i] = !next[i]
  update({ steps: next })
}
const resize = (n) => update({ steps: Array.from({ length: n }, (_, i) => !!steps.value[i]) })
const setAll = (value) => update({ steps: steps.value.map(() => value) })
</script>

<style scoped>
.step-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 3px;
}
.step-cell {
  height: 18px;
  padding: 0;
  border-radius: 3px;
  background: var(--background-dark);
  border: 1px solid var(--border-color);
  cursor: pointer;
}
.step-cell--beat { border-color: var(--text-secondary); }
.step-cell--on { background: #0ea5e9; border-color: #0ea5e9; }
.step-actions { display: flex; align-items: flex-end; }
</style>
