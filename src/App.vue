<template>
  <div class="app-root">
    <router-view />
    <ToastContainer />
  </div>
</template>

<script setup>
import ToastContainer from './components/ToastContainer.vue'
// Session restore (token + GET /api/me) happens in main.js, before the router starts.
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  /* colors from the theme tokens (style.css) */
  background-color: var(--background-dark);
  color: var(--text-primary);
}

/* index.html's #app is the mount point (and centers the loading spinner);
   this is the app's own root: a column whose children (the views) take the
   whole width. Before Fase 5B it was a second #app that inherited the
   centering, so views without `flex: 1` (Login, Projects) shrank to their
   content and left a column in the middle of wide screens. */
.app-root {
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>