// File: drive-test.js

import { google } from 'googleapis'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { JWT } from 'google-auth-library'
import stream from 'stream' // Import stream
import { Buffer } from 'buffer' // Import Buffer

// --- KONFIGURASI ---
// ID Folder Shared Drive "Arsip PO Ubinkayu"
const PARENT_FOLDER_ID = '1-1Gw1ay4iQoFNFe2KcKDgCwOIi353QEC'
// Path ke file kredensial ASLI Anda
const CREDENTIALS_PATH = join(process.cwd(), 'resources', 'credentials.json')
// -------------------

function getAuth() {
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(`File credentials.json tidak ditemukan di: ${CREDENTIALS_PATH}`)
  }
  const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'))
  // Tambahkan log untuk memastikan kredensial yang benar dibaca
  console.log('   -> Membaca kredensial untuk:', creds.client_email)
  return new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'] // Scope penuh
  })
}

async function runTest() {
  let auth // Declare auth outside try block
  try {
    console.log('1. Memulai proses otentikasi Service Account...')
    auth = getAuth() // Assign auth here
    // Explicitly authorize to ensure token generation
    await auth.authorize()
    console.log('✅ Otentikasi & Authorisasi awal berhasil untuk:', auth.email)

    console.log('\n2. Mencoba MEMBUAT file tes di Shared Drive via auth.request...')
    console.log(`   - ID Folder Induk: ${PARENT_FOLDER_ID}`)

    const dummyContent = 'Ini adalah file tes dari skrip auth.request di Shared Drive.'
    const metadata = {
      name: 'test-file-shared-drive.txt', // Nama file baru
      parents: [PARENT_FOLDER_ID], // Tentukan folder induk
      mimeType: 'text/plain'
    }

    // Panggil API menggunakan auth.request
    const response = await auth.request({
      url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', // Tambahkan supportsAllDrives di URL
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/related; boundary=foo_bar_baz'
      },
      data: `--foo_bar_baz\nContent-Type: application/json; charset=UTF-8\n\n${JSON.stringify(metadata)}\n\n--foo_bar_baz\nContent-Type: text/plain\n\n${dummyContent}\n\n--foo_bar_baz--`
    })

    console.log('✅ SUKSES! auth.request BISA MEMBUAT file di Shared Drive.')
    console.log('   - Nama File Baru:', response.data.name)
    console.log('   - ID File Baru:', response.data.id)
    console.log('\n   Aplikasi Electron Anda seharusnya sudah berfungsi sekarang.')
    console.log('   -> Hapus file "test-file-shared-drive.txt" dari Drive Anda.')
  } catch (error) {
    console.error('\n❌ GAGAL! Terjadi error saat menjalankan tes (Shared Drive):')
    // @ts-ignore
    if (error.response && error.response.status === 401) {
      console.error('   - KESIMPULAN: Error 401 (Login Required) TETAP TERJADI.')
      console.error(
        '   - PENYEBAB: Sangat aneh. Token mungkin tidak valid karena alasan eksternal atau masalah Google.'
      )
      // @ts-ignore
    } else if (error.response && error.response.status === 403) {
      console.error('   - KESIMPULAN: Error 403 (Forbidden) terkonfirmasi saat MENULIS.')
      console.error(
        '   - PENYEBAB: Peran "Pengelola" di Shared Drive tidak cukup atau ada kebijakan Workspace.'
      )
      console.error(
        '   - SOLUSI: Pastikan peran adalah "Pengelola". Cek kebijakan Google Workspace jika ada.'
      )
      // @ts-ignore
    } else if (error.response && error.response.status === 404) {
      console.error('   - KESIMPULAN: Error 404 (Not Found) terkonfirmasi.')
      console.error(
        '   - PENYEBAB: Folder Induk TIDAK DITEMUKAN atau Service Account tidak bisa melihatnya.'
      )
      console.error(
        '   - SOLUSI: Cek ulang ID Folder Induk dan pastikan Service Account minimal punya peran Viewer di Drive Bersama.'
      )
      // @ts-ignore
    } else if (error.response) {
      console.error(`   - Status Error: ${error.response.status}`)
      // @ts-ignore
      console.error('   - Pesan Error:', error.response.data?.error?.message || error.message)
    } else {
      console.error('   - Pesan Error:', error.message)
    }
  }
}

runTest()
