/* eslint-disable no-irregular-whitespace */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

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
    // @ts-ignore
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
    // @ts-ignore
    .filter((r) => String(r.get('id')).trim() === String(poId).trim())
    // @ts-ignore
    .map((r) => toNum(r.get('revision_number'), -1))
  return nums.length ? Math.max(...nums) : -1
}

async function getHeaderForRevision(poId, rev, doc) {
  const sh = await getSheet(doc, 'purchase_orders')
  const rows = await sh.getRows()
  return (
    rows.find(
      (r) =>
        // @ts-ignore
        String(r.get('id')).trim() === String(poId).trim() &&
        // @ts-ignore
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
        // @ts-ignore
        String(r.get('purchase_order_id')).trim() === String(poId).trim() &&
        // @ts-ignore
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
      (row) => row.get(usernameHeader)?.trim().toLowerCase() === trimmedUsernameLower
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
  } catch (err) {
    // @ts-ignore
    console.error('💥 [Electron Login] ERROR:', err.message, err.stack)
    return {
      success: false,
      error: 'Terjadi kesalahan pada server saat login.',
      // @ts-ignore
      details: err.message
    }
  }
}

async function generateAndUploadPO(poData, revisionNumber) {
  let auth
  let filePath

  try {
    // @ts-ignore
    const pdfResult = await generatePOJpeg(poData, revisionNumber, false)
    if (!pdfResult.success || !pdfResult.path) {
      throw new Error('Gagal membuat file JPEG lokal atau path tidak ditemukan.')
    }
    filePath = pdfResult.path

    if (!fs.existsSync(filePath)) {
      throw new Error(`File JPEG tidak ditemukan di path: ${filePath}`)
    }

    console.log('🔄 Mendapatkan otentikasi baru sebelum upload/get...')
    auth = getAuth()
    await auth.authorize()
    console.log('✅ Otorisasi ulang berhasil.')

    const fileName = path.basename(filePath)
    const mimeType = 'image/jpeg'

    console.log(`🚀 Mengunggah file via auth.request: ${fileName} ke Drive...`)

    const fileStream = fs.createReadStream(filePath)
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
  } catch (error) {
    // @ts-ignore
    console.error('❌ Proses Generate & Upload PO Gagal:', error.message)
    // @ts-ignore
    if (error.response && error.response.data && error.response.data.error) {
      // @ts-ignore
      console.error(
        '   -> Detail Error Google API:',
        // @ts-ignore
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
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
        console.log(`🗑️ File lokal ${path.basename(filePath)} dihapus.`)
      } catch (unlinkErr) {
        // @ts-ignore
        console.warn(`⚠️ Gagal menghapus file lokal ${path.basename(filePath)}:`, unlinkErr.message)
      }
    }
  }
}

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

async function processBatch(items, processor, batchSize = 5) {
  const results = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(batch.map(processor))
    results.push(
      ...batchResults.map((result) =>
        result.status === 'fulfilled'
          ? result.value
          : // @ts-ignore
            { success: false, error: result.reason?.message || 'Unknown error' }
      )
    )

    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  return results
}

async function deleteGoogleDriveFile(fileId) {
  try {
    if (!fileId) {
      return { success: false, error: 'File ID tidak valid', fileId }
    }
    const auth = getAuth()
    await auth.authorize()
    console.log(`🔑 Otorisasi ulang untuk menghapus file ${fileId} berhasil.`)

    const drive = google.drive({ version: 'v3', auth })

    await drive.files.delete({
      fileId: fileId,
      supportsAllDrives: true
    })

    console.log(`✅ File berhasil dihapus dari Google Drive: ${fileId}`)
    return { success: true, fileId }
  } catch (error) {
    // @ts-ignore
    console.error(`❌ Gagal menghapus file dari Google Drive (${fileId}):`, error.message)
    // @ts-ignore
    const apiError = error.response?.data?.error || {}
    // @ts-ignore
    if (error.code === 404 || apiError.code === 404) {
      console.log(`ℹ️ File ${fileId} tidak ditemukan (404), dianggap sudah terhapus.`)
      return { success: true, fileId }
    }
    // @ts-ignore
    if (error.code === 401 || error.code === 403 || apiError.code === 401 || apiError.code === 403) {
      console.error(`🚫 Akses Ditolak/Otentikasi Gagal untuk ${fileId}.`)
      return {
        success: false,
        // @ts-ignore
        error: `Akses Ditolak/Login Gagal: ${apiError.message || error.message}`,
        fileId
      }
    }
    // @ts-ignore
    return { success: false, error: error.message || String(error), fileId }
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
      fields: 'id, webViewLink, name, size',
      supportsAllDrives: true
    })
    return {
      success: true,
      link: response.data.webViewLink,
      name: response.data.name,
      size: response.data.size
    }
  } catch (error) {
    // @ts-ignore
    console.error('❌ Gagal unggah foto progress:', error)
    // @ts-ignore
    return { success: false, error: error.message, size: 0 }
  }
}

export async function testSheetConnection() {
  try {
    const doc = await openDoc()
    console.log(`✅ Tes koneksi OK: "${doc.title}"`)
  } catch (err) {
    // @ts-ignore
    console.error('❌ Gagal tes koneksi ke Google Sheets:', err.message)
  }
}

