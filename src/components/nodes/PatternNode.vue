<template>
  <BaseNode type="pattern" :data="data">
    <div class="cg-field">
      <label class="cg-label">Algoritmo</label>
      <select class="cg-select nodrag" :value="data.algorithm || 'euclidean'" @change="update({ algorithm: $event.target.value })">
        <option v-for="a in ALGORITHMS" :key="a.value" :value="a.value">{{ a.label }}</option>
      </select>
    </div>

    <div v-if="data.algorithm === 'cellular'" class="cg-field cg-row">
      <div class="cg-col">
        <label class="cg-label">Regla</label>
        <select class="cg-select nodrag" :value="data.rule ?? 30" @change="update({ rule: parseInt($event.target.value) })">
          <option v-for="r in CELLULAR_RULES" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
      <div class="cg-col">
        <label class="cg-label">Generaciones</label>
        <input
          type="number" min="0" max="256" class="cg-input nodrag"
          :value="data.generations ?? 7"
          @change="update({ generations: Math.max(0, parseInt($event.target.value) || 0) })"
        />
      </div>
    </div>

    <div v-if="data.algorithm === 'noise'" class="cg-field">
      <label class="cg-label">Suavidad (pasos entre picos)</label>
      <div class="cg-control">
        <input
          type="range" min="1" max="16" step="1" class="cg-range nodrag"
          :value="data.noiseScale ?? 4"
          @input="update({ noiseScale: parseInt($event.target.value) })"
        />
        <span class="cg-value">{{ data.noiseScale ?? 4 }}</span>
      </div>
    </div>

    <div class="cg-field">
      <label class="cg-label">Densidad</label>
      <div class="cg-control">
        <input
          type="range" min="0" max="1" step="0.1" class="cg-range nodrag"
          :value="data.density ?? 0.5"
          @input="update({ density: parseFloat($event.target.value) })"
        />
        <span class="cg-value">{{ Math.round((data.density ?? 0.5) * 100) }}%</span>
      </div>
    </div>

    <div class="cg-field">
      <label class="cg-label">Rotación</label>
      <div class="cg-control">
        <input
          type="range" min="0" max="15" step="1" class="cg-range nodrag"
          :value="data.rotation || 0"
          @input="update({ rotation: parseInt($event.target.value) })"
        />
        <span class="cg-value">{{ data.rotation || 0 }}</span>
      </div>
    </div>

    <p class="cg-hint">El largo sale de un nodo Largo del patrón conectado (si no, 16 pasos).</p>
  </BaseNode>
</template>

<script setup>
/** Pattern Generator parameters. The seed is in the seed controls (Fase 4B). */
import BaseNode from './BaseNode.vue'
import { CELLULAR_RULES } from '../../audio/patternGenerators.js'

const props = defineProps({ data: { type: Object, required: true } })
const emit = defineEmits(['update'])

const ALGORITHMS = [
  { value: 'euclidean', label: 'Euclídeo' },
  { value: 'random', label: 'Aleatorio' },
  { value: 'binary', label: 'Binario' },
  { value: 'fibonacci', label: 'Fibonacci' },
  { value: 'cellular', label: 'Autómata celular' },
  { value: 'noise', label: 'Ruido suave (umbral)' }
]

const update = (changes) => emit('update', { ...props.data, ...changes })
</script>
