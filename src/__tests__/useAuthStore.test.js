import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// vi.mock is hoisted — use vi.hoisted() for variables it references
const mockHttp = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  defaults: {
    headers: {
      common: {}
    }
  },
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() }
  }
}))

vi.mock('../api/http.js', () => ({ default: mockHttp }))

// Mock localStorage
const localStorageStore = {}
const localStorageMock = {
  getItem: vi.fn((key) => localStorageStore[key] || null),
  setItem: vi.fn((key, value) => { localStorageStore[key] = value }),
  removeItem: vi.fn((key) => { delete localStorageStore[key] }),
  clear: vi.fn(() => { for (const k in localStorageStore) delete localStorageStore[k] })
}

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true
})

import { useAuthStore } from '../stores/useAuthStore'

describe('useAuthStore', () => {
  let authStore

  beforeEach(() => {
    setActivePinia(createPinia())
    // Reset localStorage store
    for (const k in localStorageStore) delete localStorageStore[k]
    vi.clearAllMocks()
    authStore = useAuthStore()
  })

  describe('initial state', () => {
    it('should start with no user and not authenticated', () => {
      expect(authStore.user).toBeNull()
      expect(authStore.token).toBeNull()
      expect(authStore.isAuthenticated).toBe(false)
    })

    it('should not be loading initially', () => {
      expect(authStore.isLoading).toBe(false)
    })

    it('should have null error initially', () => {
      expect(authStore.error).toBeNull()
    })
  })

  describe('getters', () => {
    it('isAuthenticated should return false when token is null', () => {
      expect(authStore.isAuthenticated).toBe(false)
    })

    it('isAuthenticated should return true when token is set', () => {
      authStore.token = 'valid-token'
      expect(authStore.isAuthenticated).toBe(true)
    })

    it('currentUser should return user when set', () => {
      authStore.user = { id: 1, name: 'Test', email: 'test@test.com' }
      expect(authStore.currentUser).toEqual({ id: 1, name: 'Test', email: 'test@test.com' })
    })

    it('currentUser should return null when no user', () => {
      expect(authStore.currentUser).toBeNull()
    })
  })

  describe('setToken', () => {
    it('should store token in state and localStorage', () => {
      authStore.setToken('my-token')
      expect(authStore.token).toBe('my-token')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('token', 'my-token')
    })

    it('should set http authorization header', () => {
      authStore.setToken('my-token')
      expect(mockHttp.defaults.headers.common['Authorization']).toBe('Bearer my-token')
    })
  })

  describe('logout', () => {
    it('should clear user and token', async () => {
      mockHttp.get.mockResolvedValue({ data: {} })
      authStore.user = { id: 1, name: 'Test' }
      authStore.token = 'my-token'

      await authStore.logout()

      expect(authStore.user).toBeNull()
      expect(authStore.token).toBeNull()
    })

    it('should remove token from localStorage', async () => {
      mockHttp.get.mockResolvedValue({ data: {} })
      authStore.token = 'my-token'

      await authStore.logout()

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('token')
    })

    it('should remove auth header', async () => {
      mockHttp.get.mockResolvedValue({ data: {} })
      mockHttp.defaults.headers.common['Authorization'] = 'Bearer xyz'

      await authStore.logout()

      expect(mockHttp.defaults.headers.common['Authorization']).toBeUndefined()
    })
  })

  describe('login', () => {
    it('should set token and user on success', async () => {
      mockHttp.post.mockResolvedValue({
        data: { token: 'jwt-token', user: { id: 1, name: 'Test', email: 'test@test.com' } }
      })

      const result = await authStore.login({ email: 'test@test.com', password: 'pass' })

      expect(result.success).toBe(true)
      expect(authStore.token).toBe('jwt-token')
      expect(authStore.user.name).toBe('Test')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('token', 'jwt-token')
    })

    it('should set error on failure', async () => {
      mockHttp.post.mockRejectedValue({
        response: { data: { message: 'Invalid credentials' } }
      })

      const result = await authStore.login({ email: 'x', password: 'x' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid credentials')
      expect(authStore.error).toBe('Invalid credentials')
    })

    it('should use friendlyMessage if present', async () => {
      mockHttp.post.mockRejectedValue({
        friendlyMessage: 'Error amigable',
        response: { data: { message: 'Original error' } }
      })

      const result = await authStore.login({ email: 'x', password: 'x' })

      expect(result.error).toBe('Error amigable')
    })

    it('should set generic error when no response body', async () => {
      mockHttp.post.mockRejectedValue(new Error('Network Error'))

      const result = await authStore.login({ email: 'x', password: 'x' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('No se pudo iniciar sesión.') // Fase 5B: texto en español
    })
  })

  describe('register', () => {
    it('should set token and user on success', async () => {
      mockHttp.post.mockResolvedValue({
        data: { token: 'jwt-new', user: { id: 2, name: 'New', email: 'new@test.com' } }
      })

      const result = await authStore.register({ name: 'New', email: 'new@test.com', password: 'pass123' })

      expect(result.success).toBe(true)
      expect(authStore.token).toBe('jwt-new')
      expect(authStore.user.name).toBe('New')
    })
  })

  describe('error handling', () => {
    it('clearError should reset error to null', () => {
      authStore.error = 'Something went wrong'
      authStore.clearError()
      expect(authStore.error).toBeNull()
    })
  })

  describe('restoreSession (Phase 1)', () => {
    it('does nothing without a stored token', async () => {
      const result = await authStore.restoreSession()
      expect(result.success).toBe(false)
      expect(mockHttp.get).not.toHaveBeenCalled()
      expect(authStore.isAuthenticated).toBe(false)
      expect(authStore.sessionChecked).toBe(true)
    })

    it('restores token and fetches the user from /me', async () => {
      localStorageStore.token = 'stored-token'
      mockHttp.get.mockResolvedValue({ data: { user: { id: 1, name: 'Ana', email: 'ana@x.com' } } })

      const promise = authStore.restoreSession()
      // Token is applied synchronously, before /me answers
      expect(authStore.token).toBe('stored-token')
      expect(mockHttp.defaults.headers.common['Authorization']).toBe('Bearer stored-token')

      const result = await promise
      expect(mockHttp.get).toHaveBeenCalledWith('/me')
      expect(result.success).toBe(true)
      expect(authStore.user.name).toBe('Ana')
    })

    it('logs out when the token is invalid (401)', async () => {
      localStorageStore.token = 'expired'
      mockHttp.get.mockRejectedValue({ response: { status: 401, data: { message: 'Unauthorized' } } })

      const result = await authStore.restoreSession()

      expect(result).toEqual({ success: false, error: 'invalid-token' })
      expect(authStore.token).toBeNull()
      expect(authStore.user).toBeNull()
      expect(authStore.isAuthenticated).toBe(false)
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('token')
      expect(mockHttp.defaults.headers.common['Authorization']).toBeUndefined()
    })

    it('keeps the session on network errors', async () => {
      localStorageStore.token = 'stored-token'
      mockHttp.get.mockRejectedValue(new Error('Network Error'))

      const result = await authStore.restoreSession()

      expect(result.success).toBe(false)
      expect(authStore.token).toBe('stored-token')
      expect(authStore.isAuthenticated).toBe(true)
    })
  })
})