export async function listPOs() {
  try {
    const doc = await openDoc()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const itemSheet = await getSheet(doc, 'purchase_order_items')
    const progressSheet = await getSheet(doc, 'progress_tracking')

    const rawPoRows = await poSheet.getRows()
    const rawItemRows = await itemSheet.getRows()
    const rawProgressRows = await progressSheet.getRows()

    const poRows = rawPoRows.map((r) => r.toObject())
    const itemRows = rawItemRows.map((r) => r.toObject())
    const progressRows = rawProgressRows.map((r) => r.toObject())

    const byId = new Map()
    for (const r of poRows) {
      const id = String(r.id).trim()
      // @ts-ignore
      const rev = toNum(r.revision_number, -1)
      const keep = byId.get(id)
      if (!keep || rev > keep.rev) byId.set(id, { rev, row: r })
    }
    const latestPoObjects = Array.from(byId.values()).map(({ row }) => row)

    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      // @ts-ignore
      const key = `${row.purchase_order_id}-${row.purchase_order_item_id}`
      if (!acc[key]) acc[key] = []
      // @ts-ignore
      acc[key].push({ stage: row.stage, created_at: row.created_at })
      return acc
    }, {})

    const latestItemRevisions = itemRows.reduce((acc, item) => {
      // @ts-ignore
      const poId = item.purchase_order_id
      // @ts-ignore
      const rev = toNum(item.revision_number, -1)
      if (!acc.has(poId) || rev > acc.get(poId)) {
        acc.set(poId, rev)
      }
      return acc
    }, new Map())

    const result = latestPoObjects.map((poObject) => {
      // @ts-ignore
      const poId = poObject.id
      // @ts-ignore
      const lastRevisedBy = poObject.revised_by || 'N/A'
      // @ts-ignore
      const lastRevisedDate = poObject.created_at

      const latestRev = latestItemRevisions.get(poId) ?? -1
      const poItems = itemRows.filter(
        (item) =>
          // @ts-ignore
          item.purchase_order_id === poId && toNum(item.revision_number, -1) === latestRev
      )

      let poProgress = 0
      // @ts-ignore
      let finalStatus = poObject.status || 'Open'
      let completed_at = null

      if (poItems.length > 0) {
        let totalPercentage = 0
        poItems.forEach((item) => {
          // @ts-ignore
          const itemId = item.id
          const compositeKey = `${poId}-${itemId}`
          // @ts-ignore
          const itemProgressHistory = progressByCompositeKey[compositeKey] || []
          let latestStageIndex = -1

          if (itemProgressHistory.length > 0) {
            const latestProgress = itemProgressHistory.sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )[0]
            // @ts-ignore
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
            // @ts-ignore
            .filter((row) => row.purchase_order_id === poId)
            // @ts-ignore
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

      return {
        ...poObject,
        items: poItems,
        progress: roundedProgress,
        status: finalStatus,
        completed_at: completed_at,
        // @ts-ignore
        pdf_link: poObject.pdf_link || null,
        lastRevisedBy: lastRevisedBy,
        lastRevisedDate: lastRevisedDate,
        // @ts-ignore
        acc_marketing: poObject.acc_marketing || '',
        // @ts-ignore
        file_size_bytes: poObject.file_size_bytes || 0
      }
    })

    return result
  } catch (err) {
    // @ts-ignore
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
    let totalFileSize = 0

    const newPoRow = await poSheet.addRow({
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

    if (data.poPhotoPath) {
      console.log('Mengunggah foto referensi PO...')
      const photoResult = await uploadPoPhoto(data.poPhotoPath, data.nomorPo, data.namaCustomer)
      if (photoResult.success) {
        newPoRow.set('foto_link', photoResult.link)
        // @ts-ignore
        newPoRow.set('foto_file_name', photoResult.name || '')
        // @ts-ignore
        totalFileSize += Number(photoResult.size || 0)
      } else {
        // @ts-ignore
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
      // @ts-ignore
      newPoRow.set('pdf_file_name', uploadResult.name || '')
      // @ts-ignore
      totalFileSize += Number(uploadResult.size || 0)
    } else {
      // @ts-ignore
      newPoRow.set('pdf_link', `ERROR: ${uploadResult.error}`)
      newPoRow.set('pdf_file_name', '')
    }

    newPoRow.set('file_size_bytes', totalFileSize)
    await newPoRow.save()
    return { success: true, poId, revision_number: 0 }
  } catch (err) {
    // @ts-ignore
    console.error('❌ saveNewPO error:', err.message)
    // @ts-ignore
    return { success: false, error: err.message }
  }
}

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

    let totalFileSize = 0
    // @ts-ignore
    let fotoLink = prev.foto_link || 'Tidak ada foto'
    let fotoSize = 0
    // @ts-ignore
    let fotoFileName = prev.foto_file_name || ''

    const newRevisionRow = await poSheet.addRow({
      id: String(data.poId),
      revision_number: newRev,
      // @ts-ignore
      po_number: data.nomorPo ?? prev.po_number ?? '',
      // @ts-ignore
      project_name: data.namaCustomer ?? prev.project_name ?? '',
      // @ts-ignore
      deadline: data.tanggalKirim ?? prev.deadline ?? null,
      // @ts-ignore
      status: data.status ?? prev.status ?? 'Open',
      // @ts-ignore
      priority: data.prioritas ?? prev.priority ?? 'Normal',
      // @ts-ignore
      notes: data.catatan ?? prev.notes ?? '',
      // @ts-ignore
      kubikasi_total: data.kubikasi_total ?? prev.kubikasi_total ?? 0,
      // @ts-ignore
      acc_marketing: data.marketing ?? prev.acc_marketing ?? '',
      created_at: now,
      pdf_link: 'generating...',
      pdf_file_name: '',
      foto_link: '...',
      foto_file_name: fotoFileName,
      file_size_bytes: 0,
      revised_by: data.revisedBy || 'Unknown',
      // @ts-ignore
      alamat_kirim: data.alamatKirim ?? prev.alamat_kirim ?? ''
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

    if (data.poPhotoPath) {
      console.log(`[updatePO] 📸 Terdeteksi foto referensi baru, mengunggah...`)
      const photoResult = await uploadPoPhoto(data.poPhotoPath, data.nomorPo, data.namaCustomer)
      if (photoResult.success) {
        fotoLink = photoResult.link
        // @ts-ignore
        fotoSize = Number(photoResult.size || 0)
        // @ts-ignore
        fotoFileName = photoResult.name || ''
      } else {
        // @ts-ignore
        fotoLink = `ERROR: ${photoResult.error}`
        fotoFileName = ''
      }
    } else {
      console.log(`[updatePO] 🖼️ Tidak ada foto referensi baru, mewariskan link lama: ${fotoLink}`)
      // @ts-ignore
      totalFileSize = Number(prev.file_size_bytes || 0)
    }

    const poDataForJpeg = {
      // @ts-ignore
      po_number: data.nomorPo ?? prev.po_number,
      // @ts-ignore
      project_name: data.namaCustomer ?? prev.project_name,
      // @ts-ignore
      deadline: data.tanggalKirim ?? prev.deadline,
      // @ts-ignore
      priority: data.prioritas ?? prev.priority,
      items: itemsWithIds,
      // @ts-ignore
      notes: data.catatan ?? prev.notes,
      created_at: now,
      // @ts-ignore
      kubikasi_total: data.kubikasi_total ?? prev.kubikasi_total ?? 0,
      poPhotoPath: data.poPhotoPath,
      foto_link: fotoLink,
      // @ts-ignore
      marketing: data.marketing ?? prev.acc_marketing,
      // @ts-ignore
      alamat_kirim: data.alamatKirim ?? prev.alamat_kirim ?? ''
    }

    const uploadResult = await generateAndUploadPO(poDataForJpeg, newRev)

    let jpegSize = 0
    if (uploadResult.success) {
      newRevisionRow.set('pdf_link', uploadResult.link)
      // @ts-ignore
      newRevisionRow.set('pdf_file_name', uploadResult.name || '')
      // @ts-ignore
      jpegSize = Number(uploadResult.size || 0)
    } else {
      // @ts-ignore
      newRevisionRow.set('pdf_link', `ERROR: ${uploadResult.error}`)
      // @ts-ignore
      newRevisionRow.set('pdf_file_name', prev.pdf_file_name || '')
    }

    if (data.poPhotoPath) {
      totalFileSize = fotoSize + jpegSize
    } else {
      totalFileSize = fotoSize + jpegSize
      if (totalFileSize === 0 && !data.poPhotoPath) {
        // @ts-ignore
        totalFileSize = Number(prev.file_size_bytes || 0)
      }
    }

    newRevisionRow.set('foto_link', fotoLink)
    newRevisionRow.set('foto_file_name', fotoFileName)
    newRevisionRow.set('file_size_bytes', totalFileSize)
    await newRevisionRow.save()

    return { success: true, revision_number: newRev }
  } catch (err) {
    // @ts-ignore
    console.error('❌ updatePO error:', err.message)
    // @ts-ignore
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
    const fileIdToName = new Map()

    toDelHdr.forEach((poRow) => {
      const pdfLink = poRow.get('pdf_link')
      const pdfName = poRow.get('pdf_file_name') || null
      if (pdfLink && !pdfLink.startsWith('ERROR:') && !pdfLink.includes('generating')) {
        const fileId = extractGoogleDriveFileId(pdfLink)
        if (fileId) {
          fileIds.add(fileId)
          if (pdfName) fileIdToName.set(fileId, pdfName)
        }
      }

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
          console.log(`Found foto_link to delete: ${fileId}`)
        }
      }
    })

    poProgressRows.forEach((progressRow) => {
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
    let failedFiles = []

    if (uniqueFileIds.length > 0) {
      console.log(`🗂️ Menghapus ${uniqueFileIds.length} file dari Google Drive dalam batch...`)

      const deleteResults = await processBatch(uniqueFileIds, deleteGoogleDriveFile, 5)

      deleteResults.forEach((result) => {
        if (result.success) {
          deletedFilesCount++
        } else {
          failedFilesCount++
          // @ts-ignore
          const name = fileIdToName.get(result.fileId) || null
          // @ts-ignore
          failedFiles.push({ fileId: result.fileId, fileName: name, error: result.error })
          // @ts-ignore
          console.warn(
            `⚠️ Gagal menghapus file ${result.fileId} (${name || 'unknown name'}): ${result.error}`
          )
        }
      })
    }

    console.log(`📄 Menghapus data dari spreadsheet...`)
    const sheetDeletions = []
    poProgressRows.reverse().forEach((row) => sheetDeletions.push(row.delete()))
    toDelHdr.reverse().forEach((row) => sheetDeletions.push(row.delete()))
    toDelItems.reverse().forEach((row) => sheetDeletions.push(row.delete()))
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
    // @ts-ignore
    const endTime = Date.now()
    const duration = ((endTime - startTime) / 1000).toFixed(1)
    // @ts-ignore
    console.error(`❌ Gagal menghapus PO ID ${poId} setelah ${duration}s:`, err.message)
    // @ts-ignore
    return { success: false, error: err.message, duration: `${duration}s` }
  }
}

export async function listPOItems(poId) {
  try {
    const doc = await openDoc()
    return await getLivePOItems(String(poId), doc)
  } catch (err) {
    // @ts-ignore
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
      // @ts-ignore
      .filter((r) => String(r.get('id')).trim() === String(poId).trim())
      .map((r) => r.toObject())
      // @ts-ignore
      .sort((a, b) => a.revision_number - b.revision_number)
  } catch (err) {
    // @ts-ignore
    console.error('❌ listPORevisions error:', err.message)
    return []
  }
}

export async function listPOItemsByRevision(poId, revisionNumber) {
  try {
    const doc = await openDoc()
    // @ts-ignore
    return await getItemsByRevision(String(poId), toNum(revisionNumber, 0), doc)
  } catch (err) {
    // @ts-ignore
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
    // @ts-ignore
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
      poPhotoPath: data.poPhotoPath,
      marketing: data.marketing || 'Unknown',
      alamat_kirim: data.alamatKirim || ''
    }
    // @ts-ignore
    return await generatePOJpeg(poData, 'preview', true)
  } catch (err) {
    // @ts-ignore
    console.error('❌ previewPO error:', err.message)
    // @ts-ignore
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
            // @ts-ignore
            String(r.get('purchase_order_id')) === String(poId) &&
            // @ts-ignore
            toNum(r.get('revision_number'), -1) === toNum(m.revision_number, -1)
        )
        .map((r) => r.toObject())
    }))
    // @ts-ignore
    history.sort((a, b) => b.revision.revision_number - a.revision.revision_number)
    return history
  } catch (err) {
    // @ts-ignore
    console.error('❌ getRevisionHistory error:', err.message)
    return []
  }
}

