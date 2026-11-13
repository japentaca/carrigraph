/**
 * vTrapFocus — directive for dialogs (Fase 4B): when the element mounts it
 * takes the focus (first focusable element, or `[data-autofocus]`), keeps
 * Tab / Shift+Tab inside, calls the bound function on Escape, and gives the
 * focus back to where it was when it unmounts.
 *
 *   <div role="dialog" aria-modal="true" v-trap-focus="close">…</div>
 *
 * The global shortcuts (useKeyboard) ignore keys pressed inside an
 * aria-modal element, so Escape / Delete / Space there belong to the dialog.
 */

import { nextTick } from 'vue'
import { focusableIn, trapTab } from '../editor/a11y.js'

const STATE = Symbol('trapFocus')

export const vTrapFocus = {
  mounted(el, binding) {
    const previous = typeof document !== 'undefined' ? document.activeElement : null
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        const fn = el[STATE]?.onEscape
        if (typeof fn === 'function') {
          event.preventDefault()
          event.stopPropagation()
          fn(event)
        }
        return
      }
      trapTab(event, el)
    }
    el[STATE] = { previous, onKeydown, onEscape: binding.value }
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    el.addEventListener('keydown', onKeydown)
    nextTick(() => {
      if (!el.isConnected) return
      const target = el.querySelector('[data-autofocus]') || focusableIn(el)[0] || el
      target.focus?.({ preventScroll: true })
    })
  },
  updated(el, binding) {
    if (el[STATE]) el[STATE].onEscape = binding.value
  },
  beforeUnmount(el) {
    const state = el[STATE]
    if (!state) return
    el.removeEventListener('keydown', state.onKeydown)
    const prev = state.previous
    if (prev && prev.isConnected && typeof prev.focus === 'function' && prev !== document.body) {
      // After the DOM update, so the focus does not land in the removed dialog.
      setTimeout(() => { if (prev.isConnected) prev.focus({ preventScroll: true }) }, 0)
    }
    delete el[STATE]
  }
}
