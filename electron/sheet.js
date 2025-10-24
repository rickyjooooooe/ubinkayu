import { GoogleSpreadsheet } from 'google-spreadsheet'
import { JWT } from 'google-auth-library'
import path from 'node:path'
import fs from 'node:fs'
import { app, dialog } from 'electron'
import { google } from 'googleapis'
import { generatePOJpeg } from './jpegGenerator.js'
import stream from 'node:stream'

const SPREADSHEET_ID = '1Bp5rETvaAe9nT4DrNpm-WsQqQlPNaau4gIzw1nA5Khk'
const PO_ARCHIVE_FOLDER_ID = '1-1Gw1ay4iQoFNFe2KcKDgCwOIi353QEC'
const PROGRESS_PHOTOS_FOLDER_ID = '1UfUQoqNBSsth9KzGRUmjenwegmsA6hbK'

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

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

const ALIASES = {
  purchase_orders: ['purchase_orders', 'purchase_order'],
  purchase_order_items: ['purchase_order_items', 'po_items'],
  product_master: ['product_master', 'products'],
  progress_tracking: ['purchase_order_items_progress', 'progress']
}

async function getSheet(doc, key) {
  const titles = ALIASES[key] || [key]
  for (const t of titles) {
    if (doc.sheetsByTitle[t]) return doc.sheetsByTitle[t]
  }
  throw new Error(
    `Sheet "${titles[0]}" tidak ditemukan. Pastikan nama sheet di Google Sheets sudah benar.`
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
        fields: 'webViewLink', // Minta hanya webViewLink
        supportsAllDrives: true // Tetap perlu untuk Shared Drive
      }
    })

    const webViewLink = getResponse?.data?.webViewLink
    if (!webViewLink) {
      console.error('❌ Gagal mendapatkan webViewLink via auth.request:', getResponse.data)
      throw new Error('Gagal mendapatkan link file setelah upload berhasil.')
    }
    console.log(`✅ Link file didapatkan via auth.request: ${webViewLink}`)

    return { success: true, link: webViewLink }
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
        lastRevisedDate: lastRevisedDate
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
      pdf_link: 'generating...'
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
      marketing: data.namaMarketing || 'Unknown' // <--- tambahin ini
    }
    console.log('TITIK C (Backend): Meneruskan ke PDF:', poDataForJpeg)
    const uploadResult = await generateAndUploadPO(poDataForJpeg, 0)

    if (uploadResult.success) {
      newPoRow.set('pdf_link', uploadResult.link)
      await newPoRow.save()
    } else {
      newPoRow.set('pdf_link', `ERROR: ${uploadResult.error}`)
      await newPoRow.save()
    }

    return { success: true, poId, revision_number: 0 }
  } catch (err) {
    console.error('❌ saveNewPO error:', err.message)
    return { success: false, error: err.message }
  }
}

export async function updatePO(data) {
  console.log('TITIK B (Backend): Menerima data:', data)
  try {
    const doc = await openDoc()
    const now = new Date().toISOString()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const itemSheet = await getSheet(doc, 'purchase_order_items')

    const latest = await latestRevisionNumberForPO(String(data.poId), doc)
    const prevRow = latest >= 0 ? await getHeaderForRevision(String(data.poId), latest, doc) : null
    const prev = prevRow ? prevRow.toObject() : {}
    const newRev = latest >= 0 ? latest + 1 : 0

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
      revised_by: data.revisedBy || 'Unknown' // <--
    })

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

    if (data.poPhotoBase64) {
      console.log(`[updatePO] 📸 Terdeteksi foto baru (base64), membuat JPEG baru...`)

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
        poPhotoBase64: data.poPhotoBase64,

        marketing: data.acc_marketing
      }

      const uploadResult = await generateAndUploadPO(poDataForJpeg, newRev)

      if (uploadResult.success) {
        newRevisionRow.set('pdf_link', uploadResult.link)
      } else {
        newRevisionRow.set('pdf_link', `ERROR: ${uploadResult.error}`)
      }
      await newRevisionRow.save()
    } else {
      console.log(
        `[updatePO] 🖼️ Tidak ada foto baru. Menyalin link dari revisi ${latest}: ${prev.pdf_link}`
      )

      newRevisionRow.set('pdf_link', prev.pdf_link || null)
      await newRevisionRow.save()
    }

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

