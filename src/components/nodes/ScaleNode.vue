<template>
  <BaseNode type="scale" :data="data" width="220px">
    <div class="cg-field cg-row">
      <div class="cg-col">
        <label class="cg-label">Tónica</label>
        <select class="cg-select nodrag" :value="data.root || 'C'" @change="update({ root: $event.target.value })">
          <option v-for="n in NOTE_NAMES" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
      <div class="cg-col">
        <label class="cg-label">Escala</label>
        <select class="cg-select nodrag" :value="data.scale || 'pentatonic'" @change="update({ scale: $event.target.value })">
          <option v-for="s in SCALE_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </div>
    </div>

    <div class="cg-field">
      <label class="cg-label">Melodía</label>
      <select class="cg-select nodrag" :value="mode" @change="update({ mode: $event.target.value })">
        <option v-for="m in MELODY_MODE_OPTIONS" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
    </div>

    <div class="cg-field">
      <label class="cg-label">Octava</label>
      <div class="cg-buttons">
        <button v-for="o in OCTAVES" :key="o" class="cg-btn nodrag" :class="{ active: (data.octave ?? 4) === o }" @click="update({ octave: o })">{{ o }}</button>
      </div>
    </div>

    <div v-if="mode !== 'fixed'" class="cg-field">
      <label class="cg-label">Rango (octavas)</label>
      <div class="cg-buttons">
        <button v-for="r in RANGES" :key="r" class="cg-btn nodrag" :class="{ active: (data.range ?? 2) === r }" @click="update({ range: r })">{{ r }}</button>
      </div>
    </div>
  </BaseNode>
</template>

<script setup>
import { computed } from 'vue'
import BaseNode from './BaseNode.vue'
import { NOTE_NAMES } from '../../audio/engine/score.js'
import { SCALE_OPTIONS, MELODY_MODE_OPTIONS, OCTAVES, RANGES } from './options.js'

const props = defineProps({ data: { type: Object, required: true } })
const emit = defineEmits(['update'])
const mode = computed(() => props.data.mode || 'ascending')
const update = (changes) => emit('update', { ...props.data, ...changes })
</script>
