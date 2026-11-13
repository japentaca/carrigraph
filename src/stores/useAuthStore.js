import { defineStore } from 'pinia'
import http from '../api/http.js'

/**
 * Guest mode: no account and no token. A guest can open public projects
 * (gallery, shared links) or a blank one in the editor and change them, but
 * nothing is ever sent to the server. The flag lives in sessionStorage: it
 * survives a reload and ends with the tab (or by signing in).
 */
const GUEST_KEY = 'guest'
const readGuestFlag = () => {
  try { return sessionStorage.getItem(GUEST_KEY) === '1' } catch { return false }
}
const writeGuestFlag = (on) => {
  try {
    if (on) sessionStorage.setItem(GUEST_KEY, '1')
    else sessionStorage.removeItem(GUEST_KEY)
  } catch { /* storage blocked: guest mode lasts until reload */ }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    token: null,
    isLoading: false,
    error: null,
    // true once restoreSession() has checked the stored token with the server
    sessionChecked: false,
    /** Guest mode chosen (see isGuest: a session always wins). */
    guest: readGuestFlag()
  }),

  getters: {
    isAuthenticated: (state) => !!state.token,
    /** Using the app without an account: edits stay in the browser, nothing is saved. */
    isGuest: (state) => state.guest && !state.token,
    currentUser: (state) => state.user
  },

  actions: {
    async login(credentials) {
      this.isLoading = true
      this.error = null
      
      try {
        const response = await http.post('/login', credentials)
        const { token, user } = response.data
        this.leaveGuest()
        
        this.token = token
        this.user = user
        
        // Store token in localStorage
        localStorage.setItem('token', token)
        
        // Set default authorization header
        http.defaults.headers.common['Authorization'] = `Bearer ${token}`
        
        return { success: true }
      } catch (error) {
        this.error = error.friendlyMessage || error.response?.data?.message || 'No se pudo iniciar sesión.'
        return { success: false, error: this.error }
      } finally {
        this.isLoading = false
      }
    },

    async register(userData) {
      this.isLoading = true
      this.error = null
      
      try {
        const response = await http.post('/register', userData)
        const { token, user } = response.data
        this.leaveGuest()
        
        this.token = token
        this.user = user
        
        // Store token in localStorage
        localStorage.setItem('token', token)
        
        http.defaults.headers.common['Authorization'] = `Bearer ${token}`
        
        return { success: true }
      } catch (error) {
        this.error = error.friendlyMessage || error.response?.data?.message || 'No se pudo crear la cuenta.'
        return { success: false, error: this.error }
      } finally {
        this.isLoading = false
      }
    },

    async logout() {
      try {
        await http.get('/logout')
      } catch (error) {
        console.error('Logout error:', error)
      } finally {
        this.clearSession()
      }
    },

    /** Enter guest mode (no request, no credentials). No effect with a session. */
    enterGuest() {
      if (this.token) return false
      this.guest = true
      writeGuestFlag(true)
      return true
    },

    leaveGuest() {
      this.guest = false
      writeGuestFlag(false)
    },

    /** Forget token and user locally (no request). */
    clearSession() {
      this.token = null
      this.user = null
      localStorage.removeItem('token')
      delete http.defaults.headers.common['Authorization']
    },

    /**
     * On page load: take the token from localStorage and ask the server who
     * the user is (GET /api/me). If the token is rejected (401), log out.
     * Network errors keep the token so the user is not logged out offline.
     * The token is set synchronously, before the first await, so router
     * guards see the session immediately.
     */
    async restoreSession() {
      const token = localStorage.getItem('token')
      if (!token) {
        this.sessionChecked = true
        return { success: false }
      }

      this.setToken(token)

      try {
        const response = await http.get('/me')
        this.user = response.data.user
        return { success: true }
      } catch (error) {
        const status = error.response?.status
        if (status === 401 || status === 403 || status === 404) {
          this.clearSession()
          return { success: false, error: 'invalid-token' }
        }
        return { success: false, error: error.friendlyMessage || 'network' }
      } finally {
        this.sessionChecked = true
      }
    },

    setToken(token) {
      this.leaveGuest()
      this.token = token
      localStorage.setItem('token', token)
      http.defaults.headers.common['Authorization'] = `Bearer ${token}`
    },

    clearError() {
      this.error = null
    }
  }
})