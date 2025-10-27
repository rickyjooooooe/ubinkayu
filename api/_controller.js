// file: api/_controller.js

import {
  openDoc,
  getSheet,
  toNum,
  getNextIdFromSheet,
  scrubItemPayload,
  extractGoogleDriveFileId,
  deleteGoogleDriveFile,
  processBatch,
  PRODUCTION_STAGES,
  generatePOJpeg,
  getAuth,
  PO_ARCHIVE_FOLDER_ID,
  PROGRESS_PHOTOS_FOLDER_ID,
  DEFAULT_STAGE_DURATIONS
} from './_helpers.js'
import { google } from 'googleapis'
import stream from 'stream'
import { GoogleGenerativeAI } from '@google/generative-ai'

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

// --- HELPERS KHUSUS UNTUK FUNGSI TERTENTU ---
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

// =================================================================
// KUMPULAN SEMUA LOGIKA API
// =================================================================

// --- LOGIC FOR: listPOs ---
export async function handleListPOs(req, res) {
  // Log paling awal untuk menandakan fungsi dimulai
  console.log('🏁 [Vercel] handleListPOs function started!')

  // Bungkus seluruh logika asli dalam try...catch
  try {
    const doc = await openDoc()
    const poSheet = getSheet(doc, 'purchase_orders')
    const itemSheet = getSheet(doc, 'purchase_order_items')
    const progressSheet = getSheet(doc, 'progress_tracking')

    // Ambil data dari sheet
    const [poRows, itemRows, progressRows] = await Promise.all([
      poSheet.getRows(),
      itemSheet.getRows(),
      progressSheet.getRows()
    ])

    // --- Proses Data PO untuk mendapatkan revisi terbaru ---
    const byId = new Map()
    for (const r of poRows) {
      const id = String(r.get('id')).trim()
      const rev = toNum(r.get('revision_number'), -1)
      // @ts-ignore - Abaikan potensi error TS jika 'rev' tidak ada di tipe 'keep'
      const keep = byId.get(id)
      if (!keep || rev > keep.rev) {
        // Simpan baris GoogleSpreadsheetRow, bukan objek biasa
        byId.set(id, { rev, row: r })
      }
    }
    // Dapatkan array baris GoogleSpreadsheetRow revisi terbaru
    const latestPoRows = Array.from(byId.values()).map(({ row }) => row)

    // --- Siapkan data helper untuk progress dan item ---
    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      const poId = row.get('purchase_order_id')
      const itemId = row.get('purchase_order_item_id')
      const key = `${poId}-${itemId}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
      return acc
    }, {})

    // Ubah itemRows menjadi objek biasa untuk Map dan filter
    const itemObjects = itemRows.map((item) => item.toObject())

    const itemsByPoId = itemObjects.reduce((acc, item) => {
      const poId = item.purchase_order_id // Akses properti objek
      if (!acc[poId]) acc[poId] = []
      acc[poId].push(item)
      return acc
    }, {})

    const latestItemRevisions = new Map()
    itemObjects.forEach((item) => {
      // Gunakan itemObjects
      const poId = item.purchase_order_id
      const rev = toNum(item.revision_number, -1)
      const current = latestItemRevisions.get(poId)
      if (current === undefined || rev > current) {
        // Periksa undefined
        latestItemRevisions.set(poId, rev)
      }
    })

    // --- Hitung hasil akhir ---
    const result = latestPoRows.map((po) => {
      // 'po' di sini adalah GoogleSpreadsheetRow
      const poObject = po.toObject() // Konversi ke objek biasa SEKARANG
      const poId = poObject.id
      const latestRev = latestItemRevisions.get(poId) ?? -1

      // Filter item dari itemsByPoId yang sudah berupa objek
      const poItems = (itemsByPoId[poId] || []).filter(
        (item) => toNum(item.revision_number, -1) === latestRev
      )

      // Hitung progress (logika sama seperti sebelumnya)
      let poProgress = 0
      if (poItems.length > 0) {
        let totalPercentage = 0
        poItems.forEach((item) => {
          const itemId = item.id
          const stages = PRODUCTION_STAGES // Pastikan ini terdefinisi/diimpor
          const compositeKey = `${poId}-${itemId}`
          const itemProgressHistory = progressByCompositeKey[compositeKey] || []
          let latestStageIndex = -1
          if (itemProgressHistory.length > 0) {
            // Salin array sebelum sort
            const latestProgress = [...itemProgressHistory].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )[0]
            latestStageIndex = stages.indexOf(latestProgress.stage)
          }
          const itemPercentage =
            latestStageIndex >= 0 ? ((latestStageIndex + 1) / stages.length) * 100 : 0
          totalPercentage += itemPercentage
        })
        poProgress = totalPercentage / poItems.length
      }

      // Tentukan status final dan completed_at (logika sama seperti sebelumnya)
      let finalStatus = poObject.status
      let completed_at = null
      if (finalStatus !== 'Cancelled') {
        const roundedProgress = Math.round(poProgress) // Bulatkan sekali saja
        if (roundedProgress >= 100) {
          finalStatus = 'Completed'
          const allProgressForPO = progressRows // Gunakan progressRows asli
            .filter((row) => row.get('purchase_order_id') === poId)
            .map((row) => {
              try {
                return new Date(row.get('created_at')).getTime()
              } catch {
                return 0
              } // Handle invalid date strings
            })
            .filter((time) => time > 0) // Filter out invalid dates

          if (allProgressForPO.length > 0) {
            completed_at = new Date(Math.max(...allProgressForPO)).toISOString()
          }
        } else if (roundedProgress > 0) {
          finalStatus = 'In Progress'
        } else {
          finalStatus = 'Open'
        }
      }

      // Tambahkan field yang dibutuhkan frontend (konsisten dengan Electron)
      const lastRevisedBy = poObject.revised_by || 'N/A'
      const lastRevisedDate = poObject.created_at // Timestamp revisi terakhir

      // Susun objek hasil
      return {
        ...poObject, // Sertakan semua data asli dari sheet
        items: poItems, // Sertakan item yang sudah difilter
        progress: Math.round(poProgress), // Progress yang dibulatkan
        status: finalStatus,
        completed_at: completed_at,
        pdf_link: poObject.pdf_link || null, // Pastikan pdf_link diambil dari poObject
        // Field tambahan untuk konsistensi
        acc_marketing: poObject.acc_marketing || '',
        alamat_kirim: poObject.alamat_kirim || '',
        lastRevisedBy: lastRevisedBy,
        lastRevisedDate: lastRevisedDate
      }
    }) // Akhir .map

    // Kirim hasil JSON ke klien
    return res.status(200).json(result)
  } catch (err) {
    // Blok catch untuk menangani error
    console.error('💥 [Vercel] ERROR in handleListPOs:', err.message, err.stack) // Log error detail
    // Kirim respons error ke klien
    // @ts-ignore - Abaikan error TS jika 'message' tidak ada di tipe 'err'
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error processing listPOs',
      details: err.message
    })
  }
}

async function generateAndUploadPO(poData, revisionNumber) {
  let auth
  try {
    // 1. Generate Buffer JPEG (panggil fungsi dari _helpers.js)
    console.log('⏳ [Vercel] Generating JPEG buffer...')
    // @ts-ignore
    const jpegResult = await generatePOJpeg(poData, revisionNumber) // Tidak perlu argumen 'true'
    if (!jpegResult.success || !jpegResult.buffer) {
      throw new Error(jpegResult.error || 'Gagal membuat buffer JPEG.')
    }
    const jpegBuffer = jpegResult.buffer
    const fileName = jpegResult.fileName // Ambil nama file dari hasil generate
    console.log(`✅ [Vercel] JPEG buffer created: ${fileName}`)

    // 2. Dapatkan objek auth dan authorize
    console.log('🔄 [Vercel] Mendapatkan otentikasi baru sebelum upload/get...')
    auth = getAuth() // Panggil fungsi getAuth dari _helpers.js
    await auth.authorize()
    console.log('✅ [Vercel] Otorisasi ulang berhasil.')

    const mimeType = 'image/jpeg'

    console.log(`🚀 [Vercel] Mengunggah file via auth.request: ${fileName} ke Drive...`)

    // --- Upload via auth.request menggunakan Buffer ---
    const metadata = {
      name: fileName,
      mimeType: mimeType,
      parents: [PO_ARCHIVE_FOLDER_ID] // Pastikan konstanta ini diimpor/tersedia
    }
    const boundary = `----VercelBoundary${Date.now()}----`

    // Buat multipart body langsung dari buffer
    const metaPart = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n\r\n`
    )
    const mediaHeaderPart = Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`)
    const endBoundaryPart = Buffer.from(`\r\n--${boundary}--\r\n`)

    // Gabungkan buffer menjadi satu payload
    const requestBody = Buffer.concat([metaPart, mediaHeaderPart, jpegBuffer, endBoundaryPart])

    // Panggil API create menggunakan auth.request
    const createResponse = await auth.request({
      url: `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': requestBody.length // Penting untuk Vercel
      },
      data: requestBody, // Kirim Buffer gabungan sebagai data
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    })

    // --- Ambil webViewLink via auth.request ---
    const fileId = createResponse?.data?.id
    if (!fileId) {
      console.error(
        '❌ [Vercel] Upload berhasil, tetapi ID file tidak ditemukan:',
        createResponse.data
      )
      throw new Error('Upload berhasil tetapi ID file tidak didapatkan.')
    }
    console.log(
      `✅ [Vercel] File berhasil diunggah (ID: ${fileId}). Mengambil webViewLink via auth.request...`
    )

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
      console.error('❌ [Vercel] Gagal mendapatkan webViewLink via auth.request:', getResponse.data)
      throw new Error('Gagal mendapatkan link file setelah upload berhasil.')
    }
    console.log(`✅ [Vercel] Link file didapatkan via auth.request: ${webViewLink}`)

    // Tidak ada file lokal yang perlu dihapus di Vercel
    return { success: true, link: webViewLink }
  } catch (error) {
    console.error('❌ [Vercel] Proses Generate & Upload PO Gagal:', error.message)
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
    return { success: false, error: error.message } // Kembalikan objek error
  }
}

