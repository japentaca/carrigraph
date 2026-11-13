<template>
  <BaseNode type="logic" :data="data" width="190px">
    <div class="cg-field">
      <label class="cg-label">Operación</label>
      <div class="cg-buttons">
        <button
          v-for="op in ops" :key="op.value"
          class="cg-btn nodrag" :class="{ active: operation === op.value }"
          :title="op.hint"
          @click="update({ operation: op.value })"
        >{{ op.label }}</button>
      </div>
    </div>
    <p class="cg-hint">{{ current.hint }}</p>
  </BaseNode>
</template>

<script setup>
import { computed } from 'vue'
import BaseNode from './BaseNode.vue'

const props = defineProps({ data: { type: Object, required: true } })
const emit = defineEmits(['update'])

const ops = [
  { value: 'and', label: 'AND', hint: 'Suena donde A y B tienen golpe.' },
  { value: 'or', label: 'OR', hint: 'Suena donde A o B tienen golpe.' },
  { value: 'xor', label: 'XOR', hint: 'Suena donde solo uno de los dos tiene golpe.' },
  { value: 'not', label: 'NOT', hint: 'Invierte A (B no se usa).' }
]
const operation = computed(() => props.data.operation || 'and')
const current = computed(() => ops.find(o => o.value === operation.value) || ops[0])
const update = (changes) => emit('update', { ...props.data, ...changes })
</script>
