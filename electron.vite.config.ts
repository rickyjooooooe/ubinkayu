import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // --- TAMBAHAN BARU ---
      // Baris-baris ini memaksa dev server untuk memantau
      // perubahan pada file di dalam folder 'electron/'
      watch: {
        include: ['electron/**/*']
      },
      // --- AKHIR TAMBAHAN ---

      rollupOptions: {
        external: [
          'google-spreadsheet',
          'google-auth-library',
          'pdfkit',
          'fs-extra', // Jika Anda pakai
          'canvas', // Jika Anda pakai canvas di main process (sepertinya tidak)
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
