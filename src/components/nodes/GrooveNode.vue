<template>
  <BaseNode type="groove" :data="data" width="220px">
    <div v-for="s in sliders" :key="s.key" class="cg-field">
      <label class="cg-label">{{ s.label }}</label>
      <div class="cg-control">
        <input
          type="range" class="cg-range nodrag" min="0" max="1" step="0.05"
          :value="data[s.key] ?? 0"
          @input="update({ [s.key]: parseFloat($event.target.value) })"
        />
        <span class="cg-value">{{ Math.round((data[s.key] ?? 0) * 100) }}%</span>
      </div>
    </div>

    <div class="cg-field">
      <label class="cg-label">Acento cada</label>
      <div class="cg-buttons">
        <button
          v-for="n in accentOptions" :key="n"
          class="cg-btn nodrag" :class="{ active: (data.accentEvery ?? 0) === n }"
          @click="update({ accentEvery: n })"
        >{{ n === 0 ? 'No' : n }}</button>
      </div>
    </div>

    <div v-if="(data.accentEvery ?? 0) > 0" class="cg-field">
      <label class="cg-label">Fuerza del acento</label>
      <div class="cg-control">
        <input
          type="range" class="cg-range nodrag" min="0" max="1" step="0.05"
          :value="data.accentAmount ?? 0"
          @input="update({ accentAmount: parseFloat($event.target.value) })"
        />
        <span class="cg-value">{{ Math.round((data.accentAmount ?? 0) * 100) }}%</span>
      </div>
    </div>
  </BaseNode>
</template>

<script setup>
import BaseNode from './BaseNode.vue'

const props = defineProps({ data: { type: Object, required: true } })
const emit = defineEmits(['update'])

const sliders = [
  { key: 'swing', label: 'Swing' },
  { key: 'timing', label: 'Humanizar tiempo' },
  { key: 'velocity', label: 'Humanizar intensidad' }
]
const accentOptions = [0, 2, 3, 4, 8]
const update = (changes) => emit('update', { ...props.data, ...changes })
</script>
