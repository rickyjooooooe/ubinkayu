// file: vite.config.ts

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Konfigurasi ini HANYA untuk build web/mobile (Vercel & Capacitor)
export default defineConfig({
  // Tentukan 'root' dari aplikasi frontend Anda
  root: 'src/renderer',

  // Beri tahu Vite di mana harus mencari file .env
  envDir: '../../',

  plugins: [react()],

  build: {
    // Tentukan direktori output
    outDir: resolve(__dirname, 'out/renderer')
  }
})