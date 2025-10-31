import { GoogleSpreadsheet } from 'google-spreadsheet'
import { JWT } from 'google-auth-library'
import path from 'node:path'
import fs from 'node:fs'
import { app, dialog } from 'electron'
import { google } from 'googleapis'
import { generatePOJpeg } from './jpegGenerator.js'
import stream from 'node:stream'
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config()

const SPREADSHEET_ID = '1Bp5rETvaAe9nT4DrNpm-WsQqQlPNaau4gIzw1nA5Khk'
const PO_ARCHIVE_FOLDER_ID = '1-1Gw1ay4iQoFNFe2KcKDgCwOIi353QEC'
const PROGRESS_PHOTOS_FOLDER_ID = '1UfUQoqNBSsth9KzGRUmjenwegmsA6hbK'
const USER_SPREADSHEET_ID = '1nNk-49aah-dWuEoVwMiU40BXek3slHyvzIgIXOAgE6Q'

const PRODUCTION_STAGES = [
  'Cari Bahan Baku',
  'Sawmill',
  'KD',
  'Pembahanan',
  'Moulding',
  'Coating',
  'Siap Kirim'
]

const formatDate = (dateString) => {
  if (!dateString) return '-'
  try {
    // Format YYYY-MM-DD dari ISO string
    const isoDate = new Date(dateString).toISOString().split('T')[0]
    const [year, month, day] = isoDate.split('-')
    return `${day}/${month}/${year}` // Format DD/MM/YYYY
  } catch (e) {
    return '-'
  }
}

const DEFAULT_STAGE_DURATIONS = {
  Pembahanan: 7, // 1 minggu
  Moulding: 7, // 1 minggu
  KD: 14, // 2 minggu
  Coating: 14, // 2 minggu
  // Tahap lain bisa diberi default 0 jika tidak ada durasi spesifik
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

    console.error(content) // Tetap log di terminal
    dialog.showErrorBox(title, content) // <-- INI AKAN MEMUNCULKAN POPUP ERROR

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
  const doc = new GoogleSpreadsheet(USER_SPREADSHEET_ID, auth) // <- Ini pakai ID user
  await doc.loadInfo()
  return doc
}

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

const ALIASES = {
  purchase_orders: ['purchase_orders', 'purchase_order'],
  purchase_order_items: ['purchase_order_items', 'po_items'],
  product_master: ['product_master', 'products'],
  progress_tracking: ['purchase_order_items_progress', 'progress'],
  users: ['users_credentials', 'users']
}

async function getSheet(doc, key) {
  const titles = ALIASES[key] || [key]
  for (const t of titles) {
    if (doc.sheetsByTitle[t]) return doc.sheetsByTitle[t]
  }
  throw new Error(
    n`Sheet "${titles[0]}" tidak ditemukan. Pastikan nama sheet di Google Sheets sudah benar.`
  )
}

function toNum(v, def = 0) {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : def
}

async function getNextIdFromSheet(sheet) {
  await sheet.loadHeaderRow()
  const rows = await sheet.getRows()
  if (rows.length === 0) return '1'
  let maxId = 0
  rows.forEach((r) => {
    const val = toNum(r.get('id'), NaN)
    if (!Number.isNaN(val)) maxId = Math.max(maxId, val)
  })
  return String(maxId + 1)
}

function scrubItemPayload(item) {
  const { id, purchase_order_id, revision_id, revision_number, ...rest } = item || {}
  return rest
}

async function latestRevisionNumberForPO(poId, doc) {
  const sh = await getSheet(doc, 'purchase_orders')
  const rows = await sh.getRows()
  const nums = rows
    .filter((r) => String(r.get('id')).trim() === String(poId).trim())
    .map((r) => toNum(r.get('revision_number'), -1))
  return nums.length ? Math.max(...nums) : -1
}

async function getHeaderForRevision(poId, rev, doc) {
  const sh = await getSheet(doc, 'purchase_orders')
  const rows = await sh.getRows()
  return (
    rows.find(
      (r) =>
        String(r.get('id')).trim() === String(poId).trim() &&
        toNum(r.get('revision_number'), -1) === toNum(rev, -1)
    ) || null
  )
}

async function getItemsByRevision(poId, rev, doc) {
  const sh = await getSheet(doc, 'purchase_order_items')
  const rows = await sh.getRows()
  return rows
    .filter(
      (r) =>
        String(r.get('purchase_order_id')).trim() === String(poId).trim() &&
        toNum(r.get('revision_number'), -1) === toNum(rev, -1)
    )
    .map((r) => r.toObject())
}

async function getLivePOItems(poId, doc) {
  const latest = await latestRevisionNumberForPO(poId, doc)
  if (latest < 0) return []
  return getItemsByRevision(poId, latest, doc)
}

export async function handleLoginUser(loginData) {
  console.log('🏁 [Electron] handleLoginUser started!')
  const { username, password } = loginData

  // Validasi input dasar
  if (!username || !password) {
    console.warn('⚠️ [Electron Login] Missing username or password.')
    // Ganti res.json -> return object
    return { success: false, error: 'Username dan password harus diisi.' }
  }

  try {
    const doc = await openUserDoc() // Ini akan memanggil openDoc() milik Electron
    const userSheet = await getSheet(doc, 'users') // Ini memanggil alias 'users' yang baru
    console.log(`✅ [Electron Login] Accessed sheet: ${userSheet.title}`)

    // Muat header
    await userSheet.loadHeaderRow()
    const headers = userSheet.headerValues
    console.log('✅ [Electron Login] Sheet headers:', headers)

    // --- SESUAIKAN NAMA KOLOM DI SINI (sudah sama) ---
    const usernameHeader = 'login_username'
    const passwordHeader = 'login_pwd'
    const nameHeader = 'name'
    const roleHeader = 'role'
    // --- AKHIR PENYESUAIAN NAMA KOLOM ---

    if (!headers.includes(usernameHeader) || !headers.includes(passwordHeader)) {
      console.error(
        `❌ [Electron Login] Missing required columns (${usernameHeader} or ${passwordHeader}) in sheet "${userSheet.title}"`
      )
      // Ganti res.json -> return object
      return { success: false, error: 'Kesalahan konfigurasi sheet.' }
    }

    // Ambil semua baris data user
    const rows = await userSheet.getRows()
    console.log(`ℹ️ [Electron Login] Found ${rows.length} user rows.`)

    // Cari user
    const trimmedUsernameLower = username.trim().toLowerCase()
    const userRow = rows.find(
      (row) => row.get(usernameHeader)?.trim().toLowerCase() === trimmedUsernameLower
    )

    if (userRow) {
      const foundUsername = userRow.get(usernameHeader)
      console.log(`👤 [Electron Login] User found: ${foundUsername}`)

      const storedPassword = userRow.get(passwordHeader)

      if (storedPassword === password) {
        console.log(`✅ [Electron Login] Password match for user: ${foundUsername}`)
        // Login berhasil
        const userName =
          headers.includes(nameHeader) && userRow.get(nameHeader)
            ? userRow.get(nameHeader)
            : foundUsername
        const userRole = headers.includes(roleHeader) ? userRow.get(roleHeader) : undefined

        // Ganti res.json -> return object
        return { success: true, name: userName, role: userRole }
      } else {
        console.warn(`🔑 [Electron Login] Password mismatch for user: ${foundUsername}`)
        // Ganti res.json -> return object
        return { success: false, error: 'Username atau password salah.' }
      }
    } else {
      console.warn(`❓ [Electron Login] User not found: ${username}`)
      // Ganti res.json -> return object
      return { success: false, error: 'Username atau password salah.' }
    }
  } catch (err) {
    console.error('💥 [Electron Login] ERROR:', err.message, err.stack)
    // Ganti res.json -> return object
    return {
      success: false,
      error: 'Terjadi kesalahan pada server saat login.',
      details: err.message
    }
  }
}

async function generateAndUploadPO(poData, revisionNumber) {
  let auth
  let filePath

  try {
    // 1. Generate JPEG
    // @ts-ignore
    const pdfResult = await generatePOJpeg(poData, revisionNumber, false)
    if (!pdfResult.success || !pdfResult.path) {
      throw new Error('Gagal membuat file JPEG lokal atau path tidak ditemukan.')
    }
    filePath = pdfResult.path

    if (!fs.existsSync(filePath)) {
      throw new Error(`File JPEG tidak ditemukan di path: ${filePath}`)
    }

    // 2. Dapatkan objek auth dan authorize
    console.log('🔄 Mendapatkan otentikasi baru sebelum upload/get...')
    auth = getAuth() // Panggil fungsi getAuth Anda
    await auth.authorize()
    console.log('✅ Otorisasi ulang berhasil.')

    const fileName = path.basename(filePath)
    const mimeType = 'image/jpeg'

    console.log(`🚀 Mengunggah file via auth.request: ${fileName} ke Drive...`)

    // --- Upload via auth.request (Sama seperti sebelumnya) ---
    const fileStream = fs.createReadStream(filePath)
    const metadata = {
      name: fileName,
      mimeType: mimeType,
      parents: [PO_ARCHIVE_FOLDER_ID]
    }
    const boundary = `----UbinkayuERPBoundary${Date.now()}----`
    const readable = new stream.PassThrough()
    // ... (Kode untuk menulis metadata dan pipe fileStream ke readable - sama seperti sebelumnya)
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

    // --- Ambil webViewLink via auth.request ---
    const fileId = createResponse?.data?.id
    if (!fileId) {
      console.error('❌ Upload berhasil, tetapi ID file tidak ditemukan:', createResponse.data)
      throw new Error('Upload berhasil tetapi ID file tidak didapatkan.')
    }
    console.log(
      `✅ File berhasil diunggah (ID: ${fileId}). Mengambil webViewLink via auth.request...`
    )

    // Panggil files.get endpoint menggunakan auth.request
    const getResponse = await auth.request({
      url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
      method: 'GET',
      params: {
        fields: 'webViewLink,size', // Minta hanya webViewLink
        supportsAllDrives: true // Tetap perlu untuk Shared Drive
      }
    })

    const webViewLink = getResponse?.data?.webViewLink
    const fileSize = getResponse?.data?.size
    if (!webViewLink) {
      console.error('❌ Gagal mendapatkan webViewLink via auth.request:', getResponse.data)
      throw new Error('Gagal mendapatkan link file setelah upload berhasil.')
    }
    console.log(`✅ Link file dan size didapatkan via auth.request: ${webViewLink}`)

    return { success: true, link: webViewLink, size: fileSize }
  } catch (error) {
    // ... (Error handling sama seperti sebelumnya)
    console.error('❌ Proses Generate & Upload PO Gagal:', error.message)
    // @ts-ignore
    if (error.response && error.response.data && error.response.data.error) {
      // @ts-ignore
      console.error(
        '   -> Detail Error Google API:',
        JSON.stringify(error.response.data.error, null, 2)
      )
      // @ts-ignore
    } else if (error.response) {
      // @ts-ignore
      console.error(`   -> Status Error HTTP: ${error.response.status}`)
      // @ts-ignore
      console.error('   -> Data Error:', error.response.data)
    }
    // @ts-ignore
    return { success: false, error: error.message }
  } finally {
    // Hapus file lokal
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
        console.log(`🗑️ File lokal ${path.basename(filePath)} dihapus.`)
      } catch (unlinkErr) {
        console.warn(`⚠️ Gagal menghapus file lokal ${path.basename(filePath)}:`, unlinkErr.message)
      }
    }
  }
}

