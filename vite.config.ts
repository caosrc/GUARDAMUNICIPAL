import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const replitDomain = process.env.REPLIT_DEV_DOMAIN

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    hmr: replitDomain
      ? {
          host: replitDomain,
          protocol: 'wss',
          clientPort: 443,
        }
      : false,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:5000',
        ws: true,
        changeOrigin: true,
      },
    }
  },
  build: {
    assetsDir: 'assets',
    sourcemap: false,
  },
})
