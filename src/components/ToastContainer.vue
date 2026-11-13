<template>
  <Teleport to="body">
    <div class="toast-container" aria-live="polite">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toastStore.toasts"
          :key="toast.id"
          :class="['toast', `toast--${toast.type}`]"
          role="alert"
        >
          <span class="toast__icon">{{ iconMap[toast.type] }}</span>
          <span class="toast__message">{{ toast.message }}</span>
          <button
            class="toast__close"
            @click="toastStore.removeToast(toast.id)"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { useToastStore } from '../stores/useToastStore'

const toastStore = useToastStore()

const iconMap = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️'
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 400px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
  line-height: 1.4;
  box-shadow: 0 4px 16px var(--shadow-color);
  pointer-events: auto;
  background: var(--background-light);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-left-width: 4px;
}

.toast--success {
  border-left-color: var(--accent-color);
}

.toast--error {
  border-left-color: var(--danger-color);
}

.toast--warning {
  border-left-color: var(--warning-color);
}

.toast--info {
  border-left-color: var(--primary-color);
}

.toast__icon {
  flex-shrink: 0;
  font-size: 1.125rem;
}

.toast__message {
  flex: 1;
  min-width: 0;
}

.toast__close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: inherit;
  opacity: 0.6;
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0;
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: opacity 0.15s;
}

.toast__close:hover {
  opacity: 1;
}

/* TransitionGroup animations */
.toast-enter-active {
  transition: all 0.3s ease-out;
}

.toast-leave-active {
  transition: all 0.25s ease-in;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
