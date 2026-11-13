// Fase 5A — shared link / gallery player, gallery, profile, share dialog.
// Pure parts (preparePublicProject, safeRedirect, shareUrl) and the views
// mounted with a memory router and a mocked API.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { h, defineComponent, ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('../api/http.js', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), defaults: { headers: { common: {} } } } }))

import http from '../api/http.js'
import { preparePublicProject, toPublicGraph } from '../sharing/publicProject.js'
import { safeRedirect } from '../router/redirect.js'
import { shareUrl } from '../api/sharing.js'
import { usePublicPlayer, compilePublicProject } from '../composables/usePublicPlayer.js'
import { useAudioStore, setAudioEngineFactory } from '../stores/useAudioStore'
import { useAuthStore } from '../stores/useAuthStore'
import { useProjectStore } from '../stores/useProjectStore'
import { MULTITRACK_PRESETS } from '../stores/usePresetStore'
import { createEngine } from '../audio/engine/index.js'
import SharedProject from '../views/SharedProject.vue'
import Gallery from '../views/Gallery.vue'
import Profile from '../views/Profile.vue'
import ShareDialog from '../components/ShareDialog.vue'
import TransportBar from '../components/editor/TransportBar.vue'
import TimelinePanel from '../components/TimelinePanel.vue'
import { FakeAudioContext, createFakeTimers } from './helpers/fakeAudioContext.js'

const preset = (id) => JSON.parse(JSON.stringify(MULTITRACK_PRESETS.find(p => p.id === id)))
const TWO_TRACKS = preset('preset-bass-arp')

/** What GET /api/shared/:token answers (see server/routes/public.js). */
function payload(overrides = {}) {
  const g = toPublicGraph({ nodes: TWO_TRACKS.nodes, edges: TWO_TRACKS.edges, metadata: { schemaVersion: 3, tempo: 100, swing: 0.2 } })
  return {
    project: { name: 'Mi tema', description: 'Desc', ...g.graph, track_count: 2, created_at: 'T0', updated_at: 'T1', ...overrides },
    author: { name: 'Ana' }
  }
}

// Old (schema 1) project: backwards edge with old handle ids, no seed.
const OLD = {
  project: {
    name: 'Viejo',
    nodes: [
      { id: 'pat', type: 'pattern', position: { x: 0, y: 0 }, data: { algorithm: 'euclidean', density: 0.5 } },
      { id: 'voi', type: 'voice', position: { x: 300, y: 0 }, data: { instrument: 'Bass' } }
    ],
    edges: [{ id: 'old', source: 'voi', target: 'pat', sourceHandle: 'voice-input', targetHandle: 'pattern-output' }],
    metadata: {}
  },
  author: { name: 'B' }
}

let ctx, timers
function useFakeEngine() {
  ctx = new FakeAudioContext()
  timers = createFakeTimers()
  setAudioEngineFactory((opts) => createEngine({ ...opts, createContext: () => ctx, transportOptions: { timers } }))
}

function makeRouter(path) {
  const Stub = { render: () => h('div') }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/s/:token', component: SharedProject, props: { kind: 'shared' } },
      { path: '/gallery', component: Gallery },
      { path: '/gallery/:id', component: SharedProject, props: { kind: 'gallery' } },
      { path: '/profile', component: Profile },
      { path: '/editor/:id?', component: Stub },
      { path: '/login', component: Stub },
      { path: '/projects', component: Stub }
    ]
  })
  router.push(path)
  return router
}

async function mountRoute(path, { stubs = {} } = {}) {
  const router = makeRouter(path)
  await router.isReady()
  const wrapper = mount({ template: '<router-view />' }, {
    global: { plugins: [router], stubs: { ReadOnlyGraph: true, LevelMeter: true, Oscilloscope: true, ...stubs } },
    attachTo: document.body
  })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  useFakeEngine()
})

afterEach(() => {
  document.body.innerHTML = ''
})

