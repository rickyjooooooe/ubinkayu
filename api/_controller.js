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
  generateOrderJpeg,
  getAuth,
  PO_ARCHIVE_FOLDER_ID,
  PROGRESS_PHOTOS_FOLDER_ID,
  UploadOrderPhoto,
  DEFAULT_STAGE_DURATIONS
} from './_helpers.js'
import { google } from 'googleapis'
import stream from 'stream'

// =================================================================
// CONSTANTS — nama sheet yang benar sesuai database
// =================================================================
const SHEET = {
  ORDERS: 'orders',
  ORDER_ITEMS: 'order_items',
  PROGRESS: 'order_items_progress',   // ✅ FIX: bukan 'progress_tracking'
  PRODUCT_MASTER: 'product_master',
}

// =================================================================
// DATE HELPERS
// =================================================================

const formatDate = (dateString) => {
  if (!dateString) return '-'
  try {
    const isoDate = new Date(dateString).toISOString().split('T')[0]
    const [year, month, day] = isoDate.split('-')
    return `${day}/${month}/${year}`
  } catch (e) {
    return '-'
  }
}

const formatDateForAnalysis = (dateString) => {
  if (!dateString) return null
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return null
    return date.toISOString().split('T')[0]
  } catch {
    return null
  }
}

const getYearMonth = (dateString) => {
  const date = formatDateForAnalysis(dateString)
  return date ? date.substring(0, 7) : null
}

// =================================================================
// SHARED HELPER: Filter PO berdasarkan marketing
// =================================================================
function filterOrdersByMarketing(poList, user) {
  if (!user || user.role !== 'marketing') {
    return poList
  }
  const marketingName = user.name.toLowerCase()
  console.log(`[Vercel Filter] Menerapkan filter Marketing untuk: ${user.name}`)
  return poList.filter((order) => {
    let poMarketing = ''
    if (typeof order.get === 'function') {
      poMarketing = order.get('acc_marketing')
    } else {
      poMarketing = order.acc_marketing
    }
    return poMarketing?.toLowerCase() === marketingName
  })
}

// =================================================================
// SHARED HELPER: Upload file ke Google Drive (multipart)
// =================================================================
async function uploadFileToDrive(auth, buffer, fileName, mimeType, folderId) {
  const boundary = `----DriveBoundary${Date.now()}----`
  const metadata = { name: fileName, mimeType, parents: [folderId] }
  const metaPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n\r\n`
  )
  const mediaHeaderPart = Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`)
  const endBoundaryPart = Buffer.from(`\r\n--${boundary}--\r\n`)
  const requestBody = Buffer.concat([metaPart, mediaHeaderPart, buffer, endBoundaryPart])

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
  if (!fileId) throw new Error('Upload berhasil tapi ID file tidak didapatkan.')

  const getResponse = await auth.request({
    url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
    method: 'GET',
    params: { fields: 'webViewLink,size', supportsAllDrives: true }
  })

  return {
    fileId,
    webViewLink: getResponse?.data?.webViewLink || null,
    size: Number(getResponse?.data?.size || 0)
  }
}

// =================================================================
// AUTH HANDLER
// =================================================================
export async function handleLoginUser(req, res) {
  console.log('✅ [Vercel Controller] Entered handleLoginUser function.')
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username dan password harus diisi.' })
  }

  try {
    const doc = await openUserDoc()
    const userSheet = await getSheet(doc, 'users')
    await userSheet.loadHeaderRow()
    const headers = userSheet.headerValues

    const usernameHeader = 'login_username'
    const passwordHeader = 'login_pwd'
    const nameHeader = 'name'
    const roleHeader = 'role'

    if (!headers.includes(usernameHeader) || !headers.includes(passwordHeader)) {
      return res.status(500).json({ success: false, error: 'Kesalahan konfigurasi server.' })
    }

    const rows = await userSheet.getRows()
    const trimmedUsernameLower = username.trim().toLowerCase()
    const userRow = rows.find(
      (row) => row.get(usernameHeader)?.trim().toLowerCase() === trimmedUsernameLower
    )

    if (userRow) {
      const foundUsername = userRow.get(usernameHeader)
      const storedPassword = userRow.get(passwordHeader)

      if (storedPassword === password) {
        const userName =
          headers.includes(nameHeader) && userRow.get(nameHeader)
            ? userRow.get(nameHeader)
            : foundUsername
        const userRole = headers.includes(roleHeader) ? userRow.get(roleHeader) : undefined
        return res.status(200).json({ success: true, name: userName, role: userRole })
      } else {
        return res.status(401).json({ success: false, error: 'Username atau password salah.' })
      }
    } else {
      return res.status(401).json({ success: false, error: 'Username atau password salah.' })
    }
  } catch (err) {
    console.error('💥 [Vercel Login] CRITICAL ERROR:', err.message, err.stack)
    return res.status(500).json({
      success: false,
      error: 'Terjadi kesalahan pada server saat login.',
      details: err.message
    })
  }
}

// =================================================================
// REVISION HELPERS
// =================================================================
async function latestRevisionNumberForOrder(orderId, doc) {
  const sh = await getSheet(doc, SHEET.ORDERS)
  const rows = await sh.getRows()
  const nums = rows
    .filter((r) => String(r.get('id')).trim() === String(orderId).trim())
    .map((r) => toNum(r.get('revision_number'), -1))
  return nums.length ? Math.max(...nums) : -1
}

async function getHeaderForRevision(orderId, rev, doc) {
  const sh = await getSheet(doc, SHEET.ORDERS)
  const rows = await sh.getRows()
  return (
    rows.find(
      (r) =>
        String(r.get('id')).trim() === String(orderId).trim() &&
        toNum(r.get('revision_number'), -1) === toNum(rev, -1)
    ) || null
  )
}

async function getItemsByRevision(orderId, rev, doc) {
  const sh = await getSheet(doc, SHEET.ORDER_ITEMS)
  const rows = await sh.getRows()
  return rows
    .filter(
      (r) =>
        String(r.get('order_id')).trim() === String(orderId).trim() &&
        toNum(r.get('revision_number'), -1) === toNum(rev, -1)
    )
    .map((r) => r.toObject())
}

// =================================================================
// GENERATE & UPLOAD PO JPEG
// =================================================================
async function generateAndUploadOrder(orderData, revisionNumber) {
  try {
    console.log('⏳ [Vercel] Generating JPEG buffer...')
    const jpegResult = await generateOrderJpeg(orderData, revisionNumber)
    if (!jpegResult.success || !jpegResult.buffer) {
      throw new Error(jpegResult.error || 'Gagal membuat buffer JPEG.')
    }

    const auth = getAuth()
    await auth.authorize()

    const { webViewLink, size } = await uploadFileToDrive(
      auth,
      jpegResult.buffer,
      jpegResult.fileName,
      'image/jpeg',
      PO_ARCHIVE_FOLDER_ID
    )

    if (!webViewLink) throw new Error('Gagal mendapatkan link file setelah upload.')
    console.log(`✅ [Vercel] File uploaded: ${webViewLink}`)
    return { success: true, link: webViewLink, size }
  } catch (error) {
    console.error('❌ [Vercel] Generate & Upload PO Gagal:', error.message)
    return { success: false, error: error.message, size: 0 }
  }
}