export async function getProductSalesAnalysis() {
  try {
    const doc = await openDoc()
    const itemSheet = await getSheet(doc, 'purchase_order_items')
    const poSheet = await getSheet(doc, 'purchase_orders')
    const productSheet = await getSheet(doc, 'product_master')

    const [itemRows, poRows, productRows] = await Promise.all([
      itemSheet.getRows(),
      poSheet.getRows(),
      productSheet.getRows()
    ])

    const poMap = new Map()
    poRows.forEach((r) => {
      const poId = r.get('id')
      const rev = toNum(r.get('revision_number'))
      if (!poMap.has(poId) || rev > poMap.get(poId).revision_number) {
        poMap.set(poId, r.toObject())
      }
    })

    const salesData = {}
    const salesByDate = []
    const woodTypeData = {}
    const customerData = {}

    itemRows.forEach((item) => {
      const productName = item.get('product_name')
      const quantity = toNum(item.get('quantity'), 0)
      const woodType = item.get('wood_type')
      const kubikasi = toNum(item.get('kubikasi'), 0)
      const poId = item.get('purchase_order_id')
      const po = poMap.get(poId)

      if (!productName || !po) return

      if (!salesData[productName]) {
        salesData[productName] = { totalQuantity: 0, name: productName }
      }
      salesData[productName].totalQuantity += quantity

      salesByDate.push({
        date: new Date(po.created_at),
        name: productName,
        quantity: quantity
      })

      if (woodType) {
        woodTypeData[woodType] = (woodTypeData[woodType] || 0) + quantity
      }

      const customerName = po.project_name
      if (customerName) {
        customerData[customerName] = (customerData[customerName] || 0) + kubikasi
      }
    })

    const topSellingProducts = Object.values(salesData)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 10)

    const woodTypeDistribution = Object.keys(woodTypeData)
      .map((name) => ({
        name,
        value: woodTypeData[name]
      }))
      .sort((a, b) => b.value - a.value)

    const topCustomers = Object.keys(customerData)
      .map((name) => ({
        name,
        totalKubikasi: customerData[name]
      }))
      .sort((a, b) => b.totalKubikasi - a.totalKubikasi)
      .slice(0, 5)

    const today = new Date()
    const thirtyDaysAgo = new Date(new Date().setDate(today.getDate() - 30))
    const sixtyDaysAgo = new Date(new Date().setDate(today.getDate() - 60))

    const salesLast30 = {}
    const salesPrev30 = {}

    salesByDate.forEach((sale) => {
      if (sale.date >= thirtyDaysAgo) {
        salesLast30[sale.name] = (salesLast30[sale.name] || 0) + sale.quantity
      } else if (sale.date >= sixtyDaysAgo) {
        salesPrev30[sale.name] = (salesPrev30[sale.name] || 0) + sale.quantity
      }
    })

    const trendingProducts = Object.keys(salesLast30)
      .map((name) => {
        const last30 = salesLast30[name]
        const prev30 = salesPrev30[name] || 0
        const change = prev30 === 0 && last30 > 0 ? 100 : ((last30 - prev30) / (prev30 || 1)) * 100
        return { name, last30, prev30, change }
      })
      .filter((p) => p.change > 20 && p.last30 > p.prev30)
      .sort((a, b) => b.change - a.change)

    const allProductNames = productRows.map((r) => r.get('product_name'))
    const soldProductNames = new Set(Object.keys(salesData))
    const neverSoldProducts = allProductNames.filter((name) => !soldProductNames.has(name))

    return {
      topSellingProducts,
      woodTypeDistribution,
      topCustomers,
      trendingProducts,
      slowMovingProducts: neverSoldProducts
    }
  } catch (err) {
    console.error('❌ Gagal melakukan analisis penjualan produk:', err.message)
    return {
      topSellingProducts: [],
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

export async function handleOllamaChat(prompt) {
  // 1. Dapatkan data PO (konteks)
  let allPOs
  try {
    allPOs = await listPOs() // Panggil fungsi listPOs yang sudah ada
    if (!allPOs || allPOs.length === 0) {
      return 'Maaf, data PO belum tersedia untuk dianalisis.'
    }
  } catch (e) {
    console.error('Gagal mengambil data PO untuk konteks AI:', e.message)
    return 'Maaf, saya gagal mengambil data PO terbaru untuk menjawab pertanyaan Anda.'
  }

  // 2. Siapkan System Prompt untuk "Tool Use"
  const today = new Date().toISOString().split('T')[0] // Dapatkan tanggal hari ini (YYYY-MM-DD)

  const systemPrompt = `Anda adalah Asisten ERP Ubinkayu. Tugas Anda adalah mengubah pertanyaan pengguna menjadi JSON 'perintah' berdasarkan alat (tools) yang tersedia.
  Hari ini adalah ${today}.

  Alat (Tools) yang Tersedia:
  1. "getTotalPO": Menghitung jumlah total PO, PO aktif, dan PO selesai.
     - Keywords: "jumlah po", "total po", "ada berapa po", "how many purchase orders".
     - JSON: {"tool": "getTotalPO"}
  2. "getTopProduct": Menemukan produk terlaris dari PO yang sudah selesai.
     - Keywords: "produk terlaris", "paling laku", "best selling product".
     - JSON: {"tool": "getTopProduct"}
  3. "getTopCustomer": Menemukan customer terbesar (volume m³) dari PO yang sudah selesai.
     - Keywords: "customer terbesar", "top customer", "biggest customer".
     - JSON: {"tool": "getTopCustomer"}
  4. "getPOStatus": Mencari status PO berdasarkan nomor.
     - Keywords: "status po", "cek po", "check purchase order", "find po [nomor]".
     - AI HARUS mengekstrak "param" (nomor PO).
     - JSON: {"tool": "getPOStatus", "param": "NOMOR_PO_DI_SINI"}
  5. "getUrgentPOs": Menampilkan daftar PO aktif yang urgent.
     - Keywords: "po urgent", "urgent orders".
     - JSON: {"tool": "getUrgentPOs"}
  6. "getNearingDeadline": Menampilkan PO aktif yang akan deadline (dalam 7 hari).
     - Keywords: "deadline dekat", "nearing deadline", "akan jatuh tempo".
     - JSON: {"tool": "getNearingDeadline"}
  7. "getNewestPOs": Menampilkan 3 PO yang baru saja dibuat.
     - Keywords: "po terbaru", "order terbaru", "newest po".
     - JSON: {"tool": "getNewestPOs"}
  8. "getOldestPO": Menampilkan PO terlama.
     - Keywords: "po terlama", "order pertama", "oldest po".
     - JSON: {"tool": "getOldestPO"}
  9. "getPOsByDateRange": Mencari PO berdasarkan rentang tanggal masuk.
     - Keywords: "po bulan oktober", "po tanggal 20 okt", "po minggu lalu", "po 2025".
     - AI HARUS mengekstrak 'startDate' dan 'endDate' dalam format YYYY-MM-DD. Gunakan ${today} sebagai referensi.
     - Jika hanya satu tanggal (misal "po 20 oktober 2025"), 'startDate' dan 'endDate' harus sama ("2025-10-20").
     - JSON: {"tool": "getPOsByDateRange", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}
  10. "help": Memberikan bantuan.
      - Keywords: "bantuan", "help", "apa yang bisa kamu lakukan", "perintah".
      - JSON: {"tool": "help"}
  11. "general": Untuk pertanyaan umum (misal: "kamu siapa?", "halo", "terima kasih").
      - Keywords: "halo", "kamu siapa", "dengan siapa ini", "terima kasih".
      - JSON: {"tool": "general"}

  ATURAN KETAT:
  - JANGAN menjawab pertanyaan secara langsung.
  - HANYA kembalikan JSON.
  - Jika pertanyaan "po bulan oktober ini", AI harus mengerti ini tahun 2025 dan kembalikan: {"tool": "getPOsByDateRange", "startDate": "2025-10-01", "endDate": "2025-10-31"}
  - Jika pertanyaan "po terbaru", kembalikan: {"tool": "getNewestPOs"}
  - Jika pertanyaan "halo", kembalikan: {"tool": "general"}
  - Jika tidak yakin, kembalikan: {"tool": "unknown"}
  `

  // 3. Panggil Ollama HANYA untuk klasifikasi
  let aiDecision
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'phi3:latest', // Gunakan model ringan dan cepat (phi3)
        prompt: `Pertanyaan Pengguna: "${prompt}"\n\nJSON Perintah:`,
        system: systemPrompt,
        stream: false,
        format: 'json' // Minta Ollama MENGEMBALIKAN JSON
      })
    })
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`Ollama API error: ${errorData.error || response.statusText}`)
    }
    const data = await response.json()
    aiDecision = JSON.parse(data.response) // Parse jawaban JSON dari AI
  } catch (err) {
    console.error('Error klasifikasi Ollama:', err)
    if (
      err.message &&
      (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed'))
    ) {
      return "Koneksi ke server AI Ollama gagal. Pastikan Ollama sudah berjalan (jalankan 'ollama serve' di terminal)."
    }
    return `Maaf, terjadi kesalahan saat memahami permintaan Anda: ${err.message}`
  }

  // 4. Jalankan Alat (Tools) di JavaScript berdasarkan keputusan AI
  try {
    switch (aiDecision.tool) {
      case 'getTotalPO': {
        const totalPOs = allPOs.length
        const activePOs = allPOs.filter(
          (po) => po.status !== 'Completed' && po.status !== 'Cancelled'
        ).length
        const completedPOs = allPOs.filter((po) => po.status === 'Completed').length
        return `Saat ini ada ${totalPOs} total PO di database.\n\n- ${activePOs} PO sedang aktif.\n- ${completedPOs} PO sudah selesai.`
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
        if (!poNumber) return 'Mohon sebutkan nomor PO yang ingin dicek (contoh: status po 123).'
        const latestPO = allPOs
          .filter((po) => po.po_number === poNumber)
          .sort((a, b) => Number(b.revision_number || 0) - Number(a.revision_number || 0))[0]
        return latestPO
          ? `Status PO ${poNumber} (${latestPO.project_name}) adalah: ${latestPO.status || 'Open'}. Progress: ${latestPO.progress?.toFixed(0) || 0}%.`
          : `PO ${poNumber} tidak ditemukan.`
      }

      case 'getUrgentPOs': {
        const urgentPOs = allPOs.filter(
          (po) => po.priority === 'Urgent' && po.status !== 'Completed' && po.status !== 'Cancelled'
        )
        if (urgentPOs.length > 0) {
          const poNumbers = urgentPOs
            .map((po) => `- ${po.po_number} (${po.project_name})`)
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
              return new Date(po.deadline) >= todayDate && new Date(po.deadline) <= nextWeek
            } catch (e) {
              return false
            }
          })
          .sort((a, b) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime())

        if (nearingPOs.length > 0) {
          const poDetails = nearingPOs
            .map((po) => `- ${po.po_number} (${po.project_name}): ${formatDate(po.deadline)}`)
            .join('\n')
          return `Ada ${nearingPOs.length} PO aktif yang mendekati deadline (7 hari):\n${poDetails}`
        }
        return 'Tidak ada PO aktif yang mendekati deadline dalam 7 hari ke depan.'
      }

      case 'getNewestPOs': {
        const sortedPOs = [...allPOs].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        const newestPOs = sortedPOs.slice(0, 3) // Ambil 3 terbaru
        const poDetails = newestPOs
          .map((po) => `- ${po.po_number} (${po.project_name}), Tgl: ${formatDate(po.created_at)}`)
          .join('\n')
        return `Berikut adalah 3 PO terbaru yang masuk:\n${poDetails}`
      }

      case 'getOldestPO': {
        const sortedPOs = [...allPOs].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        const oldestPO = sortedPOs[sortedPOs.length - 1] // Ambil yang terakhir (paling lama)
        if (oldestPO) {
          return `PO terlama yang tercatat adalah:\n- Nomor PO: ${oldestPO.po_number}\n- Customer: ${oldestPO.project_name}\n- Tanggal Masuk: ${formatDate(oldestPO.created_at)}`
        }
        return 'Tidak dapat menemukan data PO.'
      }

      case 'getPOsByDateRange': {
        const { startDate, endDate } = aiDecision
        if (!startDate || !endDate) {
          return "Maaf, saya tidak mengerti rentang tanggal yang Anda maksud. Coba lagi (misal: 'po bulan oktober')."
        }
        const start = new Date(startDate).getTime()
        const end = new Date(endDate).getTime() + (24 * 60 * 60 * 1000 - 1) // Set ke akhir hari

        const foundPOs = allPOs.filter((po) => {
          try {
            const poDate = new Date(po.created_at).getTime()
            return poDate >= start && poDate <= end
          } catch (e) {
            return false
          }
        })

        if (foundPOs.length > 0) {
          const poDetails = foundPOs
            .map(
              (po) =>
                `- ${po.po_number} (${po.project_name}), Tgl Masuk: ${formatDate(po.created_at)}`
            )
            .slice(0, 10)
            .join('\n') // Batasi 10

          const dateRangeStr =
            startDate === endDate
              ? formatDate(startDate)
              : `${formatDate(startDate)} s/d ${formatDate(endDate)}`
          let response = `Saya menemukan ${foundPOs.length} PO untuk rentang tanggal ${dateRangeStr}:\n${poDetails}`
          if (foundPOs.length > 10) response += `\n...dan ${foundPOs.length - 10} lainnya.`
          return response
        }
        return `Tidak ada PO yang ditemukan untuk rentang tanggal ${dateRangeStr}.`
      }

      case 'help':
        return 'Anda bisa bertanya tentang:\n- Jumlah total PO\n- Produk terlaris\n- Customer terbesar\n- Status PO [nomor PO]\n- PO Urgent\n- PO Deadline Dekat\n- PO terbaru / terlama\n- PO berdasarkan tanggal'

      case 'general':
        if (prompt.toLowerCase().includes('siapa')) {
          return 'Saya adalah Asisten AI Ubinkayu, siap membantu Anda.'
        }
        if (prompt.toLowerCase().includes('terima kasih')) {
          return 'Sama-sama! Senang bisa membantu.'
        }
        return 'Halo! Ada yang bisa saya bantu?'

      default: // Termasuk jika aiDecision.tool adalah "unknown"
        return "Maaf, saya tidak yakin bagaimana harus merespons itu. Coba tanyakan 'bantuan' untuk melihat apa yang bisa saya lakukan."
    }
  } catch (execError) {
    console.error('Error saat menjalankan alat:', execError)
    return 'Maaf, terjadi kesalahan saat memproses jawaban Anda.'
  }
}