export async function updateItemProgress(data) {
  let auth
  let photoLink = null // ⬅️ PERBAIKAN
  let photoName = null
  let filePath = null // ⬅️ PERBAIKAN
  const { poId, itemId, poNumber, stage, notes, photoPath } = data

  try {
    if (photoPath) {
      filePath = photoPath
      if (!fs.existsSync(filePath)) {
        throw new Error(`File foto tidak ditemukan: ${filePath}`)
      }

      console.log('🔄 Mendapatkan otentikasi baru sebelum upload foto progress...')
      auth = getAuth()
      await auth.authorize()
      console.log('✅ Otorisasi ulang berhasil.')

      const fileName = `PO-${poNumber}_ITEM-${itemId}_${new Date()
        .toISOString()
        .replace(/:/g, '-')}.jpg`
      const mimeType = 'image/jpeg'

      console.log(`🚀 Mengunggah foto progress via auth.request: ${fileName} ke Drive...`)

      const fileStream = fs.createReadStream(filePath)
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
      photo_url: photoLink, // ⬅️ PERBAIKAN
      photo_file_name: photoName || '',
      created_at: new Date().toISOString()
    })
    console.log(`✅ Log progress untuk item ID ${itemId} berhasil disimpan ke Sheet.`)

    return { success: true }
  } catch (err) {
    // @ts-ignore
    console.error('❌ Gagal update item progress:', err.message)
    // @ts-ignore
    if (err.response && err.response.data && err.response.data.error) {
      // @ts-ignore
      console.error(
        '   -> Detail Error Google API:',
        // @ts-ignore
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
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
        console.log(`🗑️ File foto lokal ${path.basename(filePath)} dihapus.`)
      } catch (unlinkErr) {
        // @ts-ignore
        console.warn(
          `⚠️ Gagal menghapus file foto lokal ${path.basename(filePath)}:`,
          // @ts-ignore
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

    const byId = new Map()
    for (const r of poRows) {
      const id = String(r.get('id')).trim()
      // @ts-ignore
      const rev = toNum(r.get('revision_number'), -1)
      // @ts-ignore
      if (!byId.has(id) || rev > byId.get(id).rev) {
        byId.set(id, { rev, row: r })
      }
    }
    const latestPoRows = Array.from(byId.values()).map(({ row }) => row)

    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      // @ts-ignore
      const key = `${row.get('purchase_order_id')}-${row.get('purchase_order_item_id')}`
      if (!acc[key]) acc[key] = []
      // @ts-ignore
      acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
      return acc
    }, {})

    const latestItemRevisions = itemRows.reduce((acc, item) => {
      // @ts-ignore
      const poId = item.get('purchase_order_id')
      // @ts-ignore
      const rev = toNum(item.get('revision_number'), -1)
      if (!acc.has(poId) || rev > acc.get(poId)) {
        acc.set(poId, rev)
      }
      return acc
    }, new Map())

    const allPOsWithCalculatedStatus = latestPoRows.map((po) => {
      const poId = po.get('id')
      const latestRev = latestItemRevisions.get(poId) ?? -1
      const poItems = itemRows.filter(
        (item) =>
          item.get('purchase_order_id') === poId &&
          // @ts-ignore
          toNum(item.get('revision_number'), -1) === latestRev
      )

      let totalPercentage = 0
      if (poItems.length > 0) {
        poItems.forEach((item) => {
          const itemId = item.get('id')
          // @ts-ignore
          const itemProgressHistory = progressByCompositeKey[`${poId}-${itemId}`] || []
          let latestStageIndex = -1
          if (itemProgressHistory.length > 0) {
            const latestProgress = [...itemProgressHistory].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )[0]
            // @ts-ignore
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
      (po) => po.status !== 'Completed' && po.status !== 'Cancelled'
    )

    return activePOs
  } catch (err) {
    // @ts-ignore
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

    const allItemsForPO = itemRows.filter((r) => r.get('purchase_order_id') === poId)

    if (allItemsForPO.length === 0) {
      console.warn(`Tidak ada item sama sekali untuk PO ID ${poId} di sheet items.`)
      return []
    }

    // @ts-ignore
    const latestItemRev = Math.max(-1, ...allItemsForPO.map((r) => toNum(r.get('revision_number'))))

    const poData = poRows.find(
      // @ts-ignore
      (r) => r.get('id') === poId && toNum(r.get('revision_number')) === latestItemRev
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

    let stageDeadlines = []
    let cumulativeDate = new Date(poStartDate)
    stageDeadlines = PRODUCTION_STAGES.map((stageName) => {
      if (stageName === 'Siap Kirim') {
        return { stageName, deadline: poDeadline.toISOString() }
      }
      // @ts-ignore
      const durationDays = DEFAULT_STAGE_DURATIONS[stageName] || 0
      cumulativeDate.setDate(cumulativeDate.getDate() + durationDays)
      return { stageName, deadline: new Date(cumulativeDate).toISOString() }
    })

    const poItemsForLatestRev = allItemsForPO.filter(
      // @ts-ignore
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
      // @ts-ignore
      const history = (progressByItemId[itemId] || []).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() // ⬅️ PERBAIKAN
      )
      return { ...itemObject, progressHistory: history, stageDeadlines }
    })

    return result
  } catch (err) {
    // @ts-ignore
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
    // @ts-ignore
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
      // @ts-ignore
      const rev = toNum(r.get('revision_number'))
      // @ts-ignore
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
        // @ts-ignore
        const item = itemMap.get(update.purchase_order_item_id)
        if (!item) return null

        // @ts-ignore
        const po = poMap.get(item.purchase_order_id)
        if (!po) return null

        return {
          ...update,
          // @ts-ignore
          item_name: item.product_name,
          po_number: po.po_number
        }
      })
      .filter(Boolean)

    return enrichedUpdates
  } catch (err) {
    // @ts-ignore
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
      // @ts-ignore
      const rev = toNum(r.get('revision_number'))
      // @ts-ignore
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
      // @ts-ignore
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
        // @ts-ignore
        toNum(item.get('revision_number')) === latestRev
      )
    })

    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      const poId = row.get('purchase_order_id')
      const itemId = row.get('purchase_order_item_id')
      const key = `${poId}-${itemId}`
      if (!acc[key]) acc[key] = []
      // @ts-ignore
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
      // @ts-ignore
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
        // @ts-ignore
        urgentItems.push(attentionItem)
      }

      const deadline = new Date(po.get('deadline'))
      if (deadline <= sevenDaysFromNow && deadline >= today && currentStage !== 'Siap Kirim') {
        // @ts-ignore
        nearingDeadline.push({ ...attentionItem, deadline: po.get('deadline') })
      }

      if (
        latestProgress &&
        new Date(latestProgress.created_at) < fiveDaysAgo &&
        currentStage !== 'Siap Kirim'
      ) {
        // @ts-ignore
        stuckItems.push({ ...attentionItem, last_update: latestProgress.created_at })
      }
    })

    return { nearingDeadline, stuckItems, urgentItems }
  } catch (err) {
    // @ts-ignore
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
    const [rawItemRows, rawPoRows, rawProductRows] = await Promise.all([
      itemSheet.getRows(),
      poSheet.getRows(),
      productSheet.getRows()
    ])

    const itemRows = rawItemRows.map((r) => r.toObject())
    const poRows = rawPoRows.map((r) => r.toObject())
    const productRows = rawProductRows.map((r) => r.toObject())

    const latestPoMap = poRows.reduce((map, po) => {
      // @ts-ignore
      const poId = po.id
      // @ts-ignore
      const rev = toNum(po.revision_number)
      // @ts-ignore
      if (po.status !== 'Cancelled') {
        // @ts-ignore
        if (!map.has(poId) || rev > map.get(poId).revision_number) {
          map.set(poId, { ...po, revision_number: rev })
        }
      }
      return map
    }, new Map())

    const salesByProduct = {}
    const salesByMarketing = {}
    const monthlySalesByProduct = {}
    const monthlySalesByMarketing = {}
    const woodTypeDistribution = {}
    const customerByKubikasi = {}
    const salesByDateForTrend = []
    const soldProductNames = new Set()

    itemRows.forEach((item) => {
      // @ts-ignore
      const po = latestPoMap.get(item.purchase_order_id)
      // @ts-ignore
      if (!po || toNum(item.revision_number) !== po.revision_number) {
        return
      }

      // @ts-ignore
      const productName = item.product_name
      // @ts-ignore
      const quantity = toNum(item.quantity, 0)
      // @ts-ignore
      const kubikasi = toNum(item.kubikasi, 0)
      // @ts-ignore
      const woodType = item.wood_type
      const yearMonth = getYearMonth(po.created_at)

      if (!productName || quantity <= 0) return

      soldProductNames.add(productName)

      // @ts-ignore
      salesByProduct[productName] = salesByProduct[productName] || {
        totalQuantity: 0,
        totalKubikasi: 0,
        name: productName
      }
      // @ts-ignore
      salesByProduct[productName].totalQuantity += quantity
      // @ts-ignore
      salesByProduct[productName].totalKubikasi += kubikasi

      if (yearMonth) {
        // @ts-ignore
        monthlySalesByProduct[yearMonth] = monthlySalesByProduct[yearMonth] || {}
        // @ts-ignore
        monthlySalesByProduct[yearMonth][productName] =
          // @ts-ignore
          (monthlySalesByProduct[yearMonth][productName] || 0) + quantity
      }

      if (woodType)
        // @ts-ignore
        woodTypeDistribution[woodType] = (woodTypeDistribution[woodType] || 0) + quantity

      try {
        // @ts-ignore
        salesByDateForTrend.push({ date: new Date(po.created_at), name: productName, quantity })
      } catch {}
    })

    latestPoMap.forEach((po) => {
      // @ts-ignore
      const marketingName = po.acc_marketing || 'N/A'
      // @ts-ignore
      const customerName = po.project_name
      // @ts-ignore
      const kubikasiTotalPO = toNum(po.kubikasi_total, 0)
      const yearMonth = getYearMonth(po.created_at)

      // @ts-ignore
      salesByMarketing[marketingName] = salesByMarketing[marketingName] || {
        totalKubikasi: 0,
        poCount: 0,
        name: marketingName
      }
      // @ts-ignore
      salesByMarketing[marketingName].totalKubikasi += kubikasiTotalPO
      // @ts-ignore
      salesByMarketing[marketingName].poCount += 1

      if (yearMonth) {
        // @ts-ignore
        monthlySalesByMarketing[yearMonth] = monthlySalesByMarketing[yearMonth] || {}
        // @ts-ignore
        monthlySalesByMarketing[yearMonth][marketingName] =
          // @ts-ignore
          (monthlySalesByMarketing[yearMonth][marketingName] || 0) + kubikasiTotalPO
      }

      if (customerName)
        // @ts-ignore
        customerByKubikasi[customerName] = (customerByKubikasi[customerName] || 0) + kubikasiTotalPO
    })

    const topSellingProducts = Object.values(salesByProduct)
      // @ts-ignore
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 10)

    const salesByMarketingSorted = Object.values(salesByMarketing).sort(
      // @ts-ignore
      (a, b) => b.totalKubikasi - a.totalKubikasi
    )

    const woodTypeDistributionSorted = Object.entries(woodTypeDistribution)
      .map(([name, value]) => ({ name, value }))
      // @ts-ignore
      .sort((a, b) => b.value - a.value)

    const topCustomers = Object.entries(customerByKubikasi)
      .map(([name, totalKubikasi]) => ({ name, totalKubikasi }))
      // @ts-ignore
      .sort((a, b) => b.totalKubikasi - a.totalKubikasi)
      .slice(0, 10)

    const allMonths = new Set([
      ...Object.keys(monthlySalesByProduct),
      ...Object.keys(monthlySalesByMarketing)
    ])
    const sortedMonths = Array.from(allMonths).sort()

    const allProductKeys = new Set()
    sortedMonths.forEach((month) => {
      // @ts-ignore
      if (monthlySalesByProduct[month])
        // @ts-ignore
        Object.keys(monthlySalesByProduct[month]).forEach((p) => allProductKeys.add(p))
    })
    const allMarketingKeys = new Set()
    sortedMonths.forEach((month) => {
      // @ts-ignore
      if (monthlySalesByMarketing[month])
        // @ts-ignore
        Object.keys(monthlySalesByMarketing[month]).forEach((m) => allMarketingKeys.add(m))
    })

    const monthlyProductChartData = sortedMonths.map((month) => {
      const monthData = { month }
      allProductKeys.forEach((prodKey) => {
        // @ts-ignore
        monthData[prodKey] = monthlySalesByProduct[month]?.[prodKey] || 0
      })
      return monthData
    })

    const monthlyMarketingChartData = sortedMonths.map((month) => {
      const monthData = { month }
      allMarketingKeys.forEach((markKey) => {
        // @ts-ignore
        monthData[markKey] = monthlySalesByMarketing[month]?.[markKey] || 0
      })
      return monthData
    })

    const todayTrend = new Date(),
      thirtyDaysAgo = new Date(new Date().setDate(todayTrend.getDate() - 30)),
      sixtyDaysAgo = new Date(new Date().setDate(todayTrend.getDate() - 60))
    const salesLast30 = {},
      salesPrev30 = {}
    salesByDateForTrend.forEach((sale) => {
      if (sale.date >= thirtyDaysAgo)
        // @ts-ignore
        salesLast30[sale.name] = (salesLast30[sale.name] || 0) + sale.quantity
      else if (sale.date >= sixtyDaysAgo)
        // @ts-ignore
        salesPrev30[sale.name] = (salesPrev30[sale.name] || 0) + sale.quantity
    })
    const trendingProducts = Object.keys(salesLast30)
      .map((name) => {
        // @ts-ignore
        const last30 = salesLast30[name] || 0
        // @ts-ignore
        const prev30 = salesPrev30[name] || 0
        const change =
          prev30 === 0 && last30 > 0 ? 100 : ((last30 - prev30) / (prev30 === 0 ? 1 : prev30)) * 100
        return { name, last30, prev30, change }
      })
      .filter((p) => p.change > 10 && p.last30 > p.prev30)
      .sort((a, b) => b.change - a.change)

    // @ts-ignore
    const allMasterProductNames = productRows.map((p) => p.product_name).filter(Boolean)
    const slowMovingProducts = allMasterProductNames.filter((name) => !soldProductNames.has(name))

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

    console.log('📊 Analisis Penjualan Dihasilkan:', analysisResult)
    return analysisResult
  } catch (err) {
    // @ts-ignore
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

export async function getSalesItemData() {
  try {
    const doc = await openDoc()
    const itemSheet = await getSheet(doc, 'purchase_order_items')
    const poSheet = await getSheet(doc, 'purchase_orders')

    const [itemRows, poRows] = await Promise.all([itemSheet.getRows(), poSheet.getRows()])

    const poMap = new Map()
    poRows.forEach((r) => {
      const poId = r.get('id')
      // @ts-ignore
      const rev = toNum(r.get('revision_number'))
      // @ts-ignore
      if (!poMap.has(poId) || rev > poMap.get(poId).revision_number) {
        poMap.set(poId, r.toObject())
      }
    })

    const combinedData = itemRows
      .map((item) => {
        const itemObject = item.toObject()
        // @ts-ignore
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
    // @ts-ignore
    console.error('❌ Gagal mengambil data item penjualan:', err.message)
    return []
  }
}
export async function addNewProduct(productData) {
  try {
    console.log('📦 Menambahkan produk baru ke master:', productData)

    const doc = await openDoc()
    const sheet = await getSheet(doc, 'product_master')

    const nextId = await getNextIdFromSheet(sheet)
    await sheet.addRow({ id: nextId, ...productData })

    console.log(`✅ Produk baru [ID: ${nextId}] berhasil ditambahkan.`)
    return { success: true, newId: nextId }
  } catch (err) {
    // @ts-ignore
    console.error('❌ Gagal menambahkan produk baru:', err.message)
    // @ts-ignore
    return { success: false, error: err.message }
  }
}

export async function handleGroqChat(prompt) {
  // 1. AMBIL KONTEKS DATA PO
  let allPOs
  try {
    allPOs = await listPOs() // Memanggil listPOs() yang diimpor
    if (!Array.isArray(allPOs)) {
      console.error('listPOs did not return an array.')
      allPOs = []
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

  // 2. SIAPKAN SAPAAN & SYSTEM PROMPT
  const now = new Date()
  const currentHour = now.getHours()
  let timeOfDayGreeting = 'Halo!'
  if (currentHour >= 4 && currentHour < 11) {
    timeOfDayGreeting = 'Selamat pagi!'
  } else if (currentHour >= 11 && currentHour < 15) {
    timeOfDayGreeting = 'Selamat siang!'
  } else if (currentHour >= 15 && currentHour < 19) {
    timeOfDayGreeting = 'Selamat sore!'
  } else {
    timeOfDayGreeting = 'Selamat malam, tunggu apa ga tidur!'
  }

  const today = new Date().toISOString().split('T')[0]

  // --- [SYSTEM PROMPT BARU] ---
  const systemPrompt = `Anda adalah Asisten ERP Ubinkayu. Tugas Anda adalah mengubah pertanyaan pengguna menjadi JSON 'perintah' yang valid. HANYA KEMBALIKAN JSON.
Hari ini adalah ${today}.

--- ATURAN PRIORITAS ---
1. Jika user menyebut nomor PO, nama customer, atau revisi, Anda HARUS menggunakan "getPOInfo".
2. Tentukan 'intent' user dengan hati-hati.

--- Alat (Tools) yang Tersedia ---

1. "getTotalPO": (Untuk pertanyaan jumlah/total PO).
    - Keywords: "jumlah po", "total po", "ada berapa po", "semua po aktif".
    - JSON: {"tool": "getTotalPO"}

2. "getTopProduct": (Untuk pertanyaan produk terlaris).
    - Keywords: "produk terlaris", "paling laku".
    - JSON: {"tool": "getTopProduct"}

3. "getTopCustomer": (Untuk pertanyaan customer terbesar).
    - Keywords: "customer terbesar", "top customer".
    - JSON: {"tool": "getTopCustomer"}

4. "getPOInfo": (SATU-SATUNYA ALAT UNTUK MENCARI PO). Mencari PO berdasarkan nomor, customer, atau revisi.
    - PENTING: Alat ini menangani SEMUA permintaan terkait PO spesifik.
    - AI HARUS mengekstrak parameter pencarian ("poNumber" atau "customerName").
    - AI HARUS mengekstrak "revisionNumber" (jika disebut).
    - AI HARUS menentukan "intent" (niat) user:
      - "status": Jika user HANYA bertanya "status", "progress", "cek po".
      - "details": Jika user bertanya "info", "detail", "item", "customer", atau "cari PO".
      - "file": Jika user bertanya "link", "file", "dokumen", "JPEG", "arsip".
    - Jika tidak spesifik, default ke "details".
    - Keywords: "status po [nomor]", "link file [nomor]", "info po [nomor]", "arsip jpeg [nomor]", "po customer [nama]", "detail revisi [nomor]".
    - JSON: {"tool": "getPOInfo", "param": {"poNumber": "...", "customerName": "...", "revisionNumber": "...", "intent": "status"}}

5. "getUrgentPOs": (Untuk pertanyaan PO 'Urgent').
    - Keywords: "po urgent", "urgent orders".
    - JSON: {"tool": "getUrgentPOs"}

6. "getNearingDeadline": (Untuk pertanyaan PO 'deadline dekat').
    - Keywords: "deadline dekat", "nearing deadline".
    - JSON: {"tool": "getNearingDeadline"}

7. "getNewestPOs": (Untuk pertanyaan PO 'terbaru').
    - Keywords: "po terbaru", "newest po".
    - JSON: {"tool": "getNewestPOs"}

8. "getOldestPO": (Untuk pertanyaan PO 'terlama').
    - Keywords: "po terlama", "oldest po".
    - JSON: {"tool": "getOldestPO"}

9. "getPOsByDateRange": (Untuk pertanyaan PO berdasarkan 'tanggal').
    - Keywords: "po bulan oktober", "po tanggal 20 okt".
    - AI HARUS mengekstrak 'startDate' dan 'endDate'.
    - JSON: {"tool": "getPOsByDateRange", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}

10. "getPOByStatusCount": (Untuk pertanyaan jumlah PO 'Open' atau 'In Progress').
     - Keywords: "berapa po open", "jumlah po in progress".
     - JSON: {"tool": "getPOByStatusCount", "param": "STATUS_DIMINTA"}

11. "getApplicationHelp": (Untuk pertanyaan 'cara pakai' aplikasi).
     - Keywords: "cara buat po", "panduan aplikasi".
     - JSON: {"tool": "getApplicationHelp", "topic": "NAMA_FITUR_DIMINTA"}

12. "help": (Untuk pertanyaan 'bantuan' atau 'perintah').
     - Keywords: "bantuan", "help".
     - JSON: {"tool": "help"}

13. "general": (Untuk sapaan umum).
     - Keywords: "halo", "terima kasih".
     - JSON: {"tool": "general"}

14. "getTopSellingProductsChart": (Untuk 'grafik' penjualan).
     - Keywords: "grafik produk", "chart penjualan".
     - JSON: {"tool": "getTopSellingProductsChart"}

ATURAN KETAT:
- JANGAN menjawab pertanyaan. HANYA KEMBALIKAN JSON.
- Jika tidak yakin tool mana, KEMBALIKAN: {"tool": "unknown"}`
  // --- [AKHIR SYSTEM PROMPT BARU] ---

  // 3. PANGGIL GROQ API
  let aiDecisionJsonString = ''
  let aiDecision = { tool: 'unknown' }

  const groqToken = process.env.GROQ_API_KEY
  const modelId = 'llama-3.1-8b-instant'

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
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 150
    }

    // @ts-ignore
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
      console.log('✅ [Electron AI - Groq] Parsed JSON decision:', aiDecision)
    } else {
      console.error('❌ [Electron AI - Groq] Unexpected response format (manual):', result)
      throw new Error('Unexpected response format from Groq (manual fetch).')
    }
  } catch (err) {
    // @ts-ignore
    console.error('💥 [Electron AI - Groq] AI call or JSON parse ERROR:', err.message)
    // @ts-ignore
    return `Maaf, terjadi kesalahan saat menghubungi Groq: ${err.message}`
  }

  // 4. JALANKAN ALAT (TOOLS)
  try {
    console.log(`[Electron AI - Groq] Executing tool: ${aiDecision?.tool || 'unknown'}`)
    // @ts-ignore
    let responseText = ''

    // @ts-ignore
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

        responseText =
          `Saat ini ada ${totalPOs} total PO di database.\n\n` +
          `- ${activePOsCount} PO sedang aktif (${openCount} Open, ${inProgressCount} In Progress).\n` +
          `- ${completedPOs} PO sudah selesai.`
        break
      }
      case 'getTopProduct': {
        const completedPOs = allPOs.filter((po) => po.status === 'Completed')
        if (completedPOs.length === 0) {
          responseText = 'Belum ada data PO Selesai untuk dianalisis.'
          break
        }
        const salesData = {}
        completedPOs
          .flatMap((po) => po.items || [])
          .forEach((item) => {
            if (item.product_name)
              // @ts-ignore
              salesData[item.product_name] =
                // @ts-ignore
                (salesData[item.product_name] || 0) + Number(item.quantity || 0)
          })
        const topProduct =
          Object.keys(salesData).length > 0
            ? Object.keys(salesData).reduce((a, b) => (salesData[a] > salesData[b] ? a : b))
            : 'N/A'
        responseText =
          topProduct !== 'N/A'
            ? `Produk terlaris dari PO Selesai adalah: ${topProduct} (${salesData[topProduct]} unit).`
            : 'Tidak dapat menemukan produk terlaris.'
        break
      }
      case 'getTopCustomer': {
        const completedPOs = allPOs.filter((po) => po.status === 'Completed')
        if (completedPOs.length === 0) {
          responseText = 'Belum ada data PO Selesai untuk dianalisis.'
          break
        }
        const customerData = {}
        completedPOs.forEach((po) => {
          if (po.project_name)
            // @ts-ignore
            customerData[po.project_name] =
              // @ts-ignore
              (customerData[po.project_name] || 0) + Number(po.kubikasi_total || 0)
        })
        const topCustomer =
          Object.keys(customerData).length > 0
            ? Object.keys(customerData).reduce((a, b) =>
                customerData[a] > customerData[b] ? a : b
              )
            : 'N/A'
        responseText =
          topCustomer !== 'N/A'
            ? `Customer terbesar (m³) dari PO Selesai adalah: ${topCustomer} (${customerData[
                topCustomer
              ].toFixed(3)} m³).`
            : 'Tidak dapat menemukan customer terbesar.'
        break
      }

      // --- [CASE BARU] ---
      case 'getPOInfo': {
        // @ts-ignore
        const { poNumber, customerName, revisionNumber, intent } = aiDecision.param

        if (!poNumber && !customerName) {
          responseText = 'Mohon sebutkan nomor PO atau nama customer yang ingin dicari.'
          break
        }

        // 1. Logika Pencarian
        let matchingPOs = []
        if (poNumber) {
          const sanitizePOString = (str) => {
            if (!str) return ''
            return str
              .toLowerCase()
              .replace(/po-|po /g, '')
              .replace(/[ .]/g, '')
          }
          const sanitizedQuery = sanitizePOString(poNumber)
          matchingPOs = allPOs.filter(
            (p) => p.po_number && sanitizePOString(p.po_number).includes(sanitizedQuery)
          )
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
          matchingPOs = Array.from(poMap.values())
        }

        if (matchingPOs.length === 0) {
          responseText = `Maaf, PO yang cocok dengan '${poNumber || customerName}' tidak ditemukan.`
          break
        }

        // 2. Logika Pemilihan Revisi
        let foundPO = null
        let revNum = -1
        let feedback = '' // Teks tambahan

        if (revisionNumber !== undefined && revisionNumber !== null) {
          revNum = toNum(revisionNumber, -1)
          // @ts-ignore
          foundPO = matchingPOs.find((p) => toNum(p.revision_number, -1) === revNum)

          if (!foundPO) {
            // @ts-ignore
            foundPO = matchingPOs.sort(
              (a, b) => toNum(b.revision_number, -1) - toNum(a.revision_number, -1)
            )[0]
            revNum = toNum(foundPO.revision_number, -1)
            feedback = `Tidak menemukan Revisi ${revisionNumber}. Menampilkan hasil untuk revisi terbaru (Rev ${revNum}):\n`
          }
        } else {
          // @ts-ignore
          foundPO = matchingPOs.sort(
            (a, b) => toNum(b.revision_number, -1) - toNum(a.revision_number, -1)
          )[0]
          revNum = toNum(foundPO.revision_number, -1)
        }

        if (!foundPO) {
          responseText = `Maaf, PO ${poNumber || customerName} tidak ditemukan.`
          break
        }

        // 3. Logika Merespons Berdasarkan NIAT (INTENT)
        const poIntent = intent || 'details'

        switch (poIntent) {
          case 'file':
            // @ts-ignore
            if (foundPO.pdf_link && foundPO.pdf_link.startsWith('http')) {
              // @ts-ignore
              responseText = `${feedback}Berikut link file untuk PO ${foundPO.po_number} (Rev ${revNum}):\n${foundPO.pdf_link}`
              // @ts-ignore
            } else if (foundPO.pdf_link) {
              // @ts-ignore
              responseText = `${feedback}Saya menemukan PO ${foundPO.po_number} (Rev ${revNum}), tapi link filenya bermasalah: ${foundPO.pdf_link}`
            } else {
              // @ts-ignore
              responseText = `${feedback}Maaf, PO ${foundPO.po_number} (Rev ${revNum}) tidak memiliki link file.`
            }
            break

          case 'status':
            // @ts-ignore
            responseText = `${feedback}Status PO ${foundPO.po_number} (${
              foundPO.project_name || 'N/A'
            }) adalah: ${foundPO.status || 'N/A'}. Progress: ${
              foundPO.progress?.toFixed(0) || 0
            }%.`
            break

          case 'details':
          default:
            // @ts-ignore
            const itemsSummary = (foundPO.items || [])
              .map(
                (item) =>
                  `- ${item.product_name || 'Item Tanpa Nama'} (${item.quantity || 0} ${
                    item.satuan || 'unit'
                  })`
              )
              .join('\n')

            responseText =
              `${feedback}✅ PO ditemukan:\n` +
              // @ts-ignore
              `Nomor PO: ${foundPO.po_number || 'N/A'}\n` +
              // @ts-ignore
              `Customer: ${foundPO.project_name || 'N/A'}\n` +
              // @ts-ignore
              `Tgl Masuk: ${formatDate(foundPO.created_at)}\n` +
              // @ts-ignore
              `Target Kirim: ${formatDate(foundPO.deadline)}\n` +
              // @ts-ignore
              `Status: ${foundPO.status || 'N/A'}\n` +
              // @ts-ignore
              `Progress: ${foundPO.progress?.toFixed(0) || 0}%\n` +
              // @ts-ignore
              `Prioritas: ${foundPO.priority || 'Normal'}\n` +
              `Item:\n${itemsSummary || '(Tidak ada item)'}`
            break
        }
        break
      }
      // --- [AKHIR CASE BARU] ---

      case 'getUrgentPOs': {
        const urgentPOs = allPOs.filter(
          (po) => po.priority === 'Urgent' && po.status !== 'Completed' && po.status !== 'Cancelled'
        )
        if (urgentPOs.length > 0) {
          const poNumbers = urgentPOs
            .map((po) => `- ${po.po_number || 'N/A'} (${po.project_name || 'N/A'})`)
            .join('\n')
          responseText = `Ada ${urgentPOs.length} PO aktif dengan prioritas Urgent:\n${poNumbers}`
        } else {
          responseText = 'Saat ini tidak ada PO aktif dengan prioritas Urgent.'
        }
        break
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
          .sort(
            (a, b) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime()
          )
        if (nearingPOs.length > 0) {
          const poDetails = nearingPOs
            .map(
              (po) =>
                `- ${po.po_number || 'N/A'} (${po.project_name || 'N/A'}): ${formatDate(
                  po.deadline
                )}`
            )
            .join('\n')
          responseText = `Ada ${nearingPOs.length} PO aktif yang mendekati deadline (7 hari):\n${poDetails}`
        } else {
          responseText = 'Tidak ada PO aktif yang mendekati deadline dalam 7 hari ke depan.'
        }
        break
      }
      case 'getNewestPOs': {
        const sortedPOs = [...allPOs].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        const newestPOs = sortedPOs.slice(0, 3)
        const poDetails = newestPOs
          .map(
            (po) =>
              `- ${po.po_number || 'N/A'} (${po.project_name || 'N/A'}), Tgl: ${formatDate(
                po.created_at
              )}`
          )
          .join('\n')
        responseText = `Berikut adalah 3 PO terbaru yang masuk:\n${poDetails}`
        break
      }
      case 'getOldestPO': {
        const sortedPOs = [...allPOs].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        const oldestPO = sortedPOs[0]
        if (oldestPO) {
          responseText = `PO terlama yang tercatat adalah:\n- Nomor PO: ${
            oldestPO.po_number || 'N/A'
          }\n- Customer: ${
            oldestPO.project_name || 'N/A'
          }\n- Tanggal Masuk: ${formatDate(oldestPO.created_at)}`
        } else {
          responseText = 'Tidak dapat menemukan data PO.'
        }
        break
      }
      case 'getPOsByDateRange': {
        // @ts-ignore
        const { startDate, endDate } = aiDecision.param
        if (!startDate || !endDate) {
          responseText = 'Maaf, tidak mengerti rentang tanggal.'
          break
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/
        if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
          responseText =
            'Maaf, format tanggal yang diterima AI tidak valid. Seharusnya YYYY-MM-DD.'
          break
        }
        let start, end
        try {
          start = new Date(startDate).getTime()
          end = new Date(endDate)
          end.setHours(23, 59, 59, 999)
          end = end.getTime()
          if (isNaN(start) || isNaN(end)) throw new Error('Invalid date conversion')
        } catch (e) {
          responseText = 'Maaf, terjadi kesalahan saat memproses rentang tanggal.'
          break
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
                `- ${po.po_number || 'N/A'} (${po.project_name || 'N/A'}), Tgl Masuk: ${formatDate(
                  po.created_at
                )}`
            )
            .slice(0, 10)
            .join('\n')
          let response = `Saya menemukan ${foundPOs.length} PO untuk ${dateRangeStr}:\n${poDetails}`
          if (foundPOs.length > 10) response += `\n...dan ${foundPOs.length - 10} lainnya.`
          responseText = response
        } else {
          responseText = `Tidak ada PO ditemukan untuk ${dateRangeStr}.`
        }
        break
      }
      case 'getPOByStatusCount': {
        // @ts-ignore
        const requestedStatus = aiDecision.param
        if (
          !requestedStatus ||
          (requestedStatus.toLowerCase() !== 'open' &&
            requestedStatus.toLowerCase() !== 'in progress')
        ) {
          responseText = 'Mohon sebutkan status (Open atau In Progress).'
          break
        }
        const requestedStatusLower = requestedStatus.toLowerCase()
        const displayStatus = requestedStatusLower === 'open' ? 'Open' : 'In Progress'
        const count = allPOs.filter(
          (po) =>
            po.status?.toLowerCase() === requestedStatusLower &&
            po.status !== 'Completed' &&
            po.status !== 'Cancelled'
        ).length
        responseText = `Ada ${count} PO dengan status "${displayStatus}".`
        break
      }
      case 'getApplicationHelp': {
        // @ts-ignore
        const topic = aiDecision.topic?.toLowerCase() || ''
        if (topic.includes('buat po') || topic.includes('input po')) {
          responseText =
            "Untuk membuat PO baru:\n1. Klik tombol '+ Tambah PO Baru' di halaman 'Purchase Orders'.\n2. Isi detail PO seperti Nomor PO, Nama Customer, Tanggal Kirim.\n3. Tambahkan minimal satu item di tabel bawah (isi Produk, Ukuran, Qty, dll.).\n4. Klik 'Simpan PO Baru'."
        } else if (topic.includes('update progress')) {
          responseText =
            "Untuk update progress PO:\n1. Buka halaman 'Progress'.\n2. Cari PO yang ingin diupdate.\n3. Klik tombol 'Update Progress' pada kartu PO tersebut.\n4. Pilih item yang ingin diupdate.\n5. Pilih 'Tahap Berikutnya', tambahkan catatan (opsional), dan unggah foto (opsional).\n6. Klik tombol 'Simpan Progress ke [Nama Tahap]'."
        } else if (topic.includes('revisi po')) {
          responseText =
            "Untuk merevisi PO yang sudah ada:\n1. Buka halaman 'Purchase Orders'.\n2. Cari PO yang ingin direvisi.\n3. Klik tombol 'Revisi' pada baris tabel PO tersebut.\n4. Form akan terisi data PO terakhir, ubah data header atau item sesuai kebutuhan.\n5. Jika ada foto referensi baru, unggah fotonya.\n6. Klik 'Simpan Revisi'. Anda akan diminta memasukkan nama perevisi."
        } else if (topic.includes('tambah produk')) {
          responseText =
            "Untuk menambah produk baru ke daftar master:\n1. Saat berada di form Input/Revisi PO, klik tombol '+ Tambah Master Produk' di atas tabel item.\n2. Akan muncul jendela pop-up.\n3. Isi detail produk baru (Nama Produk wajib diisi).\n4. Klik 'Simpan Produk'. Produk baru akan tersedia di daftar dropdown."
        } else {
          responseText =
            'Saya bisa membantu menjelaskan cara:\n- Membuat PO baru\n- Update progress PO\n- Revisi PO\n- Menambah produk master.\n\nFitur mana yang ingin Anda ketahui?'
        }
        break
      }
      case 'getTopSellingProductsChart': {
        const completedPOs = allPOs.filter((p) => p.status === 'Completed')
        if (completedPOs.length === 0) {
          responseText = 'Belum ada data PO Selesai untuk membuat grafik.'
          break
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
        const chartData = Object.entries(salesData)
          // @ts-ignore
          .map(([name, quantity]) => ({ name, Kuantitas: Number(quantity) }))
          .sort((a, b) => b.Kuantitas - a.Kuantitas)
          .slice(0, 5)
        if (chartData.length === 0) {
          responseText = 'Tidak dapat menemukan data penjualan produk untuk membuat grafik.'
          break
        }
        const chartPayload = {
          type: 'bar',
          data: chartData,
          dataKey: 'Kuantitas',
          nameKey: 'name'
        }
        responseText = `Tentu, berikut adalah grafik 5 produk terlaris (berdasarkan kuantitas dari PO Selesai):\nCHART_JSON::${JSON.stringify(
          chartPayload
        )}`
        break
      }
      case 'help':
        responseText =
          'Anda bisa bertanya tentang:\n- Jumlah total PO (detail status aktif)\n- Produk terlaris/Customer terbesar (dari PO Selesai)\n- Status PO [nomor]\n- Detail PO [nomor/nama customer]\n- PO Urgent/Deadline Dekat\n- PO terbaru / terlama\n- PO per tanggal\n- Jumlah PO Open / In Progress\n- Cara pakai fitur'
        break
      case 'general': {
        if (prompt.toLowerCase().includes('siapa')) {
          responseText = 'Saya adalah Asisten AI Ubinkayu.'
        } else if (prompt.toLowerCase().includes('terima kasih')) {
          responseText = 'Sama-sama! Senang bisa membantu.'
        } else {
          responseText = `${timeOfDayGreeting} Ada yang bisa saya bantu?`
        }
        break
      }
      case 'unknown':
      default:
        console.warn('Menerima tool tidak dikenal dari AI:', aiDecision.tool)
        responseText =
          "Maaf, saya tidak yakin bagaimana harus merespons itu. Coba tanyakan 'bantuan'."
        break
    }
    return responseText
  } catch (execError) {
    // @ts-ignore
    console.error('Error saat menjalankan alat:', execError)
    // @ts-ignore
    return `Maaf, terjadi kesalahan saat memproses jawaban: ${execError.message}`
  }
}