// =================================================================
// HANDLER: List Orders
// =================================================================
export async function handleListOrders(req, res) {
  console.log('🏁 [Vercel] handleListOrders started!')
  const { user } = req.body

  try {
    const doc = await openDoc()
    const Sheet = await getSheet(doc, SHEET.ORDERS)           // ✅ await
    const itemSheet = await getSheet(doc, SHEET.ORDER_ITEMS)  // ✅ await
    const progressSheet = await getSheet(doc, SHEET.PROGRESS) // ✅ await + nama benar

    const [orderRows, itemRows, progressRows] = await Promise.all([
      Sheet.getRows(),
      itemSheet.getRows(),
      progressSheet.getRows()
    ])

    const byId = new Map()
    for (const r of orderRows) {
      const id = String(r.get('id')).trim()
      const rev = toNum(r.get('revision_number'), -1)
      const status = r.get('status') || ''
      if (status === 'Requested') {
        if (!byId.has(id)) byId.set(id, { rev, row: r })
        continue
      }
      const keep = byId.get(id)
      if (keep?.row?.get('status') === 'Requested') continue
      if (!keep || rev > keep.rev) {
        byId.set(id, { rev, row: r })
      }
    }
    const latestOrderRows = Array.from(byId.values()).map(({ row }) => row)

    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      const key = `${row.get('order_id')}-${row.get('order_item_id')}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
      return acc
    }, {})

    const itemObjects = itemRows.map((item) => item.toObject())
    const itemsByOrderId = itemObjects.reduce((acc, item) => {
      const orderId = item.order_id
      if (!acc[orderId]) acc[orderId] = []
      acc[orderId].push(item)
      return acc
    }, {})

    const latestItemRevisions = new Map()
    itemObjects.forEach((item) => {
      const orderId = item.order_id
      const rev = toNum(item.revision_number, -1)
      const current = latestItemRevisions.get(orderId)
      if (current === undefined || rev > current) {
        latestItemRevisions.set(orderId, rev)
      }
    })

    const result = latestOrderRows.map((order) => {
      const orderObject = order.toObject()
      const orderId = orderObject.id
      const latestRev = latestItemRevisions.get(orderId) ?? -1

      const orderItems = (itemsByOrderId[orderId] || []).filter(
        (item) => toNum(item.revision_number, -1) === latestRev
      )

      let orderProgress = 0
      if (orderItems.length > 0) {
        let totalPercentage = 0
        orderItems.forEach((item) => {
          const itemId = item.id
          const compositeKey = `${orderId}-${itemId}`
          const itemProgressHistory = progressByCompositeKey[compositeKey] || []
          let latestStageIndex = -1
          if (itemProgressHistory.length > 0) {
            const latestProgress = [...itemProgressHistory].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )[0]
            latestStageIndex = PRODUCTION_STAGES.indexOf(latestProgress.stage)
          }
          const itemPercentage =
            latestStageIndex >= 0 ? ((latestStageIndex + 1) / PRODUCTION_STAGES.length) * 100 : 0
          totalPercentage += itemPercentage
        })
        orderProgress = totalPercentage / orderItems.length
      }

      let finalStatus = orderObject.status
      let completed_at = null
      if (finalStatus !== 'Cancelled' && finalStatus !== 'Requested') {
        const roundedProgress = Math.round(orderProgress)
        if (roundedProgress >= 100) {
          finalStatus = 'Completed'
          const allProgressForOrder = progressRows
            .filter((row) => row.get('order_id') === orderId)
            .map((row) => {
              try { return new Date(row.get('created_at')).getTime() } catch { return 0 }
            })
            .filter((time) => time > 0)
          if (allProgressForOrder.length > 0) {
            completed_at = new Date(Math.max(...allProgressForOrder)).toISOString()
          }
        } else if (roundedProgress > 0) {
          finalStatus = 'In Progress'
        } else {
          finalStatus = 'Open'
        }
      }

      return {
        ...orderObject,
        items: orderItems,
        progress: Math.round(orderProgress),
        status: finalStatus,
        completed_at,
        pdf_link: orderObject.pdf_link || null,
        acc_marketing: orderObject.acc_marketing || '',
        alamat_kirim: orderObject.alamat_kirim || '',
        lastRevisedBy: orderObject.revised_by || 'N/A',
        lastRevisedDate: orderObject.created_at
      }
    })

    const filteredResult = filterOrdersByMarketing(result, user)
    return res.status(200).json(filteredResult)
  } catch (err) {
    console.error('💥 [Vercel] ERROR in handleListOrders:', err.message, err.stack)
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error processing listOrders',
      details: err.message
    })
  }
}

// =================================================================
// HANDLER: Save New Order
// =================================================================
export async function handleSaveNewOrder(req, res) {
  console.log('🏁 [Vercel] handleSaveNewOrder started!')
  const data = req.body
  let doc, NewOrderRow
  let totalFileSize = 0
  let fotoLink = 'Tidak ada foto'
  let photoSize = 0

  try {
    doc = await openDoc()
    const now = new Date().toISOString()
    const Sheet = await getSheet(doc, SHEET.ORDERS)
    const itemSheet = await getSheet(doc, SHEET.ORDER_ITEMS)
    const orderId = await getNextIdFromSheet(Sheet)

    if (data.poPhotoBase64) {
      const photoResult = await UploadOrderPhoto(
        data.poPhotoBase64,
        data.nomorOrder || `PO-${orderId}`,
        data.namaCustomer || 'Customer'
      )
      if (photoResult.success) {
        fotoLink = photoResult.link
        photoSize = photoResult.size || 0
      } else {
        fotoLink = `ERROR: ${photoResult.error || 'Upload foto gagal'}`
      }
    }

    const NewOrderRowData = {
      id: orderId,
      revision_number: 0,
      order_number: data.nomorOrder || `PO-${orderId}`,
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
      revised_by: 'N/A',
      project_valuation: toNum(data.project_valuation, 0),
    }

    NewOrderRow = await Sheet.addRow(NewOrderRowData)

    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw) => {
      const clean = scrubItemPayload(raw)
      const kubikasiItem = toNum(raw.kubikasi, 0)
      const newItem = { id: nextItemId, order_id: orderId, revision_number: 0, kubikasi: kubikasiItem, ...clean }
      itemsWithIds.push({ ...raw, id: nextItemId, kubikasi: kubikasiItem })
      nextItemId++
      return newItem
    })

    if (itemsToAdd.length > 0) await itemSheet.addRows(itemsToAdd)

    const orderDataForUpload = {
      order_number: NewOrderRowData.order_number,
      project_name: NewOrderRowData.project_name,
      deadline: NewOrderRowData.deadline,
      priority: NewOrderRowData.priority,
      notes: NewOrderRowData.notes,
      created_at: NewOrderRowData.created_at,
      kubikasi_total: NewOrderRowData.kubikasi_total,
      acc_marketing: NewOrderRowData.acc_marketing,
      alamat_kirim: NewOrderRowData.alamat_kirim,
      foto_link: fotoLink,
      items: itemsWithIds,
      poPhotoBase64: data.poPhotoBase64
    }

    const uploadResult = await generateAndUploadOrder(orderDataForUpload, 0)
    const jpegSize = uploadResult.success ? (uploadResult.size || 0) : 0
    totalFileSize = photoSize + jpegSize

    NewOrderRow.set('pdf_link', uploadResult.success ? uploadResult.link : `ERROR: ${uploadResult.error || 'Unknown'}`)
    NewOrderRow.set('file_size_bytes', totalFileSize)
    await NewOrderRow.save({ raw: false })

    return res.status(200).json({ success: true, orderId, revision_number: 0 })
  } catch (err) {
    console.error('💥 [Vercel] ERROR in handleSaveNewOrder:', err.message, err.stack)
    if (NewOrderRow && !NewOrderRow.get('pdf_link')?.startsWith('http')) {
      try {
        NewOrderRow.set('pdf_link', `ERROR: ${err.message}`)
        await NewOrderRow.save()
      } catch (saveErr) {
        console.error('  -> Failed to save error link:', saveErr.message)
      }
    }
    return res.status(500).json({ success: false, error: 'Internal Server Error saving PO', details: err.message })
  }
}

// =================================================================
// HANDLER: Request Project (Marketing)
// =================================================================
export async function handleRequestProject(req, res) {
  console.log('🏁 [Vercel] handleRequestProject started!')
  const data = req.body
  if (!data.nomorOrder || !data.namaCustomer) {
    return res.status(400).json({ success: false, error: 'Nomor PO dan Nama Customer harus diisi.' })
  }

  try {
    const doc = await openDoc()
    const now = new Date().toISOString()
    const Sheet = await getSheet(doc, SHEET.ORDERS)
    const orderId = await getNextIdFromSheet(Sheet)

    const NewOrderRowData = {
      id: orderId,
      revision_number: 0,
      order_number: data.nomorOrder,
      project_name: data.namaCustomer,
      deadline: data.tanggalKirim || null,
      status: 'Requested',
      priority: data.prioritas || 'Normal',
      notes: data.catatan || '',
      kubikasi_total: 0,
      acc_marketing: data.marketing || '',
      created_at: now,
      pdf_link: '',
      foto_link: 'Tidak ada foto',
      file_size_bytes: 0,
      alamat_kirim: data.alamatKirim || '',
      revised_by: 'N/A',
      project_valuation: toNum(data.project_valuation, 0),
    }

    let NewOrderRow = await Sheet.addRow(NewOrderRowData)

    if (data.poPhotoBase64) {
      const photoResult = await UploadOrderPhoto(data.poPhotoBase64, data.nomorOrder, data.namaCustomer)
      if (photoResult.success) {
        NewOrderRow.set('foto_link', photoResult.link)
        await NewOrderRow.save({ raw: false })
      }
    }

    return res.status(200).json({ success: true, orderId, message: 'Request project berhasil dikirim.' })
  } catch (err) {
    console.error('💥 [Vercel] ERROR in handleRequestProject:', err.message, err.stack)
    return res.status(500).json({ success: false, error: 'Gagal menyimpan request project.', details: err.message })
  }
}

// =================================================================
// HANDLER: Confirm Request (Admin)
// =================================================================
export async function handleConfirmRequest(req, res) {
  console.log('🏁 [Vercel] handleConfirmRequest started!')
  const data = req.body
  const { orderId, items, revisedBy } = data

  if (!orderId) return res.status(400).json({ success: false, error: 'PO ID harus diisi.' })
  if (!items || items.length === 0) return res.status(400).json({ success: false, error: 'Minimal satu item harus diisi.' })

  let doc, targetRow
  try {
    doc = await openDoc()
    const Sheet = await getSheet(doc, SHEET.ORDERS)
    const itemSheet = await getSheet(doc, SHEET.ORDER_ITEMS)

    const allOrderRows = await Sheet.getRows()
    targetRow = allOrderRows.find(
      (r) =>
        String(r.get('id')).trim() === String(orderId).trim() &&
        toNum(r.get('revision_number'), -1) === 0
    )

    if (!targetRow) return res.status(404).json({ success: false, error: `PO dengan ID ${orderId} tidak ditemukan.` })
    if (targetRow.get('status') !== 'Requested') return res.status(400).json({ success: false, error: 'PO ini bukan berstatus Requested.' })

    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)

    const itemsToAdd = (items || []).map((raw) => {
      const clean = scrubItemPayload(raw)
      const kubikasiItem = toNum(raw.kubikasi, 0)
      const newItem = { id: nextItemId, order_id: orderId, revision_number: 0, kubikasi: kubikasiItem, ...clean }
      itemsWithIds.push({ ...raw, id: nextItemId, kubikasi: kubikasiItem })
      nextItemId++
      return newItem
    })

    await itemSheet.addRows(itemsToAdd)

    const kubikasiTotal = itemsWithIds.reduce((acc, item) => acc + toNum(item.kubikasi, 0), 0)

    // ✅ FIX: project_valuation dipertahankan
    targetRow.set('status', 'Open')
    targetRow.set('kubikasi_total', kubikasiTotal)
    targetRow.set('revised_by', revisedBy || 'Admin')
    targetRow.set('pdf_link', 'generating...')
    targetRow.set('project_valuation', toNum(targetRow.get('project_valuation'), 0))
    await targetRow.save({ raw: false })

    const orderDataForUpload = {
      order_number: targetRow.get('order_number'),
      project_name: targetRow.get('project_name'),
      deadline: targetRow.get('deadline'),
      priority: targetRow.get('priority'),
      notes: targetRow.get('notes'),
      created_at: targetRow.get('created_at'),
      kubikasi_total: kubikasiTotal,
      acc_marketing: targetRow.get('acc_marketing'),
      alamat_kirim: targetRow.get('alamat_kirim'),
      foto_link: targetRow.get('foto_link'),
      items: itemsWithIds,
    }

    const uploadResult = await generateAndUploadOrder(orderDataForUpload, 0)
    targetRow.set('pdf_link', uploadResult.success ? uploadResult.link : `ERROR: ${uploadResult.error || 'Unknown'}`)
    targetRow.set('file_size_bytes', uploadResult.size || 0)
    await targetRow.save({ raw: false })

    return res.status(200).json({ success: true, orderId, message: 'PO berhasil dibuat dari request.' })
  } catch (err) {
    console.error('💥 [Vercel] ERROR in handleConfirmRequest:', err.message, err.stack)
    if (targetRow) {
      try {
        targetRow.set('pdf_link', `ERROR: ${err.message}`)
        await targetRow.save({ raw: false })
      } catch (saveErr) {
        console.error('  -> Failed to save error fallback:', saveErr.message)
      }
    }
    return res.status(500).json({ success: false, error: 'Gagal konfirmasi request.', details: err.message })
  }
}

// =================================================================
// HANDLER: Update Order
// =================================================================
export async function handleUpdateOrder(req, res) {
  console.log('🏁 [Vercel] handleUpdateOrder started!')
  const data = req.body
  let doc, newRevisionRow
  let totalFileSize = 0
  let fotoLink = ''
  let photoSize = 0

  try {
    doc = await openDoc()
    const now = new Date().toISOString()
    const Sheet = await getSheet(doc, SHEET.ORDERS)
    const itemSheet = await getSheet(doc, SHEET.ORDER_ITEMS)

    const orderId = String(data.orderId)
    if (!orderId) throw new Error('PO ID is required for update.')

    const latestRevNum = await latestRevisionNumberForOrder(orderId, doc)
    const prevRow = latestRevNum >= 0 ? await getHeaderForRevision(orderId, latestRevNum, doc) : null
    const prevData = prevRow ? prevRow.toObject() : {}
    const newRevNum = latestRevNum >= 0 ? latestRevNum + 1 : 0

    fotoLink = prevData.foto_link || 'Tidak ada foto'

    if (data.poPhotoBase64) {
      const photoResult = await UploadOrderPhoto(
        data.poPhotoBase64,
        data.nomorOrder ?? prevData.order_number ?? `PO-${orderId}`,
        data.namaCustomer ?? prevData.project_name ?? 'Customer'
      )
      if (photoResult.success) {
        fotoLink = photoResult.link
        photoSize = photoResult.size || 0
      } else {
        fotoLink = `ERROR: ${photoResult.error || 'Upload foto gagal'}`
      }
    }

    const newRevisionRowData = {
      id: orderId,
      revision_number: newRevNum,
      order_number: data.nomorOrder ?? prevData.order_number ?? `PO-${orderId}`,
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

    newRevisionRow = await Sheet.addRow(newRevisionRowData)

    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw) => {
      const clean = scrubItemPayload(raw)
      const newItem = { id: nextItemId, order_id: orderId, revision_number: newRevNum, kubikasi: toNum(raw.kubikasi, 0), ...clean }
      itemsWithIds.push({ ...raw, id: nextItemId, kubikasi: newItem.kubikasi })
      nextItemId++
      return newItem
    })

    if (itemsToAdd.length > 0) await itemSheet.addRows(itemsToAdd)

    const uploadResult = await generateAndUploadOrder({ ...newRevisionRowData, poPhotoBase64: data.poPhotoBase64, items: itemsWithIds }, newRevNum)
    const jpegSize = uploadResult.success ? (uploadResult.size || 0) : 0

    totalFileSize = photoSize + jpegSize
    if (totalFileSize === 0 && !data.poPhotoBase64) {
      totalFileSize = Number(prevData.file_size_bytes || 0)
    }

    newRevisionRow.set('pdf_link', uploadResult.success ? uploadResult.link : prevData.pdf_link || `ERROR: ${uploadResult.error || 'Unknown'}`)
    newRevisionRow.set('file_size_bytes', totalFileSize)
    await newRevisionRow.save({ raw: false })

    return res.status(200).json({ success: true, revision_number: newRevNum })
  } catch (err) {
    console.error('💥 [Vercel Update] ERROR in handleUpdateOrder:', err.message, err.stack)
    if (newRevisionRow) {
      try {
        if (!newRevisionRow.get('pdf_link')?.startsWith('http')) {
          newRevisionRow.set('pdf_link', `ERROR: ${err.message}`)
        }
        await newRevisionRow.save({ raw: false })
      } catch (saveErr) {
        console.error(' -> Failed to save error link:', saveErr.message)
      }
    }
    return res.status(500).json({ success: false, error: 'Internal Server Error (updatePO)', details: err.message })
  }
}

// =================================================================
// HANDLER: Delete Order
// =================================================================
export async function handleDeleteOrder(req, res) {
  // ✅ FIX: Tambah try/catch
  try {
    const { orderId } = req.query
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId diperlukan.' })

    const startTime = Date.now()
    const doc = await openDoc()
    const [Sheet, itemSheet, progressSheet] = await Promise.all([
      getSheet(doc, SHEET.ORDERS),
      getSheet(doc, SHEET.ORDER_ITEMS),
      getSheet(doc, SHEET.PROGRESS)  // ✅ nama sheet benar
    ])
    const [orderRows, itemRows, progressRows] = await Promise.all([
      Sheet.getRows(),
      itemSheet.getRows(),
      progressSheet.getRows()
    ])

    const toDelHdr = orderRows.filter((r) => String(r.get('id')).trim() === String(orderId).trim())
    const toDelItems = itemRows.filter((r) => String(r.get('order_id')).trim() === String(orderId).trim())
    const orderProgressRows = progressRows.filter((r) => String(r.get('order_id')).trim() === String(orderId).trim())

    const fileIds = new Set()
    toDelHdr.forEach((poRow) => {
      const pdfLink = poRow.get('pdf_link')
      if (pdfLink && !pdfLink.startsWith('ERROR:') && !pdfLink.includes('generating')) {
        const fileId = extractGoogleDriveFileId(pdfLink)
        if (fileId) fileIds.add(fileId)
      }
      const fotoLink = poRow.get('foto_link')
      if (fotoLink && !fotoLink.startsWith('ERROR:') && !fotoLink.includes('generating') && fotoLink !== 'Tidak ada foto') {
        const fileId = extractGoogleDriveFileId(fotoLink)
        if (fileId) fileIds.add(fileId)
      }
    })
    orderProgressRows.forEach((progressRow) => {
      const photoUrl = progressRow.get('photo_url')
      if (photoUrl) {
        const fileId = extractGoogleDriveFileId(photoUrl)
        if (fileId) fileIds.add(fileId)
      }
    })

    const uniqueFileIds = Array.from(fileIds)
    let deletedFilesCount = 0, failedFilesCount = 0, failedFiles = []
    if (uniqueFileIds.length > 0) {
      const deleteResults = await processBatch(uniqueFileIds, deleteGoogleDriveFile, 5)
      deleteResults.forEach((result) => {
        if (result.success) deletedFilesCount++
        else { failedFilesCount++; failedFiles.push({ fileId: result.fileId, error: result.error }) }
      })
    }

    const sheetDeletions = []
    orderProgressRows.reverse().forEach((row) => sheetDeletions.push(row.delete()))
    toDelHdr.reverse().forEach((row) => sheetDeletions.push(row.delete()))
    toDelItems.reverse().forEach((row) => sheetDeletions.push(row.delete()))
    await Promise.allSettled(sheetDeletions)

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    const summary = {
      deletedRevisions: toDelHdr.length,
      deletedItems: toDelItems.length,
      deletedProgressRecords: orderProgressRows.length,
      deletedFiles: deletedFilesCount,
      failedFileDeletes: failedFilesCount,
      duration: `${duration}s`,
      failedFiles: failedFiles.length > 0 ? failedFiles : undefined
    }
    return res.status(200).json({
      success: true,
      message: `PO berhasil dihapus (${summary.deletedRevisions} revisi, ${summary.deletedItems} item, ${summary.deletedFiles} file).`,
      summary
    })
  } catch (err) {
    console.error('💥 [Vercel] ERROR in handleDeleteOrder:', err.message, err.stack)
    return res.status(500).json({ success: false, error: 'Gagal menghapus PO.', details: err.message })
  }
}

// =================================================================
// HANDLER: Get Products
// =================================================================
export async function handleGetProducts(req, res) {
  try {
    const doc = await openDoc()
    const sheet = await getSheet(doc, SHEET.PRODUCT_MASTER)
    const rows = await sheet.getRows()
    return res.status(200).json(rows.map((r) => r.toObject()))
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: List Order Items
// =================================================================
export async function handlelistOrderItems(req, res) {
  try {
    const { orderId } = req.query
    const doc = await openDoc()
    const latestRev = await latestRevisionNumberForOrder(String(orderId), doc)
    if (latestRev < 0) return res.status(200).json([])
    const items = await getItemsByRevision(String(orderId), latestRev, doc)
    return res.status(200).json(items)
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: Get Revision History
// =================================================================
export async function handleGetRevisionHistory(req, res) {
  try {
    const { orderId } = req.query
    const doc = await openDoc()
    const Sheet = await getSheet(doc, SHEET.ORDERS)
    const allOrderRows = await Sheet.getRows()
    const metas = allOrderRows
      .filter((r) => String(r.get('id')).trim() === String(orderId).trim())
      .map((r) => r.toObject())

    const itemSheet = await getSheet(doc, SHEET.ORDER_ITEMS)
    const allItemRows = await itemSheet.getRows()
    const history = metas.map((m) => ({
      revision: m,
      items: allItemRows
        .filter(
          (r) =>
            String(r.get('order_id')) === String(orderId) &&
            toNum(r.get('revision_number'), -1) === toNum(m.revision_number, -1)
        )
        .map((r) => r.toObject())
    }))
    history.sort((a, b) => b.revision.revision_number - a.revision.revision_number)
    return res.status(200).json(history)
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: Preview Order
// =================================================================
export async function handlePreviewOrder(req, res) {
  try {
    const data = req.body
    const orderData = { ...data, created_at: new Date().toISOString() }
    const result = await generateOrderJpeg(orderData, 'preview')
    if (result.success) {
      return res.status(200).json({ success: true, base64Data: result.buffer.toString('base64') })
    }
    throw new Error(result.error || 'Failed to generate JPEG buffer')
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: Update Item Progress
// =================================================================
export async function handleUpdateItemProgress(req, res) {
  try {
    const { orderId, itemId, orderNumber, stage, notes, photoBase64 } = req.body
    let photoLink = null

    if (photoBase64) {
      try {
        const auth = getAuth()
        await auth.authorize()

        const timestamp = new Date().toISOString().replace(/:/g, '-')
        const fileName = `Order-${orderNumber}_ITEM-${itemId}_${timestamp}.jpg`
        const imageBuffer = Buffer.from(photoBase64, 'base64')

        // ✅ Gunakan shared helper uploadFileToDrive
        const { webViewLink } = await uploadFileToDrive(auth, imageBuffer, fileName, 'image/jpeg', PROGRESS_PHOTOS_FOLDER_ID)
        photoLink = webViewLink
        console.log(`✅ Progress photo uploaded: ${photoLink}`)
      } catch (photoErr) {
        console.error('❌ Gagal upload foto progress:', photoErr.message)
      }
    }

    const doc = await openDoc()
    const progressSheet = await getSheet(doc, SHEET.PROGRESS)  // ✅ nama sheet benar
    const nextId = await getNextIdFromSheet(progressSheet)
    await progressSheet.addRow({
      id: nextId,
      order_id: orderId,
      order_item_id: itemId,
      stage,
      notes: notes || '',
      photo_url: photoLink || '',
      created_at: new Date().toISOString()
    })
    return res.status(200).json({ success: true })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: Get Active Orders With Progress
// =================================================================
export async function handleGetActiveOrdersWithProgress(req, res) {
  try {
    const { user } = req.body
    const doc = await openDoc()
    const [Sheet, itemSheet, progressSheet] = await Promise.all([
      getSheet(doc, SHEET.ORDERS),
      getSheet(doc, SHEET.ORDER_ITEMS),
      getSheet(doc, SHEET.PROGRESS)  // ✅ nama sheet benar
    ])
    const [orderRows, itemRows, progressRows] = await Promise.all([
      Sheet.getRows(), itemSheet.getRows(), progressSheet.getRows()
    ])

    const byId = new Map()
    orderRows.forEach((r) => {
      const id = String(r.get('id')).trim(), rev = toNum(r.get('revision_number'), -1)
      if (!byId.has(id) || rev > (byId.get(id)?.rev ?? -1)) byId.set(id, { rev, row: r })
    })
    const activeOrders = Array.from(byId.values())
      .map(({ row }) => row)
      .filter((r) => r.get('status') !== 'Completed' && r.get('status') !== 'Cancelled')

    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      const key = `${row.get('order_id')}-${row.get('order_item_id')}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
      return acc
    }, {})

    const latestItemRevisions = itemRows.reduce((acc, item) => {
      const orderId = item.get('order_id'), rev = toNum(item.get('revision_number'), -1)
      if (!acc.has(orderId) || rev > acc.get(orderId)) acc.set(orderId, rev)
      return acc
    }, new Map())

    const result = activeOrders.map((order) => {
      const orderId = order.get('id'), latestRev = latestItemRevisions.get(orderId) ?? -1
      const orderItems = itemRows.filter(
        (item) => item.get('order_id') === orderId && toNum(item.get('revision_number'), -1) === latestRev
      )
      if (orderItems.length === 0) return { ...order.toObject(), progress: 0 }

      const totalPercentage = orderItems.reduce((total, item) => {
        const itemProgress = progressByCompositeKey[`${orderId}-${item.get('id')}`] || []
        let latestStageIndex = -1
        if (itemProgress.length > 0) {
          const latest = [...itemProgress].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )[0]
          latestStageIndex = PRODUCTION_STAGES.indexOf(latest.stage)
        }
        return total + (latestStageIndex >= 0 ? ((latestStageIndex + 1) / PRODUCTION_STAGES.length) * 100 : 0)
      }, 0)

      return { ...order.toObject(), progress: Math.round(totalPercentage / orderItems.length) }
    })

    return res.status(200).json(filterOrdersByMarketing(result, user))
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: Get Order Items With Details
// =================================================================
export async function handleGetOrderItemsWithDetails(req, res) {
  try {
    const { orderId } = req.query
    const doc = await openDoc()
    const [Sheet, itemSheet, progressSheet] = await Promise.all([
      getSheet(doc, SHEET.ORDERS),
      getSheet(doc, SHEET.ORDER_ITEMS),
      getSheet(doc, SHEET.PROGRESS)  // ✅ nama sheet benar
    ])
    const [orderRows, itemRows, progressRows] = await Promise.all([
      Sheet.getRows(), itemSheet.getRows(), progressSheet.getRows()
    ])

    const allItemsForOrder = itemRows.filter((r) => r.get('order_id') === orderId)
    if (allItemsForOrder.length === 0) return res.status(200).json([])

    const latestItemRev = Math.max(-1, ...allItemsForOrder.map((r) => toNum(r.get('revision_number'))))
    const orderData = orderRows.find(
      (r) => r.get('id') === orderId && toNum(r.get('revision_number')) === latestItemRev
    )

    // ✅ FIX: return 404 bukan throw
    if (!orderData) {
      return res.status(404).json({
        success: false,
        error: `Data PO untuk revisi terbaru (rev ${latestItemRev}) tidak ditemukan.`
      })
    }

    const poStartDate = new Date(orderData.get('created_at'))
    const poDeadline = new Date(orderData.get('deadline'))
    let cumulativeDate = new Date(poStartDate)
    const stageDeadlines = PRODUCTION_STAGES.map((stageName) => {
      if (stageName === 'Siap Kirim') return { stageName, deadline: poDeadline.toISOString() }
      const durationDays = DEFAULT_STAGE_DURATIONS[stageName] || 0
      cumulativeDate.setDate(cumulativeDate.getDate() + durationDays)
      return { stageName, deadline: new Date(cumulativeDate).toISOString() }
    })

    const orderItemsForLatestRev = allItemsForOrder.filter(
      (item) => toNum(item.get('revision_number'), -1) === latestItemRev
    )

    const progressByItemId = progressRows
      .filter((row) => row.get('order_id') === orderId)
      .reduce((acc, row) => {
        const itemId = row.get('order_item_id')
        if (!acc[itemId]) acc[itemId] = []
        acc[itemId].push(row.toObject())
        return acc
      }, {})

    const result = orderItemsForLatestRev.map((item) => {
      const itemObject = item.toObject()
      const history = (progressByItemId[String(itemObject.id)] || []).sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      )
      return { ...itemObject, progressHistory: history, stageDeadlines }
    })

    return res.status(200).json(result)
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: Get Recent Progress Updates
// =================================================================
export async function handleGetRecentProgressUpdates(req, res) {
  try {
    const { user } = req.body
    const doc = await openDoc()
    const [progressSheet, itemSheet, Sheet] = await Promise.all([
      getSheet(doc, SHEET.PROGRESS),  // ✅ nama sheet benar
      getSheet(doc, SHEET.ORDER_ITEMS),
      getSheet(doc, SHEET.ORDERS)
    ])
    const [progressRows, itemRows, orderRows] = await Promise.all([
      progressSheet.getRows(), itemSheet.getRows(), Sheet.getRows()
    ])

    const filteredOrderRows = filterOrdersByMarketing(orderRows, user)
    const itemMap = new Map(itemRows.map((r) => [r.get('id'), r.toObject()]))
    const orderMap = filteredOrderRows.reduce((acc, r) => {
      const orderId = r.get('id'), rev = toNum(r.get('revision_number'))
      if (!acc.has(orderId) || rev > toNum(acc.get(orderId).revision_number)) {
        acc.set(orderId, r.toObject())
      }
      return acc
    }, new Map())

    // ✅ FIX: validasi limit
    const rawLimit = parseInt(req.query.limit)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10

    const enrichedUpdates = progressRows
      .map((r) => r.toObject())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit)
      .map((update) => {
        const item = itemMap.get(update.order_item_id)
        if (!item) return null
        const order = orderMap.get(item.order_id)
        if (!order) return null
        return { ...update, item_name: item.product_name, order_number: order.order_number }
      })
      .filter(Boolean)

    return res.status(200).json(enrichedUpdates)
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: Get Attention Data
// =================================================================
export async function handleGetAttentionData(req, res) {
  try {
    const { user } = req.body
    const doc = await openDoc()
    const [Sheet, itemSheet, progressSheet] = await Promise.all([
      getSheet(doc, SHEET.ORDERS),
      getSheet(doc, SHEET.ORDER_ITEMS),
      getSheet(doc, SHEET.PROGRESS)  // ✅ nama sheet benar
    ])
    const [orderRows, itemRows, progressRows] = await Promise.all([
      Sheet.getRows(), itemSheet.getRows(), progressSheet.getRows()
    ])

    const filteredOrderRows = filterOrdersByMarketing(orderRows, user)
    const latestOrderMap = filteredOrderRows.reduce((map, r) => {
      const id = r.get('id'), rev = toNum(r.get('revision_number'))
      if (!map.has(id) || rev > map.get(id).rev) map.set(id, { rev, row: r })
      return map
    }, new Map())

    const latestItemRevisions = itemRows.reduce((map, item) => {
      const orderId = item.get('order_id'), rev = toNum(item.get('revision_number'), -1)
      if (!map.has(orderId) || rev > map.get(orderId)) map.set(orderId, rev)
      return map
    }, new Map())

    const activeItems = itemRows.filter((item) => {
      const orderData = latestOrderMap.get(item.get('order_id'))
      if (!orderData) return false
      const order = orderData.row
      const latestRev = latestItemRevisions.get(item.get('order_id')) ?? -1
      return (
        order.get('status') !== 'Completed' &&
        order.get('status') !== 'Cancelled' &&
        toNum(item.get('revision_number')) === latestRev
      )
    })

    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      const key = `${row.get('order_id')}-${row.get('order_item_id')}`
      if (!acc[key]) acc[key] = []
      acc[key].push({ stage: row.get('stage'), created_at: row.get('created_at') })
      return acc
    }, {})

    const nearingDeadline = [], stuckItems = [], urgentItems = []
    const today = new Date()
    const sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
    const fiveDaysAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000)

    activeItems.forEach((item) => {
      const order = latestOrderMap.get(item.get('order_id')).row
      const itemProgress = progressByCompositeKey[`${order.get('id')}-${item.get('id')}`] || []
      const latestProgress = [...itemProgress].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0]
      const currentStage = latestProgress ? latestProgress.stage : 'Belum Mulai'
      const attentionItem = {
        order_number: order.get('order_number'),
        item_name: item.get('product_name'),
        current_stage: currentStage
      }
      if (order.get('priority') === 'Urgent') urgentItems.push(attentionItem)
      const deadline = new Date(order.get('deadline'))
      if (deadline <= sevenDaysFromNow && deadline >= today && currentStage !== 'Siap Kirim') {
        nearingDeadline.push({ ...attentionItem, deadline: order.get('deadline') })
      }
      if (latestProgress && new Date(latestProgress.created_at) < fiveDaysAgo && currentStage !== 'Siap Kirim') {
        stuckItems.push({ ...attentionItem, last_update: latestProgress.created_at })
      }
    })

    return res.status(200).json({ nearingDeadline, stuckItems, urgentItems })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: Product Sales Analysis
