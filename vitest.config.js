import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'url'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

// Two projects:
//  - unit:   frontend (src/**), jsdom
//  - server: backend (tests/**), node, in-memory SQLite
// `npm test` runs both; `npm run test:unit` / `npm run test:server` run one.
export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir
    }
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,vue}', 'server/**/*.js'],
      exclude: ['src/main.js', 'src/__tests__/**', 'server/data/**']
    },
    projects: [
      {
        extends: true,
        plugins: [vue()],
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.{test,spec}.{js,ts}']
        }
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          globals: true,
          include: ['tests/**/*.{test,spec}.js'],
          setupFiles: ['tests/setup.js'],
          testTimeout: 15000
        }
      }
    ]
  }
})
