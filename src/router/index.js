import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/useAuthStore'
import { safeRedirect } from './redirect.js'

// Every view is loaded on demand (its own chunk). The editor (Vue Flow, node
// components, compiler and audio engine) is by far the largest; Login and
// Projects stay small so the first screen loads fast (Fase 5B).
const Editor = () => import('../views/Editor.vue')
const Login = () => import('../views/Login.vue')
const Projects = () => import('../views/Projects.vue')
const SharedProject = () => import('../views/SharedProject.vue')
const Gallery = () => import('../views/Gallery.vue')
const Profile = () => import('../views/Profile.vue')

const routes = [
  {
    path: '/',
    redirect: () => (useAuthStore().isGuest ? '/gallery' : '/projects')
  },
  {
    path: '/login',
    name: 'Login',
    component: Login,
    meta: { requiresGuest: true }
  },
  {
    path: '/projects',
    name: 'Projects',
    component: Projects,
    meta: { requiresAuth: true }
  },
  // A public project opened in the editor as an unsaved copy (guest mode, or
  // a signed-in user trying it out): nothing is written to the original.
  {
    path: '/editor/gallery/:galleryId(\\d+)',
    name: 'EditorGallery',
    component: Editor,
    meta: { requiresAuth: true, allowGuest: true }
  },
  {
    path: '/editor/shared/:token',
    name: 'EditorShared',
    component: Editor,
    meta: { requiresAuth: true, allowGuest: true }
  },
  // Guests get the blank editor (/editor); /editor/:id is a saved project and needs a session.
  {
    path: '/editor/:id?',
    name: 'Editor',
    component: Editor,
    meta: { requiresAuth: true, allowGuest: true }
  },
  // Public, read-only (with or without a session)
  {
    path: '/s/:token',
    name: 'Shared',
    component: SharedProject,
    props: { kind: 'shared' }
  },
  {
    path: '/gallery',
    name: 'Gallery',
    component: Gallery
  },
  {
    path: '/gallery/:id(\\d+)',
    name: 'GalleryProject',
    component: SharedProject,
    props: { kind: 'gallery' }
  },
  {
    path: '/profile',
    name: 'Profile',
    component: Profile,
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Navigation guards
router.beforeEach((to) => {
  const authStore = useAuthStore()
  const isAuthenticated = authStore.isAuthenticated

  // Guest mode: only the routes that allow it, and never a saved project (/editor/:id).
  const asGuest = authStore.isGuest && !!to.meta.allowGuest && !(to.name === 'Editor' && to.params.id)

  if (to.meta.requiresAuth && !isAuthenticated && !asGuest) return { path: '/login', query: { redirect: to.fullPath } }
  if (to.meta.requiresGuest && isAuthenticated) return safeRedirect(to.query.redirect)
  return true
})

export default router