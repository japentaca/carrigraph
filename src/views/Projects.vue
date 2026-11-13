<template>
  <div class="projects-container">
    <div class="projects-header">
      <div class="header-content">
        <h1>Mis proyectos</h1>
        <div class="header-actions">
          <div class="search-box">
            <input 
              v-model="searchQuery"
              type="text" 
              placeholder="Buscar proyectos…"
              aria-label="Buscar proyectos"
              class="search-input"
            />
          </div>
          <button @click="showCreateModal = true" class="btn">
            <span>+ Nuevo proyecto</span>
          </button>
          <button @click="handleImportCgproj" class="btn secondary">
            <span>📂 Importar .cgproj</span>
          </button>
          <router-link to="/gallery" class="btn secondary nav-link">🌐 Galería</router-link>
          <div class="user-menu">
            <button @click="showUserMenu = !showUserMenu" class="user-btn" :aria-expanded="showUserMenu" aria-haspopup="menu">
              {{ authStore.currentUser?.name || 'Usuario' }}
            </button>
            <div v-if="showUserMenu" class="user-dropdown">
              <router-link to="/profile" class="dropdown-item">Perfil</router-link>
              <button @click="handleLogout" class="dropdown-item">
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <div class="projects-content">
      <!-- Skeleton loading -->
      <div v-if="projectStore.isLoading && projectStore.projects.length === 0" class="projects-grid">
        <div v-for="n in 6" :key="'skeleton-' + n" class="project-card skeleton">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line skeleton-desc"></div>
          <div class="skeleton-line skeleton-desc short"></div>
          <div class="skeleton-line skeleton-meta"></div>
        </div>
      </div>
      
      <!-- Empty: no projects at all -->
      <div v-else-if="!projectStore.isLoading && projectStore.projects.length === 0" class="empty-state">
        <div class="empty-icon">🎵</div>
        <h3>No tenés proyectos todavía</h3>
        <p>Creá tu primer proyecto de patrones de audio para empezar.</p>
        <button @click="showCreateModal = true" class="btn">
          + Crear proyecto
        </button>
      </div>
      
      <!-- Empty: search returned nothing -->
      <div v-else-if="filteredProjects.length === 0" class="empty-state">
        <div class="empty-icon">🔍</div>
        <h3>Sin resultados</h3>
        <p>Ningún proyecto coincide con "{{ searchQuery }}".</p>
        <button @click="searchQuery = ''" class="btn secondary">
          Limpiar búsqueda
        </button>
      </div>
      
      <div v-else class="projects-grid">
        <div 
          v-for="project in filteredProjects" 
          :key="project.id"
          class="project-card"
          role="link"
          tabindex="0"
          :aria-label="`Abrir ${project.name}`"
          @click="openProject(project)"
          @keydown.enter.self="openProject(project)"
        >
          <div class="project-header">
            <h3>{{ project.name }}</h3>
            <div class="project-actions">
              <button
                @click.stop="openShare(project)"
                class="action-btn"
                title="Compartir"
                :aria-label="`Compartir ${project.name}`"
              >
                🔗
              </button>
              <button 
                @click.stop="editProject(project)"
                class="action-btn"
                title="Editar"
                :aria-label="`Editar nombre y descripción de ${project.name}`"
              >
                ✏️
              </button>
              <button 
                @click.stop="deleteProject(project.id)"
                class="action-btn danger"
                title="Eliminar"
                :aria-label="`Eliminar ${project.name}`"
              >
                🗑️
              </button>
            </div>
          </div>
          
          <p class="project-description">
            {{ project.description || 'Sin descripción' }}
          </p>
          
          <div class="project-meta">
            <span class="meta-item">
              📅 {{ formatDate(project.updated_at) }}
            </span>
            <span class="meta-item">
              🎵 {{ project.node_count ?? project.nodes?.length ?? 0 }} nodos
            </span>
            <span v-if="project.share_token" class="meta-badge" title="Tiene un enlace de solo lectura activo">🔗 Compartido</span>
            <span v-if="project.is_public" class="meta-badge" title="Aparece en la galería pública">🌐 Público</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Create/Edit Project Modal -->
    <div v-if="showCreateModal || editingProject" class="modal-overlay" @click="closeModal">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title" v-trap-focus="closeModal" @click.stop>
        <div class="modal-header">
          <h2 id="project-modal-title">{{ editingProject ? 'Editar proyecto' : 'Nuevo proyecto' }}</h2>
          <button @click="closeModal" class="close-btn" aria-label="Cerrar">×</button>
        </div>
        
        <form @submit.prevent="handleSubmit" class="modal-form">
          <div class="form-group">
            <label class="form-label" for="project-name">Nombre</label>
            <input 
              id="project-name"
              data-autofocus
              v-model="projectForm.name"
              type="text" 
              class="form-input"
              placeholder="Nombre del proyecto"
              required
            />
          </div>
          
          <div class="form-group">
            <label class="form-label" for="project-description">Descripción</label>
            <textarea 
              id="project-description"
              v-model="projectForm.description"
              class="form-input"
              placeholder="Descripción (opcional)"
              rows="3"
            ></textarea>
          </div>
          
          <div class="modal-actions">
            <button type="button" @click="closeModal" class="btn secondary">
              Cancelar
            </button>
            <button type="submit" class="btn" :disabled="projectStore.isLoading">
              {{ editingProject ? 'Guardar' : 'Crear' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <ShareDialog
      :visible="!!sharingProject"
      :project="sharingProject"
      @changed="onShareChanged"
      @close="sharingProject = null"
    />

    <ConfirmDialog
      :visible="showDeleteConfirm"
      title="¿Eliminar proyecto?"
      message="Esta acción eliminará el proyecto y todo su historial de versiones. No se puede deshacer."
      confirm-text="Eliminar"
      cancel-text="Cancelar"
      type="danger"
      :loading="projectStore.isLoading"
      @confirm="onDeleteConfirmed"
      @cancel="showDeleteConfirm = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/useAuthStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useToastStore } from '../stores/useToastStore'
import { importProjectFile } from '../composables/useProjectIO.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ShareDialog from '../components/ShareDialog.vue'
import { vTrapFocus } from '../composables/useFocusTrap.js'

const router = useRouter()
const authStore = useAuthStore()
const projectStore = useProjectStore()
const toastStore = useToastStore()

const searchQuery = ref('')
const showCreateModal = ref(false)
const showUserMenu = ref(false)
const editingProject = ref(null)
const showDeleteConfirm = ref(false)
const projectToDelete = ref(null)
const sharingProject = ref(null)

const projectForm = reactive({
  name: '',
  description: ''
})

const filteredProjects = computed(() => {
  if (!searchQuery.value) {
    return projectStore.projects
  }
  
  const query = searchQuery.value.toLowerCase()
  return projectStore.projects.filter(project => 
    project.name.toLowerCase().includes(query) ||
    (project.description && project.description.toLowerCase().includes(query))
  )
})

onMounted(() => {
  projectStore.fetchProjects()
})

const openProject = (project) => {
  router.push(`/editor/${project.id}`)
}

// Fase 5A: share link and gallery
const openShare = (project) => {
  sharingProject.value = project
}

const onShareChanged = (changes) => {
  const index = projectStore.projects.findIndex(p => p.id === sharingProject.value?.id)
  if (index !== -1) projectStore.projects[index] = { ...projectStore.projects[index], ...changes }
}

const editProject = (project) => {
  editingProject.value = project
  projectForm.name = project.name
  projectForm.description = project.description || ''
}

const deleteProject = (projectId) => {
  projectToDelete.value = projectId
  showDeleteConfirm.value = true
}

const onDeleteConfirmed = async () => {
  const result = await projectStore.deleteProject(projectToDelete.value)
  if (result.success) {
    toastStore.success('Proyecto eliminado')
  } else {
    toastStore.error(result.error || 'Error al eliminar proyecto')
  }
  showDeleteConfirm.value = false
  projectToDelete.value = null
}

const handleSubmit = async () => {
  if (editingProject.value) {
    const result = await projectStore.updateProjectInfo(editingProject.value.id, {
      name: projectForm.name,
      description: projectForm.description
    })
    
    if (result.success) {
      toastStore.success('Proyecto actualizado')
      closeModal()
    } else {
      toastStore.error(result.error || 'Error al actualizar proyecto')
    }
  } else {
    const result = await projectStore.createProject({
      name: projectForm.name,
      description: projectForm.description
    })
    
    if (result.success) {
      toastStore.success('Proyecto creado')
      closeModal()
      router.push(`/editor/${result.project.id}`)
    } else {
      toastStore.error(result.error || 'Error al crear proyecto')
    }
  }
}

const closeModal = () => {
  showCreateModal.value = false
  editingProject.value = null
  projectForm.name = ''
  projectForm.description = ''
}

const handleImportCgproj = async () => {
  const result = await importProjectFile()
  if (!result.success) {
    if (result.error !== 'Cancelado') {
      toastStore.error(result.error || 'Error al importar')
    }
    return
  }

  // Crear proyecto a partir del .cgproj importado
  const createResult = await projectStore.createProject({
    name: result.data.name,
    description: `Importado de ${result.data.name}`,
    nodes: result.data.nodes,
    edges: result.data.edges,
    // tempo / swing of the file (Fase 5B: before, importing from the list lost them)
    metadata: Object.fromEntries(['tempo', 'swing']
      .filter(k => Number.isFinite(result.data.metadata?.[k]))
      .map(k => [k, result.data.metadata[k]]))
  })

  if (createResult.success) {
    toastStore.success(`Proyecto "${result.data.name}" importado`)
    router.push(`/editor/${createResult.project.id}`)
  } else {
    toastStore.error(createResult.error || 'Error al crear proyecto desde archivo')
  }
}

const handleLogout = async () => {
  await authStore.logout()
  toastStore.info('Sesión cerrada')
  router.push('/login')
}

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleDateString('es-AR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}
</script>

<style scoped>
.projects-container {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--background-dark);
}

.projects-header {
  background: var(--background-light);
  border-bottom: 1px solid var(--border-color);
  padding: 1.5rem 2rem;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 1200px;
  margin: 0 auto;
}

.header-content h1 {
  color: var(--text-primary);
  font-size: 1.75rem;
  font-weight: bold;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.search-box {
  position: relative;
}

.search-input {
  background: var(--background-dark);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.5rem 1rem;
  color: var(--text-primary);
  width: 250px;
}

.user-menu {
  position: relative;
}

.user-btn {
  background: var(--secondary-color);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.5rem 1rem;
  cursor: pointer;
}

.user-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  background: var(--background-dark);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-top: 0.5rem;
  min-width: 120px;
  box-shadow: 0 4px 12px var(--shadow-color);
  z-index: 10;
}

.dropdown-item {
  width: 100%;
  background: none;
  border: none;
  color: var(--text-primary);
  padding: 0.75rem 1rem;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.dropdown-item:hover {
  background: var(--background-light);
}

a.dropdown-item {
  display: block;
  text-decoration: none;
  font-size: 0.875rem;
}

.nav-link {
  text-decoration: none;
}

.meta-badge {
  font-size: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 0 0.5rem;
  color: var(--text-secondary);
}

.projects-content {
  flex: 1;
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  overflow-y: auto;
}

.empty-state {
  text-align: center;
  padding: 4rem;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.empty-state h3 {
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.empty-state p {
  margin-bottom: 2rem;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
}

.project-card {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.project-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px var(--shadow-color);
}

/* Skeleton loading cards */
.project-card.skeleton {
  cursor: default;
  pointer-events: none;
}

.project-card.skeleton:hover {
  border-color: var(--border-color);
  transform: none;
  box-shadow: none;
}

.skeleton-line {
  background: linear-gradient(90deg, var(--background-dark) 25%, var(--border-color) 50%, var(--background-dark) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
  margin-bottom: 0.75rem;
}

.skeleton-title {
  height: 1.25rem;
  width: 60%;
}

.skeleton-desc {
  height: 0.875rem;
  width: 90%;
}

.skeleton-desc.short {
  width: 50%;
}

.skeleton-meta {
  height: 0.75rem;
  width: 40%;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.project-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1rem;
}

.project-header h3 {
  color: var(--text-primary);
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}

.project-actions {
  display: flex;
  gap: 0.5rem;
}

.action-btn {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s ease;
}

.action-btn:hover {
  background: var(--background-dark);
}

.action-btn.danger:hover {
  background: color-mix(in srgb, var(--danger-color) 20%, transparent);
}

.project-description {
  color: var(--text-secondary);
  margin-bottom: 1rem;
  line-height: 1.5;
}

.project-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 1rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.meta-item, .meta-badge { white-space: nowrap; }

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--background-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  width: 100%;
  max-width: 500px;
  margin: 2rem;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  color: var(--text-primary);
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  background: var(--background-dark);
  color: var(--text-primary);
}

.modal-form {
  padding: 1.5rem;
}

.modal-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
}
</style>
<style scoped>
/* Phones and narrow windows (Fase 4B) */
.project-card:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

@media (max-width: 720px) {
  .projects-header { padding: 0.9rem 1rem; }
  .header-content { flex-wrap: wrap; gap: 0.75rem; }
  .header-content h1 { font-size: 1.35rem; }
  .header-actions { flex-wrap: wrap; gap: 0.5rem; width: 100%; }
  .search-box { flex: 1 1 100%; }
  .search-input { width: 100%; }
  .user-menu { margin-left: auto; }
  .projects-content { padding: 1rem; }
  .projects-grid { grid-template-columns: 1fr; gap: 0.75rem; }
  .project-card { padding: 1rem; }
  .empty-state { padding: 2rem 1rem; }
  .modal { margin: 0.75rem; }
}
</style>
