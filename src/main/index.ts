/* eslint-disable no-irregular-whitespace */
/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/explicit-function-return-type */


// =================================================================
// LANGKAH 1: IMPOR UTAMA
// =================================================================
import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { GoogleSpreadsheet, GoogleSpreadsheetRow } from 'google-spreadsheet'
import { JWT } from 'google-auth-library'
import { google } from 'googleapis'
// @ts-ignore (Abaikan error 'could not find declaration file')
import { generatePOJpeg } from '../../electron/jpegGenerator.js'
import stream from 'node:stream'
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config()

// =================================================================
// LANGKAH 2: KONSTANTA & HELPER DARI (sheet.js)
// =================================================================

const SPREADSHEET_ID = '1Bp5rETvaAe9nT4DrNpm-WsQqQlPNaau4gIzw1nA5Khk'
const PO_ARCHIVE_FOLDER_ID = '1-1Gw1ay4iQoFNFe2KcKDgCwOIi353QEC'
const PROGRESS_PHOTOS_FOLDER_ID = '1UfUQoqNBSsth9KzGRUmjenwegmsA6hbK'
const USER_SPREADSHEET_ID = '1nNk-49aah-dWuEoVwMiU40BXek3slHyvzIgIXOAgE6Q'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url: string, options: any, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const response = await fetch(url, options);

      // 1. Sukses
      if (response.ok) {
        return response; // Langsung kembalikan
      }

      // 2. Gagal, baca teks error
      const errorText = await response.text();
      console.warn(`Fetch attempt ${attempt} failed with status ${response.status}: ${errorText.substring(0, 100)}...`);

      // 3. Cek apakah ini Rate Limit (429)
      if (response.status === 429) {
        let delayMs = 7000; // Default 7 detik jika parsing gagal
        try {
          // Coba parse pesan error Groq untuk mendapatkan durasi
          const errorJson = JSON.parse(errorText);
          const message = errorJson?.error?.message || '';

          // Gunakan Regex untuk menemukan "Please try again in 7.22s"
          const match = message.match(/Please try again in (.*?)s/);
          if (match && match[1]) {
            // Ubah detik (misal 7.22) menjadi milidetik dan tambah 500ms buffer
            delayMs = parseFloat(match[1]) * 1000 + 500;
          }
        } catch (parseError) {
          console.warn('Could not parse 429 error message, using default delay.');
        }

        if (attempt >= maxRetries) {
          throw new Error(`Rate limit exceeded after ${maxRetries} attempts. Last error: ${errorText}`);
        }

        console.warn(`[Groq Rate Limit] Hit limit. Retrying in ${delayMs / 1000}s...`);
        // INI ADALAH LOGIKA YANG ANDA MINTA:
        // Aplikasi akan 'berhenti' di sini selama durasi yang diminta.
        // Frontend akan tetap menampilkan "isProcessing" (loading).
        await sleep(delayMs);
        continue; // Lanjutkan ke 'while' loop untuk mencoba lagi
      }

      // 4. Error lain (500, 400, dll), langsung lempar
      throw new Error(`Groq API request failed with status ${response.status}: ${errorText}`);

    } catch (error) {
      // 5. Network error, dll.
      console.error(`Fetch attempt ${attempt} network error:`, error);
      if (attempt >= maxRetries) {
        throw error; // Menyerah setelah max retries
      }
      await sleep(1000); // Tunggu 1 detik untuk network error
    }
  }
  // Seharusnya tidak pernah sampai sini
  throw new Error('Fetch failed after all retries.');
}

const PRODUCTION_STAGES = [
  'Cari Bahan Baku',
  'Sawmill',
  'KD',
  'Pembahanan',
  'Moulding',
  'Coating',
  'Siap Kirim'
]

const formatDate = (dateString: string | Date | undefined | null) => {
  if (!dateString) return '-'
  try {
    const isoDate = new Date(dateString).toISOString().split('T')[0]
    const [year, month, day] = isoDate.split('-')
    return `${day}/${month}/${year}` // Format DD/MM/YYYY
  } catch (e) {
    return '-'
  }
}

function toNum(v: any, def = 0) {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : def
}

const DEFAULT_STAGE_DURATIONS: { [key: string]: number } = {
  Pembahanan: 7,
  Moulding: 7,
  KD: 14,
  Coating: 14,
  'Cari Bahan Baku': 0,
  Sawmill: 0,
  'Siap Kirim': 0
}

function getAuth() {
  const isDev = !app.isPackaged
  const credPath = isDev
    ? path.join(process.cwd(), 'resources', 'credentials.json')
    : path.join(process.resourcesPath, 'resources', 'credentials.json')
  if (!fs.existsSync(credPath)) {
    const title = 'Error Kredensial Kritis'
    const content = `File credentials.json tidak dapat ditemukan di aplikasi.\n\nLokasi yang dicari:\n${credPath}`
    console.error(content)
    dialog.showErrorBox(title, content)
    throw new Error('File credentials.json tidak ditemukan.')
  }
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'))
  return new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  })
}

async function openDoc() {
  const auth = getAuth()
  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth)
  await doc.loadInfo()
  return doc
}

async function openUserDoc() {
  const auth = getAuth()
  const doc = new GoogleSpreadsheet(USER_SPREADSHEET_ID, auth)
  await doc.loadInfo()
  return doc
}

const ALIASES: { [key: string]: string[] } = {
  purchase_orders: ['purchase_orders', 'purchase_order'],
  purchase_order_items: ['purchase_order_items', 'po_items'],
  product_master: ['product_master', 'products'],
  progress_tracking: ['purchase_order_items_progress', 'progress'],
  users: ['users_credentials', 'users']
}

async function getSheet(doc: GoogleSpreadsheet, key: string) {
  const titles = ALIASES[key] || [key]
  for (const t of titles) {
    if (doc.sheetsByTitle[t]) return doc.sheetsByTitle[t]
  }
  throw new Error(
    `Sheet "${titles[0]}" tidak ditemukan. Pastikan nama sheet di Google Sheets sudah benar.`
  )
}

async function getNextIdFromSheet(sheet: any) {
  await sheet.loadHeaderRow()
  const rows = await sheet.getRows()
  if (rows.length === 0) return '1'
  let maxId = 0
  rows.forEach((r: any) => {
    const val = toNum(r.get('id'), NaN)
    if (!Number.isNaN(val)) maxId = Math.max(maxId, val)
  })
  return String(maxId + 1)
}

function scrubItemPayload(item: any) {
  const { id, purchase_order_id, revision_id, revision_number, ...rest } = item || {}
  return rest
}

async function latestRevisionNumberForPO(poId: string, doc: GoogleSpreadsheet) {
  const sh = await getSheet(doc, 'purchase_orders')
  const rows = await sh.getRows()
  const nums = rows
    .filter((r: any) => String(r.get('id')).trim() === String(poId).trim())
    .map((r: any) => toNum(r.get('revision_number'), -1))
  return nums.length ? Math.max(...nums) : -1
}

async function getHeaderForRevision(poId: string, rev: number, doc: GoogleSpreadsheet) {
  const sh = await getSheet(doc, 'purchase_orders')
  const rows = await sh.getRows()
  return (
    rows.find(
      (r: any) =>
        String(r.get('id')).trim() === String(poId).trim() &&
        toNum(r.get('revision_number'), -1) === toNum(rev, -1)
    ) || null
  )
}

async function getItemsByRevision(poId: string, rev: number, doc: GoogleSpreadsheet) {
  const sh = await getSheet(doc, 'purchase_order_items')
  const rows = await sh.getRows()
  return rows
    .filter(
      (r: any) =>
        String(r.get('purchase_order_id')).trim() === String(poId).trim() &&
        toNum(r.get('revision_number'), -1) === toNum(rev, -1)
    )
    .map((r: any) => r.toObject())
}

async function getLivePOItems(poId: string, doc: GoogleSpreadsheet) {
  const latest = await latestRevisionNumberForPO(poId, doc)
  if (latest < 0) return []
  return getItemsByRevision(poId, latest, doc)
}

function extractGoogleDriveFileId(driveUrl: string) {
  if (!driveUrl || typeof driveUrl !== 'string') return null
  const patterns = [
    /\/d\/([a-zA-Z0-9-_]+)/,
    /id=([a-zA-Z0-9-_]+)/,
    /file\/d\/([a-zA-Z0-9-_]+)/,
    /open\?id=([a-zA-Z0-9-_]+)/
  ]
  for (const pattern of patterns) {
    const match = driveUrl.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }
  return null
}

async function processBatch(items: any[], processor: (item: any) => Promise<any>, batchSize = 5) {
  const results: any[] = [] // ⬅️ PERBAIKAN TS2345
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(batch.map(processor))
    results.push(
      ...batchResults.map((result) =>
        result.status === 'fulfilled'
          ? result.value
          : { success: false, error: (result.reason as Error)?.message || 'Unknown error' }
      )
    )
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  return results
}

async function deleteGoogleDriveFile(fileId: string) {
  if (!fileId) {
    return { success: false, error: 'File ID tidak valid', fileId };
  }

  const auth = getAuth();
  await auth.authorize(); // 1. Otorisasi dulu
  console.log(`🔑 Otorisasi ulang untuk menghapus file ${fileId} berhasil.`);

  const MAX_RETRIES = 6;
  const RETRY_DELAY = 10000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${MAX_RETRIES} to delete ${fileId}...`);

      // --- [PERBAIKAN] ---
      // Gunakan auth.request() secara langsung, sama seperti fungsi upload
      await auth.request({
        url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
        method: 'DELETE',
        params: {
          supportsAllDrives: true
        }
      });
      // --- [AKHIR PERBAIKAN] ---

      console.log(`✅ File berhasil dihapus dari Google Drive: ${fileId}`);
      return { success: true, fileId }; // SUKSES! Keluar dari loop.

    } catch (error: any) {
      // Logika Catch Anda sudah bagus, kita hanya perlu menyesuaikan cara membaca status code
      console.error(`❌ Gagal attempt ${attempt} untuk ${fileId}:`, error.message);

      // Penyesuaian untuk membaca error dari auth.request
      const apiError = error.response?.data?.error || {};
      const statusCode = error.code || error.response?.status || apiError.code;

      if (statusCode === 404 && attempt < MAX_RETRIES) {
        console.warn(`⚠️ File ${fileId} tidak ditemukan (404). Kemungkinan Google propagation delay. Mencoba lagi dalam ${RETRY_DELAY / 1000} detik...`);
        await sleep(RETRY_DELAY);
        continue;
      }

      if (statusCode === 404 && attempt === MAX_RETRIES) {
        console.warn(`⚠️ File ${fileId} tetap tidak ditemukan (404) setelah ${MAX_RETRIES} percobaan. Menganggap file 'yatim'.`);
        return { success: false, error: 'File tidak ditemukan (404)', fileId };
      }

      if (statusCode === 401 || statusCode === 403) {
        console.error(`🚫 Akses Ditolak/Otentikasi Gagal untuk ${fileId}. Tidak akan mencoba lagi.`);
        const errorMessage = apiError.message || error.response?.data?.message || error.message;
        return { success: false, error: `Akses Ditolak/Login Gagal: ${errorMessage}`, fileId };
      }

      if (attempt < MAX_RETRIES) {
        console.warn(`Error server (${statusCode}), mencoba lagi...`);
        await sleep(RETRY_DELAY);
        continue;
      }

      return { success: false, error: error.message || String(error), fileId };
    }
  }

  return { success: false, error: 'Retry loop finished unexpectedly', fileId };
}

async function uploadPoPhoto(photoPath: string, poNumber: string, customerName: string) {
  try {
    if (!fs.existsSync(photoPath)) throw new Error(`File foto tidak ditemukan: ${photoPath}`)
    const auth = getAuth()
    const drive = google.drive({ version: 'v3', auth })
    const safeCustomer = String(customerName || '').replace(/[/\\?%*:|"<>]/g, '-')
    const fileName = `PO-${poNumber}-${safeCustomer}.jpg`
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'image/jpeg',
        parents: [PROGRESS_PHOTOS_FOLDER_ID]
      },
      media: {
        mimeType: 'image/jpeg',
        body: fs.createReadStream(photoPath)
      },
      fields: 'id, webViewLink, name, size',
      supportsAllDrives: true
    })
    console.log(`✅ Foto referensi PO berhasil diunggah: ${response.data.webViewLink}`)
    return {
      success: true,
      link: response.data.webViewLink,
      name: response.data.name,
      size: response.data.size
    }
  } catch (error: any) {
    console.error('❌ Gagal unggah foto referensi PO:', error)
    return { success: false, error: error.message, size: 0 }
  }
}

async function generateAndUploadPO(poData: any, revisionNumber: number | string) {
  let auth
  let filePath: string | undefined
  try {
    const pdfResult = await generatePOJpeg(poData, revisionNumber, false)
    if (!pdfResult.success || !pdfResult.path) {
      throw new Error('Gagal membuat file JPEG lokal atau path tidak ditemukan.')
    }
    filePath = pdfResult.path

    if (!filePath || !fs.existsSync(filePath)) { // ⬅️ PERBAIKAN TS2345
      throw new Error(`File JPEG tidak ditemukan di path: ${filePath}`)
    }

    console.log('🔄 Mendapatkan otentikasi baru sebelum upload/get...')
    auth = getAuth()
    await auth.authorize()
    console.log('✅ Otorisasi ulang berhasil.')

    const fileName = path.basename(filePath) // ⬅️ PERBAIKAN TS2345
    const mimeType = 'image/jpeg'
    console.log(`🚀 Mengunggah file via auth.request: ${fileName} ke Drive...`)

    const fileStream = fs.createReadStream(filePath) // ⬅️ PERBAIKAN TS2345
    const metadata = {
      name: fileName,
      mimeType: mimeType,
      parents: [PO_ARCHIVE_FOLDER_ID]
    }
    const boundary = `----UbinkayuERPBoundary${Date.now()}----`
    const readable = new stream.PassThrough()

    readable.write(`--${boundary}\r\n`)
    readable.write('Content-Type: application/json; charset=UTF-8\r\n\r\n')
    readable.write(JSON.stringify(metadata) + '\r\n\r\n')
    readable.write(`--${boundary}\r\n`)
    readable.write(`Content-Type: ${mimeType}\r\n\r\n`)
    fileStream.pipe(readable, { end: false })
    fileStream.on('end', () => {
      readable.write(`\r\n--${boundary}--\r\n`)
      readable.end()
    })
    fileStream.on('error', (err) => {
      readable.destroy(err)
    })

    const createResponse = await auth.request({
      url: `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      data: readable,
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    })

    const fileId = createResponse?.data?.id
    if (!fileId) {
      console.error('❌ Upload berhasil, tetapi ID file tidak ditemukan:', createResponse.data)
      throw new Error('Upload berhasil tetapi ID file tidak didapatkan.')
    }
    console.log(
      `✅ File berhasil diunggah (ID: ${fileId}). Mengambil webViewLink via auth.request...`
    )

    const getResponse = await auth.request({
      url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
      method: 'GET',
      params: {
        fields: 'webViewLink,size,name',
        supportsAllDrives: true
      }
    })

    const webViewLink = getResponse?.data?.webViewLink
    const fileSize = getResponse?.data?.size
    const fileNameOnDrive = getResponse?.data?.name || fileName
    if (!webViewLink) {
      console.error('❌ Gagal mendapatkan webViewLink via auth.request:', getResponse.data)
      throw new Error('Gagal mendapatkan link file setelah upload berhasil.')
    }
    console.log(`✅ Link file dan size didapatkan via auth.request: ${webViewLink}`)

    return { success: true, link: webViewLink, size: fileSize, name: fileNameOnDrive }
  } catch (error: any) {
    console.error('❌ Proses Generate & Upload PO Gagal:', error.message)
    if (error.response && error.response.data && error.response.data.error) {
      console.error(
        '   -> Detail Error Google API:',
        JSON.stringify(error.response.data.error, null, 2)
      )
    } else if (error.response) {
      console.error(`   -> Status Error HTTP: ${error.response.status}`)
      console.error('   -> Data Error:', error.response.data)
    }
    return { success: false, error: error.message }
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
        console.log(`🗑️ File lokal ${path.basename(filePath)} dihapus.`)
      } catch (unlinkErr: any) {
        console.warn(`⚠️ Gagal menghapus file lokal ${path.basename(filePath)}:`, unlinkErr.message)
      }
    }
  }
}

