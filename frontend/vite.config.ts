// Proxy backend requests without exposing the server API key.
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
        '/api/v1': {
          target: env.BACKEND_URL,
          changeOrigin: true,
          headers: env.BACKEND_API_KEY ? { 'X-API-Key': env.BACKEND_API_KEY } : {},
        },
      } : undefined,
    },
  }
})
