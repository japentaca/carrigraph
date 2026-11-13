<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <button @click="emit('back')" class="btn secondary" :aria-label="guest ? 'Volver a la galería' : 'Volver a proyectos'"><span aria-hidden="true">←</span><span class="btn-text"> {{ guest ? 'Galería' : 'Proyectos' }}</span></button>
      <span class="project-title">{{ title }}</span>
      <span
        class="save-status"
        :class="`save-status--${status.key}`"
        role="status"
        aria-live="polite"
        :title="statusTitle"
      >
        <span class="save-status__dot"></span>{{ status.label }}
      </span>
    </div>

    <div class="toolbar-center">
      <button
        v-if="guest" class="btn" disabled
        title="Modo invitado: los cambios no se guardan. Iniciá sesión para guardar, o exportá el proyecto a un archivo."
        aria-label="Guardar (no disponible en modo invitado)"
      >
        <span aria-hidden="true">💾</span><span class="btn-text"> Guardar</span>
      </button>
      <button v-else @click="emit('save')" class="btn" :disabled="saving" title="Guardar (Ctrl+S)" aria-label="Guardar">
        <span v-if="saving" class="btn-spinner"></span>
        <span aria-hidden="true">💾</span><span class="btn-text"> {{ saving ? 'Guardando…' : 'Guardar' }}</span>
      </button>
      <button @click="emit('undo')" class="btn secondary" :disabled="!canUndo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer"><span aria-hidden="true">↶</span><span class="btn-text"> Deshacer</span></button>
      <button @click="emit('redo')" class="btn secondary" :disabled="!canRedo" title="Rehacer (Ctrl+Shift+Z)" aria-label="Rehacer"><span aria-hidden="true">↷</span><span class="btn-text"> Rehacer</span></button>
      <button
        v-if="!guest"
        @click="emit('history')" class="btn secondary"
        :disabled="!canShowHistory"
        :title="canShowHistory ? 'Historial de versiones guardadas' : 'Guardá el proyecto para tener historial'"
        aria-label="Historial de versiones"
      >
        <span aria-hidden="true">🕘</span><span class="btn-text"> Historial</span>
      </button>
      <button
        v-if="!guest"
        @click="emit('share')" class="btn secondary"
        :disabled="!canShowHistory"
        :title="canShowHistory ? 'Enlace de solo lectura y galería pública' : 'Guardá el proyecto para poder compartirlo'"
        aria-label="Compartir"
      >
        <span aria-hidden="true">🔗</span><span class="btn-text"> Compartir</span>
      </button>
    </div>

    <div class="toolbar-right">
      <button @click="exports.exportWav()" class="btn" :disabled="!exports.canExportAudio.value" title="WAV de la mezcla (Ctrl+E)" aria-label="Exportar WAV de la mezcla">
        <span aria-hidden="true">{{ audioStore.isExporting ? '⏳' : '🎵' }}</span><span class="btn-text"> {{ audioStore.isExporting ? 'Exportando…' : 'WAV' }}</span>
      </button>
      <button
        @click="exports.exportStems()" class="btn secondary"
        :disabled="!exports.canExportAudio.value"
        title="Un WAV por pista, con sus efectos (archivos separados)"
        aria-label="Exportar stems (un WAV por pista)"
      >
        <span aria-hidden="true">🎚️</span><span class="btn-text"> Stems</span>
      </button>
      <button @click="exports.exportMidi()" class="btn secondary" :disabled="!hasConnectedNodes" title="MIDI multipista (Ctrl+M)" aria-label="Exportar MIDI">
        <span aria-hidden="true">🎼</span><span class="btn-text"> MIDI</span>
      </button>
      <label class="repeats" title="Repeticiones al exportar WAV, stems y MIDI (1–64)">
        <span aria-hidden="true">×</span><span class="sr-only">Repeticiones al exportar</span>
        <input
          type="number" min="1" max="64"
          :value="audioStore.exportRepeats"
          @change="$event.target.value = exports.setRepeats(parseInt($event.target.value))"
        />
      </label>
      <button @click="emit('help')" class="btn secondary" title="Atajos de teclado (?)" aria-label="Atajos de teclado"><span aria-hidden="true">⌨️</span></button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useAudioStore } from '../../stores/useAudioStore'
import { useExports } from '../../composables/useExports.js'
import { usePlayback } from '../../composables/usePlayback.js'

const props = defineProps({
  title: { type: String, default: 'Proyecto sin título' },
  /** { key, label } from useAutosave */
  status: { type: Object, required: true },
  saving: { type: Boolean, default: false },
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
  canShowHistory: { type: Boolean, default: false },
  /** Guest mode: no save, history or share */
  guest: { type: Boolean, default: false }
})

const emit = defineEmits(['back', 'save', 'undo', 'redo', 'history', 'share', 'help'])

const audioStore = useAudioStore()
const exports = useExports()
const { hasConnectedNodes } = usePlayback()

const statusTitle = computed(() => ({
  saved: 'Todo guardado en el servidor',
  dirty: 'Hay cambios sin guardar (los proyectos ya guardados se autoguardan a los pocos segundos)',
  saving: 'Guardando en el servidor',
  error: 'El último guardado falló; se reintenta con el próximo cambio o con Guardar',
  conflict: 'El servidor tiene una versión más nueva de este proyecto',
  new: 'Proyecto nuevo: guardalo para crearlo en el servidor',
  guest: 'Modo invitado: podés editar, reproducir y exportar, pero nada se guarda en el servidor'
}[props.status.key] || props.status.label))
</script>

<style scoped>
.toolbar {
  background: var(--background-light);
  border-bottom: 1px solid var(--border-color);
  padding: 0.6rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.toolbar-left,
.toolbar-center,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.project-title {
  color: var(--text-primary);
  font-weight: 500;
  margin-left: 0.5rem;
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Narrow screens: icon buttons (the names stay as aria-label / title). */
@media (max-width: 1000px) {
  .btn-text { display: none; }
  .toolbar { padding: 0.45rem 0.6rem; gap: 0.35rem; }
  .toolbar .btn { padding: 0.45rem 0.6rem; }
  .project-title { max-width: 14ch; }
}

.save-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
}

.save-status__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
}

.save-status--saved .save-status__dot { background: var(--accent-color); }
.save-status--dirty .save-status__dot { background: var(--warning-color); }
.save-status--saving .save-status__dot { background: var(--primary-color); }
.save-status--error .save-status__dot,
.save-status--conflict .save-status__dot { background: var(--danger-color); }
.save-status--conflict { color: var(--danger-color); border-color: var(--danger-color); }
.save-status--guest .save-status__dot { background: var(--warning-color); }
.save-status--guest { color: var(--warning-color); border-color: var(--warning-color); }

.repeats {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.repeats input {
  width: 3.2rem;
  padding: 0.25rem 0.3rem;
  background: var(--background-dark);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.btn-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  margin-right: 0.25rem;
  vertical-align: middle;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
