import { defineStore } from 'pinia'

let toastId = 0

export const useToastStore = defineStore('toast', {
  state: () => ({
    toasts: []
  }),

  actions: {
    /**
     * Add a toast notification.
     * @param {string} message
     * @param {'success'|'error'|'warning'|'info'} type
     * @param {number} durationMs - auto-dismiss in ms (0 = no auto-dismiss)
     */
    addToast(message, type = 'info', durationMs = 4000) {
      const id = ++toastId
      this.toasts.push({ id, message, type, createdAt: Date.now() })

      if (durationMs > 0) {
        setTimeout(() => {
          this.removeToast(id)
        }, durationMs)
      }

      return id
    },

    removeToast(id) {
      this.toasts = this.toasts.filter(t => t.id !== id)
    },

    success(message, durationMs) {
      return this.addToast(message, 'success', durationMs)
    },

    error(message, durationMs) {
      return this.addToast(message, 'error', durationMs ?? 6000)
    },

    warning(message, durationMs) {
      return this.addToast(message, 'warning', durationMs)
    },

    info(message, durationMs) {
      return this.addToast(message, 'info', durationMs)
    },

    clearAll() {
      this.toasts = []
    }
  }
})