/**
 * Extract Google Drive file ID from various Drive URL formats
 * @param {string} driveUrl - Google Drive URL
 * @returns {string|null} - File ID or null if not found
 */
function extractGoogleDriveFileId(driveUrl) {
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

/**
 * Process items in batches to prevent API rate limiting
 * @param {Array} items - Items to process
 * @param {Function} processor - Function to process each item
 * @param {number} batchSize - Number of items to process simultaneously
 * @returns {Promise<Array>} - Array of results
 */
async function processBatch(items, processor, batchSize = 5) {
  const results = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(batch.map(processor))
    results.push(
      ...batchResults.map((result) =>
        result.status === 'fulfilled'
          ? result.value
          : { success: false, error: result.reason?.message || 'Unknown error' }
      )
    )

    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  return results
}

/**
 * Delete a file from Google Drive
 * @param {string} fileId - Google Drive file ID
 * @returns {Promise<{success: boolean, error?: string, fileId: string}>}
 */
async function deleteGoogleDriveFile(fileId) {
  try {
    if (!fileId) {
      return { success: false, error: 'File ID tidak valid', fileId }
    }

    const auth = getAuth()
    const drive = google.drive({ version: 'v3', auth })

    await drive.files.delete({
      fileId: fileId,
      supportsAllDrives: true
    })

    console.log(`✅ File berhasil dihapus dari Google Drive: ${fileId}`)
    return { success: true, fileId }
  } catch (error) {
    console.error(`❌ Gagal menghapus file dari Google Drive (${fileId}):`, error.message)
    return { success: false, error: error.message, fileId }
  }
}

async function uploadProgressPhoto(photoPath, poNumber, itemId) {
  try {
    if (!fs.existsSync(photoPath)) throw new Error(`File foto tidak ditemukan: ${photoPath}`)
    const auth = getAuth()
    const drive = google.drive({ version: 'v3', auth })
    const timestamp = new Date().toISOString().replace(/:/g, '-')
    const fileName = `PO-${poNumber}_ITEM-${itemId}_${timestamp}.jpg`
    const response = await drive.files.create({
      requestBody: { name: fileName, mimeType: 'image/jpeg', parents: [PROGRESS_PHOTOS_FOLDER_ID] },
      media: { mimeType: 'image/jpeg', body: fs.createReadStream(photoPath) },
      fields: 'id, webViewLink',
      supportsAllDrives: true
    })
    return { success: true, link: response.data.webViewLink }
  } catch (error) {
    console.error('❌ Gagal unggah foto progress:', error)
    return { success: false, error: error.message }
  }
}

export async function testSheetConnection() {
  try {
    const doc = await openDoc()
    console.log(`✅ Tes koneksi OK: "${doc.title}"`)
  } catch (err) {
    console.error('❌ Gagal tes koneksi ke Google Sheets:', err.message)
  }
}

export async function listPOs() {
  try {
    const doc = await openDoc()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const itemSheet = await getSheet(doc, 'purchase_order_items')
    const progressSheet = await getSheet(doc, 'progress_tracking')

    // Ambil data mentah (rows)
    const rawPoRows = await poSheet.getRows()
    const rawItemRows = await itemSheet.getRows()
    const rawProgressRows = await progressSheet.getRows()

    // Lakukan pembersihan objek di sini untuk menghindari error cloning
    const poRows = rawPoRows.map((r) => r.toObject())
    const itemRows = rawItemRows.map((r) => r.toObject())
    const progressRows = rawProgressRows.map((r) => r.toObject())

    // 1. Ambil Revisi Header Terbaru (dari data yang sudah bersih)
    const byId = new Map()
    for (const r of poRows) {
      const id = String(r.id).trim()
      const rev = toNum(r.revision_number, -1)
      const keep = byId.get(id)
      if (!keep || rev > keep.rev) byId.set(id, { rev, row: r })
    }
    const latestPoObjects = Array.from(byId.values()).map(({ row }) => row)

    // 2. Siapkan Helper Maps
    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      const key = `${row.purchase_order_id}-${row.purchase_order_item_id}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ stage: row.stage, created_at: row.created_at })
      return acc
    }, {})

    const latestItemRevisions = itemRows.reduce((acc, item) => {
      const poId = item.purchase_order_id
      const rev = toNum(item.revision_number, -1)
      if (!acc.has(poId) || rev > acc.get(poId)) {
        acc.set(poId, rev)
      }
      return acc
    }, new Map())

    // 3. Gabungkan dan Hitung Status/Progress
    const result = latestPoObjects.map((poObject) => {
      const poId = poObject.id
      // [PERBAIKAN] Gunakan poObject dan akses properti langsung
      const lastRevisedBy = poObject.revised_by || 'N/A'
      const lastRevisedDate = poObject.created_at // Ambil timestamp dari revisi terakhir (baris ini)

      const latestRev = latestItemRevisions.get(poId) ?? -1
      const poItems = itemRows.filter(
        (item) => item.purchase_order_id === poId && toNum(item.revision_number, -1) === latestRev
      )

      let poProgress = 0
      let finalStatus = poObject.status || 'Open' // Status default dari sheet/Open
      let completed_at = null

      // Hitung Progress
      if (poItems.length > 0) {
        let totalPercentage = 0
        poItems.forEach((item) => {
          const itemId = item.id
          const compositeKey = `${poId}-${itemId}`
          const itemProgressHistory = progressByCompositeKey[compositeKey] || []
          let latestStageIndex = -1

          if (itemProgressHistory.length > 0) {
            const latestProgress = itemProgressHistory.sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )[0]
            // Gunakan PRODUCTION_STAGES yang terimpor
            latestStageIndex = PRODUCTION_STAGES.indexOf(latestProgress.stage)
          }

          const itemPercentage =
            latestStageIndex >= 0 ? ((latestStageIndex + 1) / PRODUCTION_STAGES.length) * 100 : 0
          totalPercentage += itemPercentage
        })
        poProgress = totalPercentage / poItems.length
      }

      // Tentukan Status (Menggantikan status lama dengan status yang dihitung)
      const roundedProgress = Math.round(poProgress)

      if (finalStatus !== 'Cancelled') {
        if (roundedProgress >= 100) {
          finalStatus = 'Completed'

          // Cari tanggal update progress terakhir untuk PO ini
          const allProgressForPO = progressRows
            .filter((row) => row.purchase_order_id === poId)
            .map((row) => new Date(row.created_at).getTime())

          if (allProgressForPO.length > 0) {
            completed_at = new Date(Math.max(...allProgressForPO)).toISOString()
          }
        } else if (roundedProgress > 0) {
          finalStatus = 'In Progress'
        } else {
          finalStatus = 'Open'
        }
      }

      // KUNCI: Kembalikan objek JavaScript murni dan lengkap (Deep Clone)
      return {
        ...poObject,
        items: poItems,
        progress: roundedProgress,
        status: finalStatus,
        completed_at: completed_at,
        pdf_link: poObject.pdf_link || null,
        lastRevisedBy: lastRevisedBy,
        lastRevisedDate: lastRevisedDate,
        acc_marketing: poObject.acc_marketing || '', // Pastikan field ini ada
        file_size_bytes: poObject.file_size_bytes || 0 // [TAMBAHKAN INI]
      }
    })

    return result
  } catch (err) {
    console.error('❌ listPOs error:', err.message)
    return []
  }
}

export async function saveNewPO(data) {
  console.log('TITIK B (Backend): Menerima data:', data)
  try {
    const doc = await openDoc()
    const now = new Date().toISOString()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const itemSheet = await getSheet(doc, 'purchase_order_items')

    const poId = await getNextIdFromSheet(poSheet)
    let totalFileSize = 0 // Variabel untuk menjumlahkan ukuran file

    const newPoRow = await poSheet.addRow({
      id: poId,
      revision_number: 0,
      po_number: data.nomorPo,
      project_name: data.namaCustomer,
      deadline: data.tanggalKirim || '',
      status: 'Open',
      priority: data.prioritas || '',
      notes: data.catatan || '',
      kubikasi_total: data.kubikasi_total || 0,
      acc_marketing: data.marketing || '',
      created_at: now,
      pdf_link: 'generating...',
      foto_link: '...', // Placeholder
      file_size_bytes: 0 // Placeholder
    })

    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw) => {
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

    // 1. Upload Foto Referensi (jika ada)
    if (data.poPhotoPath) {
      console.log('Mengunggah foto referensi PO...')
      const photoResult = await uploadPoPhoto(data.poPhotoPath, data.nomorPo, data.namaCustomer)
      if (photoResult.success) {
        newPoRow.set('foto_link', photoResult.link)
        totalFileSize += Number(photoResult.size || 0) // Tambah ukuran foto
      } else {
        newPoRow.set('foto_link', `ERROR: ${photoResult.error}`)
      }
    } else {
      newPoRow.set('foto_link', 'Tidak ada foto')
    }

    // 2. Siapkan data dan buat JPEG
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
      marketing: data.marketing || 'Unknown' // [PERBAIKAN] Gunakan data.marketing
    }

    const uploadResult = await generateAndUploadPO(poDataForJpeg, 0)

    if (uploadResult.success) {
      newPoRow.set('pdf_link', uploadResult.link)
      totalFileSize += Number(uploadResult.size || 0) // Tambah ukuran JPEG
    } else {
      newPoRow.set('pdf_link', `ERROR: ${uploadResult.error}`)
    }

    // 3. Simpan total ukuran file dan simpan baris
    newPoRow.set('file_size_bytes', totalFileSize)
    await newPoRow.save()
    return { success: true, poId, revision_number: 0 }
  } catch (err) {
    console.error('❌ saveNewPO error:', err.message)
    return { success: false, error: err.message }
  }
}

// [GANTI SELURUH FUNGSI UPDATEPO ANDA DENGAN INI]
export async function updatePO(data) {
  console.log('TITIK B (Backend): Menerima data revisi:', data)
  try {
    const doc = await openDoc()
    const now = new Date().toISOString()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const itemSheet = await getSheet(doc, 'purchase_order_items')

    const latest = await latestRevisionNumberForPO(String(data.poId), doc)
    const prevRow = latest >= 0 ? await getHeaderForRevision(String(data.poId), latest, doc) : null
    const prev = prevRow ? prevRow.toObject() : {}
    const newRev = latest >= 0 ? latest + 1 : 0

    let totalFileSize = 0 // Variabel untuk menjumlahkan ukuran file
    let fotoLink = prev.foto_link || 'Tidak ada foto' // Warisi link foto lama
    let fotoSize = 0

    // 1. Buat baris revisi baru di sheet
    const newRevisionRow = await poSheet.addRow({
      id: String(data.poId),
      revision_number: newRev,
      po_number: data.nomorPo ?? prev.po_number ?? '',
      project_name: data.namaCustomer ?? prev.project_name ?? '',
      deadline: data.tanggalKirim ?? prev.deadline ?? '',
      status: data.status ?? prev.status ?? 'Open',
      priority: data.prioritas ?? prev.priority ?? '',
      notes: data.catatan ?? prev.notes ?? '',
      kubikasi_total: data.kubikasi_total ?? prev.kubikasi_total ?? 0,
      acc_marketing: data.marketing ?? prev.acc_marketing ?? '',
      created_at: now,
      pdf_link: 'generating...',
      foto_link: '...', // Placeholder
      file_size_bytes: 0, // Placeholder
      revised_by: data.revisedBy || 'Unknown'
    })

    // 2. Tambahkan item-item baru ke sheet
    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw) => {
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

    // 3. Logika Upload Foto Referensi (jika ada foto baru)
    if (data.poPhotoPath) {
      console.log(`[updatePO] 📸 Terdeteksi foto referensi baru, mengunggah...`)
      const photoResult = await uploadPoPhoto(data.poPhotoPath, data.nomorPo, data.namaCustomer)
      if (photoResult.success) {
        fotoLink = photoResult.link // Gunakan link foto baru
        fotoSize = Number(photoResult.size || 0) // Simpan ukuran foto baru
      } else {
        fotoLink = `ERROR: ${photoResult.error}`
      }
    } else {
      console.log(`[updatePO] 🖼️ Tidak ada foto referensi baru, mewariskan link lama: ${fotoLink}`)
      // Jika tidak ada foto baru, kita harus mewarisi ukuran file lama.
      // Kita asumsikan ukuran file lama adalah total (foto + jpeg).
      // Ini akan diperbaiki oleh ukuran JPEG baru di bawah.
      // Untuk akurasi terbaik, Anda Seharusnya memisahkan foto_size dan jpeg_size.
      // Tapi untuk sekarang, kita akan wariskan ukuran total lama JIKA JPEG GAGAL.
      totalFileSize = Number(prev.file_size_bytes || 0) // Warisi ukuran lama sementara
    }

    // 4. Siapkan data untuk generator JPEG
    const poDataForJpeg = {
      po_number: data.nomorPo ?? prev.po_number,
      project_name: data.namaCustomer ?? prev.project_name,
      deadline: data.tanggalKirim ?? prev.deadline,
      priority: data.prioritas ?? prev.priority,
      items: itemsWithIds,
      notes: data.catatan ?? prev.notes,
      created_at: now,
      kubikasi_total: data.kubikasi_total ?? prev.kubikasi_total ?? 0,

      poPhotoPath: data.poPhotoPath, // Path file BARU (jika ada)
      foto_link: fotoLink, // Link foto (BARU atau LAMA)

      marketing: data.marketing ?? prev.acc_marketing
    }

    // 5. Buat dan upload JPEG baru (karena item/header mungkin berubah)
    const uploadResult = await generateAndUploadPO(poDataForJpeg, newRev)

    let jpegSize = 0
    if (uploadResult.success) {
      newRevisionRow.set('pdf_link', uploadResult.link)
      jpegSize = Number(uploadResult.size || 0)
    } else {
      newRevisionRow.set('pdf_link', `ERROR: ${uploadResult.error}`)
      // Jika JPEG gagal, setidaknya wariskan link JPEG lama
      newRevisionRow.set('pdf_link', prev.pdf_link || `ERROR: ${uploadResult.error}`)
    }

    // 6. Finalisasi Logika Ukuran File
    if (data.poPhotoPath) {
      // Jika ada FOTO BARU, total ukuran = ukuran foto baru + ukuran JPEG baru
      totalFileSize = fotoSize + jpegSize
    } else {
      // Jika FOTO LAMA, kita tidak tahu ukurannya.
      // Solusi terbaik adalah mewarisi ukuran lama JIKA generate JPEG GAGAL
      if (!uploadResult.success) {
        totalFileSize = Number(prev.file_size_bytes || 0)
      } else {
        // Jika FOTO LAMA tapi JPEG BARU dibuat, kita tidak bisa menjumlahkannya.
        // Ini adalah kelemahan desain sheet (tidak memisah ukuran foto & JPEG).
        // KOMPROMI: Kita simpan ukuran JPEG baru + asumsi ukuran foto lama (jika ada)
        // Solusi paling aman: warisi ukuran total lama jika tidak ada foto baru
        totalFileSize = Number(prev.file_size_bytes || 0)
        // TAPI ini tidak akan update jika ukuran JPEG berubah.

        // Mari kita ambil keputusan desain:
        // `file_size_bytes` akan selalu dihitung ulang.
        // Jika foto lama, kita tidak bisa menghitungnya. Jadi kita anggap 0.
        // Ini akan membuat Dashboard tidak akurat untuk PO lama.

        // Logika terbaik yang bisa kita lakukan:
        // Ukuran total = (ukuran foto baru ATAU 0) + (ukuran JPEG baru ATAU 0)
        // Jika kedua-duanya gagal/tidak ada, baru warisi yang lama.
        totalFileSize = fotoSize + jpegSize
        if (totalFileSize === 0 && !data.poPhotoPath) {
          totalFileSize = Number(prev.file_size_bytes || 0)
        }
      }
    }

    newRevisionRow.set('foto_link', fotoLink)
    newRevisionRow.set('file_size_bytes', totalFileSize)
    await newRevisionRow.save() // Simpan semua perubahan

    return { success: true, revision_number: newRev }
  } catch (err) {
    console.error('❌ updatePO error:', err.message)
    return { success: false, error: err.message }
  }
}

export async function deletePO(poId) {
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

    const toDelHdr = poRows.filter((r) => String(r.get('id')).trim() === String(poId).trim())
    const toDelItems = itemRows.filter(
      (r) => String(r.get('purchase_order_id')).trim() === String(poId).trim()
    )
    const poProgressRows = progressRows.filter(
      (r) => String(r.get('purchase_order_id')).trim() === String(poId).trim()
    )

    const fileIds = new Set()

    toDelHdr.forEach((poRow) => {
      const pdfLink = poRow.get('pdf_link')
      if (pdfLink && !pdfLink.startsWith('ERROR:') && !pdfLink.includes('generating')) {
        const fileId = extractGoogleDriveFileId(pdfLink)
        if (fileId) fileIds.add(fileId)
      }
    })

    poProgressRows.forEach((progressRow) => {
      const photoUrl = progressRow.get('photo_url')
      if (photoUrl) {
        const fileId = extractGoogleDriveFileId(photoUrl)
        if (fileId) fileIds.add(fileId)
      }
    })

    const uniqueFileIds = Array.from(fileIds)

    let deletedFilesCount = 0
    let failedFilesCount = 0
    let failedFiles = []

    if (uniqueFileIds.length > 0) {
      console.log(`🗂️ Menghapus ${uniqueFileIds.length} file dari Google Drive dalam batch...`)

      const deleteResults = await processBatch(uniqueFileIds, deleteGoogleDriveFile, 5)

      deleteResults.forEach((result) => {
        if (result.success) {
          deletedFilesCount++
        } else {
          failedFilesCount++
          failedFiles.push({ fileId: result.fileId, error: result.error })
          console.warn(`⚠️ Gagal menghapus file ${result.fileId}: ${result.error}`)
        }
      })
    }

    console.log(`📄 Menghapus data dari spreadsheet...`)

    const sheetDeletions = []

    poProgressRows.reverse().forEach((row) => {
      sheetDeletions.push(row.delete())
    })

    toDelHdr.reverse().forEach((row) => {
      sheetDeletions.push(row.delete())
    })

    toDelItems.reverse().forEach((row) => {
      sheetDeletions.push(row.delete())
    })

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
  } catch (err) {
    const endTime = Date.now()
    const duration = ((endTime - startTime) / 1000).toFixed(1)
    console.error(`❌ Gagal menghapus PO ID ${poId} setelah ${duration}s:`, err.message)
    return { success: false, error: err.message, duration: `${duration}s` }
  }
}

export async function listPOItems(poId) {
  try {
    const doc = await openDoc()
    return await getLivePOItems(String(poId), doc)
  } catch (err) {
    console.error('❌ listPOItems error:', err.message)
    return []
  }
}

export async function listPORevisions(poId) {
  try {
    const doc = await openDoc()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const rows = await poSheet.getRows()
    return rows
      .filter((r) => String(r.get('id')).trim() === String(poId).trim())
      .map((r) => r.toObject())
      .sort((a, b) => a.revision_number - b.revision_number)
  } catch (err) {
    console.error('❌ listPORevisions error:', err.message)
    return []
  }
}

export async function listPOItemsByRevision(poId, revisionNumber) {
  try {
    const doc = await openDoc()
    return await getItemsByRevision(String(poId), toNum(revisionNumber, 0), doc)
  } catch (err) {
    console.error('❌ listPOItemsByRevision error:', err.message)
    return []
  }
}

export async function getProducts() {
  try {
    const doc = await openDoc()
    const sheet = await getSheet(doc, 'product_master')
    const rows = await sheet.getRows()
    return rows.map((r) => r.toObject())
  } catch (err) {
    console.error('❌ getProducts error:', err.message)
    return []
  }
}

export async function previewPO(data) {
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
      poPhotoPath: data.poPhotoPath
    }
    return await generatePOJpeg(poData, 'preview', true)
  } catch (err) {
    console.error('❌ previewPO error:', err.message)
    return { success: false, error: err.message }
  }
}

export async function getRevisionHistory(poId) {
  try {
    const doc = await openDoc()
    const metas = await listPORevisions(String(poId))
    const itemSheet = await getSheet(doc, 'purchase_order_items')
    const allItemRows = await itemSheet.getRows()

    const history = metas.map((m) => ({
      revision: m,
      items: allItemRows
        .filter(
          (r) =>
            String(r.get('purchase_order_id')) === String(poId) &&
            toNum(r.get('revision_number'), -1) === toNum(m.revision_number, -1)
        )
        .map((r) => r.toObject())
    }))
    history.sort((a, b) => b.revision.revision_number - a.revision.revision_number)
    return history
  } catch (err) {
    console.error('❌ getRevisionHistory error:', err.message)
    return []
  }
}

export async function updateItemProgress(data) {
  let auth // Deklarasikan auth di luar try
  let photoLink = null // Default link foto null
  let filePath = null // Path foto lokal
  const { poId, itemId, poNumber, stage, notes, photoPath } = data // Ambil photoPath dari data

  try {
    // --- Bagian Upload Foto (jika ada) ---
    if (photoPath) {
      filePath = photoPath // Simpan path untuk unlink
      if (!fs.existsSync(filePath)) {
        throw new Error(`File foto tidak ditemukan: ${filePath}`)
      }

      // 1. Dapatkan auth dan authorize
      console.log('🔄 Mendapatkan otentikasi baru sebelum upload foto progress...')
      auth = getAuth() // Panggil fungsi getAuth Anda
      await auth.authorize()
      console.log('✅ Otorisasi ulang berhasil.')

      const fileName = `PO-${poNumber}_ITEM-${itemId}_${new Date().toISOString().replace(/:/g, '-')}.jpg`
      const mimeType = 'image/jpeg' // Asumsi foto selalu JPEG

      console.log(`🚀 Mengunggah foto progress via auth.request: ${fileName} ke Drive...`)

      // --- Gunakan auth.request untuk Upload ---
      const fileStream = fs.createReadStream(filePath)
      const metadata = {
        name: fileName,
        mimeType: mimeType,
        parents: [PROGRESS_PHOTOS_FOLDER_ID] // Gunakan folder ID foto progress
      }
      const boundary = `----UbinkayuProgressBoundary${Date.now()}----`
      const readable = new stream.PassThrough()

      // Tulis bagian metadata dan file (sama seperti generateAndUploadPO)
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

      // Panggil API create
      const createResponse = await auth.request({
        url: `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`,
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        data: readable,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      })

      // --- Ambil webViewLink via auth.request ---
      const fileId = createResponse?.data?.id
      if (!fileId) {
        console.error(
          '❌ Upload foto progress berhasil, tetapi ID file tidak ditemukan:',
          createResponse.data
        )
        throw new Error('Upload foto berhasil tetapi ID file tidak didapatkan.')
      }
      console.log(`✅ Foto progress berhasil diunggah (ID: ${fileId}). Mengambil webViewLink...`)

      // Panggil files.get endpoint menggunakan auth.request
      const getResponse = await auth.request({
        url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
        method: 'GET',
        params: {
          fields: 'webViewLink',
          supportsAllDrives: true
        }
      })

      const webViewLink = getResponse?.data?.webViewLink
      if (!webViewLink) {
        console.error('❌ Gagal mendapatkan webViewLink foto progress:', getResponse.data)
        throw new Error('Gagal mendapatkan link foto setelah upload berhasil.')
      }
      photoLink = webViewLink // Simpan link foto
      console.log(`✅ Link foto progress didapatkan: ${photoLink}`)

      // Jangan hapus file lokal di sini, biarkan di finally
    } // Akhir dari blok if (photoPath)

    // --- Bagian Simpan Log ke Google Sheet ---
    // Jika tidak ada upload foto, kita tetap butuh auth untuk Sheet
    if (!auth) {
      console.log('🔄 Mendapatkan otentikasi untuk Google Sheet...')
      auth = getAuth()
      await auth.authorize() // Authorize jika belum
      console.log('✅ Otorisasi Sheet berhasil.')
    }

    const doc = await openDoc() // Pastikan openDoc menggunakan auth atau sudah terkonfigurasi
    const progressSheet = await getSheet(doc, 'progress_tracking') // Pastikan getSheet menggunakan doc
    const nextId = await getNextIdFromSheet(progressSheet) // Pastikan getNextIdFromSheet menggunakan sheet

    console.log(`📝 Menyimpan log progress ke Sheet... (Stage: ${stage})`)
    await progressSheet.addRow({
      id: nextId,
      purchase_order_id: poId,
      purchase_order_item_id: itemId,
      stage: stage,
      notes: notes || '', // Pastikan notes dihandle jika kosong
      photo_url: photoLink, // Gunakan link yang didapat (bisa null jika tidak ada foto)
      created_at: new Date().toISOString()
    })
    console.log(`✅ Log progress untuk item ID ${itemId} berhasil disimpan ke Sheet.`)

    return { success: true }
  } catch (err) {
    console.error('❌ Gagal update item progress:', err.message)
    // @ts-ignore
    if (err.response && err.response.data && err.response.data.error) {
      // @ts-ignore
      console.error(
        '   -> Detail Error Google API:',
        JSON.stringify(err.response.data.error, null, 2)
      )
      // @ts-ignore
    } else if (err.response) {
      // @ts-ignore
      console.error(`   -> Status Error HTTP: ${err.response.status}`)
      // @ts-ignore
      console.error('   -> Data Error:', err.response.data)
    }
    // @ts-ignore
    return { success: false, error: err.message }
  } finally {
    // Hapus file foto lokal jika ada path-nya
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
        console.log(`🗑️ File foto lokal ${path.basename(filePath)} dihapus.`)
      } catch (unlinkErr) {
        console.warn(
          `⚠️ Gagal menghapus file foto lokal ${path.basename(filePath)}:`,
          unlinkErr.message
        )
      }
    }
  }
}

export async function getActivePOsWithProgress() {
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

    // 1. Ambil semua revisi PO terbaru (tanpa filter status)
    const byId = new Map()
    for (const r of poRows) {
      const id = String(r.get('id')).trim()
      const rev = toNum(r.get('revision_number'), -1)
      if (!byId.has(id) || rev > byId.get(id).rev) {
        byId.set(id, { rev, row: r })
      }
    }
    const latestPoRows = Array.from(byId.values()).map(({ row }) => row)

    // 2. Siapkan data helper
    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      const key = `${row.get('purchase_order_id')}-${row.get('purchase_order_item_id')}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
      return acc
    }, {})

    const latestItemRevisions = itemRows.reduce((acc, item) => {
      const poId = item.get('purchase_order_id')
      const rev = toNum(item.get('revision_number'), -1)
      if (!acc.has(poId) || rev > acc.get(poId)) {
        acc.set(poId, rev)
      }
      return acc
    }, new Map())

    // 3. Hitung progress dan status untuk SETIAP PO
    const allPOsWithCalculatedStatus = latestPoRows.map((po) => {
      const poId = po.get('id')
      const latestRev = latestItemRevisions.get(poId) ?? -1
      const poItems = itemRows.filter(
        (item) =>
          item.get('purchase_order_id') === poId &&
          toNum(item.get('revision_number'), -1) === latestRev
      )

      let totalPercentage = 0
      if (poItems.length > 0) {
        poItems.forEach((item) => {
          const itemId = item.get('id')
          const itemProgressHistory = progressByCompositeKey[`${poId}-${itemId}`] || []
          let latestStageIndex = -1
          if (itemProgressHistory.length > 0) {
            const latestProgress = [...itemProgressHistory].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )[0]
            latestStageIndex = PRODUCTION_STAGES.indexOf(latestProgress.stage)
          }
          totalPercentage +=
            latestStageIndex >= 0 ? ((latestStageIndex + 1) / PRODUCTION_STAGES.length) * 100 : 0
        })
      }

      const poProgress = poItems.length > 0 ? totalPercentage / poItems.length : 0
      const poObject = po.toObject()

      // Hitung status secara dinamis
      let finalStatus = poObject.status
      if (finalStatus !== 'Cancelled') {
        if (poProgress >= 100) finalStatus = 'Completed'
        else if (poProgress > 0) finalStatus = 'In Progress'
        else finalStatus = 'Open'
      }

      return { ...poObject, progress: Math.round(poProgress), status: finalStatus }
    })

    // 4. BARU LAKUKAN FILTER di akhir berdasarkan status yang sudah dihitung
    const activePOs = allPOsWithCalculatedStatus.filter(
      (po) => po.status !== 'Completed' && po.status !== 'Cancelled'
    )

    return activePOs
  } catch (err) {
    console.error('❌ Gagal get active POs with progress:', err.message)
    return []
  }
}

