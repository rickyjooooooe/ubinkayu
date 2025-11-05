/* eslint-disable @typescript-eslint/ban-ts-comment */
// file: api/_controller.js

import {
  openDoc,
  openUserDoc,
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
  uploadPoPhoto,
  DEFAULT_STAGE_DURATIONS
} from './_helpers.js'
import { google } from 'googleapis'
import stream from 'stream'

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

// --- [BARU] Helper untuk filter PO berdasarkan marketing ---
function filterPOsByMarketing(poList, user) {
  if (!user || user.role !== 'marketing') {
    return poList
  }
  const marketingName = user.name.toLowerCase()
  console.log(`[Vercel Filter] Menerapkan filter Marketing untuk: ${user.name}`)
  return poList.filter((po) => {
    let poMarketing = ''
    // Handle jika 'po' adalah GoogleSpreadsheetRow atau plain object
    if (typeof po.get === 'function') {
      poMarketing = po.get('acc_marketing')
    } else {
      poMarketing = po.acc_marketing
    }
    return poMarketing?.toLowerCase() === marketingName
  })
}
// --- [AKHIR HELPER BARU] ---

export async function handleLoginUser(req, res) {
  console.log('✅ [Vercel Controller] Entered handleLoginUser function.')
  console.log('🏁 [Vercel] handleLoginUser started!')
  const { username, password } = req.body
  console.log(
    `  -> Received username: ${username ? '***' : 'MISSING'}, password: ${password ? '***' : 'MISSING'}`
  )

  if (!username || !password) {
    console.warn('⚠️ [Vercel Login] Missing username or password in request body.')
    return res.status(400).json({ success: false, error: 'Username dan password harus diisi.' })
  }

  try {
    console.log('  -> Attempting to call openUserDoc()...')
    const doc = await openUserDoc()
    console.log('  -> openUserDoc() successful. Attempting getSheet("users")...')
    const userSheet = await getSheet(doc, 'users')
    console.log(`✅ [Vercel Login] Accessed sheet: ${userSheet.title}`)

    await userSheet.loadHeaderRow()
    const headers = userSheet.headerValues
    console.log('✅ [Vercel Login] Sheet headers:', headers)

    const usernameHeader = 'login_username'
    const passwordHeader = 'login_pwd'
    const nameHeader = 'name'
    const roleHeader = 'role'

    if (!headers.includes(usernameHeader) || !headers.includes(passwordHeader)) {
      console.error(
        `❌ [Vercel Login] Missing required columns (${usernameHeader} or ${passwordHeader}) in sheet "${userSheet.title}"`
      )
      return res.status(500).json({ success: false, error: 'Kesalahan konfigurasi server.' })
    }

    const rows = await userSheet.getRows()
    console.log(`ℹ️ [Vercel Login] Found ${rows.length} user rows.`)

    const trimmedUsernameLower = username.trim().toLowerCase()
    const userRow = rows.find(
      (row) => row.get(usernameHeader)?.trim().toLowerCase() === trimmedUsernameLower
    )

    if (userRow) {
      const foundUsername = userRow.get(usernameHeader)
      console.log(`👤 [Vercel Login] User found: ${foundUsername}`)

      const storedPassword = userRow.get(passwordHeader)

      if (storedPassword === password) {
        console.log(`✅ [Vercel Login] Password match for user: ${foundUsername}`)
        const userName =
          headers.includes(nameHeader) && userRow.get(nameHeader)
            ? userRow.get(nameHeader)
            : foundUsername
        const userRole = headers.includes(roleHeader) ? userRow.get(roleHeader) : undefined

        return res.status(200).json({ success: true, name: userName, role: userRole })
      } else {
        console.warn(`🔑 [Vercel Login] Password mismatch for user: ${foundUsername}`)
        return res.status(401).json({ success: false, error: 'Username atau password salah.' })
      }
    } else {
      console.warn(`❓ [Vercel Login] User not found: ${username}`)
      return res.status(401).json({ success: false, error: 'Username atau password salah.' })
    }
  } catch (err) {
    console.error('💥 [Vercel Login] CRITICAL ERROR in try block:', err.message, err.stack)
    return res.status(500).json({
      success: false,
      error: 'Terjadi kesalahan pada server saat login.',
      details: err.message
    })
  }
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

// =================================================================
// KUMPULAN SEMUA LOGIKA API
// =================================================================

export async function handleListPOs(req, res) {
  console.log('🏁 [Vercel] handleListPOs function started!')
  const { user } = req.body // [TERIMA USER]

  try {
    const doc = await openDoc()
    const poSheet = getSheet(doc, 'purchase_orders')
    const itemSheet = getSheet(doc, 'purchase_order_items')
    const progressSheet = getSheet(doc, 'progress_tracking')

    const [poRows, itemRows, progressRows] = await Promise.all([
      poSheet.getRows(),
      itemSheet.getRows(),
      progressSheet.getRows()
    ])

    const byId = new Map()
    for (const r of poRows) {
      const id = String(r.get('id')).trim()
      const rev = toNum(r.get('revision_number'), -1)
      const keep = byId.get(id)
      if (!keep || rev > keep.rev) {
        byId.set(id, { rev, row: r })
      }
    }
    const latestPoRows = Array.from(byId.values()).map(({ row }) => row)

    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      const poId = row.get('purchase_order_id')
      const itemId = row.get('purchase_order_item_id')
      const key = `${poId}-${itemId}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
      return acc
    }, {})

    const itemObjects = itemRows.map((item) => item.toObject())

    const itemsByPoId = itemObjects.reduce((acc, item) => {
      const poId = item.purchase_order_id
      if (!acc[poId]) acc[poId] = []
      acc[poId].push(item)
      return acc
    }, {})

    const latestItemRevisions = new Map()
    itemObjects.forEach((item) => {
      const poId = item.purchase_order_id
      const rev = toNum(item.revision_number, -1)
      const current = latestItemRevisions.get(poId)
      if (current === undefined || rev > current) {
        latestItemRevisions.set(poId, rev)
      }
    })

    const result = latestPoRows.map((po) => {
      const poObject = po.toObject()
      const poId = poObject.id
      const latestRev = latestItemRevisions.get(poId) ?? -1

      const poItems = (itemsByPoId[poId] || []).filter(
        (item) => toNum(item.revision_number, -1) === latestRev
      )

      let poProgress = 0
      if (poItems.length > 0) {
        let totalPercentage = 0
        poItems.forEach((item) => {
          const itemId = item.id
          const stages = PRODUCTION_STAGES
          const compositeKey = `${poId}-${itemId}`
          const itemProgressHistory = progressByCompositeKey[compositeKey] || []
          let latestStageIndex = -1
          if (itemProgressHistory.length > 0) {
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

      let finalStatus = poObject.status
      let completed_at = null
      if (finalStatus !== 'Cancelled') {
        const roundedProgress = Math.round(poProgress)
        if (roundedProgress >= 100) {
          finalStatus = 'Completed'
          const allProgressForPO = progressRows
            .filter((row) => row.get('purchase_order_id') === poId)
            .map((row) => {
              try {
                return new Date(row.get('created_at')).getTime()
              } catch {
                return 0
              }
            })
            .filter((time) => time > 0)

          if (allProgressForPO.length > 0) {
            completed_at = new Date(Math.max(...allProgressForPO)).toISOString()
          }
        } else if (roundedProgress > 0) {
          finalStatus = 'In Progress'
        } else {
          finalStatus = 'Open'
        }
      }

      const lastRevisedBy = poObject.revised_by || 'N/A'
      const lastRevisedDate = poObject.created_at

      return {
        ...poObject,
        items: poItems,
        progress: Math.round(poProgress),
        status: finalStatus,
        completed_at: completed_at,
        pdf_link: poObject.pdf_link || null,
        acc_marketing: poObject.acc_marketing || '',
        alamat_kirim: poObject.alamat_kirim || '',
        lastRevisedBy: lastRevisedBy,
        lastRevisedDate: lastRevisedDate
      }
    })

    // [FILTER MARKETING]
    const filteredResult = filterPOsByMarketing(result, user)

    return res.status(200).json(filteredResult)
  } catch (err) {
    console.error('💥 [Vercel] ERROR in handleListPOs:', err.message, err.stack)
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
    console.log('⏳ [Vercel] Generating JPEG buffer...')
    const jpegResult = await generatePOJpeg(poData, revisionNumber)
    if (!jpegResult.success || !jpegResult.buffer) {
      throw new Error(jpegResult.error || 'Gagal membuat buffer JPEG.')
    }
    const jpegBuffer = jpegResult.buffer
    const fileName = jpegResult.fileName
    console.log(`✅ [Vercel] JPEG buffer created: ${fileName}`)

    console.log('🔄 [Vercel] Mendapatkan otentikasi baru sebelum upload/get...')
    auth = getAuth()
    await auth.authorize()
    console.log('✅ [Vercel] Otorisasi ulang berhasil.')

    const mimeType = 'image/jpeg'
    console.log(`🚀 [Vercel] Mengunggah file via auth.request: ${fileName} ke Drive...`)

    const metadata = {
      name: fileName,
      mimeType: mimeType,
      parents: [PO_ARCHIVE_FOLDER_ID]
    }
    const boundary = `----VercelBoundary${Date.now()}----`

    const metaPart = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n\r\n`
    )
    const mediaHeaderPart = Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`)
    const endBoundaryPart = Buffer.from(`\r\n--${boundary}--\r\n`)
    const requestBody = Buffer.concat([metaPart, mediaHeaderPart, jpegBuffer, endBoundaryPart])

    const createResponse = await auth.request({
      url: `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': requestBody.length
      },
      data: requestBody,
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    })

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

    const getResponse = await auth.request({
      url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
      method: 'GET',
      params: {
        fields: 'webViewLink,size', // Tambahkan size di sini
        supportsAllDrives: true
      }
    })

    const webViewLink = getResponse?.data?.webViewLink
    const fileSize = getResponse?.data?.size // Ambil size dari respons

    if (!webViewLink) {
      console.error('❌ [Vercel] Gagal mendapatkan webViewLink via auth.request:', getResponse.data)
      throw new Error('Gagal mendapatkan link file setelah upload berhasil.')
    }
    console.log(`✅ [Vercel] Link file didapatkan: ${webViewLink}, Size: ${fileSize}`)

    return { success: true, link: webViewLink, size: Number(fileSize || 0) }
  } catch (error) {
    console.error('❌ [Vercel] Proses Generate & Upload PO Gagal:', error.message)
    return { success: false, error: error.message, size: 0 }
  }
}