// --- LOGIC FOR: saveNewPO ---
export async function handleSaveNewPO(req, res) {
  console.log('🏁 [Vercel] handleSaveNewPO started!') // Log awal
  const data = req.body
  let doc // Deklarasi di luar try
  let newPoRow // Deklarasi di luar try

  try {
    doc = await openDoc() // Panggil openDoc di dalam try
    const now = new Date().toISOString()
    const poSheet = getSheet(doc, 'purchase_orders')
    const itemSheet = getSheet(doc, 'purchase_order_items')
    const poId = await getNextIdFromSheet(poSheet)

    // Data untuk baris baru di sheet
    const newPoRowData = {
      id: poId,
      revision_number: 0,
      po_number: data.nomorPo || `PO-${poId}`, // Fallback nomor PO
      project_name: data.namaCustomer || 'N/A',
      deadline: data.tanggalKirim || null, // Gunakan null jika kosong
      status: 'Open',
      priority: data.prioritas || 'Normal',
      notes: data.catatan || '',
      kubikasi_total: toNum(data.kubikasi_total, 0), // Pastikan number
      acc_marketing: data.marketing || '',
      created_at: now,
      pdf_link: 'generating...', // Placeholder
      alamat_kirim: data.alamatKirim || '',
      revised_by: 'N/A' // Revisi awal
    }

    console.log('📝 [Vercel] Adding new PO row to sheet:', newPoRowData.po_number)
    newPoRow = await poSheet.addRow(newPoRowData) // Tambah baris ke sheet

    // Proses item
    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw) => {
      const clean = scrubItemPayload(raw) // Bersihkan payload
      const kubikasiItem = toNum(raw.kubikasi, 0) // Hitung kubikasi (atau ambil jika sudah ada)
      const newItem = {
        id: nextItemId,
        purchase_order_id: poId,
        revision_number: 0, // Set revisi item
        kubikasi: kubikasiItem,
        ...clean // Tambahkan field bersih lainnya
        // Pastikan field lain (product_name, wood_type, dll.) ada di 'clean'
      }
      itemsWithIds.push({ ...raw, id: nextItemId, kubikasi: kubikasiItem }) // Untuk generator JPEG
      nextItemId++
      return newItem
    })

    if (itemsToAdd.length > 0) {
      console.log(`➕ [Vercel] Adding ${itemsToAdd.length} items to sheet for PO ${poId}`)
      await itemSheet.addRows(itemsToAdd)
    } else {
      console.warn(`⚠️ [Vercel] No items provided for new PO ${poId}`)
    }

    // Siapkan data untuk generateAndUploadPO
    const poDataForUpload = {
      // Ambil data dari newPoRowData agar konsisten dengan yang disimpan
      po_number: newPoRowData.po_number,
      project_name: newPoRowData.project_name,
      deadline: newPoRowData.deadline,
      priority: newPoRowData.priority,
      notes: newPoRowData.notes,
      created_at: newPoRowData.created_at,
      kubikasi_total: newPoRowData.kubikasi_total,
      acc_marketing: newPoRowData.acc_marketing,
      alamat_kirim: newPoRowData.alamat_kirim,
      // Data lain yang mungkin dibutuhkan generatePOJpeg
      items: itemsWithIds,
      poPhotoBase64: data.poPhotoBase64 // Ambil dari request body jika ada
    }

    console.log(`⏳ [Vercel] Calling generateAndUploadPO for PO ${poId}...`)
    // Panggil fungsi generateAndUploadPO yang baru
    const uploadResult = await generateAndUploadPO(poDataForUpload, 0) // Revisi 0

    // Update link di sheet
    console.log(`🔄 [Vercel] Updating pdf_link for PO ${poId}...`)
    newPoRow.set(
      'pdf_link',
      uploadResult.success
        ? uploadResult.link
        : `ERROR: ${uploadResult.error || 'Unknown upload error'}`
    )
    await newPoRow.save()
    console.log(`✅ [Vercel] pdf_link updated.`)

    // Kirim respons sukses
    return res.status(200).json({ success: true, poId, revision_number: 0 })
  } catch (err) {
    // Tangani error, catat, dan kirim respons error
    console.error('💥 [Vercel] ERROR in handleSaveNewPO:', err.message, err.stack)
    // Jika baris PO sudah terlanjur dibuat tapi upload gagal, update link error
    if (newPoRow && !newPoRow.get('pdf_link')?.startsWith('http')) {
      try {
        // @ts-ignore
        newPoRow.set('pdf_link', `ERROR: ${err.message}`)
        await newPoRow.save()
      } catch (saveErr) {
        // @ts-ignore
        console.error('   -> Failed to save error link back to sheet:', saveErr.message)
      }
    }
    // @ts-ignore
    return res
      .status(500)
      .json({ success: false, error: 'Internal Server Error saving PO', details: err.message })
  }
}

