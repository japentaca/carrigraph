<template>
  <div class="modal-overlay" @click="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Atajos de teclado" v-trap-focus="() => emit('close')" @click.stop>
      <div class="modal-header">
        <h3>⌨️ Atajos de teclado</h3>
        <button @click="emit('close')" class="close-btn" aria-label="Cerrar">×</button>
      </div>
      <div class="modal-content">
        <div v-for="s in shortcuts" :key="s.combo" class="shortcut-row">
          <kbd class="shortcut-key">{{ s.label }}</kbd>
          <span class="shortcut-desc">{{ s.description }}</span>
        </div>
        <p class="shortcut-note">
          Doble clic o Tab en el lienzo: buscar un nodo y crearlo donde está el puntero (clic derecho: lista completa).
          Soltá una conexión en el vacío para crear un nodo compatible ya conectado. Clic en un nodo: sus parámetros en
          el inspector; doble clic: lleva el foco al inspector; ▾ en el nodo: editarlo ahí mismo.
          Arrastrá un tipo de la paleta lateral al lienzo para crearlo ahí.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { getShortcutList } from '../../composables/useKeyboard.js'
import { vTrapFocus } from '../../composables/useFocusTrap.js'

const emit = defineEmits(['close'])
const shortcuts = getShortcutList()
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--background-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  width: 100%;
  max-width: 460px;
  margin: 2rem;
  max-height: 80vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  color: var(--text-primary);
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  width: 2rem;
  height: 2rem;
  border-radius: 4px;
}

.modal-content {
  padding: 1rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.shortcut-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.shortcut-key {
  background: var(--background-dark);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.8rem;
  color: var(--text-primary);
  min-width: 90px;
  text-align: center;
  white-space: nowrap;
}

.shortcut-desc {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.shortcut-note {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.4;
}
</style>