export async function handleSaveNewPO(req, res) {
  console.log('🏁 [Vercel] handleSaveNewPO started!')
  const data = req.body
  let doc, newPoRow
  let totalFileSize = 0
  let fotoLink = 'Tidak ada foto'
  let photoSize = 0

  try {
    doc = await openDoc()
    const now = new Date().toISOString()
    const poSheet = getSheet(doc, 'purchase_orders')
    const itemSheet = getSheet(doc, 'purchase_order_items')
    const poId = await getNextIdFromSheet(poSheet)

    if (data.poPhotoBase64) {
      console.log('  -> Uploading PO Reference Photo...')
      const photoResult = await uploadPoPhoto(
        data.poPhotoBase64,
        data.nomorPo || `PO-${poId}`,
        data.namaCustomer || 'Customer'
      )
      if (photoResult.success) {
        fotoLink = photoResult.link
        photoSize = photoResult.size || 0
      } else {
        fotoLink = `ERROR: ${photoResult.error || 'Upload foto gagal'}`
      }
    }

    const newPoRowData = {
      id: poId,
      revision_number: 0,
      po_number: data.nomorPo || `PO-${poId}`,
      project_name: data.namaCustomer || 'N/A',
      deadline: data.tanggalKirim || null,
      status: 'Open',
      priority: data.prioritas || 'Normal',
      notes: data.catatan || '',
      kubikasi_total: toNum(data.kubikasi_total, 0),
      acc_marketing: data.marketing || '',
      created_at: now,
      pdf_link: 'generating...',
      foto_link: fotoLink,
      file_size_bytes: 0,
      alamat_kirim: data.alamatKirim || '',
      revised_by: 'N/A'
    }

    console.log('📝 [Vercel] Adding new PO row to sheet:', newPoRowData.po_number)
    newPoRow = await poSheet.addRow(newPoRowData)

    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw) => {
      const clean = scrubItemPayload(raw)
      const kubikasiItem = toNum(raw.kubikasi, 0)
      const newItem = {
        id: nextItemId,
        purchase_order_id: poId,
        revision_number: 0,
        kubikasi: kubikasiItem,
        ...clean
      }
      itemsWithIds.push({ ...raw, id: nextItemId, kubikasi: kubikasiItem })
      nextItemId++
      return newItem
    })

    if (itemsToAdd.length > 0) {
      console.log(`➕ [Vercel] Adding ${itemsToAdd.length} items to sheet for PO ${poId}`)
      await itemSheet.addRows(itemsToAdd)
    } else {
      console.warn(`⚠️ [Vercel] No items provided for new PO ${poId}`)
    }

    const poDataForUpload = {
      po_number: newPoRowData.po_number,
      project_name: newPoRowData.project_name,
      deadline: newPoRowData.deadline,
      priority: newPoRowData.priority,
      notes: newPoRowData.notes,
      created_at: newPoRowData.created_at,
      kubikasi_total: newPoRowData.kubikasi_total,
      acc_marketing: newPoRowData.acc_marketing,
      alamat_kirim: newPoRowData.alamat_kirim,
      foto_link: fotoLink,
      items: itemsWithIds,
      poPhotoBase64: data.poPhotoBase64
    }

    console.log(`⏳ [Vercel] Calling generateAndUploadPO for PO ${poId}...`)
    const uploadResult = await generateAndUploadPO(poDataForUpload, 0)

    let jpegSize = 0
    if (uploadResult.success) {
      jpegSize = uploadResult.size || 0
    }
    totalFileSize = photoSize + jpegSize

    console.log(`🔄 [Vercel] Updating pdf_link & file_size_bytes for PO ${poId}...`)
    newPoRow.set(
      'pdf_link',
      uploadResult.success ? uploadResult.link : `ERROR: ${uploadResult.error || 'Unknown'}`
    )
    newPoRow.set('file_size_bytes', totalFileSize)
    await newPoRow.save({ raw: false })
    console.log(`✅ [Vercel] pdf_link & file_size_bytes updated.`)

    return res.status(200).json({ success: true, poId, revision_number: 0 })
  } catch (err) {
    console.error('💥 [Vercel] ERROR in handleSaveNewPO:', err.message, err.stack)
    if (newPoRow && !newPoRow.get('pdf_link')?.startsWith('http')) {
      try {
        newPoRow.set('pdf_link', `ERROR: ${err.message}`)
        await newPoRow.save()
      } catch (saveErr) {
        console.error('  -> Failed to save error link back to sheet:', saveErr.message)
      }
    }
    return res
      .status(500)
      .json({ success: false, error: 'Internal Server Error saving PO', details: err.message })
  }
}

