// file: capacitor.config.ts

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ubinkayu.erp',
  appName: 'Ubinkayu',
  webDir: 'out/renderer',
  server: {
    url: 'https://ubinkayu.vercel.app',
    hostname: 'ubinkayu.vercel.app', // <-- TAMBAHKAN BARIS INI
    androidScheme: 'https',
    allowNavigation: ['ubinkayu.vercel.app']
  },

  ios: {
    contentInset: 'never' // <-- Ganti dari 'none' menjadi 'never'
  }
}

export default config