// --- LOGIC FOR: updatePO ---
export async function handleUpdatePO(req, res) {
  console.log('🏁 [Vercel] handleUpdatePO started!')
  const data = req.body
  let doc
  let newRevisionRow

  try {
    doc = await openDoc()
    const now = new Date().toISOString()
    const poSheet = getSheet(doc, 'purchase_orders')
    const itemSheet = getSheet(doc, 'purchase_order_items')

    // Dapatkan data revisi sebelumnya
    const poId = String(data.poId) // Pastikan poId ada
    if (!poId) {
      throw new Error('PO ID is required for update.')
    }

    const latest = await latestRevisionNumberForPO(poId, doc)
    const prevRow = latest >= 0 ? await getHeaderForRevision(poId, latest, doc) : null
    const prev = prevRow ? prevRow.toObject() : {}
    const newRev = latest >= 0 ? latest + 1 : 0

    // Data untuk baris revisi baru di sheet
    const newRevisionRowData = {
      id: poId,
      revision_number: newRev,
      po_number: data.nomorPo ?? prev.po_number ?? `PO-${poId}`, // Pastikan ada nomor PO
      project_name: data.namaCustomer ?? prev.project_name ?? 'N/A',
      deadline: data.tanggalKirim ?? prev.deadline ?? null,
      status: data.status ?? prev.status ?? 'Open',
      priority: data.prioritas ?? prev.priority ?? 'Normal',
      notes: data.catatan ?? prev.notes ?? '',
      kubikasi_total: toNum(data.kubikasi_total, toNum(prev.kubikasi_total, 0)), // Ambil dari data baru atau lama
      acc_marketing: data.marketing ?? prev.acc_marketing ?? '',
      created_at: now, // Timestamp revisi
      pdf_link: 'generating...',
      revised_by: data.revisedBy || 'Unknown', // Nama perevisi
      alamat_kirim: data.alamatKirim ?? prev.alamat_kirim ?? ''
    }

    console.log(`📝 [Vercel] Adding revision ${newRev} row to sheet for PO ${poId}`)
    newRevisionRow = await poSheet.addRow(newRevisionRowData)

    // Proses item untuk revisi baru
    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw) => {
      const clean = scrubItemPayload(raw)
      const kubikasiItem = toNum(raw.kubikasi, 0)
      const newItem = {
        id: nextItemId, // ID unik baru
        purchase_order_id: poId,
        revision_number: newRev, // Set revisi item baru
        kubikasi: kubikasiItem,
        ...clean
      }
      itemsWithIds.push({ ...raw, id: nextItemId, kubikasi: kubikasiItem })
      nextItemId++
      return newItem
    })

    if (itemsToAdd.length > 0) {
      console.log(
        `➕ [Vercel] Adding ${itemsToAdd.length} items to sheet for PO ${poId} Rev ${newRev}`
      )
      await itemSheet.addRows(itemsToAdd)
    } else {
      console.warn(`⚠️ [Vercel] No items provided for PO ${poId} Rev ${newRev}`)
    }

    // Siapkan data untuk generateAndUploadPO
    const poDataForUpload = {
      // Ambil data dari newRevisionRowData agar konsisten
      po_number: newRevisionRowData.po_number,
      project_name: newRevisionRowData.project_name,
      deadline: newRevisionRowData.deadline,
      priority: newRevisionRowData.priority,
      notes: newRevisionRowData.notes,
      created_at: newRevisionRowData.created_at, // Timestamp revisi
      kubikasi_total: newRevisionRowData.kubikasi_total,
      acc_marketing: newRevisionRowData.acc_marketing,
      alamat_kirim: newRevisionRowData.alamat_kirim,
      // Data lain
      items: itemsWithIds, // Item baru untuk revisi ini
      poPhotoBase64: data.poPhotoBase64 // Sertakan base64 jika dikirim dari frontend
    }

    console.log(`⏳ [Vercel] Calling generateAndUploadPO for PO ${poId} Rev ${newRev}...`)
    // Panggil fungsi generateAndUploadPO yang baru
    const uploadResult = await generateAndUploadPO(poDataForUpload, newRev)

    // Update link di sheet
    console.log(`🔄 [Vercel] Updating pdf_link for PO ${poId} Rev ${newRev}...`)
    newRevisionRow.set(
      'pdf_link',
      uploadResult.success
        ? uploadResult.link
        : `ERROR: ${uploadResult.error || 'Unknown upload error'}`
    )
    await newRevisionRow.save()
    console.log(`✅ [Vercel] pdf_link updated.`)

    // Kirim respons sukses
    return res.status(200).json({ success: true, revision_number: newRev })
  } catch (err) {
    // Tangani error
    console.error('💥 [Vercel] ERROR in handleUpdatePO:', err.message, err.stack)
    // Update link error jika baris revisi sudah dibuat
    if (newRevisionRow && !newRevisionRow.get('pdf_link')?.startsWith('http')) {
      try {
        // @ts-ignore
        newRevisionRow.set('pdf_link', `ERROR: ${err.message}`)
        await newRevisionRow.save()
      } catch (saveErr) {
        // @ts-ignore
        console.error('   -> Failed to save error link back to sheet:', saveErr.message)
      }
    }
    // @ts-ignore
    return res
      .status(500)
      .json({ success: false, error: 'Internal Server Error updating PO', details: err.message })
  }
}