export async function getPOItemsWithDetails(poId) {
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

    // --- LOGIKA BARU: Cari revisi terakhir yang memiliki item ---
    // 1. Filter semua item yang relevan untuk PO ini
    const allItemsForPO = itemRows.filter((r) => r.get('purchase_order_id') === poId)

    // 2. Jika tidak ada item sama sekali untuk PO ini, langsung kembalikan array kosong.
    if (allItemsForPO.length === 0) {
      console.warn(`Tidak ada item sama sekali untuk PO ID ${poId} di sheet items.`)
      return []
    }

    // 3. Cari nomor revisi tertinggi DARI ITEM YANG ADA.
    const latestItemRev = Math.max(-1, ...allItemsForPO.map((r) => toNum(r.get('revision_number'))))

    // 4. Ambil header PO yang cocok dengan revisi item terakhir ini.
    const poData = poRows.find(
      (r) => r.get('id') === poId && toNum(r.get('revision_number')) === latestItemRev
    )
    // --- AKHIR LOGIKA BARU ---

    if (!poData) {
      // Ini bisa terjadi jika ada item tetapi tidak ada header PO yang cocok (inkonsistensi data).
      console.error(
        `Inkonsistensi Data: Ditemukan item untuk PO ID ${poId} rev ${latestItemRev}, tetapi tidak ada header PO yang cocok.`
      )
      throw new Error(`Data PO untuk revisi terbaru (rev ${latestItemRev}) tidak ditemukan.`)
    }

    const poStartDate = new Date(poData.get('created_at'))
    const poDeadline = new Date(poData.get('deadline'))

    // Logika perhitungan deadline yang sudah benar
    let stageDeadlines = []
    let cumulativeDate = new Date(poStartDate)
    stageDeadlines = PRODUCTION_STAGES.map((stageName) => {
      if (stageName === 'Siap Kirim') {
        return { stageName, deadline: poDeadline.toISOString() }
      }
      const durationDays = DEFAULT_STAGE_DURATIONS[stageName] || 0
      cumulativeDate.setDate(cumulativeDate.getDate() + durationDays)
      return { stageName, deadline: new Date(cumulativeDate).toISOString() }
    })

    // 5. Filter item sekali lagi untuk hanya mendapatkan item dari revisi yang valid.
    const poItemsForLatestRev = allItemsForPO.filter(
      (item) => toNum(item.get('revision_number'), -1) === latestItemRev
    )

    const progressByItemId = progressRows
      .filter((row) => row.get('purchase_order_id') === poId)
      .reduce((acc, row) => {
        const itemId = row.get('purchase_order_item_id')
        if (!acc[itemId]) acc[itemId] = []
        acc[itemId].push(row.toObject())
        return acc
      }, {})

    const result = poItemsForLatestRev.map((item) => {
      const itemObject = item.toObject()
      const itemId = String(itemObject.id)
      const history = (progressByItemId[itemId] || []).sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      )
      return { ...itemObject, progressHistory: history, stageDeadlines }
    })

    return result
  } catch (err) {
    console.error(`❌ Gagal get PO items with details for PO ID ${poId}:`, err.message)
    return []
  }
}

