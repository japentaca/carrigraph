// @vitest-environment jsdom
// Guest mode: no credentials, public projects and a blank editor, nothing saved.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mockHttp = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  defaults: { headers: { common: {} } },
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } }
}))

vi.mock('../api/http.js', () => ({ default: mockHttp }))

import { useAuthStore } from '../stores/useAuthStore'
import { useProjectStore } from '../stores/useProjectStore'
import { saveStatusLabel } from '../composables/useAutosave.js'
import router from '../router/index.js'

describe('guest mode', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('enters without credentials or requests, and survives a reload of the tab', () => {
    const auth = useAuthStore()
    expect(auth.isGuest).toBe(false)
    expect(auth.enterGuest()).toBe(true)
    expect(auth.isGuest).toBe(true)
    expect(auth.isAuthenticated).toBe(false)
    expect(mockHttp.post).not.toHaveBeenCalled()
    expect(mockHttp.get).not.toHaveBeenCalled()

    // "reload": a new store reads the flag back
    setActivePinia(createPinia())
    expect(useAuthStore().isGuest).toBe(true)
  })

  it('ends when the user signs in, and cannot start with a session', async () => {
    const auth = useAuthStore()
    auth.enterGuest()
    mockHttp.post.mockResolvedValueOnce({ data: { token: 't', user: { id: 1, name: 'A' } } })
    await auth.login({ email: 'a@b.c', password: '12345678' })
    expect(auth.isGuest).toBe(false)
    expect(sessionStorage.getItem('guest')).toBeNull()
    expect(auth.enterGuest()).toBe(false)
    expect(auth.isGuest).toBe(false)
  })

  it('never sends a save to the server', async () => {
    useAuthStore().enterGuest()
    const projects = useProjectStore()
    projects.loadProject({ id: null, name: 'x', nodes: [], edges: [] })
    projects.replaceGraph([{ id: 'n1', type: 'pattern', position: { x: 0, y: 0 }, data: {} }], [])
    expect(projects.isDirty).toBe(true)

    const result = await projects.saveCurrent()
    expect(result).toMatchObject({ success: false, guest: true })
    expect(mockHttp.post).not.toHaveBeenCalled()
    expect(mockHttp.put).not.toHaveBeenCalled()
    expect(projects.saveStatus).toBe('idle')
    expect(projects.isDirty).toBe(true)
  })

  it('shows its own save status', () => {
    expect(saveStatusLabel({ saveStatus: 'idle', isDirty: true, isPersisted: false, isGuest: true }))
      .toEqual({ key: 'guest', label: 'Modo invitado · no se guarda' })
  })

  describe('routes', () => {
    const resolveTo = async (path) => {
      await router.push(path).catch(() => {})
      return router.currentRoute.value
    }

    it('without a session or guest mode, the editor asks for login', async () => {
      expect((await resolveTo('/editor/gallery/3')).path).toBe('/login')
    })

    it('a guest reaches the gallery and the public-copy editor routes, not private pages', async () => {
      useAuthStore().enterGuest()
      expect((await resolveTo('/')).path).toBe('/gallery')
      expect((await resolveTo('/projects')).path).toBe('/login')
      expect((await resolveTo('/profile')).path).toBe('/login')
      // a saved project (/editor/:id) needs a session
      expect((await resolveTo('/editor/5')).path).toBe('/login')

      const allowed = (path) => {
        const to = router.resolve(path)
        return !!to.meta.allowGuest && !(to.name === 'Editor' && to.params.id)
      }
      expect(allowed('/editor')).toBe(true)
      expect(allowed('/editor/gallery/3')).toBe(true)
      expect(router.resolve('/editor/gallery/3').name).toBe('EditorGallery')
      expect(router.resolve('/editor/shared/abc').name).toBe('EditorShared')
      expect(allowed('/projects')).toBe(false)
    })
  })
})