// --- LOGIC FOR: deletePO ---
export async function handleDeletePO(req, res) {
  const { poId } = req.query
  const startTime = Date.now()
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
  let deletedFilesCount = 0,
    failedFilesCount = 0,
    failedFiles = []
  if (uniqueFileIds.length > 0) {
    const deleteResults = await processBatch(uniqueFileIds, deleteGoogleDriveFile, 5)
    deleteResults.forEach((result) => {
      if (result.success) deletedFilesCount++
      else {
        failedFilesCount++
        failedFiles.push({ fileId: result.fileId, error: result.error })
      }
    })
  }
  const sheetDeletions = []
  poProgressRows.reverse().forEach((row) => sheetDeletions.push(row.delete()))
  toDelHdr.reverse().forEach((row) => sheetDeletions.push(row.delete()))
  toDelItems.reverse().forEach((row) => sheetDeletions.push(row.delete()))
  await Promise.allSettled(sheetDeletions)
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  const summary = {
    deletedRevisions: toDelHdr.length,
    deletedItems: toDelItems.length,
    deletedProgressRecords: poProgressRows.length,
    deletedFiles: deletedFilesCount,
    failedFileDeletes: failedFilesCount,
    duration: `${duration}s`,
    failedFiles: failedFiles.length > 0 ? failedFiles : undefined
  }
  const message = `PO berhasil dihapus (${summary.deletedRevisions} revisi, ${summary.deletedItems} item, ${summary.deletedFiles} file).`
  return res.status(200).json({ success: true, message, summary })
}

// --- LOGIC FOR: getProducts ---
export async function handleGetProducts(req, res) {
  const doc = await openDoc()
  const sheet = getSheet(doc, 'product_master')
  const rows = await sheet.getRows()
  const products = rows.map((r) => r.toObject())
  return res.status(200).json(products)
}

// --- LOGIC FOR: listPOItems ---
export async function handleListPOItems(req, res) {
  const { poId } = req.query
  const doc = await openDoc()
  const latestRev = await latestRevisionNumberForPO(String(poId), doc)
  if (latestRev < 0) return res.status(200).json([])
  const items = await getItemsByRevision(String(poId), latestRev, doc)
  return res.status(200).json(items)
}

// --- LOGIC FOR: getRevisionHistory ---
export async function handleGetRevisionHistory(req, res) {
  const { poId } = req.query
  const doc = await openDoc()
  const poSheet = await getSheet(doc, 'purchase_orders')
  const allPoRows = await poSheet.getRows()
  const metas = allPoRows
    .filter((r) => String(r.get('id')).trim() === String(poId).trim())
    .map((r) => r.toObject())
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
  return res.status(200).json(history)
}

// --- LOGIC FOR: previewPO ---
export async function handlePreviewPO(req, res) {
  const data = req.body
  const poData = { ...data, created_at: new Date().toISOString() }
  const result = await generatePOJpeg(poData, 'preview')
  if (result.success) {
    const base64Data = result.buffer.toString('base64')
    return res.status(200).json({ success: true, base64Data: base64Data })
  }
  throw new Error(result.error || 'Failed to generate JPEG buffer')
}

// --- LOGIC FOR: updateItemProgress ---
export async function handleUpdateItemProgress(req, res) {
  const { poId, itemId, poNumber, stage, notes, photoBase64 } = req.body
  let photoLink = null
  if (photoBase64) {
    const auth = getAuth()
    const drive = google.drive({ version: 'v3', auth })
    const timestamp = new Date().toISOString().replace(/:/g, '-')
    const fileName = `PO-${poNumber}_ITEM-${itemId}_${timestamp}.jpg`
    const imageBuffer = Buffer.from(photoBase64, 'base64')
    const bufferStream = new stream.PassThrough()
    bufferStream.end(imageBuffer)
    const response = await drive.files.create({
      requestBody: { name: fileName, mimeType: 'image/jpeg', parents: [PROGRESS_PHOTOS_FOLDER_ID] },
      media: { mimeType: 'image/jpeg', body: bufferStream },
      fields: 'id, webViewLink',
      supportsAllDrives: true
    })
    photoLink = response.data.webViewLink
  }
  const doc = await openDoc()
  const progressSheet = await getSheet(doc, 'progress_tracking')
  const nextId = await getNextIdFromSheet(progressSheet)
  await progressSheet.addRow({
    id: nextId,
    purchase_order_id: poId,
    purchase_order_item_id: itemId,
    stage: stage,
    notes: notes || '',
    photo_url: photoLink,
    created_at: new Date().toISOString()
  })
  return res.status(200).json({ success: true })
}