// -----------------------------------------------------------------------------
describe('preparePublicProject / toPublicGraph (puro)', () => {
  it('migrates an old project and checks its shape', () => {
    const r = preparePublicProject(OLD)
    expect(r.ok).toBe(true)
    expect(r.project.metadata.schemaVersion).toBe(3)
    expect(r.project.edges[0]).toMatchObject({ source: 'pat', target: 'voi', sourceHandle: 'pattern', targetHandle: 'notes' })
    expect(typeof r.project.nodes[0].data.seed).toBe('number')
    expect(r.project.settings).toEqual({ tempo: 120, swing: 0 })
    expect(r.author).toBe('B')
    // compiles to one track (compat mode)
    expect(compilePublicProject(r.project).score.tracks).toHaveLength(1)
  })

  it('rejects a payload that fails the same shape check as the server', () => {
    expect(preparePublicProject(null).ok).toBe(false)
    expect(preparePublicProject({ project: { nodes: 'x', edges: [] } }).ok).toBe(false)
    expect(preparePublicProject({ project: { nodes: [{ type: 'pattern' }], edges: [] } }).ok).toBe(false)
    expect(preparePublicProject({ project: { nodes: [{ id: 'a' }], edges: [{ source: 'a' }] } }).ok).toBe(false)
    expect(preparePublicProject({ project: { nodes: [{ id: 'a', position: { x: 'no', y: 0 } }], edges: [] } }).error).toMatch(/formato inválido/)
  })

  it('keeps only public fields of nodes and edges', () => {
    const g = toPublicGraph({
      nodes: [{ id: 'a', type: 'steps', position: { x: 1, y: 2 }, data: { steps: [true] }, selected: true, dimensions: { width: 3 }, secret: 1 }],
      edges: [],
      metadata: { schemaVersion: 3, created_by: 7, tempo: 300 }
    })
    expect(g.graph.nodes[0]).toEqual({ id: 'a', type: 'steps', position: { x: 1, y: 2 }, data: { steps: [true] } })
    expect(g.graph.metadata).toEqual({ schemaVersion: 3, tempo: 200, swing: 0 })
  })

  it('safeRedirect only accepts same-app paths; shareUrl builds the link', () => {
    expect(safeRedirect('/s/abc')).toBe('/s/abc')
    expect(safeRedirect('/gallery?page=2')).toBe('/gallery?page=2')
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', undefined, ['/x']]) {
      expect(safeRedirect(bad)).toBe('/projects')
    }
    expect(shareUrl({ token: 'T'.repeat(32) }, 'http://x')).toBe(`http://x/s/${'T'.repeat(32)}`)
    expect(shareUrl(null)).toBe('')
  })
})

// -----------------------------------------------------------------------------
describe('usePublicPlayer', () => {
  it('plays the project with its own tempo and never touches the project store', async () => {
    const project = ref(preparePublicProject(payload()).project)
    let player
    const w = mount(defineComponent({ setup() { player = usePublicPlayer(project); return () => h('div') } }))
    const audio = useAudioStore()
    expect(player.canPlay.value).toBe(true)
    expect(player.tempo.value).toBe(100)
    await player.togglePlay()
    expect(audio.isPlaying).toBe(true)
    expect(player.isPlaying.value).toBe(true)
    expect(audio.tempo).toBe(100)
    expect(audio.currentScore.tracks.length).toBe(player.compiled.value.score.tracks.length)
    expect(useProjectStore().nodes).toEqual([])
    expect(useProjectStore().currentProject).toBe(null)
    // read-only transport: tempo/swing setters do nothing
    player.setTempo(150)
    expect(player.tempo.value).toBe(100)
    w.unmount()
    expect(audio.isPlaying).toBe(false)
  })
})