// =================================================================
// LANGKAH 3: LOGIKA BACKEND (dulu di sheet.js)
// =================================================================

async function testSheetConnection() {
  try {
    const doc = await openDoc()
    console.log(`✅ Tes koneksi OK: "${doc.title}"`)
  } catch (err: any) {
    console.error('❌ Gagal tes koneksi ke Google Sheets:', err.message)
  }
}

async function handleLoginUser(loginData: any) {
  console.log('🏁 [Electron] handleLoginUser started!')
  const { username, password } = loginData

  if (!username || !password) {
    console.warn('⚠️ [Electron Login] Missing username or password.')
    return { success: false, error: 'Username dan password harus diisi.' }
  }

  try {
    const doc = await openUserDoc()
    const userSheet = await getSheet(doc, 'users')
    console.log(`✅ [Electron Login] Accessed sheet: ${userSheet.title}`)

    await userSheet.loadHeaderRow()
    const headers = userSheet.headerValues
    console.log('✅ [Electron Login] Sheet headers:', headers)

    const usernameHeader = 'login_username'
    const passwordHeader = 'login_pwd'
    const nameHeader = 'name'
    const roleHeader = 'role'

    if (!headers.includes(usernameHeader) || !headers.includes(passwordHeader)) {
      console.error(
        `❌ [Electron Login] Missing required columns (${usernameHeader} or ${passwordHeader}) in sheet "${userSheet.title}"`
      )
      return { success: false, error: 'Kesalahan konfigurasi sheet.' }
    }

    const rows = await userSheet.getRows()
    console.log(`ℹ️ [Electron Login] Found ${rows.length} user rows.`)

    const trimmedUsernameLower = username.trim().toLowerCase()
    const userRow = rows.find(
      (row: any) => row.get(usernameHeader)?.trim().toLowerCase() === trimmedUsernameLower
    )

    if (userRow) {
      const foundUsername = userRow.get(usernameHeader)
      console.log(`👤 [Electron Login] User found: ${foundUsername}`)
      const storedPassword = userRow.get(passwordHeader)

      if (storedPassword === password) {
        console.log(`✅ [Electron Login] Password match for user: ${foundUsername}`)
        const userName =
          headers.includes(nameHeader) && userRow.get(nameHeader)
            ? userRow.get(nameHeader)
            : foundUsername
        const userRole = headers.includes(roleHeader) ? userRow.get(roleHeader) : undefined
        return { success: true, name: userName, role: userRole }
      } else {
        console.warn(`🔑 [Electron Login] Password mismatch for user: ${foundUsername}`)
        return { success: false, error: 'Username atau password salah.' }
      }
    } else {
      console.warn(`❓ [Electron Login] User not found: ${username}`)
      return { success: false, error: 'Username atau password salah.' }
    }
  } catch (err: any) {
    console.error('💥 [Electron Login] ERROR:', err.message, err.stack)
    return {
      success: false,
      error: 'Terjadi kesalahan pada server saat login.',
      details: err.message
    }
  }
}