// --- LOGIC FOR: getActivePOsWithProgress ---
export async function handleGetActivePOsWithProgress(req, res) {
  console.log('--- 🏃‍♂️ EXECUTING handleGetActivePOsWithProgress ---')
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
  poRows.forEach((r) => {
    const id = String(r.get('id')).trim(),
      rev = toNum(r.get('revision_number'), -1)
    if (!byId.has(id) || rev > (byId.get(id)?.rev ?? -1)) byId.set(id, { rev, row: r })
  })
  const activePOs = Array.from(byId.values())
    .map(({ row }) => row)
    .filter((r) => r.get('status') !== 'Completed' && r.get('status') !== 'Cancelled')
  const progressByCompositeKey = progressRows.reduce((acc, row) => {
    const key = `${row.get('purchase_order_id')}-${row.get('purchase_order_item_id')}`
    if (!acc[key]) acc[key] = []
    acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
    return acc
  }, {})
  const latestItemRevisions = itemRows.reduce((acc, item) => {
    const poId = item.get('purchase_order_id'),
      rev = toNum(item.get('revision_number'), -1)
    if (!acc.has(poId) || rev > acc.get(poId)) acc.set(poId, rev)
    return acc
  }, new Map())
  const result = activePOs.map((po) => {
    const poId = po.get('id'),
      latestRev = latestItemRevisions.get(poId) ?? -1
    const poItems = itemRows.filter(
      (item) =>
        item.get('purchase_order_id') === poId &&
        toNum(item.get('revision_number'), -1) === latestRev
    )
    if (poItems.length === 0) return { ...po.toObject(), progress: 0 }
    let totalPercentage = poItems.reduce((total, item) => {
      const itemId = item.get('id'),
        stages = PRODUCTION_STAGES
      const itemProgress = progressByCompositeKey[`${poId}-${itemId}`] || []
      let latestStageIndex = -1
      if (itemProgress.length > 0) {
        const latest = [...itemProgress].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0]
        latestStageIndex = stages.indexOf(latest.stage)
      }
      return total + (latestStageIndex >= 0 ? ((latestStageIndex + 1) / stages.length) * 100 : 0)
    }, 0)
    return { ...po.toObject(), progress: Math.round(totalPercentage / poItems.length) }
  })
  return res.status(200).json(result)
}

// --- LOGIC FOR: getPOItemsWithDetails ---
export async function handleGetPOItemsWithDetails(req, res) {
  const { poId } = req.query
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
  const allItemsForPO = itemRows.filter((r) => r.get('purchase_order_id') === poId)
  if (allItemsForPO.length === 0) {
    return res.status(200).json([])
  }
  const latestItemRev = Math.max(-1, ...allItemsForPO.map((r) => toNum(r.get('revision_number'))))
  const poData = poRows.find(
    (r) => r.get('id') === poId && toNum(r.get('revision_number')) === latestItemRev
  )
  // --- AKHIR LOGIKA BARU ---

  if (!poData) {
    throw new Error(`Data PO untuk revisi terbaru (rev ${latestItemRev}) tidak ditemukan.`)
  }

  const poStartDate = new Date(poData.get('created_at'))
  const poDeadline = new Date(poData.get('deadline'))

  let stageDeadlines = []
  let cumulativeDate = new Date(poStartDate) // Mulai dari tanggal PO dibuat
  stageDeadlines = PRODUCTION_STAGES.map((stageName) => {
    // Jika tahap terakhir, gunakan deadline utama PO
    if (stageName === 'Siap Kirim') {
      return { stageName, deadline: poDeadline.toISOString() }
    }
    // Ambil durasi dari konstanta, default 0 jika tidak ada
    const durationDays = DEFAULT_STAGE_DURATIONS[stageName] || 0
    // Tambahkan durasi ke tanggal kumulatif
    cumulativeDate.setDate(cumulativeDate.getDate() + durationDays)
    // Simpan hasilnya
    return { stageName, deadline: new Date(cumulativeDate).toISOString() }
  })

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

  return res.status(200).json(result)
}

// --- LOGIC FOR: getRecentProgressUpdates ---
export async function handleGetRecentProgressUpdates(req, res) {
  console.log('--- ✨ EXECUTING handleGetRecentProgressUpdates ---')
  const doc = await openDoc()
  const [progressSheet, itemSheet, poSheet] = await Promise.all([
    getSheet(doc, 'progress_tracking'),
    getSheet(doc, 'purchase_order_items'),
    getSheet(doc, 'purchase_orders')
  ])
  const [progressRows, itemRows, poRows] = await Promise.all([
    progressSheet.getRows(),
    itemSheet.getRows(),
    poSheet.getRows()
  ])
  const itemMap = new Map(itemRows.map((r) => [r.get('id'), r.toObject()]))
  const poMap = poRows.reduce((acc, r) => {
    const poId = r.get('id'),
      rev = toNum(r.get('revision_number'))
    if (!acc.has(poId) || rev > acc.get(poId).revision_number) acc.set(poId, r.toObject())
    return acc
  }, new Map())
  const limit = req.query.limit ? parseInt(req.query.limit) : 10
  const enrichedUpdates = progressRows
    .map((r) => r.toObject())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
    .map((update) => {
      const item = itemMap.get(update.purchase_order_item_id)
      if (!item) return null
      const po = poMap.get(item.purchase_order_id)
      if (!po) return null
      return { ...update, item_name: item.product_name, po_number: po.po_number }
    })
    .filter(Boolean)
  return res.status(200).json(enrichedUpdates)
}

// --- LOGIC FOR: getAttentionData ---
export async function handleGetAttentionData(req, res) {
  console.log('--- 🎯 EXECUTING handleGetAttentionData ---')
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
  const latestPoMap = poRows.reduce((map, r) => {
    const id = r.get('id'),
      rev = toNum(r.get('revision_number'))
    if (!map.has(id) || rev > map.get(id).rev) map.set(id, { rev, row: r })
    return map
  }, new Map())
  const latestItemRevisions = itemRows.reduce((map, item) => {
    const poId = item.get('purchase_order_id'),
      rev = toNum(item.get('revision_number'), -1)
    if (!map.has(poId) || rev > map.get(poId)) map.set(poId, rev)
    return map
  }, new Map())
  const activeItems = itemRows.filter((item) => {
    const poData = latestPoMap.get(item.get('purchase_order_id'))
    if (!poData) return false
    const po = poData.row
    const latestRev = latestItemRevisions.get(item.get('purchase_order_id')) ?? -1
    return (
      po.get('status') !== 'Completed' &&
      po.get('status') !== 'Cancelled' &&
      toNum(item.get('revision_number')) === latestRev
    )
  })
  const progressByCompositeKey = progressRows.reduce((acc, row) => {
    const key = `${row.get('purchase_order_id')}-${row.get('purchase_order_item_id')}`
    if (!acc[key]) acc[key] = []
    acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
    return acc
  }, {})
  const nearingDeadline = [],
    stuckItems = [],
    urgentItems = []
  const today = new Date(),
    sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000),
    fiveDaysAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000)
  activeItems.forEach((item) => {
    const po = latestPoMap.get(item.get('purchase_order_id')).row
    const itemProgress = progressByCompositeKey[`${po.get('id')}-${item.get('id')}`] || []
    const latestProgress = [...itemProgress].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]
    const currentStage = latestProgress ? latestProgress.stage : 'Belum Mulai'
    const attentionItem = {
      po_number: po.get('po_number'),
      item_name: item.get('product_name'),
      current_stage: currentStage
    }
    if (po.get('priority') === 'Urgent') urgentItems.push(attentionItem)
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
  return res.status(200).json({ nearingDeadline, stuckItems, urgentItems })
}