// -----------------------------------------------------------------------------
describe('vista /s/:token', () => {
  it('shows the project read-only: graph, transport and piano roll, no editing controls', async () => {
    http.get.mockResolvedValueOnce({ data: payload() })
    const { wrapper } = await mountRoute(`/s/${'a'.repeat(32)}`)
    expect(http.get).toHaveBeenCalledWith(`/shared/${'a'.repeat(32)}`, { skipAuthRedirect: true })
    const text = wrapper.text()
    expect(text).toContain('Mi tema')
    expect(text).toContain('por Ana')
    expect(text).toContain('Solo lectura')
    expect(text).toContain('100 BPM')

    const graph = wrapper.findComponent({ name: 'ReadOnlyGraph' })
    expect(graph.exists()).toBe(true)
    expect(graph.props('nodes')).toHaveLength(TWO_TRACKS.nodes.length)

    // No tempo/swing inputs, no Tap, no save; M/S disabled
    expect(wrapper.find('input[type="number"]').exists()).toBe(false)
    expect(wrapper.findAll('button').some(b => /Tap|Guardar|Compartir/.test(b.text()))).toBe(false)
    const mix = wrapper.findAll('.mix-btn')
    expect(mix.length).toBeGreaterThan(0)
    for (const b of mix) expect(b.attributes('disabled')).toBeDefined()
    // Piano roll with the tracks of the shared project
    expect(wrapper.findAll('.roll__row').length).toBeGreaterThan(1)

    // Without a session there is no copy button, only a login link that comes back
    expect(wrapper.findAll('button').some(b => b.text().includes('Hacer una copia'))).toBe(false)
    const login = wrapper.find('a[href^="/login"]')
    expect(decodeURIComponent(login.attributes('href'))).toContain(`redirect=/s/${'a'.repeat(32)}`)

    // Play from the transport bar
    await wrapper.find('.transport__play').trigger('click')
    await flushPromises()
    expect(useAudioStore().isPlaying).toBe(true)
    wrapper.unmount()
    expect(useAudioStore().isPlaying).toBe(false)
  })

  it('signed-in users can make a copy and land in the editor', async () => {
    useAuthStore().token = 'jwt'
    http.get.mockResolvedValueOnce({ data: payload() })
    http.post.mockResolvedValueOnce({ data: { id: 42, name: 'Mi tema (copia)' } })
    const { wrapper, router } = await mountRoute(`/s/${'b'.repeat(32)}`)
    const btn = wrapper.findAll('button').find(b => b.text().includes('Hacer una copia'))
    expect(btn).toBeTruthy()
    await btn.trigger('click')
    await flushPromises()
    expect(http.post).toHaveBeenCalledWith(`/shared/${'b'.repeat(32)}/copy`)
    expect(router.currentRoute.value.path).toBe('/editor/42')
  })

  it('a revoked or unknown link shows a clear message', async () => {
    http.get.mockRejectedValueOnce(Object.assign(new Error('nf'), { response: { status: 404, data: {} } }))
    const { wrapper } = await mountRoute(`/s/${'c'.repeat(32)}`)
    expect(wrapper.text()).toContain('Enlace no disponible')
    expect(wrapper.findComponent({ name: 'ReadOnlyGraph' }).exists()).toBe(false)
  })

  it('content with an invalid shape is not drawn', async () => {
    http.get.mockResolvedValueOnce({ data: { project: { name: 'X', nodes: [{ type: 'pattern' }], edges: [] }, author: { name: 'Z' } } })
    const { wrapper } = await mountRoute(`/s/${'d'.repeat(32)}`)
    expect(wrapper.text()).toContain('No se puede mostrar')
    expect(wrapper.findComponent({ name: 'ReadOnlyGraph' }).exists()).toBe(false)
  })

  it('/gallery/:id uses the gallery endpoint and copies from it', async () => {
    useAuthStore().token = 'jwt'
    http.get.mockResolvedValueOnce({ data: { ...payload(), id: 7 } })
    http.post.mockResolvedValueOnce({ data: { id: 50 } })
    const { wrapper } = await mountRoute('/gallery/7')
    expect(http.get).toHaveBeenCalledWith('/gallery/7', { skipAuthRedirect: true })
    await wrapper.findAll('button').find(b => b.text().includes('Hacer una copia')).trigger('click')
    await flushPromises()
    expect(http.post).toHaveBeenCalledWith('/gallery/7/copy')
  })
})

// -----------------------------------------------------------------------------
describe('vista /gallery', () => {
  const items = (n, start = 1) => Array.from({ length: n }, (_, i) => ({
    id: start + i, name: `P${start + i}`, description: '', author: 'Ana', track_count: 2,
    published_at: '2026-01-02 10:00:00.000', updated_at: '2026-01-02 10:00:00.000'
  }))

  it('lists name, author, tracks and date; plays a project directly', async () => {
    http.get.mockResolvedValueOnce({ data: { items: items(2), page: 1, limit: 12, total: 2, pages: 1 } })
    const { wrapper } = await mountRoute('/gallery')
    expect(http.get).toHaveBeenCalledWith('/gallery', { params: { page: 1, limit: 12 }, skipAuthRedirect: true })
    const cards = wrapper.findAll('.gallery__card')
    expect(cards).toHaveLength(2)
    expect(cards[0].text()).toContain('P1')
    expect(cards[0].text()).toContain('por Ana')
    expect(cards[0].text()).toContain('2 pistas')
    expect(cards[0].text()).toMatch(/2026/)
    expect(cards[0].find('a').attributes('href')).toBe('/gallery/1')

    http.get.mockResolvedValueOnce({ data: { ...payload(), id: 1 } })
    await cards[0].find('button').trigger('click')
    await flushPromises()
    expect(http.get).toHaveBeenLastCalledWith('/gallery/1', { skipAuthRedirect: true })
    const audio = useAudioStore()
    expect(audio.isPlaying).toBe(true)
    expect(audio.tempo).toBe(100)
    expect(cards[0].find('button').text()).toContain('Detener')
    await cards[0].find('button').trigger('click')
    expect(audio.isPlaying).toBe(false)
  })

  it('paginates through the query string', async () => {
    http.get.mockResolvedValueOnce({ data: { items: items(12), page: 1, limit: 12, total: 13, pages: 2 } })
    const { wrapper, router } = await mountRoute('/gallery')
    expect(wrapper.text()).toContain('Página 1 de 2')
    http.get.mockResolvedValueOnce({ data: { items: items(1, 13), page: 2, limit: 12, total: 13, pages: 2 } })
    await wrapper.findAll('.gallery__pager button')[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.page).toBe('2')
    expect(http.get).toHaveBeenLastCalledWith('/gallery', { params: { page: 2, limit: 12 }, skipAuthRedirect: true })
    expect(wrapper.findAll('.gallery__card')).toHaveLength(1)
  })

  it('empty gallery', async () => {
    http.get.mockResolvedValueOnce({ data: { items: [], page: 1, limit: 12, total: 0, pages: 1 } })
    const { wrapper } = await mountRoute('/gallery')
    expect(wrapper.text()).toContain('Todavía no hay proyectos publicados')
  })
})