// =================================================================
export async function handleGetProductSalesAnalysis(req, res) {
  try {
    const { user } = req.body
    const doc = await openDoc()
    const [itemSheet, Sheet, productSheet] = await Promise.all([
      getSheet(doc, SHEET.ORDER_ITEMS),
      getSheet(doc, SHEET.ORDERS),
      getSheet(doc, SHEET.PRODUCT_MASTER)
    ])
    const [itemRowsRaw, orderRowsRaw, productRowsRaw] = await Promise.all([
      itemSheet.getRows(), Sheet.getRows(), productSheet.getRows()
    ])

    const itemRows = itemRowsRaw.map((r) => r.toObject())
    const orderRowsRawObjects = orderRowsRaw.map((r) => r.toObject())
    const productRows = productRowsRaw.map((r) => r.toObject())
    const orderRows = filterOrdersByMarketing(orderRowsRawObjects, user)

    const latestOrderMap = orderRows.reduce((map, order) => {
      const orderId = order.id, rev = toNum(order.revision_number)
      if (order.status !== 'Cancelled') {
        const existing = map.get(orderId)
        if (!existing || rev > existing.revision_number) map.set(orderId, { ...order, revision_number: rev })
      }
      return map
    }, new Map())

    const salesByProduct = {}, salesByMarketing = {}, monthlySalesByProduct = {}
    const monthlySalesByMarketing = {}, woodTypeDistribution = {}, customerByKubikasi = {}
    const salesByDateForTrend = [], soldProductNames = new Set()

    itemRows.forEach((item) => {
      const order = latestOrderMap.get(item.order_id)
      if (!order || toNum(item.revision_number) !== order.revision_number) return

      const productName = item.product_name
      const quantity = toNum(item.quantity, 0)
      const kubikasi = toNum(item.kubikasi, 0)
      const woodType = item.wood_type
      const yearMonth = getYearMonth(order.created_at)

      if (!productName || quantity <= 0) return
      soldProductNames.add(productName)

      salesByProduct[productName] = salesByProduct[productName] || { totalQuantity: 0, totalKubikasi: 0, name: productName }
      salesByProduct[productName].totalQuantity += quantity
      salesByProduct[productName].totalKubikasi += kubikasi

      if (yearMonth) {
        monthlySalesByProduct[yearMonth] = monthlySalesByProduct[yearMonth] || {}
        monthlySalesByProduct[yearMonth][productName] = (monthlySalesByProduct[yearMonth][productName] || 0) + quantity
      }
      if (woodType) woodTypeDistribution[woodType] = (woodTypeDistribution[woodType] || 0) + quantity
      try { salesByDateForTrend.push({ date: new Date(order.created_at), name: productName, quantity }) } catch {}
    })

    latestOrderMap.forEach((order) => {
      const marketingName = order.acc_marketing || 'N/A'
      const customerName = order.project_name
      const kubikasiTotalOrder = toNum(order.kubikasi_total, 0)
      const yearMonth = getYearMonth(order.created_at)

      salesByMarketing[marketingName] = salesByMarketing[marketingName] || { totalKubikasi: 0, orderCount: 0, name: marketingName }
      salesByMarketing[marketingName].totalKubikasi += kubikasiTotalOrder
      salesByMarketing[marketingName].orderCount += 1

      if (yearMonth) {
        monthlySalesByMarketing[yearMonth] = monthlySalesByMarketing[yearMonth] || {}
        monthlySalesByMarketing[yearMonth][marketingName] = (monthlySalesByMarketing[yearMonth][marketingName] || 0) + kubikasiTotalOrder
      }
      if (customerName) customerByKubikasi[customerName] = (customerByKubikasi[customerName] || 0) + kubikasiTotalOrder
    })

    const allMonths = new Set([...Object.keys(monthlySalesByProduct), ...Object.keys(monthlySalesByMarketing)])
    const sortedMonths = Array.from(allMonths).sort()
    const allProductKeys = new Set(), allMarketingKeys = new Set()
    sortedMonths.forEach((month) => {
      if (monthlySalesByProduct[month]) Object.keys(monthlySalesByProduct[month]).forEach((p) => allProductKeys.add(p))
      if (monthlySalesByMarketing[month]) Object.keys(monthlySalesByMarketing[month]).forEach((m) => allMarketingKeys.add(m))
    })

    const todayTrend = new Date()
    const thirtyDaysAgo = new Date(new Date().setDate(todayTrend.getDate() - 30))
    const sixtyDaysAgo = new Date(new Date().setDate(todayTrend.getDate() - 60))
    const salesLast30 = {}, salesPrev30 = {}
    salesByDateForTrend.forEach((sale) => {
      if (sale.date >= thirtyDaysAgo) salesLast30[sale.name] = (salesLast30[sale.name] || 0) + sale.quantity
      else if (sale.date >= sixtyDaysAgo) salesPrev30[sale.name] = (salesPrev30[sale.name] || 0) + sale.quantity
    })

    return res.status(200).json({
      topSellingProducts: Object.values(salesByProduct).sort((a, b) => b.totalQuantity - a.totalQuantity).slice(0, 10),
      salesByMarketing: Object.values(salesByMarketing).sort((a, b) => b.totalKubikasi - a.totalKubikasi),
      monthlyProductChartData: sortedMonths.map((month) => {
        const d = { month }
        allProductKeys.forEach((k) => { d[k] = monthlySalesByProduct[month]?.[k] || 0 })
        return d
      }),
      monthlyMarketingChartData: sortedMonths.map((month) => {
        const d = { month }
        allMarketingKeys.forEach((k) => { d[k] = monthlySalesByMarketing[month]?.[k] || 0 })
        return d
      }),
      woodTypeDistribution: Object.entries(woodTypeDistribution).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      topCustomers: Object.entries(customerByKubikasi).map(([name, totalKubikasi]) => ({ name, totalKubikasi })).sort((a, b) => b.totalKubikasi - a.totalKubikasi).slice(0, 10),
      trendingProducts: Object.keys(salesLast30).map((name) => {
        const last30 = salesLast30[name] || 0, prev30 = salesPrev30[name] || 0
        const change = prev30 === 0 && last30 > 0 ? 100 : ((last30 - prev30) / (prev30 === 0 ? 1 : prev30)) * 100
        return { name, last30, prev30, change }
      }).filter((p) => p.change > 10 && p.last30 > p.prev30).sort((a, b) => b.change - a.change),
      slowMovingProducts: productRows.map((p) => p.product_name).filter(Boolean).filter((name) => !soldProductNames.has(name))
    })
  } catch (err) {
    console.error('❌ [Vercel] Gagal analisis penjualan:', err.message, err.stack)
    return res.status(500).json({
      topSellingProducts: [], salesByMarketing: [], monthlyProductChartData: [],
      monthlyMarketingChartData: [], woodTypeDistribution: [], topCustomers: [],
      trendingProducts: [], slowMovingProducts: []
    })
  }
}

