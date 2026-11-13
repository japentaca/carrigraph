import { ref, watch } from 'vue'

const THEME_KEY = 'carrigraph_theme'

const currentTheme = ref(loadTheme())

function loadTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch (e) {
    // localStorage not available
  }
  return 'dark' // default
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

// Apply on load
applyTheme(currentTheme.value)

/**
 * Composable para toggle del tema claro/oscuro.
 * Persiste en localStorage.
 */
export function useTheme() {
  const toggle = () => {
    currentTheme.value = currentTheme.value === 'dark' ? 'light' : 'dark'
    applyTheme(currentTheme.value)
    try {
      localStorage.setItem(THEME_KEY, currentTheme.value)
    } catch (e) {
      // ignore
    }
  }

  return {
    theme: currentTheme,
    isDark: () => currentTheme.value === 'dark',
    isLight: () => currentTheme.value === 'light',
    toggle
  }
}
