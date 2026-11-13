<template>
  <BaseNode type="transform" :data="data" width="210px">
    <div class="cg-field">
      <label class="cg-label">Operación</label>
      <select class="cg-select nodrag" :value="operation" @change="update({ operation: $event.target.value })">
        <option v-for="op in ops" :key="op.value" :value="op.value">{{ op.label }}</option>
      </select>
    </div>

    <div v-if="operation === 'rotate'" class="cg-field">
      <label class="cg-label">Pasos (negativo = a la izquierda)</label>
      <input
        type="number" class="cg-input nodrag" min="-64" max="64"
        :value="data.amount ?? 1"
        @change="update({ amount: parseInt($event.target.value) || 0 })"
      />
    </div>

    <template v-if="operation === 'probability'">
      <div class="cg-field">
        <label class="cg-label">Probabilidad de cada golpe</label>
        <div class="cg-control">
          <input
            type="range" class="cg-range nodrag" min="0" max="1" step="0.05"
            :value="data.probability ?? 0.75"
            @input="update({ probability: parseFloat($event.target.value) })"
          />
          <span class="cg-value">{{ Math.round((data.probability ?? 0.75) * 100) }}%</span>
        </div>
      </div>
    </template>

    <p class="cg-hint">{{ current.hint }}</p>
  </BaseNode>
</template>

<script setup>
import { computed } from 'vue'
import BaseNode from './BaseNode.vue'

const props = defineProps({ data: { type: Object, required: true } })
const emit = defineEmits(['update'])

const ops = [
  { value: 'invert', label: 'Invertir', hint: 'Los silencios pasan a ser golpes y al revés.' },
  { value: 'reverse', label: 'Reversa', hint: 'El patrón de atrás para adelante.' },
  { value: 'rotate', label: 'Rotar', hint: 'Corre el patrón N pasos.' },
  { value: 'double', label: 'Doble velocidad', hint: 'El ciclo dura la mitad (se pierden los pasos impares).' },
  { value: 'half', label: 'Mitad de velocidad', hint: 'El ciclo dura el doble.' },
  { value: 'probability', label: 'Probabilidad', hint: 'Cada golpe sobrevive con esa probabilidad (fijo por semilla).' }
]
const operation = computed(() => props.data.operation || 'reverse')
const current = computed(() => ops.find(o => o.value === operation.value) || ops[0])
const update = (changes) => emit('update', { ...props.data, ...changes })
</script>