export async function handleUpdatePO(req, res) {
  console.log('🏁 [Vercel] handleUpdatePO started!')
  const data = req.body
  let doc, newRevisionRow
  let totalFileSize = 0
  let fotoLink = ''
  let photoSize = 0

  try {
    doc = await openDoc()
    const now = new Date().toISOString()
    const poSheet = await getSheet(doc, 'purchase_orders')
    const itemSheet = await getSheet(doc, 'purchase_order_items')

    const poId = String(data.poId)
    if (!poId) {
      throw new Error('PO ID is required for update.')
    }

    const latestRevNum = await latestRevisionNumberForPO(poId, doc)
    const prevRow = latestRevNum >= 0 ? await getHeaderForRevision(poId, latestRevNum, doc) : null
    const prevData = prevRow ? prevRow.toObject() : {}
    const newRevNum = latestRevNum >= 0 ? latestRevNum + 1 : 0

    fotoLink = prevData.foto_link || 'Tidak ada foto'

    if (data.poPhotoBase64) {
      console.log(`[Vercel Update] 📸 New reference photo detected (Base64), uploading...`)
      const photoResult = await uploadPoPhoto(
        data.poPhotoBase64,
        data.nomorPo ?? prevData.po_number ?? `PO-${poId}`,
        data.namaCustomer ?? prevData.project_name ?? 'Customer'
      )
      if (photoResult.success) {
        fotoLink = photoResult.link
        photoSize = photoResult.size || 0
        console.log(` -> New photo uploaded: ${fotoLink}, Size: ${photoSize}`)
      } else {
        fotoLink = `ERROR: ${photoResult.error || 'Upload foto gagal'}`
        console.error(` -> Failed to upload new photo: ${fotoLink}`)
      }
    } else {
      console.log(`[Vercel Update] 🖼️ No new reference photo. Inheriting link: ${fotoLink}`)
    }

    const newRevisionRowData = {
      id: poId,
      revision_number: newRevNum,
      po_number: data.nomorPo ?? prevData.po_number ?? `PO-${poId}`,
      project_name: data.namaCustomer ?? prevData.project_name ?? 'N/A',
      deadline: data.tanggalKirim ?? prevData.deadline ?? null,
      status: data.status ?? prevData.status ?? 'Open',
      priority: data.prioritas ?? prevData.priority ?? 'Normal',
      notes: data.catatan ?? prevData.notes ?? '',
      kubikasi_total: toNum(data.kubikasi_total, toNum(prevData.kubikasi_total, 0)),
      acc_marketing: data.marketing ?? prevData.acc_marketing ?? '',
      created_at: now,
      pdf_link: 'generating...',
      foto_link: fotoLink,
      file_size_bytes: 0,
      revised_by: data.revisedBy || 'Unknown',
      alamat_kirim: data.alamatKirim ?? prevData.alamat_kirim ?? ''
    }
    console.log(`📝 [Vercel Update] Adding revision ${newRevNum} row data for PO ${poId}`)
    newRevisionRow = await poSheet.addRow(newRevisionRowData)

    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw) => {
      const clean = scrubItemPayload(raw)
      const newItem = {
        id: nextItemId,
        purchase_order_id: poId,
        revision_number: newRevNum,
        kubikasi: toNum(raw.kubikasi, 0),
        ...clean
      }
      itemsWithIds.push({ ...raw, id: nextItemId, kubikasi: newItem.kubikasi })
      nextItemId++
      return newItem
    })

    if (itemsToAdd.length > 0) {
      console.log(
        `➕ [Vercel Update] Adding ${itemsToAdd.length} items to sheet for PO ${poId} Rev ${newRevNum}`
      )
      await itemSheet.addRows(itemsToAdd)
    } else {
      console.warn(`⚠️ [Vercel Update] No items provided for PO ${poId} Rev ${newRevNum}`)
    }

    const poDataForUpload = {
      ...newRevisionRowData,
      poPhotoBase64: data.poPhotoBase64,
      items: itemsWithIds
    }
    console.log(`⏳ [Vercel Update] Calling generateAndUploadPO for PO ${poId} Rev ${newRevNum}...`)
    const uploadResult = await generateAndUploadPO(poDataForUpload, newRevNum)

    let jpegSize = 0
    if (uploadResult.success) {
      jpegSize = uploadResult.size || 0
    }

    totalFileSize = photoSize + jpegSize
    if (totalFileSize === 0 && !data.poPhotoBase64) {
      totalFileSize = Number(prevData.file_size_bytes || 0)
      console.log(
        `[Vercel Update] JPEG failed/skipped & no new photo. Inheriting old size: ${totalFileSize}`
      )
    } else {
      console.log(
        `[Vercel Update] Calculated total file size: ${photoSize} (photo) + ${jpegSize} (jpeg) = ${totalFileSize}`
      )
    }

    console.log(
      `🔄 [Vercel Update] Updating pdf_link & file_size_bytes for PO ${poId} Rev ${newRevNum}...`
    )
    newRevisionRow.set(
      'pdf_link',
      uploadResult.success
        ? uploadResult.link
        : prevData.pdf_link || `ERROR: ${uploadResult.error || 'Unknown'}`
    )
    newRevisionRow.set('file_size_bytes', totalFileSize)
    await newRevisionRow.save({ raw: false })
    console.log(`✅ [Vercel Update] pdf_link & file_size_bytes updated.`)

    return res.status(200).json({ success: true, revision_number: newRevNum })
  } catch (err) {
    console.error('💥 [Vercel Update] ERROR in handleUpdatePO:', err.message, err.stack)
    if (newRevisionRow) {
      try {
        if (!newRevisionRow.get('pdf_link')?.startsWith('http')) {
          newRevisionRow.set('pdf_link', `ERROR: ${err.message}`)
        }
        await newRevisionRow.save({ raw: false })
      } catch (saveErr) {
        console.error(' -> Failed to save error link back during error handling:', saveErr.message)
      }
    }
    return res
      .status(500)
      .json({ success: false, error: 'Internal Server Error (updatePO)', details: err.message })
  }
}

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
    const fotoLink = poRow.get('foto_link')
    if (
      fotoLink &&
      !fotoLink.startsWith('ERROR:') &&
      !fotoLink.includes('generating') &&
      fotoLink !== 'Tidak ada foto'
    ) {
      const fileId = extractGoogleDriveFileId(fotoLink)
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

export async function handleGetProducts(req, res) {
  const doc = await openDoc()
  const sheet = getSheet(doc, 'product_master')
  const rows = await sheet.getRows()
  const products = rows.map((r) => r.toObject())
  return res.status(200).json(products)
}

export async function handleListPOItems(req, res) {
  const { poId } = req.query
  const doc = await openDoc()
  const latestRev = await latestRevisionNumberForPO(String(poId), doc)
  if (latestRev < 0) return res.status(200).json([])
  const items = await getItemsByRevision(String(poId), latestRev, doc)
  return res.status(200).json(items)
}

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
    photo_url: photoLink || '',
    created_at: new Date().toISOString()
  })
  return res.status(200).json({ success: true })
}