async function listPOs() {
  try {
    const doc = await openDoc()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const itemSheet = await getSheet(doc, 'purchase_order_items')
    const progressSheet = await getSheet(doc, 'progress_tracking')

    const rawPoRows = await poSheet.getRows()
    const rawItemRows = await itemSheet.getRows()
    const rawProgressRows = await progressSheet.getRows()

    const poRows = rawPoRows.map((r: any) => r.toObject())
    const itemRows = rawItemRows.map((r: any) => r.toObject())
    const progressRows = rawProgressRows.map((r: any) => r.toObject())

    const byId = new Map()
    for (const r of poRows) {
      const id = String(r.id).trim()
      const rev = toNum(r.revision_number, -1)
      const keep = byId.get(id)
      if (!keep || rev > keep.rev) byId.set(id, { rev, row: r })
    }
    const latestPoObjects = Array.from(byId.values()).map(({ row }: any) => row)

    const progressByCompositeKey = progressRows.reduce((acc: any, row: any) => {
      const key = `${row.purchase_order_id}-${row.purchase_order_item_id}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ stage: row.stage, created_at: row.created_at })
      return acc
    }, {})

    const latestItemRevisions = itemRows.reduce((acc: any, item: any) => {
      const poId = item.purchase_order_id
      const rev = toNum(item.revision_number, -1)
      if (!acc.has(poId) || rev > acc.get(poId)) {
        acc.set(poId, rev)
      }
      return acc
    }, new Map())

    const result = latestPoObjects.map((poObject: any) => {
      const poId = poObject.id
      const lastRevisedBy = poObject.revised_by || 'N/A'
      const lastRevisedDate = poObject.created_at
      const latestRev = latestItemRevisions.get(poId) ?? -1
      const poItems = itemRows.filter(
        (item: any) => item.purchase_order_id === poId && toNum(item.revision_number, -1) === latestRev
      )

      let poProgress = 0
      let finalStatus = poObject.status || 'Open'
      let completed_at: string | null = null // ⬅️ PERBAIKAN TS2322

      if (poItems.length > 0) {
        let totalPercentage = 0
        poItems.forEach((item: any) => {
          const itemId = item.id
          const compositeKey = `${poId}-${itemId}`
          const itemProgressHistory = progressByCompositeKey[compositeKey] || []
          let latestStageIndex = -1

          if (itemProgressHistory.length > 0) {
            const latestProgress = itemProgressHistory.sort(
              (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )[0]
            latestStageIndex = PRODUCTION_STAGES.indexOf(latestProgress.stage)
          }

          const itemPercentage =
            latestStageIndex >= 0 ? ((latestStageIndex + 1) / PRODUCTION_STAGES.length) * 100 : 0
          totalPercentage += itemPercentage
        })
        poProgress = totalPercentage / poItems.length
      }

      const roundedProgress = Math.round(poProgress)

      if (finalStatus !== 'Cancelled') {
        if (roundedProgress >= 100) {
          finalStatus = 'Completed'
          const allProgressForPO = progressRows
            .filter((row: any) => row.purchase_order_id === poId)
            .map((row: any) => new Date(row.created_at).getTime())

          if (allProgressForPO.length > 0) {
            completed_at = new Date(Math.max(...allProgressForPO)).toISOString()
          }
        } else if (roundedProgress > 0) {
          finalStatus = 'In Progress'
        } else {
          finalStatus = 'Open'
        }
      }

      return {
        ...poObject,
        items: poItems,
        progress: roundedProgress,
        status: finalStatus,
        completed_at: completed_at,
        pdf_link: poObject.pdf_link || null,
        lastRevisedBy: lastRevisedBy,
        lastRevisedDate: lastRevisedDate,
        acc_marketing: poObject.acc_marketing || '',
        file_size_bytes: poObject.file_size_bytes || 0
      }
    })

    return result
  } catch (err: any) {
    console.error('❌ listPOs error:', err.message)
    return []
  }
}

async function saveNewPO(data: any) {
  console.log('TITIK B (Backend): Menerima data:', data)
  let newPoRow: GoogleSpreadsheetRow | undefined
  try {
    const doc = await openDoc()
    const now = new Date().toISOString()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const itemSheet = await getSheet(doc, 'purchase_order_items')

    const poId = await getNextIdFromSheet(poSheet)
    let totalFileSize = 0

    newPoRow = await poSheet.addRow({
      id: poId,
      revision_number: 0,
      po_number: data.nomorPo,
      project_name: data.namaCustomer,
      deadline: data.tanggalKirim || null,
      status: 'Open',
      priority: data.prioritas || 'Normal',
      notes: data.catatan || '',
      kubikasi_total: data.kubikasi_total || 0,
      acc_marketing: data.marketing || '',
      created_at: now,
      pdf_link: 'generating...',
      pdf_file_name: '',
      foto_link: '...',
      foto_file_name: '',
      file_size_bytes: 0,
      alamat_kirim: data.alamatKirim || '',
      revised_by: 'N/A'
    })

    const itemsWithIds: any[] = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw: any) => {
      const clean = scrubItemPayload(raw)
      const newItem = {
        id: nextItemId,
        purchase_order_id: poId,
        ...clean,
        revision_id: 0,
        revision_number: 0,
        kubikasi: raw.kubikasi || 0
      }
      itemsWithIds.push({ ...raw, id: nextItemId })
      nextItemId++
      return newItem
    })

    if (itemsToAdd.length > 0) {
      await itemSheet.addRows(itemsToAdd)
    }

    if (data.poPhotoPath) {
      console.log('Mengunggah foto referensi PO...')
      const photoResult = await uploadPoPhoto(data.poPhotoPath, data.nomorPo, data.namaCustomer)
      if (photoResult.success) {
        newPoRow.set('foto_link', photoResult.link)
        newPoRow.set('foto_file_name', photoResult.name || '')
        totalFileSize += Number(photoResult.size || 0)
      } else {
        newPoRow.set('foto_link', `ERROR: ${photoResult.error}`)
      }
    } else {
      newPoRow.set('foto_link', 'Tidak ada foto')
    }

    const poDataForJpeg = {
      po_number: data.nomorPo,
      project_name: data.namaCustomer,
      deadline: data.tanggalKirim,
      priority: data.prioritas,
      items: itemsWithIds,
      notes: data.catatan,
      created_at: now,
      kubikasi_total: data.kubikasi_total || 0,
      poPhotoPath: data.poPhotoPath,
      marketing: data.marketing || 'Unknown',
      alamat_kirim: data.alamatKirim || ''
    }

    const uploadResult = await generateAndUploadPO(poDataForJpeg, 0)

    if (uploadResult.success) {
      newPoRow.set('pdf_link', uploadResult.link)
      newPoRow.set('pdf_file_name', uploadResult.name || '')
      totalFileSize += Number(uploadResult.size || 0)
    } else {
      newPoRow.set('pdf_link', `ERROR: ${uploadResult.error}`)
      newPoRow.set('pdf_file_name', '')
    }

    newPoRow.set('file_size_bytes', totalFileSize)
    await newPoRow.save()
    return { success: true, poId, revision_number: 0 }
  } catch (err: any) {
    console.error('❌ saveNewPO error:', err.message)
    return { success: false, error: err.message }
  }
}

async function updatePO(data: any) {
  console.log('TITIK B (Backend): Menerima data revisi:', data)
  let newRevisionRow: GoogleSpreadsheetRow | undefined
  try {
    const doc = await openDoc()
    const now = new Date().toISOString()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const itemSheet = await getSheet(doc, 'purchase_order_items')

    const latest = await latestRevisionNumberForPO(String(data.poId), doc)
    const prevRow = latest >= 0 ? await getHeaderForRevision(String(data.poId), latest, doc) : null
    const prev = prevRow ? prevRow.toObject() : {}
    const newRev = latest >= 0 ? latest + 1 : 0

    let totalFileSize = 0
    let fotoLink = prev.foto_link || 'Tidak ada foto'
    let fotoSize = 0
    let fotoFileName = prev.foto_file_name || ''

    newRevisionRow = await poSheet.addRow({
      id: String(data.poId),
      revision_number: newRev,
      po_number: data.nomorPo ?? prev.po_number ?? '',
      project_name: data.namaCustomer ?? prev.project_name ?? '',
      deadline: data.tanggalKirim ?? prev.deadline ?? null,
      status: data.status ?? prev.status ?? 'Open',
      priority: data.prioritas ?? prev.priority ?? 'Normal',
      notes: data.catatan ?? prev.notes ?? '',
      kubikasi_total: data.kubikasi_total ?? prev.kubikasi_total ?? 0,
      acc_marketing: data.marketing ?? prev.acc_marketing ?? '',
      created_at: now,
      pdf_link: 'generating...',
      pdf_file_name: '',
      foto_link: '...',
      foto_file_name: fotoFileName,
      file_size_bytes: 0,
      revised_by: data.revisedBy || 'Unknown',
      alamat_kirim: data.alamatKirim ?? prev.alamat_kirim ?? ''
    })

    const itemsWithIds: any[] = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw: any) => {
      const clean = scrubItemPayload(raw)
      const newItem = {
        id: nextItemId,
        purchase_order_id: String(data.poId),
        ...clean,
        revision_id: newRev,
        revision_number: newRev,
        kubikasi: raw.kubikasi || 0
      }
      itemsWithIds.push({ ...raw, id: nextItemId })
      nextItemId++
      return newItem
    })

    if (itemsToAdd.length > 0) {
      await itemSheet.addRows(itemsToAdd)
    }

    if (data.poPhotoPath) {
      console.log(`[updatePO] 📸 Terdeteksi foto referensi baru, mengunggah...`)
      const photoResult = await uploadPoPhoto(data.poPhotoPath, data.nomorPo, data.namaCustomer)
      if (photoResult.success) {
        fotoLink = photoResult.link
        fotoSize = Number(photoResult.size || 0)
        fotoFileName = photoResult.name || ''
      } else {
        fotoLink = `ERROR: ${photoResult.error}`
        fotoFileName = ''
      }
    } else {
      console.log(`[updatePO] 🖼️ Tidak ada foto referensi baru, mewariskan link lama: ${fotoLink}`)
      totalFileSize = Number(prev.file_size_bytes || 0)
    }

    const poDataForJpeg = {
      po_number: data.nomorPo ?? prev.po_number,
      project_name: data.namaCustomer ?? prev.project_name,
      deadline: data.tanggalKirim ?? prev.deadline,
      priority: data.prioritas ?? prev.priority,
      items: itemsWithIds,
      notes: data.catatan ?? prev.notes,
      created_at: now,
      kubikasi_total: data.kubikasi_total ?? prev.kubikasi_total ?? 0,
      poPhotoPath: data.poPhotoPath,
      foto_link: fotoLink,
      marketing: data.marketing ?? prev.acc_marketing,
      alamat_kirim: data.alamatKirim ?? prev.alamat_kirim ?? ''
    }

    const uploadResult = await generateAndUploadPO(poDataForJpeg, newRev)

    let jpegSize = 0
    if (uploadResult.success) {
      newRevisionRow.set('pdf_link', uploadResult.link)
      newRevisionRow.set('pdf_file_name', uploadResult.name || '')
      jpegSize = Number(uploadResult.size || 0)
    } else {
      newRevisionRow.set('pdf_link', `ERROR: ${uploadResult.error}`)
      newRevisionRow.set('pdf_file_name', prev.pdf_file_name || '')
    }

    if (data.poPhotoPath) {
      totalFileSize = fotoSize + jpegSize
    } else {
      totalFileSize = fotoSize + jpegSize
      if (totalFileSize === 0 && !data.poPhotoPath) {
        totalFileSize = Number(prev.file_size_bytes || 0)
      }
    }

    newRevisionRow.set('foto_link', fotoLink)
    newRevisionRow.set('foto_file_name', fotoFileName)
    newRevisionRow.set('file_size_bytes', totalFileSize)
    await newRevisionRow.save()

    return { success: true, revision_number: newRev }
  } catch (err: any) {
    console.error('❌ updatePO error:', err.message)
    return { success: false, error: err.message }
  }
}

export async function deletePO(poId: string) {
  const startTime = Date.now()
  console.log(`🗑️ Memulai penghapusan lengkap PO ID: ${poId}`)

  try {
    const doc = await openDoc()

    console.log(`📄 Mengambil data dari 3 sheet...`)
    const [poSheet, itemSheet, progressSheet] = await Promise.all([
      getSheet(doc, 'purchase_orders'),
      getSheet(doc, 'purchase_order_items'),
      getSheet(doc, 'progress_tracking')
    ])

    const [poRows, itemRows, progressRows] = await Promise.all([
      poSheet.getRows(),
      itemSheet.getRows(),
      progressSheet.getRows()
    ])

    const toDelHdr = poRows.filter((r: any) => String(r.get('id')).trim() === String(poId).trim())
    const toDelItems = itemRows.filter(
      (r: any) => String(r.get('purchase_order_id')).trim() === String(poId).trim()
    )
    const poProgressRows = progressRows.filter(
      (r: any) => String(r.get('purchase_order_id')).trim() === String(poId).trim()
    )

    const fileIds = new Set<string>()
    const fileIdToName = new Map<string, string>()

    toDelHdr.forEach((poRow: any) => {
      // Cek 1: Link PDF (JPEG PO)
      const pdfLink = poRow.get('pdf_link')
      const pdfName = poRow.get('pdf_file_name') || null
      if (pdfLink && !pdfLink.startsWith('ERROR:') && !pdfLink.includes('generating')) {
        const fileId = extractGoogleDriveFileId(pdfLink)
        if (fileId) {
          fileIds.add(fileId)
          if (pdfName) fileIdToName.set(fileId, pdfName)
        }
      }

      // Cek 2: Link Foto Referensi
      const fotoLink = poRow.get('foto_link')
      const fotoName = poRow.get('foto_file_name') || null
      if (
        fotoLink &&
        !fotoLink.startsWith('ERROR:') &&
        !fotoLink.includes('generating') &&
        fotoLink !== 'Tidak ada foto'
      ) {
        const fileId = extractGoogleDriveFileId(fotoLink)
        if (fileId) {
          fileIds.add(fileId)
          if (fotoName) fileIdToName.set(fileId, fotoName)
          console.log(`Found foto_link to delete: ${fileId}`) // Log tambahan
        }
      }
    })

    poProgressRows.forEach((progressRow: any) => {
      // Cek 3: Foto Progress
      const photoUrl = progressRow.get('photo_url')
      const photoName = progressRow.get('photo_file_name') || null
      if (photoUrl) {
        const fileId = extractGoogleDriveFileId(photoUrl)
        if (fileId) {
          fileIds.add(fileId)
          if (photoName) fileIdToName.set(fileId, photoName)
        }
      }
    })

    const uniqueFileIds = Array.from(fileIds)
    console.log(`Found ${uniqueFileIds.length} unique file(s) to delete.`, uniqueFileIds)

    let deletedFilesCount = 0
    let failedFilesCount = 0
    let failedFiles: any[] = []

    if (uniqueFileIds.length > 0) {
      console.log(`🗂️ Menghapus ${uniqueFileIds.length} file dari Google Drive dalam batch...`)

      const deleteResults = await processBatch(uniqueFileIds, deleteGoogleDriveFile, 5)

      deleteResults.forEach((result: any) => {
        if (result.success) {
          deletedFilesCount++
        } else {
          failedFilesCount++
          const name = fileIdToName.get(result.fileId) || null
          failedFiles.push({ fileId: result.fileId, fileName: name, error: result.error })
          console.warn(
            `⚠️ Gagal menghapus file ${result.fileId} (${name || 'unknown name'}): ${result.error}`
          )
        }
      })
    }

    console.log(`📄 Menghapus data dari spreadsheet...`)

    // --- [INI PERBAIKANNYA] ---
    const sheetDeletions: Promise<any>[] = []
    // ----------------------------

    poProgressRows.reverse().forEach((row: any) => sheetDeletions.push(row.delete()))
    toDelHdr.reverse().forEach((row: any) => sheetDeletions.push(row.delete()))
    toDelItems.reverse().forEach((row: any) => sheetDeletions.push(row.delete()))

    await Promise.allSettled(sheetDeletions)

    const endTime = Date.now()
    const duration = ((endTime - startTime) / 1000).toFixed(1)

    const summary = {
      deletedRevisions: toDelHdr.length,
      deletedItems: toDelItems.length,
      deletedProgressRecords: poProgressRows.length,
      deletedFiles: deletedFilesCount,
      failedFileDeletes: failedFilesCount,
      duration: `${duration}s`,
      failedFiles: failedFiles.length > 0 ? failedFiles : undefined
    }

    console.log(`✅ PO ${poId} berhasil dihapus lengkap dalam ${duration}s:`, summary)

    const message =
      failedFilesCount > 0
        ? `PO berhasil dihapus: ${summary.deletedRevisions} revisi, ${summary.deletedItems} item, ${summary.deletedProgressRecords} progress record, ${summary.deletedFiles} file dari Drive (${failedFilesCount} file gagal dihapus)`
        : `PO berhasil dihapus: ${summary.deletedRevisions} revisi, ${summary.deletedItems} item, ${summary.deletedProgressRecords} progress record, ${summary.deletedFiles} file dari Drive`

    return {
      success: true,
      message,
      summary
    }
  } catch (err: any) {
    const endTime = Date.now()
    const duration = ((endTime - startTime) / 1000).toFixed(1)
    console.error(`❌ Gagal menghapus PO ID ${poId} setelah ${duration}s:`, err.message)
    return { success: false, error: err.message, duration: `${duration}s` }
  }
}

async function listPOItems(poId: string) {
  try {
    const doc = await openDoc()
    return await getLivePOItems(String(poId), doc)
  } catch (err: any) {
    console.error('❌ listPOItems error:', err.message)
    return []
  }
}

async function listPORevisions(poId: string) {
  try {
    const doc = await openDoc()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const rows = await poSheet.getRows()
    return rows
      .filter((r: any) => String(r.get('id')).trim() === String(poId).trim())
      .map((r: any) => r.toObject())
      .sort((a: any, b: any) => a.revision_number - b.revision_number)
  } catch (err: any) {
    console.error('❌ listPORevisions error:', err.message)
    return []
  }
}

async function listPOItemsByRevision(poId: string, revisionNumber: number) {
  try {
    const doc = await openDoc()
    return await getItemsByRevision(String(poId), toNum(revisionNumber, 0), doc)
  } catch (err: any) {
    console.error('❌ listPOItemsByRevision error:', err.message)
    return []
  }
}

async function getProducts() {
  try {
    const doc = await openDoc()
    const sheet = await getSheet(doc, 'product_master')
    const rows = await sheet.getRows()
    return rows.map((r: any) => r.toObject())
  } catch (err: any) {
    console.error('❌ getProducts error:', err.message)
    return []
  }
}

async function previewPO(data: any) {
  try {
    const poData = {
      po_number: data.nomorPo,
      project_name: data.namaCustomer,
      created_at: new Date().toISOString(),
      deadline: data.tanggalKirim || '',
      priority: data.prioritas || '',
      items: data.items || [],
      notes: data.catatan || '',
      kubikasi_total: data.kubikasi_total || 0,
      poPhotoPath: data.poPhotoPath,
      marketing: data.marketing || 'Unknown',
      alamat_kirim: data.alamatKirim || ''
    }
    return await generatePOJpeg(poData, 'preview', true)
  } catch (err: any) {
    console.error('❌ previewPO error:', err.message)
    return { success: false, error: err.message }
  }
}

async function getRevisionHistory(poId: string) {
  try {
    const doc = await openDoc()
    const metas = await listPORevisions(String(poId))
    const itemSheet = await getSheet(doc, 'purchase_order_items')
    const allItemRows = await itemSheet.getRows()

    const history = metas.map((m: any) => ({
      revision: m,
      items: allItemRows
        .filter(
          (r: any) =>
            String(r.get('purchase_order_id')) === String(poId) &&
            toNum(r.get('revision_number'), -1) === toNum(m.revision_number, -1)
        )
        .map((r: any) => r.toObject())
    }))
    history.sort((a: any, b: any) => b.revision.revision_number - a.revision.revision_number)
    return history
  } catch (err: any) {
    console.error('❌ getRevisionHistory error:', err.message)
    return []
  }
}

async function updateItemProgress(data: any) {
  let auth
  let photoLink: string | null = null
  let photoName: string | null = null
  let filePath: string | null = null // Tipe tetap string | null
  const { poId, itemId, poNumber, stage, notes, photoPath } = data

  try {
    if (photoPath) {
      filePath = photoPath // filePath sekarang adalah string (dari data)

      // --- PERBAIKAN 1 & 2 ---
      // Kita tambahkan 'if (filePath)' untuk meyakinkan TypeScript
      // bahwa filePath tidak null saat digunakan oleh 'fs'.
      if (filePath && fs.existsSync(filePath)) {
        console.log('🔄 Mendapatkan otentikasi baru sebelum upload foto progress...')
        auth = getAuth()
        await auth.authorize()
        console.log('✅ Otorisasi ulang berhasil.')

        const fileName = `PO-${poNumber}_ITEM-${itemId}_${new Date()
          .toISOString()
          .replace(/:/g, '-')}.jpg`
        const mimeType = 'image/jpeg'

        console.log(`🚀 Mengunggah foto progress via auth.request: ${fileName} ke Drive...`)

        const fileStream = fs.createReadStream(filePath) // Sekarang aman
        const metadata = {
          name: fileName,
          mimeType: mimeType,
          parents: [PROGRESS_PHOTOS_FOLDER_ID]
        }
        const boundary = `----UbinkayuProgressBoundary${Date.now()}----`
        const readable = new stream.PassThrough()

        readable.write(`--${boundary}\r\n`)
        readable.write('Content-Type: application/json; charset=UTF-8\r\n\r\n')
        readable.write(JSON.stringify(metadata) + '\r\n\r\n')
        readable.write(`--${boundary}\r\n`)
        readable.write(`Content-Type: ${mimeType}\r\n\r\n`)
        fileStream.pipe(readable, { end: false })
        fileStream.on('end', () => {
          readable.write(`\r\n--${boundary}--\r\n`)
          readable.end()
        })
        fileStream.on('error', (err) => {
          console.error('❌ Error membaca stream file foto:', err)
          readable.destroy(err)
        })

        const createResponse = await auth.request({
          url: `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`,
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          data: readable,
          maxBodyLength: Infinity,
          maxContentLength: Infinity
        })

        const fileId = createResponse?.data?.id
        if (!fileId) {
          console.error(
            '❌ Upload foto progress berhasil, tetapi ID file tidak ditemukan:',
            createResponse.data
          )
          throw new Error('Upload foto berhasil tetapi ID file tidak didapatkan.')
        }
        console.log(`✅ Foto progress berhasil diunggah (ID: ${fileId}). Mengambil webViewLink...`)

        const getResponse = await auth.request({
          url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
          method: 'GET',
          params: {
            fields: 'webViewLink,name,size',
            supportsAllDrives: true
          }
        })

        const webViewLink = getResponse?.data?.webViewLink
        const nameOnDrive = getResponse?.data?.name
        if (!webViewLink) {
          console.error('❌ Gagal mendapatkan webViewLink foto progress:', getResponse.data)
          throw new Error('Gagal mendapatkan link foto setelah upload berhasil.')
        }
        photoLink = webViewLink
        photoName = nameOnDrive || fileName
        console.log(`✅ Link foto progress didapatkan: ${photoLink} (name: ${photoName})`)
      } else {
        // Jika filePath ada tapi file tidak ditemukan
        throw new Error(`File foto tidak ditemukan di path: ${filePath}`)
      }
    }

    if (!auth) {
      console.log('🔄 Mendapatkan otentikasi untuk Google Sheet...')
      auth = getAuth()
      await auth.authorize()
      console.log('✅ Otorisasi Sheet berhasil.')
    }

    const doc = await openDoc()
    const progressSheet = await getSheet(doc, 'progress_tracking')
    const nextId = await getNextIdFromSheet(progressSheet)

    console.log(`📝 Menyimpan log progress ke Sheet... (Stage: ${stage})`)
    await progressSheet.addRow({
      id: nextId,
      purchase_order_id: poId,
      purchase_order_item_id: itemId,
      stage: stage,
      notes: notes || '',
      // --- PERBAIKAN 3 ---
      // Pastikan kita mengirim string kosong ('') jika photoLink null.
      photo_url: photoLink || '',
      photo_file_name: photoName || '',
      created_at: new Date().toISOString()
    })
    console.log(`✅ Log progress untuk item ID ${itemId} berhasil disimpan ke Sheet.`)

    return { success: true }
  } catch (err: any) {
    console.error('❌ Gagal update item progress:', err.message)
    if (err.response && err.response.data && err.response.data.error) {
      console.error(
        '   -> Detail Error Google API:',
        JSON.stringify(err.response.data.error, null, 2)
      )
    } else if (err.response) {
      console.error(`   -> Status Error HTTP: ${err.response.status}`)
      console.error('   -> Data Error:', err.response.data)
    }
    return { success: false, error: err.message }
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
        console.log(`🗑️ File foto lokal ${path.basename(filePath)} dihapus.`)
      } catch (unlinkErr: any) {
        console.warn(
          `⚠️ Gagal menghapus file foto lokal ${path.basename(filePath)}:`,
          unlinkErr.message
        )
      }
    }
  }
}

async function getActivePOsWithProgress() {
  try {
    const doc = await openDoc()
    const [poSheet, itemSheet, progressSheet] = await Promise.all([
      getSheet(doc, 'purchase_orders'),
      getSheet(doc, 'purchase_order_items'),
      getSheet(doc, 'progress_tracking')
    ])
    const [poRows, itemRows, progressRows] = await Promise.all([
      poSheet.getRows(),
      itemSheet.getRows(),
      progressSheet.getRows()
    ])

    const byId = new Map()
    for (const r of poRows) {
      const id = String(r.get('id')).trim()
      const rev = toNum(r.get('revision_number'), -1)
      if (!byId.has(id) || rev > (byId.get(id) as any).rev) {
        byId.set(id, { rev, row: r })
      }
    }
    const latestPoRows = Array.from(byId.values()).map(({ row }: any) => row)

    const progressByCompositeKey = progressRows.reduce((acc: any, row: any) => {
      const key = `${row.get('purchase_order_id')}-${row.get('purchase_order_item_id')}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
      return acc
    }, {})

    const latestItemRevisions = itemRows.reduce((acc: any, item: any) => {
      const poId = item.get('purchase_order_id')
      const rev = toNum(item.get('revision_number'), -1)
      if (!acc.has(poId) || rev > acc.get(poId)) {
        acc.set(poId, rev)
      }
      return acc
    }, new Map())

    const allPOsWithCalculatedStatus = latestPoRows.map((po: any) => {
      const poId = po.get('id')
      const latestRev = latestItemRevisions.get(poId) ?? -1
      const poItems = itemRows.filter(
        (item: any) =>
          item.get('purchase_order_id') === poId &&
          toNum(item.get('revision_number'), -1) === latestRev
      )

      let totalPercentage = 0
      if (poItems.length > 0) {
        poItems.forEach((item: any) => {
          const itemId = item.get('id')
          const itemProgressHistory = progressByCompositeKey[`${poId}-${itemId}`] || []
          let latestStageIndex = -1
          if (itemProgressHistory.length > 0) {
            const latestProgress = [...itemProgressHistory].sort(
              (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )[0]
            latestStageIndex = PRODUCTION_STAGES.indexOf(latestProgress.stage)
          }
          totalPercentage +=
            latestStageIndex >= 0 ? ((latestStageIndex + 1) / PRODUCTION_STAGES.length) * 100 : 0
        })
      }

      const poProgress = poItems.length > 0 ? totalPercentage / poItems.length : 0
      const poObject = po.toObject()

      let finalStatus = poObject.status
      if (finalStatus !== 'Cancelled') {
        if (poProgress >= 100) finalStatus = 'Completed'
        else if (poProgress > 0) finalStatus = 'In Progress'
        else finalStatus = 'Open'
      }

      return { ...poObject, progress: Math.round(poProgress), status: finalStatus }
    })

    const activePOs = allPOsWithCalculatedStatus.filter(
      (po: any) => po.status !== 'Completed' && po.status !== 'Cancelled'
    )

    return activePOs
  } catch (err: any) {
    console.error('❌ Gagal get active POs with progress:', err.message)
    return []
  }
}

async function getPOItemsWithDetails(poId: string) {
  try {
    const doc = await openDoc()
    const [poSheet, itemSheet, progressSheet] = await Promise.all([
      getSheet(doc, 'purchase_orders'),
      getSheet(doc, 'purchase_order_items'),
      getSheet(doc, 'progress_tracking')
    ])
    const [poRows, itemRows, progressRows] = await Promise.all([
      poSheet.getRows(),
      itemSheet.getRows(),
      progressSheet.getRows()
    ])

    const allItemsForPO = itemRows.filter((r: any) => r.get('purchase_order_id') === poId)

    if (allItemsForPO.length === 0) {
      console.warn(`Tidak ada item sama sekali untuk PO ID ${poId} di sheet items.`)
      return []
    }

    const latestItemRev = Math.max(-1, ...allItemsForPO.map((r: any) => toNum(r.get('revision_number'))))

    const poData = poRows.find(
      (r: any) => r.get('id') === poId && toNum(r.get('revision_number')) === latestItemRev
    )

    if (!poData) {
      console.error(
        `Inkonsistensi Data: Ditemukan item untuk PO ID ${poId} rev ${latestItemRev}, tetapi tidak ada header PO yang cocok.`
      )
      throw new Error(`Data PO untuk revisi terbaru (rev ${latestItemRev}) tidak ditemukan.`)
    }

    const poStartDateRaw = poData.get('created_at')
    const poDeadlineRaw = poData.get('deadline')

    let poStartDate = new Date(poStartDateRaw)
    let poDeadline = new Date(poDeadlineRaw)

    if (isNaN(poStartDate.getTime())) {
      console.warn(`Tanggal created_at PO ${poId} tidak valid, menggunakan tanggal saat ini.`)
      poStartDate = new Date()
    }

    if (isNaN(poDeadline.getTime())) {
      console.warn(`Tanggal deadline PO ${poId} tidak valid, menggunakan created_at + 7 hari.`)
      poDeadline = new Date(poStartDate.getTime() + 7 * 24 * 60 * 60 * 1000)
    }

    let stageDeadlines: any[] = []
    let cumulativeDate = new Date(poStartDate)
    stageDeadlines = PRODUCTION_STAGES.map((stageName) => {
      if (stageName === 'Siap Kirim') {
        return { stageName, deadline: poDeadline.toISOString() }
      }
      const durationDays = DEFAULT_STAGE_DURATIONS[stageName] || 0
      cumulativeDate.setDate(cumulativeDate.getDate() + durationDays)
      return { stageName, deadline: new Date(cumulativeDate).toISOString() }
    })

    const poItemsForLatestRev = allItemsForPO.filter(
      (item: any) => toNum(item.get('revision_number'), -1) === latestItemRev
    )

    const progressByItemId = progressRows
      .filter((row: any) => row.get('purchase_order_id') === poId)
      .reduce((acc: any, row: any) => {
        const itemId = row.get('purchase_order_item_id')
        if (!acc[itemId]) acc[itemId] = []
        acc[itemId].push(row.toObject())
        return acc
      }, {})

    const result = poItemsForLatestRev.map((item: any) => {
      const itemObject = item.toObject()
      const itemId = String(itemObject.id)
      const history = (progressByItemId[itemId] || []).sort(
        (a: any, b: any) => (new Date(a.created_at) as any) - (new Date(b.created_at) as any) // ⬅️ PERBAIKAN TS2362/TS2363
      )
      return { ...itemObject, progressHistory: history, stageDeadlines }
    })

    return result
  } catch (err: any) {
    console.error(`❌ Gagal get PO items with details for PO ID ${poId}:`, err.message)
    return []
  }
}

async function updateStageDeadline(data: any) {
  const { poId, itemId, stageName, newDeadline } = data
  try {
    const doc = await openDoc()
    const sheet = await getSheet(doc, 'progress_tracking')
    await sheet.addRow({
      purchase_order_id: poId,
      purchase_order_item_id: itemId,
      stage: `DEADLINE_OVERRIDE: ${stageName}`,
      custom_deadline: newDeadline,
      created_at: new Date().toISOString()
    })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

async function getRecentProgressUpdates(limit = 10) {
  try {
    const doc = await openDoc()
    const progressSheet = await getSheet(doc, 'progress_tracking')
    const itemSheet = await getSheet(doc, 'purchase_order_items')
    const poSheet = await getSheet(doc, 'purchase_orders')

    const [progressRows, itemRows, poRows] = await Promise.all([
      progressSheet.getRows(),
      itemSheet.getRows(),
      poSheet.getRows()
    ])

    const itemMap = new Map(itemRows.map((r: any) => [r.get('id'), r.toObject()]))
    const poMap = new Map()
    poRows.forEach((r: any) => {
      const poId = r.get('id')
      const rev = toNum(r.get('revision_number'))
      if (!poMap.has(poId) || rev > (poMap.get(poId) as any).revision_number) {
        poMap.set(poId, r.toObject())
      }
    })

    const sortedUpdates = progressRows
      .map((r: any) => r.toObject())
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    const recentUpdates = sortedUpdates.slice(0, limit)

    const enrichedUpdates = recentUpdates
      .map((update: any) => {
        const item = itemMap.get(update.purchase_order_item_id)
        if (!item) return null

        const po = poMap.get(item.purchase_order_id)
        if (!po) return null

        return {
          ...update,
          item_name: item.product_name,
          po_number: po.po_number
        }
      })
      .filter(Boolean)

    return enrichedUpdates
  } catch (err: any) {
    console.error('❌ Gagal get recent progress updates:', err.message)
    return []
  }
}

async function getAttentionData() {
  try {
    const doc = await openDoc()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const itemSheet = await getSheet(doc, 'purchase_order_items')
    const progressSheet = await getSheet(doc, 'progress_tracking')

    const [poRows, itemRows, progressRows] = await Promise.all([
      poSheet.getRows(),
      itemSheet.getRows(),
      progressSheet.getRows()
    ])

    const byId = new Map()
    poRows.forEach((r: any) => {
      const id = r.get('id')
      const rev = toNum(r.get('revision_number'))
      if (!byId.has(id) || rev > (byId.get(id) as any).rev) {
        byId.set(id, { rev, row: r })
      }
    })
    const latestPoMap = new Map(
      Array.from(byId.values()).map((item: any) => [item.row.get('id'), item.row])
    )

    const latestItemRevisions = new Map()
    itemRows.forEach((item: any) => {
      const poId = item.get('purchase_order_id')
      const rev = toNum(item.get('revision_number'), -1)
      const current = latestItemRevisions.get(poId)
      if (!current || rev > current) {
        latestItemRevisions.set(poId, rev)
      }
    })

    const activeItems = itemRows.filter((item: any) => {
      const po = latestPoMap.get(item.get('purchase_order_id'))
      if (!po) return false
      const latestRev = latestItemRevisions.get(item.get('purchase_order_id')) ?? -1
      return (
        po.get('status') !== 'Completed' &&
        po.get('status') !== 'Cancelled' &&
        toNum(item.get('revision_number')) === latestRev
      )
    })

    const progressByCompositeKey = progressRows.reduce((acc: any, row: any) => {
      const poId = row.get('purchase_order_id')
      const itemId = row.get('purchase_order_item_id')
      const key = `${poId}-${itemId}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
      return acc
    }, {})

    const nearingDeadline: any[] = []
    const stuckItems: any[] = []
    const urgentItems: any[] = []
    const today = new Date()
    const sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
    const fiveDaysAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000)

    activeItems.forEach((item: any) => {
      const po = latestPoMap.get(item.get('purchase_order_id'))
      const poId = po.get('id')
      const itemId = item.get('id')
      const compositeKey = `${poId}-${itemId}`
      const itemProgressHistory = progressByCompositeKey[compositeKey] || []
      const latestProgress = itemProgressHistory.sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0]
      const currentStage = latestProgress ? latestProgress.stage : 'Belum Mulai'

      const attentionItem = {
        po_number: po.get('po_number'),
        item_name: item.get('product_name'),
        current_stage: currentStage
      }

      if (po.get('priority') === 'Urgent') {
        urgentItems.push(attentionItem)
      }

      const deadline = new Date(po.get('deadline'))
      if (deadline <= sevenDaysFromNow && deadline >= today && currentStage !== 'Siap Kirim') {
        nearingDeadline.push({ ...attentionItem, deadline: po.get('deadline') })
      }

      if (
        latestProgress &&
        new Date(latestProgress.created_at) < fiveDaysAgo &&
        currentStage !== 'Siap Kirim'
      ) {
        stuckItems.push({ ...attentionItem, last_update: latestProgress.created_at })
      }
    })

    return { nearingDeadline, stuckItems, urgentItems }
  } catch (err: any) {
    console.error('❌ Gagal get attention data:', err.message)
    return { nearingDeadline: [], stuckItems: [], urgentItems: [] }
  }
}

const formatDateForAnalysis = (dateString: any) => {
  if (!dateString) return null
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return null
    return date.toISOString().split('T')[0] // Format YYYY-MM-DD
  } catch {
    return null
  }
}

const getYearMonth = (dateString: any) => {
  const date = formatDateForAnalysis(dateString)
  return date ? date.substring(0, 7) : null // Ambil YYYY-MM
}

async function getProductSalesAnalysis() {
  try {
    const doc = await openDoc()
    const [itemSheet, poSheet, productSheet] = await Promise.all([
      getSheet(doc, 'purchase_order_items'),
      getSheet(doc, 'purchase_orders'),
      getSheet(doc, 'product_master')
    ])
    const [rawItemRows, rawPoRows, rawProductRows] = await Promise.all([
      itemSheet.getRows(),
      poSheet.getRows(),
      productSheet.getRows()
    ])

    const itemRows = rawItemRows.map((r: any) => r.toObject())
    const poRows = rawPoRows.map((r: any) => r.toObject())
    const productRows = rawProductRows.map((r: any) => r.toObject())

    const latestPoMap = poRows.reduce((map: any, po: any) => {
      const poId = po.id
      const rev = toNum(po.revision_number)
      if (po.status !== 'Cancelled') {
        if (!map.has(poId) || rev > map.get(poId).revision_number) {
          map.set(poId, { ...po, revision_number: rev })
        }
      }
      return map
    }, new Map())

    const salesByProduct: { [key: string]: any } = {}
    const salesByMarketing: { [key: string]: any } = {}
    const monthlySalesByProduct: { [key: string]: any } = {}
    const monthlySalesByMarketing: { [key: string]: any } = {}
    const woodTypeDistribution: { [key: string]: any } = {}
    const customerByKubikasi: { [key: string]: any } = {}
    const salesByDateForTrend: any[] = []
    const soldProductNames = new Set()

    itemRows.forEach((item: any) => {
      const po = latestPoMap.get(item.purchase_order_id)
      if (!po || toNum(item.revision_number) !== po.revision_number) {
        return
      }

      const productName = item.product_name
      const quantity = toNum(item.quantity, 0)
      const kubikasi = toNum(item.kubikasi, 0)
      const woodType = item.wood_type
      const yearMonth = getYearMonth(po.created_at)

      if (!productName || quantity <= 0) return

      soldProductNames.add(productName)

      salesByProduct[productName] = salesByProduct[productName] || {
        totalQuantity: 0,
        totalKubikasi: 0,
        name: productName
      }
      salesByProduct[productName].totalQuantity += quantity
      salesByProduct[productName].totalKubikasi += kubikasi

      if (yearMonth) {
        monthlySalesByProduct[yearMonth] = monthlySalesByProduct[yearMonth] || {}
        monthlySalesByProduct[yearMonth][productName] =
          (monthlySalesByProduct[yearMonth][productName] || 0) + quantity
      }

      if (woodType)
        woodTypeDistribution[woodType] = (woodTypeDistribution[woodType] || 0) + quantity

      try {
        salesByDateForTrend.push({ date: new Date(po.created_at), name: productName, quantity })
      } catch { }
    })

    latestPoMap.forEach((po: any) => {
      const marketingName = po.acc_marketing || 'N/A'
      const customerName = po.project_name
      const kubikasiTotalPO = toNum(po.kubikasi_total, 0)
      const yearMonth = getYearMonth(po.created_at)

      salesByMarketing[marketingName] = salesByMarketing[marketingName] || {
        totalKubikasi: 0,
        poCount: 0,
        name: marketingName
      }
      salesByMarketing[marketingName].totalKubikasi += kubikasiTotalPO
      salesByMarketing[marketingName].poCount += 1

      if (yearMonth) {
        monthlySalesByMarketing[yearMonth] = monthlySalesByMarketing[yearMonth] || {}
        monthlySalesByMarketing[yearMonth][marketingName] =
          (monthlySalesByMarketing[yearMonth][marketingName] || 0) + kubikasiTotalPO
      }

      if (customerName)
        customerByKubikasi[customerName] = (customerByKubikasi[customerName] || 0) + kubikasiTotalPO
    })

    const topSellingProductsFull = Object.values(salesByProduct).sort(
      (a: any, b: any) => b.totalQuantity - a.totalQuantity
    )

    const salesByMarketingSorted = Object.values(salesByMarketing).sort(
      (a: any, b: any) => b.totalKubikasi - a.totalKubikasi
    )

    const woodTypeDistributionSorted = Object.entries(woodTypeDistribution)
      .map(([name, value]) => ({ name, value }))
      .sort((a: any, b: any) => b.value - a.value)

    const topCustomersFull = Object.entries(customerByKubikasi)
      .map(([name, totalKubikasi]) => ({ name, totalKubikasi }))
      .sort((a: any, b: any) => b.totalKubikasi - a.totalKubikasi)

    const allMonths = new Set([
      ...Object.keys(monthlySalesByProduct),
      ...Object.keys(monthlySalesByMarketing)
    ])
    const sortedMonths = Array.from(allMonths).sort()

    const allProductKeys = new Set<string>()
    sortedMonths.forEach((month: any) => {
      if (monthlySalesByProduct[month])
        Object.keys(monthlySalesByProduct[month]).forEach((p) => allProductKeys.add(p))
    })

    const allMarketingKeys = new Set<string>()
    sortedMonths.forEach((month: any) => {
      if (monthlySalesByMarketing[month])
        Object.keys(monthlySalesByMarketing[month]).forEach((m) => allMarketingKeys.add(m))
    })

    const monthlyProductChartData = sortedMonths.map((month) => {
      const monthData: { [key: string]: any } = { month }
      allProductKeys.forEach((prodKey) => {
        monthData[prodKey] = monthlySalesByProduct[month]?.[prodKey] || 0
      })
      return monthData
    })

    const monthlyMarketingChartData = sortedMonths.map((month) => {
      const monthData: { [key: string]: any } = { month }
      allMarketingKeys.forEach((markKey) => {
        monthData[markKey] = monthlySalesByMarketing[month]?.[markKey] || 0
      })
      return monthData
    })

    const todayTrend = new Date(),
      thirtyDaysAgo = new Date(new Date().setDate(todayTrend.getDate() - 30)),
      sixtyDaysAgo = new Date(new Date().setDate(todayTrend.getDate() - 60))
    const salesLast30: { [key: string]: number } = {}
    const salesPrev30: { [key: string]: number } = {}
    salesByDateForTrend.forEach((sale) => {
      if (sale.date >= thirtyDaysAgo)
        salesLast30[sale.name] = (salesLast30[sale.name] || 0) + sale.quantity
      else if (sale.date >= sixtyDaysAgo)
        salesPrev30[sale.name] = (salesPrev30[sale.name] || 0) + sale.quantity
    })
    const trendingProducts = Object.keys(salesLast30)
      .map((name) => {
        const last30 = salesLast30[name] || 0
        const prev30 = salesPrev30[name] || 0
        const change =
          prev30 === 0 && last30 > 0 ? 100 : ((last30 - prev30) / (prev30 === 0 ? 1 : prev30)) * 100
        return { name, last30, prev30, change }
      })
      .filter((p) => p.change > 10 && p.last30 > p.prev30)
      .sort((a, b) => b.change - a.change)

    const allMasterProductNames = productRows.map((p: any) => p.product_name).filter(Boolean)
    const slowMovingProducts = allMasterProductNames.filter((name) => !soldProductNames.has(name))

    const analysisResult = {
      // --- PERBAIKAN ---
      // Kirim data lengkap (full) ke 'analysisData'
      topSellingProducts: topSellingProductsFull,
      salesByMarketing: salesByMarketingSorted,
      monthlyProductChartData,
      monthlyMarketingChartData,
      woodTypeDistribution: woodTypeDistributionSorted,
      topCustomers: topCustomersFull,
      // --- AKHIR PERBAIKAN ---
      trendingProducts,
      slowMovingProducts
    }

    console.log('📊 Analisis Penjualan Dihasilkan:', analysisResult)
    return analysisResult
  } catch (err: any) {
    console.error('❌ Gagal melakukan analisis penjualan produk:', err.message)
    return {
      topSellingProducts: [],
      salesByMarketing: [],
      monthlyProductChartData: [],
      monthlyMarketingChartData: [],
      woodTypeDistribution: [],
      topCustomers: [],
      trendingProducts: [],
      slowMovingProducts: []
    }
  }
}

async function getSalesItemData() {
  try {
    const doc = await openDoc()
    const itemSheet = await getSheet(doc, 'purchase_order_items')
    const poSheet = await getSheet(doc, 'purchase_orders')

    const [itemRows, poRows] = await Promise.all([itemSheet.getRows(), poSheet.getRows()])

    const poMap = new Map()
    poRows.forEach((r: any) => {
      const poId = r.get('id')
      const rev = toNum(r.get('revision_number'))
      if (!poMap.has(poId) || rev > (poMap.get(poId) as any).revision_number) {
        poMap.set(poId, r.toObject())
      }
    })

    const combinedData = itemRows
      .map((item: any) => {
        const itemObject = item.toObject()
        const po = poMap.get(itemObject.purchase_order_id)

        if (!po) return null

        return {
          ...itemObject,
          customer_name: po.project_name,
          po_date: po.created_at
        }
      })
      .filter(Boolean)

    return combinedData
  } catch (err: any) {
    console.error('❌ Gagal mengambil data item penjualan:', err.message)
    return []
  }
}

async function addNewProduct(productData: any) {
  try {
    console.log('📦 Menambahkan produk baru ke master:', productData)
    const doc = await openDoc()
    const sheet = await getSheet(doc, 'product_master')
    const nextId = await getNextIdFromSheet(sheet)
    await sheet.addRow({ id: nextId, ...productData })
    console.log(`✅ Produk baru [ID: ${nextId}] berhasil ditambahkan.`)
    return { success: true, newId: nextId }
  } catch (err: any) {
    console.error('❌ Gagal menambahkan produk baru:', err.message)
    return { success: false, error: err.message }
  }
}

// =================================================================
// LANGKAH 2: TAMBAHKAN FUNGSI HELPER BARU (AI CALL 2)
// =================================================================
// (Letakkan ini TEPAT SEBELUM 'async function handleGroqChat(...)')

/**
 * Melakukan panggilan kedua ke Groq untuk menghasilkan respons bahasa alami
 * berdasarkan data yang sudah diambil.
 */
async function generateNaturalResponse(
  dataContext: string, // Data mentah dalam format JSON string
  userRequestDescription: string, // Deskripsi permintaan user (misal: "User bertanya soal produk terlaris")
  originalPrompt: string // Prompt asli dari user
): Promise<string> {

  const groqToken = process.env.GROQ_API_KEY
  const modelId = 'llama-3.1-8b-instant' // Gunakan model yang sama

  if (!groqToken) {
    throw new Error('GROQ_API_KEY tidak ditemukan.')
  }

  // System prompt BARU, khusus untuk *menghasilkan* jawaban
  const generationSystemPrompt = `Anda adalah Asisten AI ERP Ubinkayu yang ramah, cerdas, dan profesional.
Tugas Anda adalah menjawab pertanyaan user berdasarkan data yang saya berikan.
JANGAN mengembalikan JSON. Jawablah dalam Bahasa Indonesia yang alami, ramah, dan bervariasi.
Anda boleh memberikan sedikit insight (wawasan) dari data jika terlihat jelas, tapi jangan berlebihan.
Selalu gunakan **format markdown** (seperti bold atau list) untuk membuat jawaban mudah dibaca.
JADIKAN JUDUL UTAMA JAWABAN ANDA (jika ada) **bold** (contoh: "**Berikut adalah 5 Produk Terlaris**").

DATA KONTEKS (dalam format JSON):
${dataContext}

DESKRIPSI PERMINTAAN USER:
${userRequestDescription}

PROMPT ASLI USER:
"${originalPrompt}"

Sekarang, tuliskan jawaban Anda untuk user.`

  try {
    console.log(`[Electron AI - Groq Call 2] Generating natural response for: ${userRequestDescription}`)
    const API_URL = 'https://api.groq.com/openai/v1/chat/completions'

    const payload = {
      model: modelId,
      messages: [
        { role: 'system', content: generationSystemPrompt }
        // Kita tidak menyertakan prompt asli user di sini karena sudah ada di system prompt
      ],
      temperature: 0.7, // <-- Naikkan temperature agar lebih bervariasi
      max_tokens: 500 // Beri ruang lebih untuk jawaban
    }

    const response = await fetchWithRetry(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Groq API Call 2 request failed: ${errorText}`)
    }

    const result = await response.json()
    const aiResponse = result.choices[0]?.message?.content?.trim()

    if (!aiResponse) {
      throw new Error('Groq Call 2 returned an empty response.')
    }

    console.log(`[Electron AI - Groq Call 2] Generated: "${aiResponse.substring(0, 50)}..."`)
    return aiResponse

  } catch (err: any) {
    console.error('💥 [Electron AI - Groq Call 2] ERROR:', err.message)
    return `Maaf, terjadi kesalahan saat saya mencoba menyusun jawaban: ${err.message}`
  }
}


// =================================================================
// LANGKAH 3: GANTI FUNGSI 'handleGroqChat' LAMA ANDA DENGAN INI
// =================================================================

async function handleGroqChat(prompt: string) {
  // 1. AMBIL KONTEKS DATA PO & ANALISIS
  let allPOs: any[]
  let analysisData: any // <-- [BARU]

  try {
    allPOs = await listPOs()
    if (!Array.isArray(allPOs)) {
      console.error('listPOs did not return an array.')
      allPOs = []
    }

    // [BARU] Ambil data analisis yang sudah jadi
    analysisData = await getProductSalesAnalysis()
  } catch (e: any) {
    console.error('Gagal mengambil data PO atau Analisis untuk konteks AI:', e.message)
    return 'Maaf, saya gagal mengambil data PO/Analisis terbaru untuk menjawab pertanyaan Anda.'
  }

  // 2. SIAPKAN SAPAAN & SYSTEM PROMPT
  const now = new Date()
  const today = new Date().toISOString().split('T')[0]

  const systemPrompt = `Anda adalah Asisten ERP Ubinkayu. Tugas Anda adalah mengubah pertanyaan pengguna menjadi JSON 'perintah' yang valid. HANYA KEMBALIKAN JSON.
Hari ini adalah ${today}.

--- ATURAN PRIORITAS ---
1. Jika user menyebut nomor PO, nama customer, atau revisi, Anda HARUS menggunakan "getPOInfo".
2. Tentukan 'intent' user dengan hati-hati.

--- Alat (Tools) yang Tersedia ---

// --- ALAT ANALISIS (SUMBER: getProductSalesAnalysis) ---
1. "getTopSellingProducts": (Untuk produk terlaris).
   - Keywords: "produk terlaris", "paling laku", "top produk".
   - JSON: {"tool": "getTopSellingProducts"}

2. "getTopCustomers": (Untuk customer terbesar).
   - Keywords: "customer terbesar", "top customer", "pelanggan utama".
   - JSON: {"tool": "getTopCustomers"}

3. "getTopMarketing": (Untuk performa marketing).
   - Keywords: "top marketing", "marketing terbaik", "performa marketing".
   - JSON: {"tool": "getTopMarketing"}

4. "getWoodDistribution": (Untuk distribusi jenis kayu).
   - Keywords: "jenis kayu", "distribusi kayu", "kayu apa paling laku".
   - PRIORITAS: Jika user menyebut "distribusi kayu" atau "persentase kayu", SELALU gunakan tool ini.
   - JSON: {"tool": "getWoodDistribution"}

5. "getTrendingProducts": (Untuk produk yang tren-nya naik).
   - Keywords: "produk tren naik", "trending product", "rekomendasi stok".
   - JSON: {"tool": "getTrendingProducts"}

6. "getSlowMovingProducts": (Untuk produk yang tidak laku).
   - Keywords: "produk tidak laku", "produk belum terjual", "slow moving".
   - JSON: {"tool": "getSlowMovingProducts"}

// --- ALAT PO (SUMBER: listPOs) ---
7. "getTotalPO": (Untuk pertanyaan jumlah/total PO).
   - Keywords: "jumlah po", "total po", "ada berapa po", "semua po aktif".
   - JSON: {"tool": "getTotalPO"}

8. "getPOInfo": (Mencari PO berdasarkan 'header'-nya: Nomor PO atau Customer).
   - PENTING: JANGAN gunakan tool ini untuk mencari berdasarkan produk or kayu. Gunakan "getPOsByItem".
   - PENTING: 'poNumber' BISA MENGANDUNG SPASI. 'revisionNumber' HANYA angka setelah kata "revisi" atau "rev".
   - AI HARUS mengekstrak "poNumber" atau "customerName".
   - AI HARUS mengekstrak "revisionNumber" (jika disebut).
   - AI HARUS menentukan "intent" (niat) user: "status", "details", atau "file".
   - Default ke "details" jika tidak spesifik.
   - JSON: {"tool": "getPOInfo", "param": {"poNumber": "...", "customerName": "...", "revisionNumber": "...", "intent": "status"}}

9. "getPOsByItem": (Mencari PO berdasarkan 'isi' item).
   - Keywords: "po yang ada produk [nama]", "cari po pakai kayu [jenis]", "po dengan [produk]".
   - AI HARUS mengekstrak "productName" ATAU "woodType".
   - JSON: {"tool": "getPOsByItem", "param": {"productName": "...", "woodType": "..."}}

10. "getUrgentPOs": (Untuk pertanyaan PO 'Urgent').
   - Keywords: "po urgent", "urgent orders".
   - JSON: {"tool": "getUrgentPOs"}

11. "getNearingDeadline": (Untuk pertanyaan PO 'deadline dekat').
   - Keywords: "deadline dekat", "nearing deadline".
   - JSON: {"tool": "getNearingDeadline"}

12. "getNewestPOs": (Untuk pertanyaan PO 'terbaru').
   - Keywords: "po terbaru", "newest po".
   - PENGECUALIAN: Jika user bertanya "po hari ini", gunakan "getPOsByDateRange".
   - JSON: {"tool": "getNewestPOs"}

13. "getOldestPO": (Untuk pertanyaan PO 'terlama').
   - Keywords: "po terlama", "oldest po".
   - JSON: {"tool": "getOldestPO"}

14. "getPOsByDateRange": (Untuk pertanyaan PO berdasarkan 'tanggal').
   - Keywords: "po bulan oktober", "po tanggal 20 okt", "po 1-10 nov", "po hari ini".
   - PRIORITAS: Jika user menyebut "hari ini", SELALU gunakan tool ini.
   - AI HARUS mengekstrak 'startDate' dan 'endDate' ("YYYY-MM-DD").
   - Jika 1 tanggal (misal: "po 1 nov 2025"), 'startDate' DAN 'endDate' HARUS sama: "2025-11-01".
   - Jika "hari ini", 'startDate' DAN 'endDate' HARUS sama dengan tanggal hari ini (${today}).
   - JSON: {"tool": "getPOsByDateRange", "param": {"startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}}

15. "getPOByStatusCount": (Untuk pertanyaan jumlah PO 'Open' atau 'In Progress').
    - Keywords: "berapa po open", "jumlah po in progress".
    - JSON: {"tool": "getPOByStatusCount", "param": "STATUS_DIMINTA"}

// --- ALAT BANTUAN & GRAFIK ---
16. "getApplicationHelp": (Untuk pertanyaan 'cara pakai' aplikasi).
    - Keywords: "cara buat po", "panduan aplikasi", "cara update progress", "cara revisi po", "cara tambah produk", "menambah produk master".
    - AI HARUS mengekstrak 'topic' dari kata kunci.
    - Contoh 1: "gimana cara input po baru?" -> "topic": "buat po".
    - Contoh 2: "panduan untuk revisi" -> "topic": "revisi po".
    - Contoh 3: "cara menambah produk master" -> "topic": "tambah produk".
    - JSON: {"tool": "getApplicationHelp", "param": {"topic": "NAMA_FITUR_DIMINTA"}}

17. "help": (Untuk pertanyaan 'bantuan' atau 'perintah').
    - Keywords: "bantuan", "help".
    - JSON: {"tool": "help"}

18. "general": (Untuk sapaan umum).
    - Keywords: "halo", "terima kasih".
    - JSON: {"tool": "general"}

19. "createCustomChart": (Untuk SEMUA permintaan 'grafik' atau 'chart').
    - Keywords: "grafik", "chart", "diagram batang", "pie chart", "bandingkan [A] dan [B]".
    - AI HARUS mengidentifikasi 5 parameter dari 'analysisData':
      1.  'dataSource': Kunci dari 'analysisData'. Nilai yang valid: 'topSellingProducts', 'topCustomers', 'salesByMarketing', 'woodTypeDistribution', 'trendingProducts'.
      2.  'chartType': Tipe chart. Nilai yang valid: 'bar' (default), 'pie', 'line'.
          - Gunakan 'pie' jika user meminta "distribusi" atau "persentase" (misal: 'woodTypeDistribution').
          - Gunakan 'bar' untuk perbandingan (top 5, dll).
      3.  'nameKey': Kunci string di 'dataSource' untuk label (sumbu X). (Contoh: 'name', 'product_name').
      4.  'dataKey': Kunci string di 'dataSource' untuk nilai (sumbu Y). (Contoh: 'totalQuantity', 'totalKubikasi', 'poCount', 'value', 'change').
      5.  'filters' (Opsional): Array string jika user ingin memfilter data. (Contoh: ["kisi kisi", "pintu"]).

    - --- CONTOH ---
    - User: "grafik produk terlaris"
    - JSON: {"tool": "createCustomChart", "param": {"dataSource": "topSellingProducts", "chartType": "bar", "nameKey": "name", "dataKey": "totalQuantity", "filters": null}}

    - User: "grafik top 5 customer berdasarkan m³"
    - JSON: {"tool": "createCustomChart", "param": {"dataSource": "topCustomers", "chartType": "bar", "nameKey": "name", "dataKey": "totalKubikasi", "filters": null}}

    - User: "pie chart distribusi kayu" ATAU "persentase kayu"
    - JSON: {"tool": "createCustomChart", "param": {"dataSource": "woodTypeDistribution", "chartType": "pie", "nameKey": "name", "dataKey": "value", "filters": null}}

    - User: "grafik perbandingan penjualan kisi kisi dan pintu"
    - JSON: {"tool": "createCustomChart", "param": {"dataSource": "topSellingProducts", "chartType": "bar", "nameKey": "name", "dataKey": "totalQuantity", "filters": ["Kisi kisi", "Pintu"]}}

    - User: "grafik marketing berdasarkan jumlah PO"
    - JSON: {"tool": "createCustomChart", "param": {"dataSource": "salesByMarketing", "chartType": "bar", "nameKey": "name", "dataKey": "poCount", "filters": null}}

ATURAN KETAT:
- JANGAN menjawab pertanyaan. HANYA KEMBALIKAN JSON.
- Jika tidak yakin tool mana, KEMBALIKAN: {"tool": "unknown"}`

  // (systemPrompt didefinisikan di atas)

  // 3. PANGGIL GROQ API (CALL 1 - MEMILIH TOOL)
  let aiDecisionJsonString = ''
  let aiDecision: any = { tool: 'unknown' }

  const groqToken = process.env.GROQ_API_KEY
  const modelId = 'llama-3.1-8b-instant'

  console.log(`[Electron AI - Groq Call 1] Using Model ID: ${modelId}`)

  if (!groqToken) {
    console.error('💥 [Electron AI - Groq Call 1] GROQ_API_KEY tidak ditemukan di process.env')
    return 'Maaf, GROQ_API_KEY tidak ditemukan. Pastikan Anda sudah membuat file .env dan me-restart Electron.'
  }

  try {
    console.log('⏳ [Electron AI - Groq Call 1] Calling Groq API via MANUAL FETCH...')

    const API_URL = 'https://api.groq.com/openai/v1/chat/completions'

    const payload = {
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 250 // Dinaikkan sedikit untuk param filter yang panjang
    }

    const response = await fetchWithRetry(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ [Electron AI - Groq Call 1] Manual Fetch Error Response:', errorText)
      throw new Error(`Groq API request failed with status ${response.status}: ${errorText}`)
    }

    const result = await response.json()
    console.log('✅ [Electron AI - Groq Call 1] Groq raw response (manual):', JSON.stringify(result))

    if (
      result &&
      result.choices &&
      result.choices[0] &&
      result.choices[0].message &&
      result.choices[0].message.content
    ) {
      aiDecisionJsonString = result.choices[0].message.content.trim()

      if (aiDecisionJsonString.startsWith('```json')) {
        aiDecisionJsonString = aiDecisionJsonString.substring(7).trim()
      }
      if (aiDecisionJsonString.endsWith('```')) {
        aiDecisionJsonString = aiDecisionJsonString
          .substring(0, aiDecisionJsonString.length - 3)
          .trim()
      }
      const jsonStart = aiDecisionJsonString.indexOf('{')
      const jsonEnd = aiDecisionJsonString.lastIndexOf('}')
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        aiDecisionJsonString = aiDecisionJsonString.substring(jsonStart, jsonEnd + 1)
      }

      console.log(` -> Cleaned JSON string: ${aiDecisionJsonString}`)
      aiDecision = JSON.parse(aiDecisionJsonString)
      console.log('✅ [Electron AI - Groq Call 1] Parsed JSON decision:', aiDecision)
    } else {
      console.error('❌ [Electron AI - Groq Call 1] Unexpected response format (manual):', result)
      throw new Error('Unexpected response format from Groq (manual fetch).')
    }
  } catch (err: any) {
    console.error('💥 [Electron AI - Groq Call 1] AI call or JSON parse ERROR:', err.message)
    return `Maaf, terjadi kesalahan saat menghubungi Groq: ${err.message}`
  }

  // 4. JALANKAN ALAT (TOOLS)
  try {
    console.log(`[Electron AI] Executing tool: ${aiDecision?.tool || 'unknown'}`)

    // PERHATIKAN: 'switch' ini sekarang 'return' sebuah 'Promise<string>'
    // atau 'string' (untuk 'help' dan 'createCustomChart')
    switch (aiDecision.tool) {

      // --- ALAT ANALISIS (PANGGILAN AI KE-2) ---

      case 'getTopSellingProducts': {
        const data = (analysisData?.topSellingProducts || []).slice(0, 5)
        if (data.length === 0) {
          return 'Saat ini data produk terlaris belum tersedia.'
        }
        return await generateNaturalResponse(
          JSON.stringify(data),
          'User bertanya tentang 5 produk terlaris.',
          prompt
        )
      }

      case 'getTopCustomers': {
        const data = (analysisData?.topCustomers || []).slice(0, 5)
        if (data.length === 0) {
          return 'Saat ini data customer teratas belum tersedia.'
        }
        return await generateNaturalResponse(
          JSON.stringify(data),
          'User bertanya tentang 5 customer teratas berdasarkan volume.',
          prompt
        )
      }

      case 'getTopMarketing': {
        const data = (analysisData?.salesByMarketing || []).slice(0, 5)
        if (data.length === 0) {
          return 'Saat ini data performa marketing belum tersedia.'
        }
        return await generateNaturalResponse(
          JSON.stringify(data),
          'User bertanya tentang 5 performa marketing teratas.',
          prompt
        )
      }

      case 'getWoodDistribution': {
        const data = (analysisData?.woodTypeDistribution || []).slice(0, 5)
        if (data.length === 0) {
          return 'Saat ini data distribusi jenis kayu belum tersedia.'
        }
        return await generateNaturalResponse(
          JSON.stringify(data),
          'User bertanya tentang 5 distribusi jenis kayu teratas.',
          prompt
        )
      }

      case 'getTrendingProducts': {
        const data = (analysisData?.trendingProducts || []).slice(0, 5)
        if (data.length === 0) {
          return 'Saat ini tidak ada produk yang sedang tren naik signifikan.'
        }
        return await generateNaturalResponse(
          JSON.stringify(data),
          'User bertanya tentang produk yang sedang tren naik dan meminta rekomendasi stok.',
          prompt
        )
      }

      case 'getSlowMovingProducts': {
        const data = (analysisData?.slowMovingProducts || []).slice(0, 10) // Tampilkan 10
        if (data.length === 0) {
          return 'Kabar baik! Semua produk di master data sudah pernah terjual.'
        }
        return await generateNaturalResponse(
          JSON.stringify(data),
          'User bertanya tentang produk yang tidak laku (slow moving).',
          prompt
        )
      }

      // --- ALAT PO (PANGGILAN AI KE-2) ---

      case 'getTotalPO': {
        const totalPOs = allPOs.length
        const activePOsList = allPOs.filter(
          (po: any) => po.status !== 'Completed' && po.status !== 'Cancelled'
        )
        const activePOsCount = activePOsList.length
        const completedPOs = allPOs.filter((po: any) => po.status === 'Completed').length
        const openCount = activePOsList.filter((po: any) => po.status === 'Open').length
        const inProgressCount = activePOsList.filter(
          (po: any) => po.status === 'In Progress'
        ).length

        const data = {
          totalPOs,
          activePOsCount,
          completedPOs,
          openCount,
          inProgressCount
        }

        return await generateNaturalResponse(
          JSON.stringify(data),
          'User bertanya tentang jumlah total PO dan rincian statusnya.',
          prompt
        )
      }

      case 'getPOInfo': {
        const { poNumber, customerName, revisionNumber, intent } = aiDecision.param
        if (!poNumber && !customerName) {
          return 'Mohon sebutkan nomor PO atau nama customer yang ingin dicari.'
        }

        let matchingPOs: any[] = []
        if (poNumber) {
          const sanitizePOString = (str: string) => {
            if (!str) return ''
            return str
              .toLowerCase()
              .replace(/po-|po /g, '')
              .replace(/[ .]/g, '')
          }
          const sanitizedQuery = sanitizePOString(poNumber)
          matchingPOs = allPOs.filter(
            (p: any) => p.po_number && sanitizePOString(p.po_number).includes(sanitizedQuery)
          )
        } else if (customerName) {
          const customerLower = customerName.toLowerCase()
          const poMap = new Map()
          allPOs.forEach((po: any) => {
            if (po.project_name?.toLowerCase().includes(customerLower)) {
              const rev = Number(po.revision_number || 0)
              if (!poMap.has(po.id) || rev > poMap.get(po.id).revision_number) {
                poMap.set(po.id, po)
              }
            }
          })
          matchingPOs = Array.from(poMap.values())
        }

        if (matchingPOs.length === 0) {
          return `Maaf, PO yang cocok dengan '${poNumber || customerName}' tidak ditemukan.`
        }

        let foundPO: any = null
        let revNum = -1
        let feedback = ''

        if (revisionNumber !== undefined && revisionNumber !== null) {
          revNum = toNum(revisionNumber, -1)
          foundPO = matchingPOs.find((p: any) => toNum(p.revision_number, -1) === revNum)

          if (!foundPO) {
            foundPO = matchingPOs.sort(
              (a: any, b: any) => toNum(b.revision_number, -1) - toNum(a.revision_number, -1)
            )[0]
            revNum = toNum(foundPO.revision_number, -1)
            feedback = `(Catatan: Tidak menemukan Revisi ${revisionNumber}, jadi saya tampilkan revisi terbaru, Rev ${revNum})`
          }
        } else {
          foundPO = matchingPOs.sort(
            (a: any, b: any) => toNum(b.revision_number, -1) - toNum(a.revision_number, -1)
          )[0]
          revNum = toNum(foundPO.revision_number, -1)
        }

        if (!foundPO) {
          return `Maaf, PO ${poNumber || customerName} tidak ditemukan.`
        }

        // Format tanggal agar lebih ramah AI
        foundPO.created_at = formatDate(foundPO.created_at);
        foundPO.deadline = formatDate(foundPO.deadline);

        const data = { foundPO, intent, feedback }

        return await generateNaturalResponse(
          JSON.stringify(data),
          `User bertanya tentang PO ${poNumber || customerName} (Rev ${revNum}) dengan niat "${intent}". ${feedback}`,
          prompt
        )
      }

      case 'getPOsByItem': {
        const { productName, woodType } = aiDecision.param || {}
        if (!productName && !woodType) {
          return 'Mohon sebutkan nama produk atau jenis kayu yang ingin dicari.'
        }

        const queryLower = (productName || woodType).toLowerCase()
        const searchType = productName ? 'produk' : 'jenis kayu'
        const poMap = new Map()
        const activePOs = allPOs.filter((p: any) => p.status !== 'Cancelled')

        for (const po of activePOs) {
          if (!po.items || po.items.length === 0) continue

          let matchItem = null
          if (productName) {
            matchItem = po.items.find((item: any) =>
              item.product_name?.toLowerCase().includes(queryLower)
            )
          } else if (woodType) {
            matchItem = po.items.find((item: any) =>
              item.wood_type?.toLowerCase().includes(queryLower)
            )
          }

          if (matchItem) {
            if (!poMap.has(po.id)) {
              poMap.set(po.id, { po, matchItem })
            }
          }
        }

        const results = Array.from(poMap.values())

        if (results.length === 0) {
          return `Tidak ditemukan PO (aktif/selesai) yang menggunakan ${searchType} "${queryLower}".`
        }

        const data = results.slice(0, 10) // Batasi 10 hasil

        return await generateNaturalResponse(
          JSON.stringify({ results: data, totalFound: results.length, query: queryLower, searchType }),
          `User mencari PO berdasarkan ${searchType} "${queryLower}".`,
          prompt
        )
      }

      case 'getUrgentPOs': {
        const urgentPOs = allPOs.filter(
          (po: any) => po.priority === 'Urgent' && po.status !== 'Completed' && po.status !== 'Cancelled'
        )
        if (urgentPOs.length === 0) {
          return 'Saat ini tidak ada PO aktif dengan prioritas Urgent.'
        }
        return await generateNaturalResponse(
          JSON.stringify(urgentPOs),
          'User bertanya tentang PO yang statusnya "Urgent".',
          prompt
        )
      }

      case 'getNearingDeadline': {
        const todayDate = new Date()
        const nextWeek = new Date(todayDate.getTime() + 7 * 24 * 60 * 60 * 1000)
        const nearingPOs = allPOs
          .filter((po: any) => {
            if (!po.deadline || po.status === 'Completed' || po.status === 'Cancelled') return false
            try {
              const deadlineDate = new Date(po.deadline)
              return (
                !isNaN(deadlineDate.getTime()) &&
                deadlineDate >= todayDate &&
                deadlineDate <= nextWeek
              )
            } catch (e) {
              return false
            }
          })
          .sort(
            (a: any, b: any) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime()
          )

        if (nearingPOs.length === 0) {
          return 'Tidak ada PO aktif yang mendekati deadline dalam 7 hari ke depan.'
        }

        // Format tanggal
        const data = nearingPOs.map(po => ({ ...po, deadline: formatDate(po.deadline) }));

        return await generateNaturalResponse(
          JSON.stringify(data),
          'User bertanya tentang PO yang mendekati deadline (7 hari ke depan).',
          prompt
        )
      }

      case 'getNewestPOs': {
        const sortedPOs = [...allPOs].sort(
          (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        const newestPOs = sortedPOs.slice(0, 3)
        // Format tanggal
        const data = newestPOs.map(po => ({ ...po, created_at: formatDate(po.created_at) }));

        return await generateNaturalResponse(
          JSON.stringify(data),
          'User bertanya tentang 3 PO terbaru.',
          prompt
        )
      }

      case 'getOldestPO': {
        const sortedPOs = [...allPOs].sort(
          (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        const oldestPO = sortedPOs[0]
        if (!oldestPO) {
          return 'Tidak dapat menemukan data PO.'
        }
        // Format tanggal
        const data = { ...oldestPO, created_at: formatDate(oldestPO.created_at) };

        return await generateNaturalResponse(
          JSON.stringify(data),
          'User bertanya tentang PO terlama.',
          prompt
        )
      }

      case 'getPOsByDateRange': {
        if (!aiDecision.param || !aiDecision.param.startDate || !aiDecision.param.endDate) {
          return 'Maaf, saya tidak mengerti rentang tanggal yang Anda maksud. Coba sebutkan tanggalnya dengan lebih jelas (contoh: "po tanggal 1 nov 2025" atau "po dari 1-10 nov 2025").'
        }
        const { startDate, endDate } = aiDecision.param

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/
        if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
          return 'Maaf, format tanggal yang diterima AI tidak valid. Seharusnya YYYY-MM-DD.'
        }

        let start, end
        try {
          start = new Date(startDate).getTime()
          end = new Date(endDate)
          end.setHours(23, 59, 59, 999)
          end = end.getTime()
          if (isNaN(start) || isNaN(end)) throw new Error('Invalid date conversion')
        } catch (e) {
          return 'Maaf, terjadi kesalahan saat memproses rentang tanggal.'
        }

        const foundPOs = allPOs.filter((po: any) => {
          try {
            const poDate = new Date(po.created_at).getTime()
            return !isNaN(poDate) && poDate >= start && poDate <= end
          } catch (e) {
            return false
          }
        })

        const dateRangeStr =
          startDate === endDate
            ? formatDate(startDate)
            : `${formatDate(startDate)} s/d ${formatDate(endDate)}`

        if (foundPOs.length === 0) {
          return `Tidak ada PO ditemukan untuk ${dateRangeStr}.`
        }

        // Format tanggal & batasi data
        const data = foundPOs.slice(0, 10).map(po => ({ ...po, created_at: formatDate(po.created_at) }));

        return await generateNaturalResponse(
          JSON.stringify({ results: data, totalFound: foundPOs.length, dateRange: dateRangeStr }),
          `User mencari PO dari ${dateRangeStr}.`,
          prompt
        )
      }

      case 'getPOByStatusCount': {
        const requestedStatus = aiDecision.param
        if (
          !requestedStatus ||
          (requestedStatus.toLowerCase() !== 'open' &&
            requestedStatus.toLowerCase() !== 'in progress')
        ) {
          return 'Mohon sebutkan status (Open atau In Progress).'
        }
        const requestedStatusLower = requestedStatus.toLowerCase()
        const displayStatus = requestedStatusLower === 'open' ? 'Open' : 'In Progress'
        const count = allPOs.filter(
          (po: any) =>
            po.status?.toLowerCase() === requestedStatusLower &&
            po.status !== 'Completed' &&
            po.status !== 'Cancelled'
        ).length

        const data = { requestedStatus: displayStatus, count }

        return await generateNaturalResponse(
          JSON.stringify(data),
          `User bertanya berapa jumlah PO dengan status "${displayStatus}".`,
          prompt
        )
      }

      // --- ALAT STATIS (TIDAK PERLU PANGGILAN AI KE-2) ---

      case 'getApplicationHelp': {
        const topic = aiDecision.param?.topic?.toLowerCase() || ''
        if (topic.includes('buat po') || topic.includes('input po')) {
          return (
            "Untuk membuat PO baru:\n1. Klik tombol '+ Tambah PO Baru' di halaman 'Purchase Orders'.\n2. Isi detail PO seperti Nomor PO, Nama Customer, Tanggal Kirim.\n3. Tambahkan minimal satu item di tabel bawah (isi Produk, Ukuran, Qty, dll.).\n4. Klik 'Simpan PO Baru'."
          )
        } else if (topic.includes('update progress') || topic.includes('progress tracking')) {
          return (
            "Untuk update progress PO:\n1. Buka halaman 'Progress'.\n2. Cari PO yang ingin diupdate.\n3. Klik tombol 'Update Progress' pada kartu PO tersebut.\n4. Pilih item yang ingin diupdate.\n5. Pilih 'Tahap Berikutnya', tambahkan catatan (opsional), dan unggah foto (opsional).\n6. Klik tombol 'Simpan Progress ke [Nama Tahap]'."
          )
        } else if (topic.includes('revisi po')) {
          return (
            "Untuk merevisi PO yang sudah ada:\n1. Buka halaman 'Purchase Orders'.\n2. Cari PO yang ingin direvisi.\n3. Klik tombol 'Revisi' pada baris tabel PO tersebut.\n4. Form akan terisi data PO terakhir, ubah data header atau item sesuai kebutuhan.\n5. Jika ada foto referensi baru, unggah fotonya.\n6. Klik 'Simpan Revisi'. Anda akan diminta memasukkan nama perevisi."
          )
        } else if (topic.includes('tambah produk')) {
          return (
            "Untuk menambah produk baru ke daftar master:\n1. Saat berada di form Input/Revisi PO, klik tombol '+ Tambah Master Produk' di atas tabel item.\n2. Akan muncul jendela pop-up.\n3. Isi detail produk baru (Nama Produk wajib diisi).\n4. Klik 'Simpan Produk'. Produk baru akan tersedia di daftar dropdown."
          )
        } else {
          return (
            'Saya bisa membantu menjelaskan cara:\n' +
            '- Membuat PO baru\n' +
            '- Update progress (Progress Tracking)\n' +
            '- Revisi PO\n' +
            '- Menambah produk master.\n\n' +
            'Fitur mana yang ingin Anda ketahui?'
          )
        }
      }

      case 'help':
        return (
          'Anda bisa bertanya tentang:\n' +
          '- Jumlah total PO (detail status aktif)\n' +
          '- Produk terlaris / Customer terbesar / Marketing terbaik\n' +
          '- Produk tren naik / Produk tidak laku / Distribusi jenis kayu\n' +
          '- Status PO [nomor]\n' +
          '- Detail PO [nomor/nama customer]\n' +
          '- Cari PO berdasarkan produk atau jenis kayu\n' +
          '- PO Urgent/Deadline Dekat\n' +
          '- PO terbaru / terlama / PO per tanggal\n' +
          '- Jumlah PO Open / In Progress\n' +
          '- Cara pakai fitur (misal: "cara update progress")\n' +
          '- Buat grafik (misal: "grafik top customer" atau "grafik bandingkan flooring dan papan")'
        )

      case 'createCustomChart': {
        const param = aiDecision.param
        console.log('[Electron AI - Groq Call 1] createCustomChart param:', param)

        if (!param || !param.dataSource || !param.nameKey || !param.dataKey) {
          return 'Maaf, saya tidak mengerti data apa yang harus dibuatkan grafik. (Missing dataSource/nameKey/dataKey).'
        }

        const { dataSource, chartType, nameKey, dataKey, filters } = param
        const rawData = analysisData[dataSource]

        if (!rawData || !Array.isArray(rawData)) {
          return `Maaf, sumber data '${dataSource}' tidak ditemukan atau bukan array.`
        }

        let processedData: any[] = []
        let title = 'Grafik Kustom' // Ini hanya untuk log, tidak dikirim ke user

        if (filters && Array.isArray(filters) && filters.length > 0) {
          // 1. Mode Filter: Ambil hanya yang diminta user
          const filterSet = new Set(filters.map((f: string) => f.toLowerCase()))
          processedData = rawData.filter((item: any) =>
            filterSet.has(String(item[nameKey]).toLowerCase())
          )
          title = `Grafik Perbandingan ${dataKey} untuk ${filters.join(' vs ')}`
        } else {
          // 2. Mode Default: Ambil Top 5 (atau 10 untuk pie)
          const sliceCount = chartType === 'pie' ? 10 : 5
          processedData = rawData.slice(0, sliceCount)
          title = `Grafik Top ${sliceCount} ${dataSource} berdasarkan ${dataKey}`
        }

        if (processedData.length === 0) {
          return `Tidak ada data yang cocok ditemukan di '${dataSource}' untuk dibuatkan grafik.`
        }

        // Format data agar konsisten untuk komponen Recharts
        const chartData = processedData.map((item: any) => ({
          name: item[nameKey] || 'N/A', // Sumbu X / Label
          value: toNum(item[dataKey], 0) // Sumbu Y / Nilai
        }))

        const chartPayload = {
          type: chartType || 'bar',
          data: chartData,
          dataKey: 'value', // <-- Standarisasi key
          nameKey: 'name' // <-- Standarisasi key
        }

        console.log(`[Electron AI] ${title}`);

        // Panggil AI Call 2 untuk memberikan teks pengantar yang bervariasi
        return await generateNaturalResponse(
          `CHART_JSON::${JSON.stringify(chartPayload)}`, // Kita "sembunyikan" JSON di dalam data
          `User meminta untuk membuat '${chartType}' kustom. Judulnya adalah: ${title}.`,
          prompt
        )
      }

      // --- ALAT UMUM (PANGGILAN AI KE-2) ---

      case 'general': {
        return await generateNaturalResponse(
          JSON.stringify({ currentHour: new Date().getHours() }),
          'User hanya menyapa (misal: "halo", "terima kasih", "siapa kamu?").',
          prompt
        )
      }

      case 'unknown':
      default:
        console.warn('Menerima tool tidak dikenal dari AI:', aiDecision.tool)
        return await generateNaturalResponse(
          JSON.stringify({}),
          'Permintaan user tidak dapat dipahami atau tool tidak dikenal.',
          prompt
        )
    }

  } catch (execError: any) {
    console.error('Error saat menjalankan alat:', execError)
    return `Maaf, terjadi kesalahan saat memproses jawaban: ${execError.message}`
  }
}

// --- [AKHIR KODE FUNGSI sheet.js] ---

// --- [MULAI KODE ASLI main.ts] ---

if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disk-cache-dir', 'C:/temp/electron-cache')
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  testSheetConnection()

  // --- IPC Handlers ---
  ipcMain.handle('ping', () => 'pong')
  ipcMain.handle('po:list', async () => {
    const data = await listPOs()
    return JSON.parse(JSON.stringify(data))
  })
  ipcMain.handle('login-user', async (_event, loginData) => {
    return await handleLoginUser(loginData)
  })
  ipcMain.handle('po:save', async (_event, data) => saveNewPO(data))
  ipcMain.handle('po:delete', async (_event, poId) => deletePO(poId))
  ipcMain.handle('po:update', async (_event, data) => updatePO(data))
  ipcMain.handle('po:preview', async (_event, data) => previewPO(data))
  ipcMain.handle('po:listItems', async (_event, poId) => listPOItems(poId))
  ipcMain.handle('po:listRevisions', async (_event, poId) => listPORevisions(poId))
  ipcMain.handle('po:listItemsByRevision', async (_event, poId, revisionNumber) =>
    listPOItemsByRevision(poId, revisionNumber)
  )
  ipcMain.handle('po:getRevisionHistory', async (_event, poId) => getRevisionHistory(poId))
  ipcMain.handle('product:get', () => getProducts())
  ipcMain.handle('app:open-external-link', (_event, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url)
      return { success: true }
    }
    return { success: false, error: 'Invalid URL' }
  })

  ipcMain.handle('app:open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('progress:getActivePOsWithProgress', () => getActivePOsWithProgress())
  ipcMain.handle('progress:getPOItemsWithDetails', (_event, poId) => getPOItemsWithDetails(poId))
  ipcMain.handle('progress:updateItem', (_event, data) => updateItemProgress(data))
  ipcMain.handle('progress:getRecentProgressUpdates', () => getRecentProgressUpdates())
  ipcMain.handle('progress:getAttentionData', () => getAttentionData())
  ipcMain.handle('analysis:getProductSales', () => getProductSalesAnalysis())
  ipcMain.handle('analysis:getSalesItemData', () => getSalesItemData())
  ipcMain.handle('app:read-file-base64', async (_event, filePath) => {
    try {
      const buffer = await fs.promises.readFile(filePath)
      return buffer.toString('base64')
    } catch (error: any) {
      console.error('Failed to read file as base64:', error)
      return null
    }
  })

  ipcMain.handle('product:add', (_event, productData) => addNewProduct(productData))
  ipcMain.handle('progress:updateDeadline', (_event, data) => updateStageDeadline(data))

  ipcMain.handle('ai:ollamaChat', async (_event, prompt) => {
    return await handleGroqChat(prompt)
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})