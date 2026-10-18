// Anonymous UI requests use a separate namespace from the authenticated jury API.
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve(import.meta.dirname, './src') } },
    server: {
      proxy: env.BACKEND_URL ? {
        '/api/ui': {
          target: env.BACKEND_URL,
          changeOrigin: true,
        },
      } : undefined,
    },
  }
})