// -----------------------------------------------------------------------------
describe('vista /profile', () => {
  const setup = async () => {
    const auth = useAuthStore()
    auth.setToken('jwt')
    auth.user = { id: 1, name: 'Ana', email: 'ana@example.com' }
    http.get.mockResolvedValue({ data: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] })
    return mountRoute('/profile')
  }

  it('validates the new password (8+, repeated) before calling the server', async () => {
    const { wrapper } = await setup()
    await wrapper.find('#pw-current').setValue('vieja-clave')
    await wrapper.find('#pw-new').setValue('corta')
    await wrapper.find('#pw-confirm').setValue('corta')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('al menos 8 caracteres')
    await wrapper.find('#pw-new').setValue('nueva-clave-1')
    await wrapper.find('#pw-confirm').setValue('otra-cosa-22')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('no coinciden')
    expect(http.put).not.toHaveBeenCalled()
  })

  it('changes the password; a wrong current password does not end the session', async () => {
    const { wrapper } = await setup()
    await wrapper.find('#pw-current').setValue('mala-clave')
    await wrapper.find('#pw-new').setValue('nueva-clave-1')
    await wrapper.find('#pw-confirm').setValue('nueva-clave-1')
    http.put.mockRejectedValueOnce(Object.assign(new Error('401'), { response: { status: 401, data: {} } }))
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(http.put).toHaveBeenCalledWith('/change-password', { currentPassword: 'mala-clave', newPassword: 'nueva-clave-1' }, { skipAuthRedirect: true })
    expect(wrapper.text()).toContain('La contraseña actual no es correcta')
    expect(useAuthStore().isAuthenticated).toBe(true)

    http.put.mockResolvedValueOnce({ data: { message: 'ok' } })
    await wrapper.find('#pw-current').setValue('buena-clave')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('#pw-new').element.value).toBe('')
  })

  it('deleting the account needs the password, the checkbox and an explicit confirmation', async () => {
    const { wrapper, router } = await setup()
    expect(wrapper.text()).toContain('tus 2 proyectos')
    const forms = wrapper.findAll('form')
    const delButton = forms[1].find('button')
    expect(delButton.attributes('disabled')).toBeDefined()
    await wrapper.find('#del-password').setValue('password123')
    expect(delButton.attributes('disabled')).toBeDefined()
    await forms[1].find('input[type="checkbox"]').setValue(true)
    expect(delButton.attributes('disabled')).toBeUndefined()
    await forms[1].trigger('submit')
    expect(http.delete).not.toHaveBeenCalled()
    // Confirmation dialog
    const dialog = document.body.querySelector('[role="alertdialog"]')
    expect(dialog.textContent).toContain('¿Borrar tu cuenta para siempre?')
    http.delete.mockResolvedValueOnce({ data: { message: 'ok' } })
    const confirm = [...dialog.querySelectorAll('button')].find(b => b.textContent.includes('Sí, borrar'))
    confirm.click()
    await flushPromises()
    expect(http.delete).toHaveBeenCalledWith('/account', { data: { password: 'password123' }, skipAuthRedirect: true })
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(localStorage.getItem('token')).toBe(null)
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('a wrong password keeps the account and the session', async () => {
    const { wrapper } = await setup()
    await wrapper.find('#del-password').setValue('mala')
    await wrapper.findAll('form')[1].find('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('form')[1].trigger('submit')
    http.delete.mockRejectedValueOnce(Object.assign(new Error('401'), { response: { status: 401, data: {} } }))
    ;[...document.body.querySelectorAll('[role="alertdialog"] button')].find(b => b.textContent.includes('Sí, borrar')).click()
    await flushPromises()
    expect(wrapper.text()).toContain('La contraseña no es correcta')
    expect(useAuthStore().isAuthenticated).toBe(true)
  })
})

// -----------------------------------------------------------------------------
describe('ShareDialog', () => {
  const TOKEN = 'Z'.repeat(32)
  const mountDialog = async () => {
    const w = mount(ShareDialog, { props: { visible: true, project: { id: 5, name: 'Tema' } }, attachTo: document.body })
    await flushPromises()
    return w
  }

  it('creates, copies and revokes the link (with confirmation)', async () => {
    http.get.mockResolvedValueOnce({ data: { share: null, is_public: false } })
    const w = await mountDialog()
    expect(http.get).toHaveBeenCalledWith('/projects/5/share')
    const body = () => document.body.querySelector('.share-dialog')
    const button = (text) => [...body().querySelectorAll('button')].find(b => b.textContent.includes(text))

    http.post.mockResolvedValueOnce({ data: { share: { token: TOKEN, path: `/s/${TOKEN}` } } })
    button('Crear enlace').click()
    await flushPromises()
    expect(http.post).toHaveBeenCalledWith('/projects/5/share')
    expect(body().querySelector('#share-url').value).toBe(`${location.origin}/s/${TOKEN}`)
    expect(w.emitted('changed').at(-1)[0]).toEqual({ share_token: TOKEN, is_public: 0 })

    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    button('Copiar').click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/s/${TOKEN}`)

    button('Revocar').click()
    await nextTick()
    expect(http.delete).not.toHaveBeenCalled()
    http.delete.mockResolvedValueOnce({ data: { revoked: true } })
    button('Sí, revocar').click()
    await flushPromises()
    expect(http.delete).toHaveBeenCalledWith('/projects/5/share')
    expect(body().querySelector('#share-url')).toBe(null)
    expect(w.emitted('changed').at(-1)[0]).toEqual({ share_token: null, is_public: 0 })
    w.unmount()
  })

  it('publishes and unpublishes in the gallery', async () => {
    http.get.mockResolvedValueOnce({ data: { share: { token: TOKEN }, is_public: false } })
    const w = await mountDialog()
    const box = document.body.querySelector('.share-check input')
    http.put.mockResolvedValueOnce({ data: { is_public: true, published_at: 'T' } })
    box.checked = true
    box.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(http.put).toHaveBeenCalledWith('/projects/5/public', { public: true })
    expect(w.emitted('changed').at(-1)[0]).toEqual({ share_token: TOKEN, is_public: 1 })
    w.unmount()
  })
})

// -----------------------------------------------------------------------------
describe('piezas reutilizadas en modo solo lectura', () => {
  it('TransportBar readonly shows tempo and swing as text', () => {
    const t = {
      isPlaying: ref(false), canPlay: ref(true), position: ref(null), cycleBars: ref(1),
      tempo: ref(97), swing: ref(0.3), volume: ref(0.7), loop: ref(true),
      setTempo: vi.fn(), setSwing: vi.fn(), tap: vi.fn(), setVolume: vi.fn(), setLoop: vi.fn(), togglePlay: vi.fn()
    }
    const w = mount(TransportBar, { props: { transport: t, readonly: true }, global: { stubs: { LevelMeter: true, Oscilloscope: true } } })
    expect(w.text()).toContain('97 BPM')
    expect(w.text()).toContain('30%')
    expect(w.find('input[type="number"]').exists()).toBe(false)
    expect(w.find('.transport__tap').exists()).toBe(false)
    w.find('.transport__play').trigger('click')
    expect(t.togglePlay).toHaveBeenCalled()
  })

  it('TimelinePanel with a given compilation does not use the editor graph and cannot mix', async () => {
    const project = preparePublicProject(payload()).project
    const compiled = compilePublicProject(project)
    const w = mount(TimelinePanel, { props: { compiled, readonly: true } })
    expect(w.findAll('.roll__row').length).toBe(compiled.score.tracks.length + 1) // + ruler
    const m = w.find('.mix-btn--mute')
    expect(m.attributes('disabled')).toBeDefined()
    expect(m.attributes('title')).toMatch(/solo lectura/)
  })
})