export async function handleGetActivePOsWithProgress(req, res) {
  console.log('--- 🏃‍♂️ EXECUTING handleGetActivePOsWithProgress ---')
  const { user } = req.body // [TERIMA USER]

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

  // [FILTER MARKETING]
  const filteredResult = filterPOsByMarketing(result, user)

  return res.status(200).json(filteredResult)
}

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

  const allItemsForPO = itemRows.filter((r) => r.get('purchase_order_id') === poId)
  if (allItemsForPO.length === 0) {
    return res.status(200).json([])
  }
  const latestItemRev = Math.max(-1, ...allItemsForPO.map((r) => toNum(r.get('revision_number'))))
  const poData = poRows.find(
    (r) => r.get('id') === poId && toNum(r.get('revision_number')) === latestItemRev
  )

  if (!poData) {
    throw new Error(`Data PO untuk revisi terbaru (rev ${latestItemRev}) tidak ditemukan.`)
  }

  const poStartDate = new Date(poData.get('created_at'))
  const poDeadline = new Date(poData.get('deadline'))

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

export async function handleGetRecentProgressUpdates(req, res) {
  console.log('--- ✨ EXECUTING handleGetRecentProgressUpdates ---')
  const { user } = req.body // [TERIMA USER]

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

  // [FILTER MARKETING]
  const filteredPoRows = filterPOsByMarketing(poRows, user)

  const itemMap = new Map(itemRows.map((r) => [r.get('id'), r.toObject()]))
  const poMap = filteredPoRows.reduce((acc, r) => {
    const poId = r.get('id'),
      rev = toNum(r.get('revision_number'))
    // Gunakan .get() karena 'r' adalah GoogleSpreadsheetRow
    if (!acc.has(poId) || rev > toNum(acc.get(poId).revision_number)) {
      acc.set(poId, r.toObject())
    }
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

export async function handleGetAttentionData(req, res) {
  console.log('--- 🎯 EXECUTING handleGetAttentionData ---')
  const { user } = req.body // [TERIMA USER]

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

  // [FILTER MARKETING]
  const filteredPoRows = filterPOsByMarketing(poRows, user)

  const latestPoMap = filteredPoRows.reduce((map, r) => {
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

export async function handleGetProductSalesAnalysis(req, res) {
  console.log('🏁 [Vercel] handleGetProductSalesAnalysis started!')
  const { user } = req.body // [TERIMA USER]

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

    const itemRows = itemRowsRaw.map((r) => r.toObject())
    const poRowsRawObjects = poRowsRaw.map((r) => r.toObject()) // Data mentah
    const productRows = productRowsRaw.map((r) => r.toObject())

    // [FILTER MARKETING]
    const poRows = filterPOsByMarketing(poRowsRawObjects, user)

    const latestPoMap = poRows.reduce((map, po) => {
      const poId = po.id
      const rev = toNum(po.revision_number)
      if (po.status !== 'Cancelled') {
        const existing = map.get(poId)
        if (!existing || rev > existing.revision_number) {
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
      } catch {}
    })

    latestPoMap.forEach((po) => {
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

    console.log('📊 [Vercel] Analisis Penjualan Dihasilkan.')
    return res.status(200).json(analysisResult)
  } catch (err) {
    console.error('❌ [Vercel] Gagal melakukan analisis penjualan produk:', err.message, err.stack)
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
    return res.status(500).json(emptyResult)
  }
}

export async function handleGetSalesItemData(req, res) {
  const { user } = req.body // [TERIMA USER]

  const doc = await openDoc()
  const [itemSheet, poSheet] = await Promise.all([
    getSheet(doc, 'purchase_order_items'),
    getSheet(doc, 'purchase_orders')
  ])
  const [itemRows, poRows] = await Promise.all([itemSheet.getRows(), poSheet.getRows()])

  // [FILTER MARKETING]
  const filteredPoRows = filterPOsByMarketing(poRows, user)

  const poMap = filteredPoRows.reduce((map, r) => {
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

export async function handleListPOItemsByRevision(req, res) {
  const { poId, revisionNumber } = req.query
  const doc = await openDoc()
  const items = await getItemsByRevision(String(poId), toNum(revisionNumber, 0), doc)
  return res.status(200).json(items)
}

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

// --- AI CHAT HELPERS (VERCEL) ---

async function listPOsForChat(user) {
  const doc = await openDoc()
  const poSheet = getSheet(doc, 'purchase_orders')
  const itemSheet = getSheet(doc, 'purchase_order_items')
  const progressSheet = getSheet(doc, 'progress_tracking')

  const [poRowsRaw, itemRowsRaw, progressRowsRaw] = await Promise.all([
    poSheet.getRows(),
    itemSheet.getRows(),
    progressSheet.getRows()
  ])

  // [FILTER MARKETING]
  const poRowsFiltered = filterPOsByMarketing(poRowsRaw, user)

  const poRows = poRowsFiltered.map((r) => r.toObject())
  const itemRows = itemRowsRaw.map((r) => r.toObject())
  const progressRows = progressRowsRaw.map((r) => r.toObject())

  const byId = new Map()
  for (const r of poRows) {
    const id = String(r.id).trim()
    const rev = toNum(r.revision_number, -1)
    if (!byId.has(id) || rev > byId.get(id).rev) {
      byId.set(id, { rev, row: r })
    }
  }
  const latestPoObjects = Array.from(byId.values()).map(({ row }) => row)

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

// --- AI CHAT MAIN HANDLER (VERCEL) ---

// =================================================================
// AI CHAT HANDLER (VERCEL - FULL NATURAL VERSION)
// =================================================================

async function generateNaturalResponse(dataContext, userRequest, originalPrompt, user) {
  const groqToken = process.env.GROQ_API_KEY
  if (!groqToken) throw new Error('GROQ_API_KEY missing')

  const sysPrompt = `Anda adalah Asisten AI ERP Ubinkayu.
Tugas Anda adalah menjawab pertanyaan user secara natural.
ANDA HARUS MENJAWAB HANYA BERDASARKAN DATA KONTEKS YANG DIBERIKAN.
JANGAN mengarang data.
Gunakan **format markdown** (bold, list) agar mudah dibaca.
Sapa user dengan nama depannya (${user?.name?.split(' ')[0] || 'Tamu'}) jika relevan.

---
DATA KONTEKS (JSON):
${dataContext}
---
DESKRIPSI PERMINTAAN USER:
${userRequest}
---
PROMPT ASLI USER:
"${originalPrompt}"
---
JAWABAN ANDA (BAHASA INDONESIA NATURAL):`

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'system', content: sysPrompt }],
        temperature: 0.3, // Sedikit kreatif tapi tetap patuh data
        max_tokens: 500
      })
    })
    if (!resp.ok) throw new Error(`Groq Error: ${await resp.text()}`)
    const json = await resp.json()
    return (
      json.choices[0]?.message?.content?.trim() || 'Maaf, saya tidak bisa menghasilkan jawaban.'
    )
  } catch (e) {
    console.error('Error generating natural response:', e)
    return 'Maaf, terjadi kesalahan saat menyusun jawaban natural.'
  }
}

export async function handleAiChat(req, res) {
  const { prompt, user, history } = req.body
  if (!prompt) return res.status(400).json({ error: 'Prompt required' })

  // 1. FETCH CONTEXT (Hanya PO dulu agar cepat di Vercel)
  let allPOs = []
  try {
    allPOs = await listPOsForChat(user)
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: 'Context fetch failed' })
  }

  // 2. DECIDE TOOL (Call 1)
  let aiDecision = { tool: 'unknown' }
  try {
    const today = new Date().toISOString().split('T')[0]
    // System prompt disingkat agar hemat token di Vercel, tapi tetap fungsional
    const systemPrompt = `Anda adalah Asisten ERP Ubinkayu. Tugas Anda adalah mengubah pertanyaan pengguna menjadi JSON 'perintah' yang valid. HANYA KEMBALIKAN JSON.
Hari ini adalah ${today}.

--- INFORMASI PENGGUNA SAAT INI ---
Nama: ${user?.name || 'Tamu'}
Role: ${user?.role || 'Tidak Dikenal'}
Panggil user dengan nama depannya (${user?.name?.split(' ')[0] || 'Tamu'}).
---

--- ATURAN PRIORITAS ---
1. Jika user menyebut nomor PO, nama customer, atau revisi, Anda HARUS menggunakan "getPOInfo".
2. Tentukan 'intent' user dengan hati-hati.

--- Alat (Tools) yang Tersedia ---
// (Daftar alat disederhanakan untuk Vercel agar tidak terlalu panjang,
// fokus pada fitur inti PO karena keterbatasan waktu eksekusi serverless)

1. "getTotalPO": (Untuk pertanyaan jumlah/total PO).
   - Keywords: "jumlah po", "total po", "ada berapa po", "semua po aktif".
   - JSON: {"tool": "getTotalPO"}

2. "getPOInfo": (Mencari PO berdasarkan nomor, customer, atau revisi).
   - Keywords: "status po [nomor]", "link file [nomor]", "info po [nomor]".
   - JSON: {"tool": "getPOInfo", "param": {"poNumber": "...", "customerName": "...", "revisionNumber": "...", "intent": "details"}}

3. "getUrgentPOs": (Untuk pertanyaan PO 'Urgent').
   - JSON: {"tool": "getUrgentPOs"}

4. "getNearingDeadline": (Untuk pertanyaan PO 'deadline dekat').
   - JSON: {"tool": "getNearingDeadline"}

5. "general": (Untuk sapaan umum).
   - Keywords: "halo", "terima kasih".
   - JSON: {"tool": "general"}

ATURAN KETAT:
- JANGAN menjawab pertanyaan. HANYA KEMBALIKAN JSON.
- Jika tidak yakin tool mana, KEMBALIKAN: {"tool": "unknown"}`

    const formattedHistory = (history || []).map((m) => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text
    }))

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        max_tokens: 150,
        messages: [
          { role: 'system', content: systemPrompt },
          ...formattedHistory,
          { role: 'user', content: prompt }
        ]
      })
    })
    const json = await resp.json()
    let content = json.choices[0]?.message?.content?.trim() || '{}'
    if (content.includes('```json')) content = content.split('```json')[1].split('```')[0].trim()
    else if (content.includes('```')) content = content.split('```')[1].trim()
    aiDecision = JSON.parse(content)
  } catch (e) {
    // Fallback cerdas jika JSON gagal diparse
    aiDecision = { tool: 'general' }
  }

  // 3. EXECUTE & GENERATE NATURAL RESPONSE (Call 2)
  try {
    switch (aiDecision.tool) {
      case 'getTotalPO': {
        const total = allPOs.length
        const active = allPOs.filter(
          (p) => p.status !== 'Completed' && p.status !== 'Cancelled'
        ).length
        const data = { totalPOs: total, activePOs: active }
        const text = await generateNaturalResponse(
          JSON.stringify(data),
          'User tanya jumlah PO',
          prompt,
          user
        )
        return res.status(200).json({ response: text })
      }
      case 'getPOInfo': {
        // Implementasi sederhana untuk Vercel (bisa dikembangkan lagi nanti)
        const { poNumber, customerName } = aiDecision.param || {}
        let found = allPOs.slice(0, 5) // Default ambil 5 teratas jika tidak ada param
        if (poNumber)
          found = allPOs.filter((p) => p.po_number?.toLowerCase().includes(poNumber.toLowerCase()))
        else if (customerName)
          found = allPOs.filter((p) =>
            p.project_name?.toLowerCase().includes(customerName.toLowerCase())
          )

        const text = await generateNaturalResponse(
          JSON.stringify(found.slice(0, 3)),
          `User cari PO: ${poNumber || customerName || 'terbaru'}`,
          prompt,
          user
        )
        return res.status(200).json({ response: text })
      }
      case 'getUserInfo': {
        if (!user) return res.status(200).json({ response: 'Anda belum login.' })
        const data = {
          nama: user.name,
          role: user.role,
          info: `Anda login sebagai ${user.name} (${user.role})`
        }
        const text = await generateNaturalResponse(
          JSON.stringify(data),
          'User tanya info akunnya',
          prompt,
          user
        )
        return res.status(200).json({ response: text })
      }
      case 'general': {
        // --- [PERBAIKAN JAM] ---
        // Ambil waktu saat ini di zona waktu Asia/Jakarta (WIB)
        const wibTimeString = new Date().toLocaleString('en-US', {
          timeZone: 'Asia/Jakarta',
          hour: 'numeric',
          hour12: false
        })
        const currentHourWIB = parseInt(wibTimeString)
        // -----------------------

        const text = await generateNaturalResponse(
          JSON.stringify({ jam: currentHourWIB }), // Kirim jam yang sudah dikoreksi
          'User menyapa atau mengobrol santai',
          prompt,
          user
        )
        return res.status(200).json({ response: text })
      }

      case 'help':
        return res.status(200).json({
          response:
            "Saya bisa membantu mengecek jumlah PO, mencari status PO, atau info akun Anda. Coba tanya: 'berapa po aktif saya?'"
        })

      default: {
        // Fallback ke AI untuk respons "saya tidak mengerti" yang lebih sopan
        const unknownText = await generateNaturalResponse(
          '{}',
          'User bertanya hal di luar kemampuan bot',
          prompt,
          user
        )
        return res.status(200).json({ response: unknownText })
      }
    }
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: `Terjadi kesalahan: ${e.message}` })
  }
}
