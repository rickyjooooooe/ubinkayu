import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      watch: {
        include: ['electron/**/*']
      },
      rollupOptions: {
        // --- TAMBAHKAN BARIS INI ---
        input: resolve(__dirname, 'src/main/index.ts'),
        // --- AKHIR TAMBAHAN ---
        external: [
          'google-spreadsheet',
          'google-auth-library',
          'pdfkit',
          'fs-extra',
          'canvas',
          'stream'
        ]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),

        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