// =================================================================
// HANDLER: Sales Item Data
// =================================================================
export async function handleGetSalesItemData(req, res) {
  try {
    const { user } = req.body
    const doc = await openDoc()
    const [itemSheet, Sheet] = await Promise.all([
      getSheet(doc, SHEET.ORDER_ITEMS),
      getSheet(doc, SHEET.ORDERS)
    ])
    const [itemRows, orderRows] = await Promise.all([itemSheet.getRows(), Sheet.getRows()])

    const filteredOrderRows = filterOrdersByMarketing(orderRows, user)
    const orderMap = filteredOrderRows.reduce((map, r) => {
      const orderId = r.get('id'), rev = toNum(r.get('revision_number'))
      if (!map.has(orderId) || rev > map.get(orderId).revision_number) map.set(orderId, r.toObject())
      return map
    }, new Map())

    const combinedData = itemRows
      .map((item) => {
        const order = orderMap.get(item.get('order_id'))
        if (!order) return null
        return { ...item.toObject(), customer_name: order.project_name, order_date: order.created_at }
      })
      .filter(Boolean)

    return res.status(200).json(combinedData)
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: Add New Product
// =================================================================
export async function handleAddNewProduct(req, res) {
  try {
    const productData = req.body
    const doc = await openDoc()
    const sheet = await getSheet(doc, SHEET.PRODUCT_MASTER)
    const nextId = await getNextIdFromSheet(sheet)
    await sheet.addRow({ id: nextId, ...productData })
    return res.status(200).json({ success: true, newId: nextId })
  } catch (error) {
    console.error('❌ Gagal menambahkan produk baru:', error.message)
    return res.status(500).json({ success: false, error: error.message })
  }
}

// =================================================================
// HANDLER: List Order Revisions
// =================================================================
export async function handleListOrderRevisions(req, res) {
  try {
    const { orderId } = req.query
    const doc = await openDoc()
    const Sheet = await getSheet(doc, SHEET.ORDERS)
    const rows = await Sheet.getRows()
    const revisions = rows
      .filter((r) => String(r.get('id')).trim() === String(orderId).trim())
      .map((r) => r.toObject())
      .sort((a, b) => a.revision_number - b.revision_number)
    return res.status(200).json(revisions)
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: List Order Items By Revision
// =================================================================
export async function handlelistOrderItemsByRevision(req, res) {
  try {
    const { orderId, revisionNumber } = req.query
    const doc = await openDoc()
    const items = await getItemsByRevision(String(orderId), toNum(revisionNumber, 0), doc)
    return res.status(200).json(items)
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: Update Stage Deadline
// =================================================================
export async function handleUpdateStageDeadline(req, res) {
  try {
    const { orderId, itemId, stageName, newDeadline } = req.body
    const doc = await openDoc()
    const sheet = await getSheet(doc, SHEET.PROGRESS)  // ✅ nama sheet benar
    await sheet.addRow({
      order_id: orderId,
      order_item_id: itemId,
      stage: `DEADLINE_OVERRIDE: ${stageName}`,
      custom_deadline: newDeadline,
      created_at: new Date().toISOString()
    })
    return res.status(200).json({ success: true })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// HANDLER: Commission Data
// =================================================================
export async function handleGetCommissionData(req, res) {
  const { user } = req.body
  try {
    const doc = await openDoc()
    const userDoc = await openUserDoc()

    const orderSheet = await getSheet(doc, SHEET.ORDERS)
    const orderRows = await orderSheet.getRows()
    const userSheet = await getSheet(userDoc, 'users')
    await userSheet.loadHeaderRow()
    const userRows = await userSheet.getRows()

    const commissionRateMap = {}
    userRows.forEach((r) => {
      const name = r.get('name')?.trim()
      const rate = Number(r.get('commision_rate') || 0)
      if (name && rate > 0) commissionRateMap[name.toLowerCase()] = rate
    })

    const orderObjects = orderRows.map((r) => r.toObject())
    const byId = new Map()
    for (const r of orderObjects) {
      const id = String(r.id).trim(), rev = toNum(r.revision_number, -1)
      const keep = byId.get(id)
      if (!keep || rev > keep.rev) byId.set(id, { rev, row: r })
    }
    const latestOrders = Array.from(byId.values()).map(({ row }) => row)

    const result = latestOrders
      .filter((order) => {
        if (order.status === 'Requested') return false
        if (!order.acc_marketing) return false
        if (!order.project_valuation || toNum(order.project_valuation, 0) === 0) return false
        if (user?.role === 'marketing') {
          return order.acc_marketing.toLowerCase() === user.name.toLowerCase()
        }
        return true
      })
      .map((order) => {
        const marketingName = order.acc_marketing?.trim() || ''
        const rate = commissionRateMap[marketingName.toLowerCase()] || 0
        const valuation = toNum(order.project_valuation, 0)
        return {
          order_id: order.id,
          order_number: order.order_number,
          project_name: order.project_name,
          marketing_name: marketingName,
          commission_rate: rate,
          project_valuation: valuation,
          commission_amount: (valuation * rate) / 100,
          status: order.status || 'Open',
          deadline: order.deadline || null,
          created_at: order.created_at,
        }
      })

    return res.status(200).json(result)
  } catch (err) {
    console.error('❌ handleGetCommissionData error:', err.message)
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// AI CHAT — buildRichContext + handleAiChat (Single Smart Call)
// =================================================================

async function buildRichContext(user) {
  const doc = await openDoc()
  const [orderSheet, itemSheet, progressSheet, productSheet] = await Promise.all([
    getSheet(doc, SHEET.ORDERS),
    getSheet(doc, SHEET.ORDER_ITEMS),
    getSheet(doc, SHEET.PROGRESS),         // ✅ nama sheet benar
    getSheet(doc, SHEET.PRODUCT_MASTER),
  ])
  const [orderRowsRaw, itemRowsRaw, progressRowsRaw, productRowsRaw] = await Promise.all([
    orderSheet.getRows(), itemSheet.getRows(), progressSheet.getRows(), productSheet.getRows()
  ])

  const orderRowsFiltered = filterOrdersByMarketing(orderRowsRaw, user)
  const orderObjects = orderRowsFiltered.map(r => r.toObject())
  const itemObjects = itemRowsRaw.map(r => r.toObject())
  const progressObjects = progressRowsRaw.map(r => r.toObject())
  const productObjects = productRowsRaw.map(r => r.toObject())

  // Revisi terbaru per order
  const latestOrderMap = new Map()
  for (const o of orderObjects) {
    const id = String(o.id).trim(), rev = toNum(o.revision_number, -1)
    const existing = latestOrderMap.get(id)
    if (!existing || rev > existing.rev) latestOrderMap.set(id, { rev, data: o })
  }
  const latestOrders = Array.from(latestOrderMap.values()).map(v => v.data)

  // Revisi item terbaru per order
  const latestItemRevMap = new Map()
  for (const item of itemObjects) {
    const oid = String(item.order_id), rev = toNum(item.revision_number, -1)
    if (!latestItemRevMap.has(oid) || rev > latestItemRevMap.get(oid)) latestItemRevMap.set(oid, rev)
  }

  // Progress per item — key: "order_id-order_item_id"
  const progressByKey = {}
  for (const p of progressObjects) {
    const key = `${p.order_id}-${p.order_item_id}`
    if (!progressByKey[key]) progressByKey[key] = []
    progressByKey[key].push(p)
  }

  const today = new Date()
  const enrichedOrders = latestOrders.map(order => {
    const orderId = String(order.id)
    const latestRev = latestItemRevMap.get(orderId) ?? -1

    const items = itemObjects
      .filter(i => String(i.order_id) === orderId && toNum(i.revision_number, -1) === latestRev)
      .map(item => {
        const history = (progressByKey[`${orderId}-${item.id}`] || [])
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        const latestStage = history[0]?.stage ?? 'Belum Mulai'
        const stageIndex = PRODUCTION_STAGES.indexOf(latestStage)
        const progressPct = stageIndex >= 0 ? Math.round(((stageIndex + 1) / PRODUCTION_STAGES.length) * 100) : 0
        return {
          id: item.id,
          product_name: item.product_name,
          wood_type: item.wood_type,
          quantity: toNum(item.quantity, 0),
          satuan: item.satuan,
          kubikasi: toNum(item.kubikasi, 0),
          current_stage: latestStage,
          progress_pct: progressPct,
          last_updated: history[0]?.created_at ?? null,
          last_updated_by: history[0]?.created_by ?? null,
        }
      })

    const overallProgress = items.length > 0
      ? Math.round(items.reduce((sum, i) => sum + i.progress_pct, 0) / items.length) : 0

    const deadlineDate = order.deadline ? new Date(order.deadline) : null
    const daysUntilDeadline = deadlineDate
      ? Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24)) : null

    let status = order.status
    if (status !== 'Cancelled' && status !== 'Requested') {
      if (overallProgress >= 100) status = 'Completed'
      else if (overallProgress > 0) status = 'In Progress'
      else status = 'Open'
    }

    return {
      id: orderId, order_number: order.order_number, customer: order.project_name,
      marketing: order.acc_marketing, status, priority: order.priority,
      progress_pct: overallProgress, kubikasi_total: toNum(order.kubikasi_total, 0),
      project_valuation: toNum(order.project_valuation, 0),
      deadline: order.deadline ?? null, days_until_deadline: daysUntilDeadline,
      created_at: order.created_at, revised_by: order.revised_by, notes: order.notes, items,
    }
  })

  const activeOrders = enrichedOrders.filter(o => o.status !== 'Completed' && o.status !== 'Cancelled')
  const urgentOrders = activeOrders.filter(o => o.priority === 'Urgent')
  const nearDeadline = activeOrders.filter(o => o.days_until_deadline !== null && o.days_until_deadline >= 0 && o.days_until_deadline <= 7)
  const overdueOrders = activeOrders.filter(o => o.days_until_deadline !== null && o.days_until_deadline < 0)
  const stuckOrders = activeOrders.filter(o => {
    const lastUpdate = o.items.reduce((latest, item) => {
      if (!item.last_updated) return latest
      const d = new Date(item.last_updated)
      return d > latest ? d : latest
    }, new Date(0))
    return Math.floor((today - lastUpdate) / (1000 * 60 * 60 * 24)) >= 5 && o.progress_pct < 100
  })

  const kubikasiByMarketing = {}
  for (const o of enrichedOrders) {
    if (o.status === 'Cancelled') continue
    const mk = o.marketing || 'N/A'
    if (!kubikasiByMarketing[mk]) kubikasiByMarketing[mk] = { total_kubikasi: 0, order_count: 0 }
    kubikasiByMarketing[mk].total_kubikasi += o.kubikasi_total
    kubikasiByMarketing[mk].order_count += 1
  }

  const productSales = {}
  for (const o of enrichedOrders) {
    if (o.status === 'Cancelled') continue
    for (const item of o.items) {
      if (!item.product_name || item.quantity <= 0) continue
      if (!productSales[item.product_name]) productSales[item.product_name] = { total_quantity: 0, total_kubikasi: 0 }
      productSales[item.product_name].total_quantity += item.quantity
      productSales[item.product_name].total_kubikasi += item.kubikasi
    }
  }

  const woodTypeSales = {}
  for (const o of enrichedOrders) {
    if (o.status === 'Cancelled') continue
    for (const item of o.items) {
      if (!item.wood_type) continue
      woodTypeSales[item.wood_type] = (woodTypeSales[item.wood_type] || 0) + item.quantity
    }
  }

  const soldNames = new Set(Object.keys(productSales))

  return {
    all_orders: enrichedOrders,
    summary: {
      total_orders: enrichedOrders.length,
      active: activeOrders.length,
      completed: enrichedOrders.filter(o => o.status === 'Completed').length,
      requested: enrichedOrders.filter(o => o.status === 'Requested').length,
      cancelled: enrichedOrders.filter(o => o.status === 'Cancelled').length,
      urgent: urgentOrders.length,
      near_deadline_7d: nearDeadline.length,
      overdue: overdueOrders.length,
      stuck_5d: stuckOrders.length,
    },
    urgent_orders: urgentOrders.map(o => ({ order_number: o.order_number, customer: o.customer, marketing: o.marketing, progress_pct: o.progress_pct, deadline: o.deadline })),
    near_deadline_orders: nearDeadline.map(o => ({ order_number: o.order_number, customer: o.customer, days_until_deadline: o.days_until_deadline, progress_pct: o.progress_pct })),
    overdue_orders: overdueOrders.map(o => ({ order_number: o.order_number, customer: o.customer, days_until_deadline: o.days_until_deadline })),
    stuck_orders: stuckOrders.map(o => ({ order_number: o.order_number, customer: o.customer, progress_pct: o.progress_pct, items_stage: o.items.map(i => `${i.product_name}: ${i.current_stage}`) })),
    kubikasi_by_marketing: kubikasiByMarketing,
    top_products: Object.entries(productSales).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total_quantity - a.total_quantity).slice(0, 10),
    wood_type_distribution: woodTypeSales,
    slow_moving_products: productObjects.map(p => p.product_name).filter(Boolean).filter(name => !soldNames.has(name)),
  }
}

export async function handleAiChat(req, res) {
  const { prompt, user, history } = req.body
  if (!prompt) return res.status(400).json({ error: 'Prompt required' })

  let context
  try {
    context = await buildRichContext(user)
  } catch (e) {
    console.error('❌ [AI] Context build failed:', e.message)
    return res.status(500).json({ error: 'Gagal memuat data.' })
  }

  const contextSnapshot = {
    summary: context.summary,
    urgent_orders: context.urgent_orders,
    near_deadline_orders: context.near_deadline_orders,
    overdue_orders: context.overdue_orders,
    stuck_orders: context.stuck_orders,
    kubikasi_by_marketing: context.kubikasi_by_marketing,
    top_products: context.top_products,
    wood_type_distribution: context.wood_type_distribution,
    slow_moving_products: context.slow_moving_products,
    recent_orders: context.all_orders
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20)
      .map(o => ({
        order_number: o.order_number, customer: o.customer, marketing: o.marketing,
        status: o.status, priority: o.priority, progress_pct: o.progress_pct,
        kubikasi_total: o.kubikasi_total, project_valuation: o.project_valuation,
        deadline: o.deadline, days_until_deadline: o.days_until_deadline,
        revised_by: o.revised_by,
        items: o.items.map(i => ({
          product_name: i.product_name, wood_type: i.wood_type,
          quantity: i.quantity, satuan: i.satuan, kubikasi: i.kubikasi,
          current_stage: i.current_stage, progress_pct: i.progress_pct,
          last_updated: i.last_updated, last_updated_by: i.last_updated_by,
        })),
      })),
  }

  const today = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short' })

  const systemPrompt = `Anda adalah Asisten ERP Ubinkayu yang cerdas.
Hari ini: ${today}
User: ${user?.name || 'Tamu'} (role: ${user?.role || 'unknown'})
Panggil user dengan nama depan: **${user?.name?.split(' ')[0] || 'Tamu'}**.

TUGAS: Jawab pertanyaan user LANGSUNG dan NATURAL berdasarkan DATA di bawah.
- JANGAN mengarang data yang tidak ada di konteks.
- Gunakan markdown (bold, list) agar mudah dibaca.
- Jika data tidak ditemukan, katakan dengan jelas.

=== DATA ERP ===
${JSON.stringify(contextSnapshot, null, 0)}
=== AKHIR DATA ===

PANDUAN:
- Jumlah/total order → summary.*
- Order urgent → urgent_orders
- Deadline dekat (≤7 hari) → near_deadline_orders
- Order lewat deadline → overdue_orders
- Order macet (≥5 hari tidak update) → stuck_orders
- Performa marketing → kubikasi_by_marketing
- Produk terlaris → top_products
- Jenis kayu terlaris → wood_type_distribution
- Produk belum pernah terjual → slow_moving_products
- Info spesifik PO → cari di recent_orders (by order_number / customer)
- Progress item → items[].current_stage + items[].progress_pct
- Siapa yang terakhir update → items[].last_updated_by

CONTOH:
Q: "berapa order aktif?" → summary.active
Q: "progress PO-X?" → cari recent_orders, sebutkan tiap item + stage-nya
Q: "marketing terbaik?" → urutkan kubikasi_by_marketing by total_kubikasi
Q: "kayu paling banyak dipesan?" → wood_type_distribution
Q: "order yang sudah lewat deadline?" → overdue_orders

Jawab dalam Bahasa Indonesia yang natural:`

  try {
    const formattedHistory = (history || []).slice(-6).map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text,
    }))

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: 'system', content: systemPrompt },
          ...formattedHistory,
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!resp.ok) throw new Error(`Groq error: ${await resp.text()}`)
    const json = await resp.json()
    const answer = json.choices[0]?.message?.content?.trim() || 'Maaf, saya tidak bisa menghasilkan jawaban saat ini.'
    return res.status(200).json({ response: answer })
  } catch (e) {
    console.error('❌ [AI] Groq call failed:', e.message)
    return res.status(500).json({ error: `Terjadi kesalahan: ${e.message}` })
  }
}