<template>
  <BaseNode type="chord" :data="data" width="190px">
    <div class="cg-field">
      <label class="cg-label">Acorde</label>
      <div class="cg-buttons">
        <button
          v-for="c in chords" :key="c.value"
          class="cg-btn nodrag" :class="{ active: chord === c.value }"
          @click="update({ chord: c.value })"
        >{{ c.label }}</button>
      </div>
    </div>
    <p class="cg-hint">Usa la escala del nodo Escala / Melodía que tenga antes.</p>
  </BaseNode>
</template>

<script setup>
import { computed } from 'vue'
import BaseNode from './BaseNode.vue'

const props = defineProps({ data: { type: Object, required: true } })
const emit = defineEmits(['update'])

const chords = [
  { value: 'triad', label: 'Tríada' },
  { value: 'seventh', label: 'Séptima' },
  { value: 'fifths', label: 'Quintas' }
]
const chord = computed(() => props.data.chord || 'triad')
const update = (changes) => emit('update', { ...props.data, ...changes })
</script>