export async function updateStageDeadline(data) {
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
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function getRecentProgressUpdates(limit = 10) {
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

    const itemMap = new Map(itemRows.map((r) => [r.get('id'), r.toObject()]))
    const poMap = new Map()
    poRows.forEach((r) => {
      const poId = r.get('id')
      const rev = toNum(r.get('revision_number'))
      if (!poMap.has(poId) || rev > poMap.get(poId).revision_number) {
        poMap.set(poId, r.toObject())
      }
    })

    const sortedUpdates = progressRows
      .map((r) => r.toObject())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    const recentUpdates = sortedUpdates.slice(0, limit)

    const enrichedUpdates = recentUpdates
      .map((update) => {
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
  } catch (err) {
    console.error('❌ Gagal get recent progress updates:', err.message)
    return []
  }
}

export async function getAttentionData() {
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
    poRows.forEach((r) => {
      const id = r.get('id')
      const rev = toNum(r.get('revision_number'))
      if (!byId.has(id) || rev > byId.get(id).rev) {
        byId.set(id, { rev, row: r })
      }
    })
    const latestPoMap = new Map(
      Array.from(byId.values()).map((item) => [item.row.get('id'), item.row])
    )

    const latestItemRevisions = new Map()
    itemRows.forEach((item) => {
      const poId = item.get('purchase_order_id')
      const rev = toNum(item.get('revision_number'), -1)
      const current = latestItemRevisions.get(poId)
      if (!current || rev > current) {
        latestItemRevisions.set(poId, rev)
      }
    })

    const activeItems = itemRows.filter((item) => {
      const po = latestPoMap.get(item.get('purchase_order_id'))
      if (!po) return false
      const latestRev = latestItemRevisions.get(item.get('purchase_order_id')) ?? -1
      return (
        po.get('status') !== 'Completed' &&
        po.get('status') !== 'Cancelled' &&
        toNum(item.get('revision_number')) === latestRev
      )
    })

    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      const poId = row.get('purchase_order_id')
      const itemId = row.get('purchase_order_item_id')
      const key = `${poId}-${itemId}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
      return acc
    }, {})

    const nearingDeadline = []
    const stuckItems = []
    const urgentItems = []
    const today = new Date()
    const sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
    const fiveDaysAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000)

    activeItems.forEach((item) => {
      const po = latestPoMap.get(item.get('purchase_order_id'))
      const poId = po.get('id')
      const itemId = item.get('id')
      const compositeKey = `${poId}-${itemId}`
      const itemProgressHistory = progressByCompositeKey[compositeKey] || []
      const latestProgress = itemProgressHistory.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
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
      if (deadline <= sevenDaysFromNow && deadline >= today && currentStage !== 'Kirim') {
        nearingDeadline.push({ ...attentionItem, deadline: po.get('deadline') })
      }

      if (
        latestProgress &&
        new Date(latestProgress.created_at) < fiveDaysAgo &&
        currentStage !== 'Kirim'
      ) {
        stuckItems.push({ ...attentionItem, last_update: latestProgress.created_at })
      }
    })

    return { nearingDeadline, stuckItems, urgentItems }
  } catch (err) {
    console.error('❌ Gagal get attention data:', err.message)
    return { nearingDeadline: [], stuckItems: [], urgentItems: [] }
  }
}

const formatDateForAnalysis = (dateString) => {
  if (!dateString) return null
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return null
    return date.toISOString().split('T')[0] // Format YYYY-MM-DD
  } catch {
    return null
  }
}

const getYearMonth = (dateString) => {
  const date = formatDateForAnalysis(dateString)
  return date ? date.substring(0, 7) : null // Ambil YYYY-MM
}

export async function getProductSalesAnalysis() {
  try {
    const doc = await openDoc()
    const [itemSheet, poSheet, productSheet] = await Promise.all([
      getSheet(doc, 'purchase_order_items'),
      getSheet(doc, 'purchase_orders'),
      getSheet(doc, 'product_master')
    ])
    // Ambil data mentah sekali saja
    const [rawItemRows, rawPoRows, rawProductRows] = await Promise.all([
      itemSheet.getRows(),
      poSheet.getRows(),
      productSheet.getRows()
    ])

    // Konversi ke Objek Biasa sekali saja
    const itemRows = rawItemRows.map((r) => r.toObject())
    const poRows = rawPoRows.map((r) => r.toObject())
    const productRows = rawProductRows.map((r) => r.toObject())

    // Buat Map PO Revisi Terbaru (semua status kecuali Cancelled)
    const latestPoMap = poRows.reduce((map, po) => {
      const poId = po.id
      const rev = toNum(po.revision_number)
      if (po.status !== 'Cancelled') {
        // @ts-ignore
        if (!map.has(poId) || rev > map.get(poId).revision_number) {
          // Simpan seluruh objek PO terbaru
          map.set(poId, { ...po, revision_number: rev }) // Pastikan revision_number adalah number
        }
      }
      return map
    }, new Map())

    // --- Inisialisasi Struktur Data Baru ---
    const salesByProduct = {}
    const salesByMarketing = {}
    const monthlySalesByProduct = {}
    const monthlySalesByMarketing = {}
    const woodTypeDistribution = {}
    const customerByKubikasi = {}
    const salesByDateForTrend = []
    const soldProductNames = new Set()

    // --- Proses Item ---
    itemRows.forEach((item) => {
      const po = latestPoMap.get(item.purchase_order_id)
      // Pastikan item berasal dari PO revisi terbaru yang valid (tidak cancelled)
      // @ts-ignore
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

      // 1. Agregasi Total per Produk
      salesByProduct[productName] = salesByProduct[productName] || {
        totalQuantity: 0,
        totalKubikasi: 0,
        name: productName
      }
      salesByProduct[productName].totalQuantity += quantity
      salesByProduct[productName].totalKubikasi += kubikasi

      // 3. Agregasi Bulanan per Produk (Quantity)
      if (yearMonth) {
        monthlySalesByProduct[yearMonth] = monthlySalesByProduct[yearMonth] || {}
        monthlySalesByProduct[yearMonth][productName] =
          (monthlySalesByProduct[yearMonth][productName] || 0) + quantity
      }

      // 5. Distribusi Kayu (Quantity)
      if (woodType)
        woodTypeDistribution[woodType] = (woodTypeDistribution[woodType] || 0) + quantity

      // 7. Data untuk Tren Produk
      try {
        salesByDateForTrend.push({ date: new Date(po.created_at), name: productName, quantity })
      } catch {}
    })

    // --- Proses Agregasi per PO (Marketing & Customer) ---
    latestPoMap.forEach((po) => {
      const marketingName = po.acc_marketing || 'N/A'
      const customerName = po.project_name
      const kubikasiTotalPO = toNum(po.kubikasi_total, 0)
      const yearMonth = getYearMonth(po.created_at)

      // Agregasi Total per Marketing
      salesByMarketing[marketingName] = salesByMarketing[marketingName] || {
        totalKubikasi: 0,
        poCount: 0,
        name: marketingName
      }
      salesByMarketing[marketingName].totalKubikasi += kubikasiTotalPO
      salesByMarketing[marketingName].poCount += 1

      // Agregasi Bulanan per Marketing
      if (yearMonth) {
        monthlySalesByMarketing[yearMonth] = monthlySalesByMarketing[yearMonth] || {}
        monthlySalesByMarketing[yearMonth][marketingName] =
          (monthlySalesByMarketing[yearMonth][marketingName] || 0) + kubikasiTotalPO
      }

      // Agregasi Customer
      if (customerName)
        customerByKubikasi[customerName] = (customerByKubikasi[customerName] || 0) + kubikasiTotalPO
    })

    // --- Finalisasi Hasil ---
    const topSellingProducts = Object.values(salesByProduct)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 10)

    const salesByMarketingSorted = Object.values(salesByMarketing).sort(
      (a, b) => b.totalKubikasi - a.totalKubikasi
    )

    const woodTypeDistributionSorted = Object.entries(woodTypeDistribution)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    const topCustomers = Object.entries(customerByKubikasi)
      .map(([name, totalKubikasi]) => ({ name, totalKubikasi }))
      .sort((a, b) => b.totalKubikasi - a.totalKubikasi)
      .slice(0, 10)

    // Format data bulanan untuk Recharts
    const allMonths = new Set([
      ...Object.keys(monthlySalesByProduct),
      ...Object.keys(monthlySalesByMarketing)
    ])
    const sortedMonths = Array.from(allMonths).sort()

    // Ambil semua nama produk dan marketing unik dari data bulanan
    const allProductKeys = new Set() // <-- Hapus <string>
    sortedMonths.forEach((month) => {
      if (monthlySalesByProduct[month])
        Object.keys(monthlySalesByProduct[month]).forEach((p) => allProductKeys.add(p))
    })
    sortedMonths.forEach((month) => {
      if (monthlySalesByProduct[month])
        Object.keys(monthlySalesByProduct[month]).forEach((p) => allProductKeys.add(p))
    })
    const allMarketingKeys = new Set() // <-- Hapus <string>
    sortedMonths.forEach((month) => {
      if (monthlySalesByMarketing[month])
        Object.keys(monthlySalesByMarketing[month]).forEach((m) => allMarketingKeys.add(m))
    })
    sortedMonths.forEach((month) => {
      if (monthlySalesByMarketing[month])
        Object.keys(monthlySalesByMarketing[month]).forEach((m) => allMarketingKeys.add(m))
    })

    const monthlyProductChartData = sortedMonths.map((month) => {
      const monthData = { month }
      allProductKeys.forEach((prodKey) => {
        monthData[prodKey] = monthlySalesByProduct[month]?.[prodKey] || 0 // Isi 0 jika tidak ada data
      })
      return monthData
    })

    const monthlyMarketingChartData = sortedMonths.map((month) => {
      const monthData = { month }
      allMarketingKeys.forEach((markKey) => {
        monthData[markKey] = monthlySalesByMarketing[month]?.[markKey] || 0 // Isi 0 jika tidak ada data
      })
      return monthData
    })

    // Kalkulasi Tren
    const todayTrend = new Date(),
      thirtyDaysAgo = new Date(new Date().setDate(todayTrend.getDate() - 30)),
      sixtyDaysAgo = new Date(new Date().setDate(todayTrend.getDate() - 60))
    const salesLast30 = {},
      salesPrev30 = {}
    salesByDateForTrend.forEach((sale) => {
      if (sale.date >= thirtyDaysAgo)
        salesLast30[sale.name] = (salesLast30[sale.name] || 0) + sale.quantity
      else if (sale.date >= sixtyDaysAgo)
        salesPrev30[sale.name] = (salesPrev30[sale.name] || 0) + sale.quantity
    })
    const trendingProducts = Object.keys(salesLast30)
      .map((name) => {
        const last30 = salesLast30[name] || 0 // Pastikan ada nilai default 0
        const prev30 = salesPrev30[name] || 0 // Pastikan ada nilai default 0
        const change =
          prev30 === 0 && last30 > 0 ? 100 : ((last30 - prev30) / (prev30 === 0 ? 1 : prev30)) * 100 // Hindari pembagian 0
        return { name, last30, prev30, change }
      })
      .filter((p) => p.change > 10 && p.last30 > p.prev30) // Filter > 10% dan lebih besar dari sebelumnya
      .sort((a, b) => b.change - a.change)

    // Produk Kurang Laris
    const allMasterProductNames = productRows.map((p) => p.product_name).filter(Boolean)
    const slowMovingProducts = allMasterProductNames.filter((name) => !soldProductNames.has(name))

    // Susun hasil akhir
    const analysisResult = {
      topSellingProducts,
      salesByMarketing: salesByMarketingSorted,
      monthlyProductChartData,
      monthlyMarketingChartData,
      woodTypeDistribution: woodTypeDistributionSorted,
      topCustomers,
      trendingProducts,
      slowMovingProducts
    }

    console.log('📊 Analisis Penjualan Dihasilkan:', analysisResult) // Log hasil
    return analysisResult // Return untuk Electron
  } catch (err) {
    console.error('❌ Gagal melakukan analisis penjualan produk:', err.message)
    // Return struktur kosong agar frontend tidak error
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

export async function getSalesItemData() {
  try {
    const doc = await openDoc()
    const itemSheet = await getSheet(doc, 'purchase_order_items')
    const poSheet = await getSheet(doc, 'purchase_orders')

    const [itemRows, poRows] = await Promise.all([itemSheet.getRows(), poSheet.getRows()])

    const poMap = new Map()
    poRows.forEach((r) => {
      const poId = r.get('id')
      const rev = toNum(r.get('revision_number'))
      if (!poMap.has(poId) || rev > poMap.get(poId).revision_number) {
        poMap.set(poId, r.toObject())
      }
    })

    const combinedData = itemRows
      .map((item) => {
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
  } catch (err) {
    console.error('❌ Gagal mengambil data item penjualan:', err.message)
    return []
  }
}
export async function addNewProduct(productData) {
  try {
    // Mengambil console.log yang deskriptif dari satu branch
    console.log('📦 Menambahkan produk baru ke master:', productData)

    const doc = await openDoc()
    const sheet = await getSheet(doc, 'product_master')

    // Menggunakan logika yang benar untuk mendapatkan ID dan menambah baris
    const nextId = await getNextIdFromSheet(sheet)
    await sheet.addRow({ id: nextId, ...productData })

    // Menggunakan return value yang lebih informatif dari branch lain
    console.log(`✅ Produk baru [ID: ${nextId}] berhasil ditambahkan.`)
    return { success: true, newId: nextId }
  } catch (err) {
    console.error('❌ Gagal menambahkan produk baru:', err.message)
    return { success: false, error: err.message }
  }
}

/**
 * Menangani logika chat AI menggunakan Groq API.
 * (Pengganti handleOllamaChat)
 */
export async function handleGroqChat(prompt) {
  // =================================================================
  // 2. AMBIL KONTEKS DATA PO (Logika asli Anda dari Ollama)
  // =================================================================
  let allPOs
  try {
    allPOs = await listPOs() // Memanggil listPOs() yang diimpor
    if (!Array.isArray(allPOs)) {
      console.error('listPOs did not return an array.')
      allPOs = [] // Fallback ke array kosong
    }
    if (allPOs.length === 0) {
      if (
        ['bantuan', 'help', 'siapa', 'halo', 'info'].some((k) => prompt.toLowerCase().includes(k))
      ) {
        // Lanjutkan ke AI untuk general/help
      } else {
        return 'Maaf, data PO belum tersedia untuk dianalisis saat ini.'
      }
    }
  } catch (e) {
    // @ts-ignore
    console.error('Gagal mengambil data PO untuk konteks AI:', e.message)
    return 'Maaf, saya gagal mengambil data PO terbaru untuk menjawab pertanyaan Anda.'
  }

  // =================================================================
  // 3. SIAPKAN SAPAAN & SYSTEM PROMPT (Logika asli Anda dari Ollama)
  // =================================================================
  const now = new Date()
  const currentHour = now.getHours()
  let timeOfDayGreeting = 'Halo!'
  // Logika sapaan ini adalah untuk WAKTU LOKAL (Electron), bukan UTC (Vercel)
  if (currentHour >= 4 && currentHour < 11) {
    timeOfDayGreeting = 'Selamat pagi!'
  } else if (currentHour >= 11 && currentHour < 15) {
    timeOfDayGreeting = 'Selamat siang!'
  } else if (currentHour >= 15 && currentHour < 19) {
    timeOfDayGreeting = 'Selamat sore!'
  } else {
    timeOfDayGreeting = 'Selamat malam!'
  }

  const today = new Date().toISOString().split('T')[0]
  // System prompt lengkap Anda, identik dengan Vercel
  const systemPrompt = `Anda adalah Asisten ERP Ubinkayu. Tugas Anda adalah mengubah pertanyaan pengguna menjadi JSON 'perintah' berdasarkan alat (tools) yang tersedia. HANYA KEMBALIKAN JSON YANG VALID, tanpa teks tambahan sebelum atau sesudahnya.
Hari ini adalah ${today}.

Alat (Tools) yang Tersedia:
1. "getTotalPO": Menghitung jumlah total SEMUA PO, SEMUA PO aktif (status BUKAN Completed/Cancelled), dan SEMUA PO selesai. Memberikan rincian jumlah Open & In Progress untuk PO Aktif.
   - Keywords: "jumlah po", "total po", "ada berapa po", "semua po aktif", "berapa poaktif", "jumlah po yang sedang berjalan", "how many purchase orders".
   - **PENTING:** Gunakan tool ini jika user bertanya jumlah PO "aktif" secara umum.
   - JANGAN gunakan tool ini jika user HANYA bertanya tentang PO Urgent atau status spesifik (Open/In Progress).
   - JSON: {"tool": "getTotalPO"}
2. "getTopProduct": Menemukan produk terlaris dari PO yang sudah selesai.
   - Keywords: "produk terlaris", "paling laku", "best selling product".
   - JSON: {"tool": "getTopProduct"}
3. "getTopCustomer": Menemukan customer terbesar (volume m³) dari PO yang sudah selesai.
   - Keywords: "customer terbesar", "top customer", "biggest customer".
   - JSON: {"tool": "getTopCustomer"}
4. "getPOStatus": Mencari status RINGKAS PO berdasarkan nomor PO yang **VALID**.
   - Keywords: "status po [nomor]", "cek po [nomor]", "progress po [nomor]". (Format lebih ketat)
   - AI **HARUS** mengekstrak nomor PO dari query pengguna dan memasukkannya ke "param".
   - Jika pengguna hanya bilang "status po" tanpa nomor, JANGAN gunakan tool ini, kembalikan 'unknown'.
   - JSON: {"tool": "getPOStatus", "param": "NOMOR_PO_EKSTRAKSI"}
5. "findPODetails": Mencari DETAIL PO berdasarkan nomor PO ATAU nama customer. Jika ditemukan, jelaskan detailnya.
   - Keywords: "cari PO", "find PO", "apakah ada PO", "detail PO", "PO customer [nama]", "PO nomor [nomor]", "info PO [nomor/nama]".
   - AI **HARUS** mengekstrak "param" yang berisi "poNumber" ATAU "customerName". Prioritaskan poNumber jika keduanya disebut.
   - JSON: {"tool": "findPODetails", "param": {"poNumber": "...", "customerName": "..."}}
6. "getUrgentPOs": Menampilkan daftar PO aktif yang prioritasnya HANYA Urgent.
   - Keywords: "po urgent", "urgent orders", "hanya yang urgent", "prioritas urgent".
   - JSON: {"tool": "getUrgentPOs"}
7. "getNearingDeadline": Menampilkan PO aktif yang akan deadline (dalam 7 hari).
   - Keywords: "deadline dekat", "nearing deadline", "akan jatuh tempo".
   - JANGAN gunakan tool ini jika user bertanya PO yang DIBUAT minggu/bulan ini.
   - JSON: {"tool": "getNearingDeadline"}
8. "getNewestPOs": Menampilkan 3 PO yang baru saja dibuat.
   - Keywords: "po terbaru", "order terbaru", "newest po".
   - JSON: {"tool": "getNewestPOs"}
9. "getOldestPO": Menampilkan PO terlama.
   - Keywords: "po terlama", "order pertama", "oldest po".
   - JSON: {"tool": "getOldestPO"}
10. "getPOsByDateRange": Mencari PO berdasarkan rentang tanggal masuk (TANGGAL PEMBUATAN PO).
    - Keywords: "po bulan oktober", "po tanggal 20 okt", "po 2025", "po kemarin", "po hari ini", "po minggu ini".
    - AI **HARUS** mengekstrak 'startDate' dan 'endDate' dalam format YYYY-MM-DD. Gunakan ${today} sebagai referensi.
    - Jika hanya satu tanggal (misal "po 20 okt 2025"), 'startDate' dan 'endDate' HARUS sama ("2025-10-20").
    - AI **HARUS MENCOBA** menginterpretasi tanggal relatif seperti "kemarin", "hari ini", "minggu lalu". Jika ${today} adalah 2025-10-25: "kemarin" -> startDate/endDate=2025-10-24; "hari ini" -> startDate/endDate=2025-10-25; "minggu ini" -> hitung awal/akhir minggu dari ${today}.
    - JSON: {"tool": "getPOsByDateRange", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}
11. "getPOByStatusCount": Menghitung jumlah PO aktif dengan status spesifik (Open atau In Progress).
    - Keywords: "berapa po open", "jumlah po in progress", "yang statusnya open", "yang sedang dikerjakan".
    - AI **HARUS** mengekstrak "param" (status yang diminta: "Open" atau "In Progress").
    - JSON: {"tool": "getPOByStatusCount", "param": "STATUS_DIMINTA"}
12. "getApplicationHelp": Memberikan penjelasan cara menggunakan fitur aplikasi ERP.
      - Keywords: "cara buat po", "bagaimana input po", "cara update progress", "bagaimana revisi po", "cara tambah produk", "panduan aplikasi", "alur kerja", "step by step [fitur]", "tutorial [fitur]", "gimana cara [fitur]".
      - AI HARUS mengekstrak "topic" dari pertanyaan pengguna (misal: "buat PO", "update progress", "revisi PO", "tambah produk", "tambah master produk"). Jika tidak jelas, biarkan kosong.
      - JSON: {"tool": "getApplicationHelp", "topic": "NAMA_FITUR_DIMINTA"}
13. "help": Memberikan bantuan atau daftar perintah yang bisa dilakukan.
    - Keywords: "bantuan", "help", "apa yang bisa kamu lakukan", "perintah".
    - JSON: {"tool": "help"}
14. "general": Untuk pertanyaan umum atau sapaan yang tidak terkait langsung dengan data PO.
    - Keywords: "halo", "kamu siapa", "dengan siapa ini", "terima kasih".
    - JSON: {"tool": "general"}
15. "findPOFile": Mencari link file (JPEG arsip) untuk PO berdasarkan nomor PO dan (opsional) nomor revisi.
    - Keywords: "carikan file", "JPEG arsip", "dokumen PO", "file PO [nomor]", "link PO [nomor] Rev [nomor]".
    - AI HARUS mengekstrak "poNumber" dan "revisionNumber" (jika ada).
    - Jika "revisionNumber" tidak disebut, AI akan mencari revisi TERBARU.
    - JSON: {"tool": "findPOFile", "param": {"poNumber": "...", "revisionNumber": "..."}}
16. "getTopSellingProductsChart": Menampilkan grafik batang (bar chart) 5 produk terlaris.
    - Keywords: "grafik produk", "chart penjualan", "produk terlaris", "tampilkan grafik".
    - (Catatan: Versi ini belum mendukung parameter kustom seperti "3 produk" atau "6 bulan").
    - JSON: {"tool": "getTopSellingProductsChart"}

ATURAN KETAT:
- JANGAN menjawab pertanyaan secara langsung. HANYA kembalikan JSON.
- Jika user bertanya "berapa po aktif?" atau "jumlah po aktif", KEMBALIKAN: {"tool": "getTotalPO"}
- Jika user tanya "status po 123", KEMBALIKAN: {"tool": "getPOStatus", "param": "123"}
- Jika user tanya "detail po customer PT ABC", KEMBALIKAN: {"tool": "findPODetails", "param": {"poNumber": null, "customerName": "PT ABC"}}
- Jika user bertanya tentang PO yang mungkin tidak ada (misal "status po 999", "cari PO xyz"), TETAP pilih tool getPOStatus atau findPODetails dan ekstrak parameternya. Biarkan backend menangani jika data tidak ditemukan.
- Contoh Tanggal Relatif (jika ${today} adalah 2025-10-25):
    - "po kemarin": {"tool": "getPOsByDateRange", "startDate": "2025-10-24", "endDate": "2025-10-24"}
    - "po hari ini": {"tool": "getPOsByDateRange", "startDate": "2025-10-25", "endDate": "2025-10-25"}
    - "po minggu ini" (Asumsi Minggu awal): {"tool": "getPOsByDateRange", "startDate": "2025-10-19", "endDate": "2025-10-25"}
- Jika tidak yakin tool mana yang paling cocok, KEMBALIKAN: {"tool": "unknown"}
- Jika user tanya "cara buat po", KEMBALIKAN: {"tool": "getApplicationHelp", "topic": "buat PO"}
- Jika user tanya "gimana cara nambah produk master?", KEMBALIKAN: {"tool": "getApplicationHelp", "topic": "tambah produk"}
- Jika user tanya "step by step update progress", KEMBALIKAN: {"tool": "getApplicationHelp", "topic": "update progress"}
`

  // =================================================================
  // 4. PANGGIL GROQ API (PENGGANTI OLLAMA)
  // =================================================================
  let aiDecisionJsonString = ''
  let aiDecision = { tool: 'unknown' }

  // Ambil API key dari file .env (Pastikan .env sudah di-load di main process)
  const groqToken = process.env.GROQ_API_KEY
  const modelId = 'llama-3.1-8b-instant' // Model yang sama dengan Vercel

  console.log(`[Electron AI - Groq] Using Model ID: ${modelId}`)

  if (!groqToken) {
    console.error('💥 [Electron AI - Groq] GROQ_API_KEY tidak ditemukan di process.env')
    return 'Maaf, GROQ_API_KEY tidak ditemukan. Pastikan Anda sudah membuat file .env dan me-restart Electron.'
  }

  try {
    console.log('⏳ [Electron AI - Groq] Calling Groq API via MANUAL FETCH...')

    const API_URL = 'https://api.groq.com/openai/v1/chat/completions'

    const payload = {
      model: modelId,
      messages: [
        // Format chat (lebih baik untuk model instruct)
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 150
    }

    // Menggunakan 'fetch' yang tersedia secara global di Electron (atau node-fetch jika di main process)
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ [Electron AI - Groq] Manual Fetch Error Response:', errorText)
      throw new Error(`Groq API request failed with status ${response.status}: ${errorText}`)
    }

    const result = await response.json()
    console.log('✅ [Electron AI - Groq] Groq raw response (manual):', JSON.stringify(result))

    // Ekstrak respons dari format Groq/OpenAI
    if (
      result &&
      result.choices &&
      result.choices[0] &&
      result.choices[0].message &&
      result.choices[0].message.content
    ) {
      aiDecisionJsonString = result.choices[0].message.content.trim()

      // Pembersihan JSON yang sama persis dengan Vercel
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
      console.log('✅ [Electron AI - Groq] Parsed JSON decision:', aiDecision)
    } else {
      console.error('❌ [Electron AI - Groq] Unexpected response format (manual):', result)
      throw new Error('Unexpected response format from Groq (manual fetch).')
    }
  } catch (err) {
    console.error('💥 [Electron AI - Groq] AI call or JSON parse ERROR:', err.message)
    // @ts-ignore
    return `Maaf, terjadi kesalahan saat menghubungi Groq: ${err.message}`
  }

  // =================================================================
  // 5. JALANKAN ALAT (TOOLS) (Logika asli Anda dari Ollama)
  // =================================================================
  try {
    console.log(`[Electron AI - Groq] Executing tool: ${aiDecision?.tool || 'unknown'}`)
    switch (aiDecision.tool) {
      case 'getTotalPO': {
        const totalPOs = allPOs.length
        const activePOsList = allPOs.filter(
          (po) => po.status !== 'Completed' && po.status !== 'Cancelled'
        )
        const activePOsCount = activePOsList.length
        const completedPOs = allPOs.filter((po) => po.status === 'Completed').length
        const openCount = activePOsList.filter((po) => po.status === 'Open').length
        const inProgressCount = activePOsList.filter((po) => po.status === 'In Progress').length

        return (
          `Saat ini ada ${totalPOs} total PO di database.\n\n` +
          `- ${activePOsCount} PO sedang aktif (${openCount} Open, ${inProgressCount} In Progress).\n` +
          `- ${completedPOs} PO sudah selesai.`
        )
      }
      case 'getTopProduct': {
        const completedPOs = allPOs.filter((po) => po.status === 'Completed')
        if (completedPOs.length === 0) return 'Belum ada data PO Selesai untuk dianalisis.'
        const salesData = {}
        completedPOs
          .flatMap((po) => po.items || [])
          .forEach((item) => {
            if (item.product_name)
              salesData[item.product_name] =
                (salesData[item.product_name] || 0) + Number(item.quantity || 0)
          })
        const topProduct =
          Object.keys(salesData).length > 0
            ? Object.keys(salesData).reduce((a, b) => (salesData[a] > salesData[b] ? a : b))
            : 'N/A'
        return topProduct !== 'N/A'
          ? `Produk terlaris dari PO Selesai adalah: ${topProduct} (${salesData[topProduct]} unit).`
          : 'Tidak dapat menemukan produk terlaris.'
      }
      case 'getTopCustomer': {
        const completedPOs = allPOs.filter((po) => po.status === 'Completed')
        if (completedPOs.length === 0) return 'Belum ada data PO Selesai untuk dianalisis.'
        const customerData = {}
        completedPOs.forEach((po) => {
          if (po.project_name)
            customerData[po.project_name] =
              (customerData[po.project_name] || 0) + Number(po.kubikasi_total || 0)
        })
        const topCustomer =
          Object.keys(customerData).length > 0
            ? Object.keys(customerData).reduce((a, b) =>
                customerData[a] > customerData[b] ? a : b
              )
            : 'N/A'
        return topCustomer !== 'N/A'
          ? `Customer terbesar (m³) dari PO Selesai adalah: ${topCustomer} (${customerData[topCustomer].toFixed(3)} m³).`
          : 'Tidak dapat menemukan customer terbesar.'
      }
      case 'getPOStatus': {
        const poNumber = aiDecision.param
        if (!poNumber || poNumber === 'NOMOR_PO_EKSTRAKSI') {
          return 'Mohon sebutkan nomor PO yang valid (contoh: status po 123).'
        }
        const latestPO = allPOs
          .filter((po) => po.po_number === poNumber)
          .sort((a, b) => Number(b.revision_number || 0) - Number(a.revision_number || 0))[0]
        return latestPO
          ? `Status PO ${poNumber} (${latestPO.project_name}) adalah: ${latestPO.status || 'Open'}. Progress: ${latestPO.progress?.toFixed(0) || 0}%.`
          : `PO ${poNumber} tidak ditemukan.`
      }
      case 'findPODetails': {
        const params = aiDecision.param
        const poNumber = params?.poNumber
        const customerName = params?.customerName
        let foundPOs = []

        if (poNumber) {
          const poMap = new Map()
          allPOs.forEach((po) => {
            if (po.po_number === poNumber) {
              const rev = Number(po.revision_number || 0)
              // @ts-ignore
              if (!poMap.has(po.id) || rev > poMap.get(po.id).revision_number) {
                poMap.set(po.id, po)
              }
            }
          })
          foundPOs = Array.from(poMap.values())
        } else if (customerName) {
          const customerLower = customerName.toLowerCase()
          const poMap = new Map()
          allPOs.forEach((po) => {
            if (po.project_name?.toLowerCase().includes(customerLower)) {
              const rev = Number(po.revision_number || 0)
              // @ts-ignore
              if (!poMap.has(po.id) || rev > poMap.get(po.id).revision_number) {
                poMap.set(po.id, po)
              }
            }
          })
          foundPOs = Array.from(poMap.values())
        }

        if (foundPOs.length === 1) {
          const po = foundPOs[0]
          const itemsSummary = (po.items || [])
            .map(
              (item) =>
                `- ${item.product_name || 'Item Tanpa Nama'} (${item.quantity || 0} ${item.satuan || 'unit'})`
            )
            .join('\n')
          return (
            `✅ PO ditemukan:\n` +
            `Nomor PO: ${po.po_number || 'N/A'}\n` +
            `Customer: ${po.project_name || 'N/A'}\n` +
            `Tgl Masuk: ${formatDate(po.created_at)}\n` + // Menggunakan formatDate() yang diimpor
            `Target Kirim: ${formatDate(po.deadline)}\n` + // Menggunakan formatDate() yang diimpor
            `Status: ${po.status || 'Open'}\n` +
            `Progress: ${po.progress?.toFixed(0) || 0}%\n` +
            `Prioritas: ${po.priority || 'Normal'}\n` +
            `Item:\n${itemsSummary || '(Tidak ada item)'}`
          )
        } else if (foundPOs.length > 1) {
          const poList = foundPOs
            .map((po) => `- ${po.po_number || 'N/A'} (${po.project_name || 'N/A'})`)
            .slice(0, 5)
            .join('\n')
          let response = `Saya menemukan ${foundPOs.length} PO yang cocok:\n${poList}`
          if (foundPOs.length > 5) response += `\n... dan lainnya.`
          response += `\n\nMohon sebutkan nomor PO spesifik yang ingin Anda lihat detailnya.`
          return response
        } else {
          return `Maaf, PO dengan ${poNumber ? 'nomor ' + poNumber : 'customer ' + customerName} tidak ditemukan.`
        }
      }
      case 'getUrgentPOs': {
        const urgentPOs = allPOs.filter(
          (po) => po.priority === 'Urgent' && po.status !== 'Completed' && po.status !== 'Cancelled'
        )
        if (urgentPOs.length > 0) {
          const poNumbers = urgentPOs
            .map((po) => `- ${po.po_number || 'N/A'} (${po.project_name || 'N/A'})`)
            .join('\n')
          return `Ada ${urgentPOs.length} PO aktif dengan prioritas Urgent:\n${poNumbers}`
        }
        return 'Saat ini tidak ada PO aktif dengan prioritas Urgent.'
      }
      case 'getNearingDeadline': {
        const todayDate = new Date()
        const nextWeek = new Date(todayDate.getTime() + 7 * 24 * 60 * 60 * 1000)
        const nearingPOs = allPOs
          .filter((po) => {
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
          .sort((a, b) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime())
        if (nearingPOs.length > 0) {
          const poDetails = nearingPOs
            .map(
              (po) =>
                `- ${po.po_number || 'N/A'} (${po.project_name || 'N/A'}): ${formatDate(po.deadline)}`
            )
            .join('\n')
          return `Ada ${nearingPOs.length} PO aktif yang mendekati deadline (7 hari):\n${poDetails}`
        }
        return 'Tidak ada PO aktif yang mendekati deadline dalam 7 hari ke depan.'
      }
      case 'getNewestPOs': {
        const sortedPOs = [...allPOs].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        const newestPOs = sortedPOs.slice(0, 3)
        const poDetails = newestPOs
          .map(
            (po) =>
              `- ${po.po_number || 'N/A'} (${po.project_name || 'N/A'}), Tgl: ${formatDate(po.created_at)}`
          )
          .join('\n')
        return `Berikut adalah 3 PO terbaru yang masuk:\n${poDetails}`
      }
      case 'getOldestPO': {
        const sortedPOs = [...allPOs].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        const oldestPO = sortedPOs[0]
        if (oldestPO) {
          return `PO terlama yang tercatat adalah:\n- Nomor PO: ${oldestPO.po_number || 'N/A'}\n- Customer: ${oldestPO.project_name || 'N/A'}\n- Tanggal Masuk: ${formatDate(oldestPO.created_at)}`
        }
        return 'Tidak dapat menemukan data PO.'
      }
      case 'getPOsByDateRange': {
        // @ts-ignore
        const { startDate, endDate } = aiDecision
        if (!startDate || !endDate) return 'Maaf, tidak mengerti rentang tanggal.'

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

        const foundPOs = allPOs.filter((po) => {
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
        if (foundPOs.length > 0) {
          const poDetails = foundPOs
            .map(
              (po) =>
                `- ${po.po_number || 'N/A'} (${po.project_name || 'N/A'}), Tgl Masuk: ${formatDate(po.created_at)}`
            )
            .slice(0, 10)
            .join('\n')
          let response = `Saya menemukan ${foundPOs.length} PO untuk ${dateRangeStr}:\n${poDetails}`
          if (foundPOs.length > 10) response += `\n...dan ${foundPOs.length - 10} lainnya.`
          return response
        }
        return `Tidak ada PO ditemukan untuk ${dateRangeStr}.`
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
          (po) =>
            po.status?.toLowerCase() === requestedStatusLower &&
            po.status !== 'Completed' &&
            po.status !== 'Cancelled'
        ).length
        return `Ada ${count} PO dengan status "${displayStatus}".`
      }
      case 'getApplicationHelp': {
        const topic = aiDecision.topic?.toLowerCase() || ''
        if (topic.includes('buat po') || topic.includes('input po')) {
          return "Untuk membuat PO baru:\n1. Klik tombol '+ Tambah PO Baru' di halaman 'Purchase Orders'.\n2. Isi detail PO seperti Nomor PO, Nama Customer, Tanggal Kirim.\n3. Tambahkan minimal satu item di tabel bawah (isi Produk, Ukuran, Qty, dll.).\n4. Klik 'Simpan PO Baru'."
        } else if (topic.includes('update progress')) {
          return "Untuk update progress PO:\n1. Buka halaman 'Progress'.\n2. Cari PO yang ingin diupdate.\n3. Klik tombol 'Update Progress' pada kartu PO tersebut.\n4. Pilih item yang ingin diupdate.\n5. Pilih 'Tahap Berikutnya', tambahkan catatan (opsional), dan unggah foto (opsional).\n6. Klik tombol 'Simpan Progress ke [Nama Tahap]'."
        } else if (topic.includes('revisi po')) {
          return "Untuk merevisi PO yang sudah ada:\n1. Buka halaman 'Purchase Orders'.\n2. Cari PO yang ingin direvisi.\n3. Klik tombol 'Revisi' pada baris tabel PO tersebut.\n4. Form akan terisi data PO terakhir, ubah data header atau item sesuai kebutuhan.\n5. Jika ada foto referensi baru, unggah fotonya.\n6. Klik 'Simpan Revisi'. Anda akan diminta memasukkan nama perevisi."
        } else if (topic.includes('tambah produk')) {
          return "Untuk menambah produk baru ke daftar master:\n1. Saat berada di form Input/Revisi PO, klik tombol '+ Tambah Master Produk' di atas tabel item.\n2. Akan muncul jendela pop-up.\n3. Isi detail produk baru (Nama Produk wajib diisi).\n4. Klik 'Simpan Produk'. Produk baru akan tersedia di daftar dropdown."
        } else {
          return 'Saya bisa membantu menjelaskan cara:\n- Membuat PO baru\n- Update progress PO\n- Revisi PO\n- Menambah produk master.\n\nFitur mana yang ingin Anda ketahui?'
        }
      }
      case 'findPOFile': {
        // @ts-ignore
        const { poNumber, revisionNumber } = aiDecision.param
        if (!poNumber) {
          responseText = 'Mohon sebutkan nomor PO yang ingin Anda cari filenya.'
          break
        }

        // --- AWAL PERUBAHAN ---

        /**
         * Fungsi 'sanitasi' untuk membersihkan string PO.
         * Ini akan:
         * 1. Mengubah ke huruf kecil.
         * 2. Menghapus prefix "po-" atau "po " (jika ada).
         * 3. Menghapus semua spasi dan titik (.).
         * Contoh: "PO-2509 263" -> "2509263"
         * Contoh: "0.2509.263"  -> "02509263"
         * Contoh: "PO-1"        -> "1"
         */
        const sanitizePOString = (str) => {
          if (!str) return ''
          return str
            .toLowerCase()
            .replace(/po-|po /g, '') // Hapus prefix "po-" atau "po "
            .replace(/[ .]/g, '') // Hapus spasi dan titik
        }

        const sanitizedQuery = sanitizePOString(poNumber) // Query Anda yang sudah bersih

        const matchingPOs = allPOs.filter((p) => {
          const sanitizedData = sanitizePOString(p.po_number) // Data sheet yang sudah bersih
          if (!sanitizedData) return false

          // Cek apakah data bersih MENGANDUNG query bersih
          return sanitizedData.includes(sanitizedQuery)
        })
        // --- AKHIR PERUBAHAN ---

        if (matchingPOs.length === 0) {
          responseText = `PO yang cocok dengan '${poNumber}' tidak ditemukan.`
          break
        }

        // --- Sisa logika (pencarian revisi) tetap sama ---
        let foundPO = null
        if (revisionNumber !== undefined && revisionNumber !== null) {
          const revNum = toNum(revisionNumber, -1)
          foundPO = matchingPOs.find((p) => toNum(p.revision_number, -1) === revNum)

          if (!foundPO) {
            foundPO = matchingPOs.sort(
              (a, b) => toNum(b.revision_number, -1) - toNum(a.revision_number, -1)
            )[0]
            responseText = `Tidak menemukan Revisi ${revisionNumber} untuk PO ${poNumber}. Menampilkan file untuk revisi terbaru (Rev ${foundPO.revision_number}):\n`
          } else {
            responseText = `File ditemukan untuk PO ${foundPO.po_number} (Rev ${revNum}):\n`
          }
        } else {
          foundPO = matchingPOs.sort(
            (a, b) => toNum(b.revision_number, -1) - toNum(a.revision_number, -1)
          )[0]
          responseText = `File ditemukan untuk revisi terbaru (Rev ${foundPO.revision_number}):\n`
        }

        // Logika untuk menampilkan link (tetap sama)
        if (foundPO.pdf_link && foundPO.pdf_link.startsWith('http')) {
          responseText += foundPO.pdf_link
        } else if (foundPO.pdf_link) {
          responseText = `Saya menemukan PO ${foundPO.po_number}, tapi link filenya bermasalah: ${foundPO.pdf_link}`
        } else {
          responseText = `Maaf, PO ${foundPO.po_number} (Rev ${foundPO.revision_number}) tidak memiliki link file.`
        }
        break
      }
      case 'getTopSellingProductsChart': {
        // 1. Replikasi logika dari getProductSalesAnalysis (menggunakan allPOs)
        const completedPOs = allPOs.filter((p) => p.status === 'Completed')
        if (completedPOs.length === 0) {
          responseText = 'Belum ada data PO Selesai untuk membuat grafik.'
          break // Fallback ke respons teks
        }

        const salesData = {}
        completedPOs
          .flatMap((p) => p.items || [])
          .forEach((item) => {
            if (item.product_name)
              // @ts-ignore
              salesData[item.product_name] =
                // @ts-ignore
                (salesData[item.product_name] || 0) + Number(item.quantity || 0)
          })

        // 2. Format data untuk chart (ambil Top 5)
        const chartData = Object.entries(salesData)
          // @ts-ignore
          .map(([name, quantity]) => ({ name, Kuantitas: Number(quantity) }))
          .sort((a, b) => b.Kuantitas - a.Kuantitas)
          .slice(0, 5)

        if (chartData.length === 0) {
          responseText = 'Tidak dapat menemukan data penjualan produk untuk membuat grafik.'
          break
        }

        // 3. Buat payload JSON untuk chart
        const chartPayload = {
          type: 'bar', // Tipe chart
          data: chartData, // Data
          dataKey: 'Kuantitas', // Key untuk sumbu Y (harus sama dengan di atas)
          nameKey: 'name' // Key untuk sumbu X
        }

        // 4. SELIPKAN JSON ke dalam responseText dengan delimiter khusus
        responseText = `Tentu, berikut adalah grafik 5 produk terlaris (berdasarkan kuantitas dari PO Selesai):\nCHART_JSON::${JSON.stringify(chartPayload)}`
        break
      }
      case 'help':
        return 'Anda bisa bertanya tentang:\n- Jumlah total PO (detail status aktif)\n- Produk terlaris/Customer terbesar (dari PO Selesai)\n- Status PO [nomor]\n- Detail PO [nomor/nama customer]\n- PO Urgent/Deadline Dekat\n- PO terbaru / terlama\n- PO berdasarkan tanggal\n- Jumlah PO Open / In Progress\n- Cara menggunakan aplikasi (misal: "cara buat po")'
      case 'general': {
        if (prompt.toLowerCase().includes('siapa')) {
          return 'Saya adalah Asisten AI Ubinkayu.'
        }
        if (prompt.toLowerCase().includes('terima kasih')) {
          return 'Sama-sama! Senang bisa membantu.'
        }
        // Menggunakan sapaan berbasis waktu lokal yang sudah dibuat
        return `${timeOfDayGreeting} Ada yang bisa saya bantu?`
      }
      case 'unknown':
        return "Maaf, saya tidak yakin bagaimana harus merespons itu. Coba tanyakan 'bantuan'."
      default:
        console.warn('Menerima tool tidak dikenal dari AI:', aiDecision.tool)
        return 'Maaf, terjadi kesalahan internal saat memproses permintaan Anda (tool tidak dikenal).'
    }
  } catch (execError) {
    console.error('Error saat menjalankan alat:', execError)
    // @ts-ignore
    return `Maaf, terjadi kesalahan saat memproses jawaban: ${execError.message}`
  }
}

// [TAMBAH FUNGSI INI]
async function uploadPoPhoto(photoPath, poNumber, customerName) {
  try {
    if (!fs.existsSync(photoPath)) throw new Error(`File foto tidak ditemukan: ${photoPath}`)

    const auth = getDriveAuth() // Gunakan auth GDrive
    const drive = google.drive({ version: 'v3', auth })

    const fileName = `PO-${poNumber}-${customerName.replace(/[/\\?%*:|"<>]/g, '-')}.jpg`

    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'image/jpeg',
        parents: [PO_PHOTOS_FOLDER_ID]
      },
      media: {
        mimeType: 'image/jpeg',
        body: fs.createReadStream(photoPath)
      },
      fields: 'id, webViewLink, size', // [UBAH] Minta 'size'
      supportsAllDrives: true
    })

    console.log(`✅ Foto referensi PO berhasil diunggah: ${response.data.webViewLink}`)
    // [UBAH] Kembalikan 'size'
    return { success: true, link: response.data.webViewLink, size: response.data.size }
  } catch (error) {
    console.error('❌ Gagal unggah foto referensi PO:', error)
    return { success: false, error: error.message, size: 0 }
  }
}
