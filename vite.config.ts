import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/openvmm-petri-website/dist/index.html',
  plugins: [react()],
  server: {
    port: 3000,
    open: true
  }
})