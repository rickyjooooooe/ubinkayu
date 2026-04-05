// file: capacitor.config.ts

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ubinkayu.erp',
  appName: 'Ubinkayu ERP',
  webDir: 'out/renderer',
  server: {
    url: 'https://ubinkayu-erp1.vercel.app',
    hostname: 'ubinkayu-erp1.vercel.app', // <-- TAMBAHKAN BARIS INI
    androidScheme: 'https',
    allowNavigation: ['ubinkayu-erp1.vercel.app']
  },

  ios: {
    contentInset: 'never' // <-- Ganti dari 'none' menjadi 'never'
  }
}

export default config
