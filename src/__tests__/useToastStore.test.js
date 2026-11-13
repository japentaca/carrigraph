import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useToastStore } from '../stores/useToastStore'

describe('useToastStore', () => {
  let toastStore

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    toastStore = useToastStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('should start with empty toasts array', () => {
      expect(toastStore.toasts).toEqual([])
    })
  })

  describe('addToast', () => {
    it('should add a toast with default type info', () => {
      toastStore.addToast('Hello')
      expect(toastStore.toasts).toHaveLength(1)
      expect(toastStore.toasts[0].message).toBe('Hello')
      expect(toastStore.toasts[0].type).toBe('info')
    })

    it('should assign unique ids', () => {
      const id1 = toastStore.addToast('First')
      const id2 = toastStore.addToast('Second')
      expect(id1).not.toBe(id2)
      expect(toastStore.toasts).toHaveLength(2)
    })

    it('should auto-dismiss after default 4 seconds', () => {
      toastStore.addToast('Temp')
      expect(toastStore.toasts).toHaveLength(1)

      vi.advanceTimersByTime(4000)
      expect(toastStore.toasts).toHaveLength(0)
    })

    it('should respect custom duration', () => {
      toastStore.addToast('Quick', 'info', 1000)
      expect(toastStore.toasts).toHaveLength(1)

      vi.advanceTimersByTime(999)
      expect(toastStore.toasts).toHaveLength(1)

      vi.advanceTimersByTime(1)
      expect(toastStore.toasts).toHaveLength(0)
    })

    it('should not auto-dismiss when duration is 0', () => {
      toastStore.addToast('Sticky', 'info', 0)
      vi.advanceTimersByTime(10000)
      expect(toastStore.toasts).toHaveLength(1)
    })
  })

  describe('removeToast', () => {
    it('should remove specific toast by id', () => {
      const id1 = toastStore.addToast('Keep')
      const id2 = toastStore.addToast('Remove')
      toastStore.removeToast(id2)
      expect(toastStore.toasts).toHaveLength(1)
      expect(toastStore.toasts[0].id).toBe(id1)
    })
  })

  describe('convenience methods', () => {
    it('success should add toast with success type', () => {
      toastStore.success('OK!')
      expect(toastStore.toasts[0].type).toBe('success')
      expect(toastStore.toasts[0].message).toBe('OK!')
    })

    it('error should add toast with error type and 6s default', () => {
      toastStore.error('Fail!')
      expect(toastStore.toasts[0].type).toBe('error')

      vi.advanceTimersByTime(4000)
      expect(toastStore.toasts).toHaveLength(1) // still there

      vi.advanceTimersByTime(2000)
      expect(toastStore.toasts).toHaveLength(0) // gone after 6s
    })

    it('warning should add toast with warning type', () => {
      toastStore.warning('Careful')
      expect(toastStore.toasts[0].type).toBe('warning')
    })

    it('info should add toast with info type', () => {
      toastStore.info('Note')
      expect(toastStore.toasts[0].type).toBe('info')
    })
  })

  describe('clearAll', () => {
    it('should remove all toasts', () => {
      toastStore.addToast('A')
      toastStore.addToast('B')
      toastStore.addToast('C')
      toastStore.clearAll()
      expect(toastStore.toasts).toHaveLength(0)
    })
  })
})
