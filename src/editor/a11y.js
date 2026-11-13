/**
 * a11y.js — small DOM helpers for accessibility (Fase 4B). No Vue.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'summary',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/** Focusable elements inside `root`, in DOM order (visible ones only when layout exists). */
export function focusableIn(root) {
  if (!root) return []
  const layout = !isJsdom()
  return [...root.querySelectorAll(FOCUSABLE)].filter(el => {
    if (el.closest('[inert],[hidden]')) return false
    // Hidden by CSS (display:none, collapsed <details>): no boxes. jsdom has no layout.
    return !layout || el.getClientRects().length > 0
  })
}

const isJsdom = () => typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')

/**
 * Keep Tab / Shift+Tab inside `root` (modal dialogs). Call from a keydown
 * handler; returns true when it moved the focus.
 */
export function trapTab(event, root) {
  if (event.key !== 'Tab' || !root) return false
  const items = focusableIn(root)
  if (!items.length) {
    event.preventDefault()
    root.focus?.()
    return true
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = root.ownerDocument.activeElement
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault()
    last.focus()
    return true
  }
  if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault()
    first.focus()
    return true
  }
  return false
}

/**
 * Give an accessible name to the controls of a node parameter panel: every
 * `.cg-label` / `.parameter-label` that is not a <label for> names the
 * control(s) that follow it (aria-label on a single input/select, or a
 * role="group" with aria-label around a set of buttons). Idempotent.
 * @returns {number} how many controls were labelled
 */
export function labelControls(root) {
  if (!root?.querySelectorAll) return 0
  let count = 0
  for (const label of root.querySelectorAll('.cg-label, .parameter-label')) {
    if (label.tagName === 'LABEL' && label.htmlFor) continue
    if (label.tagName === 'SUMMARY') continue
    const text = label.textContent.replace(/\s+/g, ' ').trim()
    if (!text) continue
    let target = label.nextElementSibling
    while (target && !target.matches('input,select,textarea,button,div,span')) target = target.nextElementSibling
    if (!target) continue
    if (target.matches('input,select,textarea')) {
      if (!target.getAttribute('aria-label')) { target.setAttribute('aria-label', text); count++ }
      continue
    }
    const controls = target.querySelectorAll('input,select,textarea')
    if (controls.length && !target.querySelector('button')) {
      // A slider with its exact-value field: the label names the first unnamed one.
      const first = [...controls].find(c => !c.getAttribute('aria-label'))
      if (first && first === controls[0]) { first.setAttribute('aria-label', text); count++ }
    } else if (target.querySelector('button') && !target.getAttribute('aria-label')) {
      target.setAttribute('role', 'group')
      target.setAttribute('aria-label', text)
      count++
    }
  }
  return count
}
