import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/weather': 'http://localhost:3000',
      '/stocks': 'http://localhost:3000',
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/weather': 'http://localhost:3000',
      '/stocks': 'http://localhost:3000',
    }
  }
})