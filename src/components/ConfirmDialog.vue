<template>
  <Teleport to="body">
    <div v-if="visible" class="confirm-overlay" @click.self="onCancel">
      <div
        class="confirm-dialog" role="alertdialog" aria-modal="true"
        :aria-labelledby="titleId" :aria-describedby="messageId"
        v-trap-focus="onCancel"
      >
        <div class="confirm-header">
          <span class="confirm-icon" aria-hidden="true">{{ iconMap[type] }}</span>
          <h3 :id="titleId">{{ title }}</h3>
        </div>

        <p :id="messageId" class="confirm-message">{{ message }}</p>

        <div v-if="detail" class="confirm-detail">{{ detail }}</div>

        <div class="confirm-actions">
          <button
            @click="onCancel"
            class="btn secondary"
            :disabled="loading"
            data-autofocus
          >
            {{ cancelText }}
          </button>
          <button
            v-if="secondaryText"
            @click="emit('secondary')"
            class="btn secondary"
            :disabled="loading"
          >
            {{ secondaryText }}
          </button>
          <button
            @click="onConfirm"
            :class="['btn', `btn--${type}`]"
            :disabled="loading"
          >
            <span v-if="loading" class="btn-spinner"></span>
            {{ loading ? 'Processing...' : confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, useId } from 'vue'
import { vTrapFocus } from '../composables/useFocusTrap.js'

const uid = useId()
const titleId = `confirm-title-${uid}`
const messageId = `confirm-message-${uid}`

const props = defineProps({
  visible: { type: Boolean, required: true },
  title: { type: String, default: '¿Seguro?' },
  message: { type: String, default: 'Esta acción no se puede deshacer.' },
  detail: { type: String, default: '' },
  confirmText: { type: String, default: 'Confirmar' },
  cancelText: { type: String, default: 'Cancelar' },
  type: { type: String, default: 'danger' }, // danger | warning | info
  loading: { type: Boolean, default: false },
  /** Optional third choice (emits 'secondary'), e.g. "Salir sin guardar". */
  secondaryText: { type: String, default: '' }
})

const emit = defineEmits(['confirm', 'cancel', 'secondary'])

const iconMap = {
  danger: '⚠️',
  warning: '⚠️',
  info: 'ℹ️'
}

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: var(--background-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.confirm-dialog {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  width: 100%;
  max-width: 420px;
  padding: 1.5rem;
  box-shadow: 0 8px 32px var(--shadow-color);
  margin: 1rem;
}

.confirm-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.confirm-icon {
  font-size: 1.5rem;
}

.confirm-header h3 {
  color: var(--text-primary);
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}

.confirm-message {
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
  margin-bottom: 0.5rem;
}

.confirm-detail {
  background: var(--background-dark);
  border-radius: 6px;
  padding: 0.75rem;
  margin-bottom: 1rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
  font-family: monospace;
  word-break: break-all;
}

.confirm-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  flex-wrap: wrap;
  margin-top: 1.5rem;
}

.btn--danger {
  background: var(--danger-color);
  border-color: var(--danger-color);
  color: white;
}

.btn--danger:hover {
  background: var(--danger-hover);
}

.btn--warning {
  background: var(--warning-color);
  border-color: var(--warning-color);
  color: #171717;
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