// --- LOGIC FOR: getProductSalesAnalysis ---
export async function handleGetProductSalesAnalysis(req, res) {
  // Log awal untuk Vercel
  console.log('🏁 [Vercel] handleGetProductSalesAnalysis started!')
  try {
    const doc = await openDoc()
    const [itemSheet, poSheet, productSheet] = await Promise.all([
      getSheet(doc, 'purchase_order_items'),
      getSheet(doc, 'purchase_orders'),
      getSheet(doc, 'product_master')
    ])
    const [itemRowsRaw, poRowsRaw, productRowsRaw] = await Promise.all([
      itemSheet.getRows(),
      poSheet.getRows(),
      productSheet.getRows()
    ])

    // Konversi ke Objek Biasa
    const itemRows = itemRowsRaw.map((r) => r.toObject())
    const poRows = poRowsRaw.map((r) => r.toObject())
    const productRows = productRowsRaw.map((r) => r.toObject())

    // Buat Map PO Revisi Terbaru (semua status kecuali Cancelled)
    const latestPoMap = poRows.reduce((map, po) => {
      const poId = po.id
      const rev = toNum(po.revision_number)
      if (po.status !== 'Cancelled') {
        const existing = map.get(poId)
        if (!existing || rev > existing.revision_number) {
          // Simpan seluruh objek PO terbaru
          map.set(poId, { ...po, revision_number: rev })
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
      // Pastikan item berasal dari PO revisi terbaru yang valid
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

    const allProductKeys = new Set()
    sortedMonths.forEach((month) => {
      if (monthlySalesByProduct[month])
        Object.keys(monthlySalesByProduct[month]).forEach((p) => allProductKeys.add(p))
    })
    const allMarketingKeys = new Set()
    sortedMonths.forEach((month) => {
      if (monthlySalesByMarketing[month])
        Object.keys(monthlySalesByMarketing[month]).forEach((m) => allMarketingKeys.add(m))
    })

    const monthlyProductChartData = sortedMonths.map((month) => {
      const monthData = { month }
      allProductKeys.forEach((prodKey) => {
        monthData[prodKey] = monthlySalesByProduct[month]?.[prodKey] || 0
      })
      return monthData
    })

    const monthlyMarketingChartData = sortedMonths.map((month) => {
      const monthData = { month }
      allMarketingKeys.forEach((markKey) => {
        monthData[markKey] = monthlySalesByMarketing[month]?.[markKey] || 0
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
        const last30 = salesLast30[name] || 0
        const prev30 = salesPrev30[name] || 0
        const change =
          prev30 === 0 && last30 > 0 ? 100 : ((last30 - prev30) / (prev30 === 0 ? 1 : prev30)) * 100
        return { name, last30, prev30, change }
      })
      .filter((p) => p.change > 10 && p.last30 > p.prev30)
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

    console.log('📊 [Vercel] Analisis Penjualan Dihasilkan.') // Log sukses Vercel
    // --- Return untuk Vercel ---
    return res.status(200).json(analysisResult)
  } catch (err) {
    console.error('❌ [Vercel] Gagal melakukan analisis penjualan produk:', err.message, err.stack) // Log error + stack
    // Return struktur kosong jika error
    const emptyResult = {
      topSellingProducts: [],
      salesByMarketing: [],
      monthlyProductChartData: [],
      monthlyMarketingChartData: [],
      woodTypeDistribution: [],
      topCustomers: [],
      trendingProducts: [],
      slowMovingProducts: []
    }
    return res.status(500).json(emptyResult) // Kirim error 500
  }
}

// --- LOGIC FOR: getSalesItemData ---
export async function handleGetSalesItemData(req, res) {
  const doc = await openDoc()
  const [itemSheet, poSheet] = await Promise.all([
    getSheet(doc, 'purchase_order_items'),
    getSheet(doc, 'purchase_orders')
  ])
  const [itemRows, poRows] = await Promise.all([itemSheet.getRows(), poSheet.getRows()])
  const poMap = poRows.reduce((map, r) => {
    const poId = r.get('id'),
      rev = toNum(r.get('revision_number'))
    if (!map.has(poId) || rev > map.get(poId).revision_number) map.set(poId, r.toObject())
    return map
  }, new Map())
  const combinedData = itemRows
    .map((item) => {
      const po = poMap.get(item.get('purchase_order_id'))
      if (!po) return null
      return { ...item.toObject(), customer_name: po.project_name, po_date: po.created_at }
    })
    .filter(Boolean)
  return res.status(200).json(combinedData)
}

export async function handleAddNewProduct(req, res) {
  const productData = req.body
  try {
    const doc = await openDoc()
    const sheet = await getSheet(doc, 'product_master')
    const nextId = await getNextIdFromSheet(sheet)
    await sheet.addRow({ id: nextId, ...productData })
    return res.status(200).json({ success: true, newId: nextId })
  } catch (error) {
    console.error('❌ Gagal menambahkan produk baru di Vercel:', error.message)
    return res.status(500).json({ success: false, error: error.message })
  }
}

// --- LOGIC FOR: listPORevisions ---
export async function handleListPORevisions(req, res) {
  const { poId } = req.query
  const doc = await openDoc()
  const poSheet = await getSheet(doc, 'purchase_orders')
  const rows = await poSheet.getRows()
  const revisions = rows
    .filter((r) => String(r.get('id')).trim() === String(poId).trim())
    .map((r) => r.toObject())
    .sort((a, b) => a.revision_number - b.revision_number)
  return res.status(200).json(revisions)
}

// --- LOGIC FOR: listPOItemsByRevision ---
export async function handleListPOItemsByRevision(req, res) {
  const { poId, revisionNumber } = req.query
  const doc = await openDoc()
  const items = await getItemsByRevision(String(poId), toNum(revisionNumber, 0), doc)
  return res.status(200).json(items)
}

// --- LOGIC FOR: updateStageDeadline ---
export async function handleUpdateStageDeadline(req, res) {
  const { poId, itemId, stageName, newDeadline } = req.body
  const doc = await openDoc()
  const sheet = await getSheet(doc, 'progress_tracking')
  await sheet.addRow({
    purchase_order_id: poId,
    purchase_order_item_id: itemId,
    stage: `DEADLINE_OVERRIDE: ${stageName}`,
    custom_deadline: newDeadline,
    created_at: new Date().toISOString()
  })
  return res.status(200).json({ success: true })
}

async function listPOsForChat() {
  const doc = await openDoc()
  const poSheet = getSheet(doc, 'purchase_orders')
  const itemSheet = getSheet(doc, 'purchase_order_items')
  const progressSheet = getSheet(doc, 'progress_tracking')

  const [poRowsRaw, itemRowsRaw, progressRowsRaw] = await Promise.all([
    poSheet.getRows(),
    itemSheet.getRows(),
    progressSheet.getRows()
  ])

  // Bersihkan data mentah
  const poRows = poRowsRaw.map((r) => r.toObject())
  const itemRows = itemRowsRaw.map((r) => r.toObject())
  const progressRows = progressRowsRaw.map((r) => r.toObject())

  // Logika revisi terbaru
  const byId = new Map()
  for (const r of poRows) {
    const id = String(r.id).trim()
    const rev = toNum(r.revision_number, -1)
    if (!byId.has(id) || rev > byId.get(id).rev) {
      byId.set(id, { rev, row: r })
    }
  }
  const latestPoObjects = Array.from(byId.values()).map(({ row }) => row)

  // Siapkan helper maps
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

  // Hitung status/progress (Logika yang sama persis dari listPOs)
  const result = latestPoObjects.map((poObject) => {
    const poId = poObject.id
    const latestRev = latestItemRevisions.get(poId) ?? -1
    const poItems = itemRows.filter(
      (item) => item.purchase_order_id === poId && toNum(item.revision_number, -1) === latestRev
    )

    let poProgress = 0
    let finalStatus = poObject.status || 'Open'
    let completed_at = null

    if (poItems.length > 0) {
      let totalPercentage = 0
      poItems.forEach((item) => {
        const itemId = item.id
        const itemProgressHistory = progressByCompositeKey[`${poId}-${itemId}`] || []
        let latestStageIndex = -1

        if (itemProgressHistory.length > 0) {
          const latestProgress = itemProgressHistory.sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
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
    return {
      ...poObject,
      items: poItems,
      progress: roundedProgress,
      status: finalStatus,
      completed_at: completed_at
    }
  })

  return result
}

export async function handleOllamaChat(req, res) {
  const { prompt } = req.body
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' })

  // 1. Dapatkan data PO (konteks)
  let allPOs
  try {
    allPOs = await listPOsForChat() // Panggil fungsi listPOs versi Vercel
    if (!allPOs || allPOs.length === 0) {
      return res.status(200).json({ response: 'Maaf, data PO belum tersedia.' })
    }
  } catch (e) {
    console.error('Gagal mengambil data PO untuk konteks AI:', e.message)
    return res.status(200).json({ response: 'Maaf, saya gagal mengambil data PO terbaru.' })
  }

  // 2. Siapkan System Prompt untuk "Tool Use"
  const today = new Date().toISOString().split('T')[0]
  const systemPrompt = `Anda adalah Asisten ERP Ubinkayu. Tugas Anda adalah mengubah pertanyaan pengguna menjadi JSON 'perintah' berdasarkan alat (tools) yang tersedia.
  Hari ini adalah ${today}.

  Alat (Tools) yang Tersedia:
  1. "getTotalPO": Menghitung jumlah total SEMUA PO, SEMUA PO aktif (status BUKAN Completed/Cancelled), dan SEMUA PO selesai.
     - Keywords: "jumlah po", "total po", "ada berapa po", "semua po aktif", "berapa po aktif", "jumlah po yang sedang berjalan", "how many purchase orders".
     - JANGAN gunakan tool ini jika user HANYA bertanya tentang PO Urgent.
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
  5. "getUrgentPOs": Menampilkan daftar PO aktif yang prioritasnya HANYA Urgent.
     - Keywords: "po urgent", "urgent orders", "hanya yang urgent", "prioritas urgent".
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
  10. "help": Memberikan bantuan atau daftar perintah yang bisa dilakukan.
      - Keywords: "bantuan", "help", "apa yang bisa kamu lakukan", "perintah".
      - JSON: {"tool": "help"}
  11. "general": Untuk pertanyaan umum atau sapaan yang tidak terkait langsung dengan data PO.
      - Keywords: "halo", "kamu siapa", "dengan siapa ini", "terima kasih".
      - JSON: {"tool": "general"}
  12. "getPOByStatusCount": Menghitung jumlah PO aktif dengan status spesifik (Open atau In Progress).
    - Keywords: "berapa po open", "jumlah po in progress", "yang statusnya open", "yang sedang dikerjakan".
    - AI HARUS mengekstrak "param" (status yang diminta: "Open" atau "In Progress"). Case insensitive tidak masalah.
    - JSON: {"tool": "getPOByStatusCount", "param": "STATUS_DIMINTA"}

  ATURAN KETAT:
  - JANGAN menjawab pertanyaan secara langsung.
  - HANYA kembalikan JSON.
  - Jika pertanyaan "po bulan oktober ini", AI harus mengerti ini tahun 2025 dan kembalikan: {"tool": "getPOsByDateRange", "startDate": "2025-10-01", "endDate": "2025-10-31"}
  - Jika pertanyaan "po terbaru", kembalikan: {"tool": "getNewestPOs"}
  - Jika pertanyaan "halo", kembalikan: {"tool": "general"}
  - Jika tidak yakin, kembalikan: {"tool": "unknown"}
  `
  // --- AKHIR DARI SALINAN SYSTEM PROMPT ---

  // 3. Panggil Gemini HANYA untuk klasifikasi
  let aiDecision
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    // Minta Gemini mengembalikan JSON
    const generationConfig = { responseMimeType: 'application/json' }
    const fullPrompt = `${systemPrompt}\nPertanyaan Pengguna: "${prompt}"\n\JSON Perintah:`

    const result = await model.generateContent(fullPrompt, generationConfig)
    const response = await result.response
    const text = response.text()
    aiDecision = JSON.parse(text) // Gemini langsung kembalikan JSON
  } catch (err) {
    console.error('Error klasifikasi Gemini:', err)
    return res
      .status(500)
      .json({ error: 'Maaf, terjadi kesalahan saat memahami permintaan Anda (Gemini).' })
  }

  // 4. Jalankan Alat (Tools) di JavaScript (SAMA PERSIS DENGAN SWITCH CASE OLLAMA)
  try {
    let responseText = '' // Variabel untuk menyimpan jawaban

    switch (aiDecision.tool) {
      case 'getTotalPO': {
        const totalPOs = allPOs.length
        const activePOs = allPOs.filter(
          (po) => po.status !== 'Completed' && po.status !== 'Cancelled'
        ).length
        const completedPOs = allPOs.filter((po) => po.status === 'Completed').length
        responseText = `Saat ini ada ${totalPOs} total PO di database.\n\n- ${activePOs} PO sedang aktif.\n- ${completedPOs} PO sudah selesai.`
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
              salesData[item.product_name] =
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
            customerData[po.project_name] =
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
            ? `Customer terbesar (m³) dari PO Selesai adalah: ${topCustomer} (${customerData[topCustomer].toFixed(3)} m³).`
            : 'Tidak dapat menemukan customer terbesar.'
        break
      }

      case 'getPOStatus': {
        const poNumber = aiDecision.param
        if (!poNumber) {
          responseText = 'Mohon sebutkan nomor PO yang ingin dicek (contoh: status po 123).'
          break
        }
        const latestPO = allPOs
          .filter((po) => po.po_number === poNumber)
          .sort((a, b) => Number(b.revision_number || 0) - Number(a.revision_number || 0))[0]
        responseText = latestPO
          ? `Status PO ${poNumber} (${latestPO.project_name}) adalah: ${latestPO.status || 'Open'}. Progress: ${latestPO.progress?.toFixed(0) || 0}%.`
          : `PO ${poNumber} tidak ditemukan.`
        break
      }

      case 'getUrgentPOs': {
        const urgentPOs = allPOs.filter(
          (po) => po.priority === 'Urgent' && po.status !== 'Completed' && po.status !== 'Cancelled'
        )
        if (urgentPOs.length > 0) {
          const poNumbers = urgentPOs
            .map((po) => `- ${po.po_number} (${po.project_name})`)
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
          .map((po) => `- ${po.po_number} (${po.project_name}), Tgl: ${formatDate(po.created_at)}`)
          .join('\n')
        responseText = `Berikut adalah 3 PO terbaru yang masuk:\n${poDetails}`
        break
      }

      case 'getOldestPO': {
        const sortedPOs = [...allPOs].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        const oldestPO = sortedPOs[sortedPOs.length - 1]
        if (oldestPO) {
          responseText = `PO terlama yang tercatat adalah:\n- Nomor PO: ${oldestPO.po_number}\n- Customer: ${oldestPO.project_name}\n- Tanggal Masuk: ${formatDate(oldestPO.created_at)}`
        } else {
          responseText = 'Tidak dapat menemukan data PO.'
        }
        break
      }

      case 'getPOsByDateRange': {
        const { startDate, endDate } = aiDecision
        if (!startDate || !endDate) {
          responseText =
            "Maaf, saya tidak mengerti rentang tanggal yang Anda maksud. Coba lagi (misal: 'po bulan oktober')."
          break
        }
        const start = new Date(startDate).getTime()
        const end = new Date(endDate).getTime() + (24 * 60 * 60 * 1000 - 1)

        const foundPOs = allPOs.filter((po) => {
          try {
            const poDate = new Date(po.created_at).getTime()
            return poDate >= start && poDate <= end
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
                `- ${po.po_number} (${po.project_name}), Tgl Masuk: ${formatDate(po.created_at)}`
            )
            .slice(0, 10)
            .join('\n')

          responseText = `Saya menemukan ${foundPOs.length} PO untuk rentang tanggal ${dateRangeStr}:\n${poDetails}`
          if (foundPOs.length > 10) responseText += `\n...dan ${foundPOs.length - 10} lainnya.`
        } else {
          responseText = `Tidak ada PO yang ditemukan untuk rentang tanggal ${dateRangeStr}.`
        }
        break
      }

      case 'getPOByStatusCount': {
        const requestedStatus = aiDecision.param
        if (
          !requestedStatus ||
          (requestedStatus.toLowerCase() !== 'open' &&
            requestedStatus.toLowerCase() !== 'in progress')
        ) {
          responseText = 'Mohon sebutkan status yang ingin dihitung (Open atau In Progress).'
          break
        }
        // Normalisasi status (misal: "open" -> "Open")
        const normalizedStatus =
          requestedStatus.charAt(0).toUpperCase() + requestedStatus.slice(1).toLowerCase()

        const count = allPOs.filter(
          // Filter hanya PO Aktif dengan status yang cocok
          (po) =>
            po.status === normalizedStatus && po.status !== 'Completed' && po.status !== 'Cancelled'
        ).length

        responseText = `Ada ${count} PO aktif dengan status "${normalizedStatus}".`
        break
      }

      case 'help':
        responseText =
          'Anda bisa bertanya tentang:\n- Jumlah total PO\n- Produk terlaris\n- Customer terbesar\n- Status PO [nomor PO]\n- PO Urgent\n- PO Deadline Dekat\n- PO terbaru / terlama\n- PO berdasarkan tanggal'
        break

      case 'general':
        if (prompt.toLowerCase().includes('siapa')) {
          responseText = 'Saya adalah Asisten AI Ubinkayu, siap membantu Anda.'
        } else if (prompt.toLowerCase().includes('terima kasih')) {
          responseText = 'Sama-sama! Senang bisa membantu.'
        } else {
          responseText = 'Halo! Ada yang bisa saya bantu?'
        }
        break

      default:
        responseText =
          "Maaf, saya tidak yakin bagaimana harus merespons itu. Coba tanyakan 'bantuan' untuk melihat apa yang bisa saya lakukan."
        break
    }

    // Kembalikan jawaban yang sudah dieksekusi
    return res.status(200).json({ response: responseText })
  } catch (execError) {
    console.error('Error saat menjalankan alat:', execError)
    return res.status(500).json({ error: 'Maaf, terjadi kesalahan saat memproses jawaban Anda.' })
  }
}
