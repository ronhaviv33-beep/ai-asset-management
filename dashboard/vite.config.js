import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // VITE_API_BASE: full URL (e.g. https://ai-asset-backend.onrender.com) set manually in Render.
    // VITE_API_URL: bare hostname auto-derived via fromService in render.yaml.
    // In dev (neither set) BASE stays '/api' and the proxy below handles it.
    'import.meta.env.VITE_API_BASE': JSON.stringify(
      process.env.VITE_API_BASE ||
      (process.env.VITE_API_URL ? `https://${process.env.VITE_API_URL}` : '')
    ),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
