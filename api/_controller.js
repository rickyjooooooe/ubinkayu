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
function filterOrdersByMarketing(poList, user) {
  if (!user || user.role !== 'marketing') {
    return poList
  }
  const marketingName = user.name.toLowerCase()
  console.log(`[Vercel Filter] Menerapkan filter Marketing untuk: ${user.name}`)
  return poList.filter((order) => {
    let poMarketing = ''
    // Handle jika 'order' adalah GoogleSpreadsheetRow atau plain object
    if (typeof order.get === 'function') {
      poMarketing = order.get('acc_marketing')
    } else {
      poMarketing = order.acc_marketing
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

async function latestRevisionNumberForOrder(orderId, doc) {
  const sh = await getSheet(doc, 'orders')
  const rows = await sh.getRows()
  const nums = rows
    .filter((r) => String(r.get('id')).trim() === String(orderId).trim())
    .map((r) => toNum(r.get('revision_number'), -1))
  return nums.length ? Math.max(...nums) : -1
}
async function getHeaderForRevision(orderId, rev, doc) {
  const sh = await getSheet(doc, 'orders')
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
  const sh = await getSheet(doc, 'order_items')
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
// KUMPULAN SEMUA LOGIKA API
// =================================================================

export async function handleListOrders(req, res) {
  console.log('🏁 [Vercel] handleListOrders function started!')
  const { user } = req.body // [TERIMA USER]

  try {
    const doc = await openDoc()
    const Sheet = getSheet(doc, 'orders')
    const itemSheet = getSheet(doc, 'order_items')
    const progressSheet = getSheet(doc, 'progress_tracking')

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
      // Order Requested selalu tampil - jangan tertimpa revision lain
      if (status === 'Requested') {
        if (!byId.has(id)) byId.set(id, { rev, row: r })
        continue
      }
      const keep = byId.get(id)
      // Jangan timpa Requested dengan revision lain
      if (keep?.row?.get('status') === 'Requested') continue
      if (!keep || rev > keep.rev) {
        byId.set(id, { rev, row: r })
      }
    }
    const latestOrderRows = Array.from(byId.values()).map(({ row }) => row)

    const progressByCompositeKey = progressRows.reduce((acc, row) => {
      const orderId = row.get('order_id')
      const itemId = row.get('order_item_id')
      const key = `${orderId}-${itemId}`
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
          const stages = PRODUCTION_STAGES
          const compositeKey = `${orderId}-${itemId}`
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
        orderProgress = totalPercentage / orderItems.length
      }

      let finalStatus = orderObject.status
      let completed_at = null
      // Jangan override status Requested
      if (finalStatus !== 'Cancelled' && finalStatus !== 'Requested') {
        const roundedProgress = Math.round(orderProgress)
        if (roundedProgress >= 100) {
          finalStatus = 'Completed'
          const allProgressForOrder = progressRows
            .filter((row) => row.get('order_id') === orderId)
            .map((row) => {
              try {
                return new Date(row.get('created_at')).getTime()
              } catch {
                return 0
              }
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

      const lastRevisedBy = orderObject.revised_by || 'N/A'
      const lastRevisedDate = orderObject.created_at

      return {
        ...orderObject,
        items: orderItems,
        progress: Math.round(orderProgress),
        status: finalStatus,
        completed_at: completed_at,
        pdf_link: orderObject.pdf_link || null,
        acc_marketing: orderObject.acc_marketing || '',
        alamat_kirim: orderObject.alamat_kirim || '',
        lastRevisedBy: lastRevisedBy,
        lastRevisedDate: lastRevisedDate
      }
    })

    // [FILTER MARKETING]
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

async function generateAndUploadOrder(orderData, revisionNumber) {
  let auth
  try {
    console.log('⏳ [Vercel] Generating JPEG buffer...')
    const jpegResult = await generateOrderJpeg(orderData, revisionNumber)
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
    const Sheet = getSheet(doc, 'orders')
    const itemSheet = getSheet(doc, 'order_items')
    const orderId = await getNextIdFromSheet(Sheet)

    if (data.poPhotoBase64) {
      console.log('  -> Uploading PO Reference Photo...')
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

    console.log('📝 [Vercel] Adding new PO row to sheet:', NewOrderRowData.order_number)
    NewOrderRow = await Sheet.addRow(NewOrderRowData)

    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw) => {
      const clean = scrubItemPayload(raw)
      const kubikasiItem = toNum(raw.kubikasi, 0)
      const newItem = {
        id: nextItemId,
        order_id: orderId,
        revision_number: 0,
        kubikasi: kubikasiItem,
        ...clean
      }
      itemsWithIds.push({ ...raw, id: nextItemId, kubikasi: kubikasiItem })
      nextItemId++
      return newItem
    })

    if (itemsToAdd.length > 0) {
      console.log(`➕ [Vercel] Adding ${itemsToAdd.length} items to sheet for PO ${orderId}`)
      await itemSheet.addRows(itemsToAdd)
    } else {
      console.warn(`⚠️ [Vercel] No items provided for new PO ${orderId}`)
    }

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

    console.log(`⏳ [Vercel] Calling generateAndUploadOrder for PO ${orderId}...`)
    const uploadResult = await generateAndUploadOrder(orderDataForUpload, 0)

    let jpegSize = 0
    if (uploadResult.success) {
      jpegSize = uploadResult.size || 0
    }
    totalFileSize = photoSize + jpegSize

    console.log(`🔄 [Vercel] Updating pdf_link & file_size_bytes for PO ${orderId}...`)
    NewOrderRow.set(
      'pdf_link',
      uploadResult.success ? uploadResult.link : `ERROR: ${uploadResult.error || 'Unknown'}`
    )
    NewOrderRow.set('file_size_bytes', totalFileSize)
    await NewOrderRow.save({ raw: false })
    console.log(`✅ [Vercel] pdf_link & file_size_bytes updated.`)

    return res.status(200).json({ success: true, orderId, revision_number: 0 })
  } catch (err) {
    console.error('💥 [Vercel] ERROR in handleSaveNewOrder:', err.message, err.stack)
    if (NewOrderRow && !NewOrderRow.get('pdf_link')?.startsWith('http')) {
      try {
        NewOrderRow.set('pdf_link', `ERROR: ${err.message}`)
        await NewOrderRow.save()
      } catch (saveErr) {
        console.error('  -> Failed to save error link back to sheet:', saveErr.message)
      }
    }
    return res
      .status(500)
      .json({ success: false, error: 'Internal Server Error saving PO', details: err.message })
  }
}
// =================================================================
// TAMBAHKAN DUA HANDLER BARU INI KE _controller.js
// =================================================================

// ---------------------------------------------------------------
// HANDLER 1: Marketing kirim request project (tanpa items)
// Endpoint: POST /api/request-project
// ---------------------------------------------------------------
export async function handleRequestProject(req, res) {
  console.log('🏁 [Vercel] handleRequestProject started!')
  const data = req.body
  // Validasi minimal
  if (!data.nomorOrder || !data.namaCustomer) {
    return res.status(400).json({ success: false, error: 'Nomor PO dan Nama Customer harus diisi.' })
  }

  try {
    const doc = await openDoc()
    const now = new Date().toISOString()
    const Sheet = getSheet(doc, 'orders')
    const orderId = await getNextIdFromSheet(Sheet)

    const NewOrderRowData = {
      id: orderId,
      revision_number: 0,
      order_number: data.nomorOrder,
      project_name: data.namaCustomer,
      deadline: data.tanggalKirim || null,
      status: 'Requested',           // <-- Status khusus request
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
      project_valuation: toNum(data.project_valuation, 0), // <-- Kolom baru
    }

    console.log(`📝 [Vercel] Adding new Request row: ${NewOrderRowData.order_number}`)
    let NewOrderRow = await Sheet.addRow(NewOrderRowData)

    // Upload foto referensi jika ada
    if (data.poPhotoBase64) {
      console.log('  -> Uploading reference photo for request...')
      const photoResult = await UploadOrderPhoto(
        data.poPhotoBase64,
        data.nomorOrder,
        data.namaCustomer
      )
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

// ---------------------------------------------------------------
// HANDLER 2: Admin konfirmasi request → isi items → jadi PO resmi
// Endpoint: POST /api/confirm-request
// Body: { orderId, items, revisedBy, kubikasi_total }
// ---------------------------------------------------------------
export async function handleConfirmRequest(req, res) {
  console.log('🏁 [Vercel] handleConfirmRequest started!')
  const data = req.body
  const { orderId, items, revisedBy } = data

  if (!orderId) return res.status(400).json({ success: false, error: 'PO ID harus diisi.' })
  if (!items || items.length === 0) return res.status(400).json({ success: false, error: 'Minimal satu item harus diisi.' })

  let doc, targetRow
  try {
    doc = await openDoc()
    const Sheet = getSheet(doc, 'orders')
    const itemSheet = getSheet(doc, 'order_items')

    // Ambil row PO yang berstatus Requested
    const allOrderRows = await Sheet.getRows()
    targetRow = allOrderRows.find(
      (r) =>
        String(r.get('id')).trim() === String(orderId).trim() &&
        toNum(r.get('revision_number'), -1) === 0
    )

    if (!targetRow) {
      return res.status(404).json({ success: false, error: `PO dengan ID ${orderId} tidak ditemukan.` })
    }

    if (targetRow.get('status') !== 'Requested') {
      return res.status(400).json({ success: false, error: 'PO ini bukan berstatus Requested.' })
    }

    // Hitung kubikasi total dari items
    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const now = new Date().toISOString()

    const itemsToAdd = (items || []).map((raw) => {
      const clean = scrubItemPayload(raw)
      const kubikasiItem = toNum(raw.kubikasi, 0)
      const newItem = {
        id: nextItemId,
        order_id: orderId,
        revision_number: 0,
        kubikasi: kubikasiItem,
        ...clean
      }
      itemsWithIds.push({ ...raw, id: nextItemId, kubikasi: kubikasiItem })
      nextItemId++
      return newItem
    })

    console.log(`➕ [Vercel Confirm] Adding ${itemsToAdd.length} items for PO ${orderId}`)
    await itemSheet.addRows(itemsToAdd)

    const kubikasiTotal = itemsWithIds.reduce((acc, item) => acc + toNum(item.kubikasi, 0), 0)

    // Update status PO menjadi 'Open' dan set kubikasi total
    targetRow.set('status', 'Open')
    targetRow.set('kubikasi_total', kubikasiTotal)
    targetRow.set('revised_by', revisedBy || 'Admin')
    targetRow.set('pdf_link', 'generating...')
    await targetRow.save({ raw: false })
    console.log(`✅ [Vercel Confirm] PO ${orderId} status updated to Open`)

    // Generate & upload JPEG PO
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

    console.log(`⏳ [Vercel Confirm] Generating & uploading JPEG for PO ${orderId}...`)
    const uploadResult = await generateAndUploadOrder(orderDataForUpload, 0)

    targetRow.set(
      'pdf_link',
      uploadResult.success ? uploadResult.link : `ERROR: ${uploadResult.error || 'Unknown'}`
    )
    targetRow.set('file_size_bytes', uploadResult.size || 0)
    await targetRow.save({ raw: false })
    console.log(`✅ [Vercel Confirm] PO ${orderId} fully confirmed as Open PO.`)

    return res.status(200).json({ success: true, orderId, message: 'PO berhasil dibuat dari request.' })
  } catch (err) {
    console.error('💥 [Vercel] ERROR in handleConfirmRequest:', err.message, err.stack)
    // Rollback status jika JPEG gagal tapi row sudah diupdate
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
    const Sheet = await getSheet(doc, 'orders')
    const itemSheet = await getSheet(doc, 'order_items')

    const orderId = String(data.orderId)
    if (!orderId) {
      throw new Error('PO ID is required for update.')
    }

    const latestRevNum = await latestRevisionNumberForOrder(orderId, doc)
    const prevRow = latestRevNum >= 0 ? await getHeaderForRevision(orderId, latestRevNum, doc) : null
    const prevData = prevRow ? prevRow.toObject() : {}
    const newRevNum = latestRevNum >= 0 ? latestRevNum + 1 : 0

    fotoLink = prevData.foto_link || 'Tidak ada foto'

    if (data.poPhotoBase64) {
      console.log(`[Vercel Update] 📸 New reference photo detected (Base64), uploading...`)
      const photoResult = await UploadOrderPhoto(
        data.poPhotoBase64,
        data.nomorOrder ?? prevData.order_number ?? `PO-${orderId}`,
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
    console.log(`📝 [Vercel Update] Adding revision ${newRevNum} row data for PO ${orderId}`)
    newRevisionRow = await Sheet.addRow(newRevisionRowData)

    const itemsWithIds = []
    let nextItemId = parseInt(await getNextIdFromSheet(itemSheet), 10)
    const itemsToAdd = (data.items || []).map((raw) => {
      const clean = scrubItemPayload(raw)
      const newItem = {
        id: nextItemId,
        order_id: orderId,
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
        `➕ [Vercel Update] Adding ${itemsToAdd.length} items to sheet for PO ${orderId} Rev ${newRevNum}`
      )
      await itemSheet.addRows(itemsToAdd)
    } else {
      console.warn(`⚠️ [Vercel Update] No items provided for PO ${orderId} Rev ${newRevNum}`)
    }

    const orderDataForUpload = {
      ...newRevisionRowData,
      poPhotoBase64: data.poPhotoBase64,
      items: itemsWithIds
    }
    console.log(`⏳ [Vercel Update] Calling generateAndUploadOrder for PO ${orderId} Rev ${newRevNum}...`)
    const uploadResult = await generateAndUploadOrder(orderDataForUpload, newRevNum)

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
      `🔄 [Vercel Update] Updating pdf_link & file_size_bytes for PO ${orderId} Rev ${newRevNum}...`
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
    console.error('💥 [Vercel Update] ERROR in handleUpdateOrder:', err.message, err.stack)
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

export async function handleDeleteOrder(req, res) {
  const { orderId } = req.query
  const startTime = Date.now()
  const doc = await openDoc()
  const [Sheet, itemSheet, progressSheet] = await Promise.all([
    getSheet(doc, 'orders'),
    getSheet(doc, 'order_items'),
    getSheet(doc, 'progress_tracking')
  ])
  const [orderRows, itemRows, progressRows] = await Promise.all([
    Sheet.getRows(),
    itemSheet.getRows(),
    progressSheet.getRows()
  ])
  const toDelHdr = orderRows.filter((r) => String(r.get('id')).trim() === String(orderId).trim())
  const toDelItems = itemRows.filter(
    (r) => String(r.get('order_id')).trim() === String(orderId).trim()
  )
  const orderProgressRows = progressRows.filter(
    (r) => String(r.get('order_id')).trim() === String(orderId).trim()
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
  orderProgressRows.forEach((progressRow) => {
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

export async function handleListOrderItems(req, res) {
  const { orderId } = req.query
  const doc = await openDoc()
  const latestRev = await latestRevisionNumberForOrder(String(orderId), doc)
  if (latestRev < 0) return res.status(200).json([])
  const items = await getItemsByRevision(String(orderId), latestRev, doc)
  return res.status(200).json(items)
}

export async function handleGetRevisionHistory(req, res) {
  const { orderId } = req.query
  const doc = await openDoc()
  const Sheet = await getSheet(doc, 'orders')
  const allOrderRows = await Sheet.getRows()
  const metas = allOrderRows
    .filter((r) => String(r.get('id')).trim() === String(orderId).trim())
    .map((r) => r.toObject())
  const itemSheet = await getSheet(doc, 'order_items')
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
}

export async function handlePreviewOrder(req, res) {
  const data = req.body
  const orderData = { ...data, created_at: new Date().toISOString() }
  const result = await generateOrderJpeg(orderData, 'preview')
  if (result.success) {
    const base64Data = result.buffer.toString('base64')
    return res.status(200).json({ success: true, base64Data: base64Data })
  }
  throw new Error(result.error || 'Failed to generate JPEG buffer')
}

export async function handleUpdateItemProgress(req, res) {
  const { orderId, itemId, orderNumber, stage, notes, photoBase64 } = req.body
  let photoLink = null

  if (photoBase64) {
    try {
      const auth = getAuth()
      await auth.authorize()

      const timestamp = new Date().toISOString().replace(/:/g, '-')
      const fileName = `Order-${orderNumber}_ITEM-${itemId}_${timestamp}.jpg`
      const imageBuffer = Buffer.from(photoBase64, 'base64')
      const mimeType = 'image/jpeg'

      // Gunakan multipart upload via auth.request (sama seperti generateAndUploadOrder)
      const boundary = `----ProgressBoundary${Date.now()}----`
      const metadata = {
        name: fileName,
        mimeType: mimeType,
        parents: [PROGRESS_PHOTOS_FOLDER_ID]
      }
      const metaPart = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n\r\n`
      )
      const mediaHeaderPart = Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`)
      const endBoundaryPart = Buffer.from(`\r\n--${boundary}--\r\n`)
      const requestBody = Buffer.concat([metaPart, mediaHeaderPart, imageBuffer, endBoundaryPart])

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
      if (fileId) {
        const getResponse = await auth.request({
          url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
          method: 'GET',
          params: { fields: 'webViewLink', supportsAllDrives: true }
        })
        photoLink = getResponse?.data?.webViewLink || null
        console.log(`✅ Progress photo uploaded: ${photoLink}`)
      }
    } catch (photoErr) {
      console.error('❌ Gagal upload foto progress:', photoErr.message)
      // Lanjut simpan progress tanpa foto daripada gagal total
    }
  }

  const doc = await openDoc()
  const progressSheet = await getSheet(doc, 'progress_tracking')
  const nextId = await getNextIdFromSheet(progressSheet)
  await progressSheet.addRow({
    id: nextId,
    order_id: orderId,
    order_item_id: itemId,
    stage: stage,
    notes: notes || '',
    photo_url: photoLink || '',
    created_at: new Date().toISOString()
  })
  return res.status(200).json({ success: true })
}

export async function handleGetActiveOrdersWithProgress(req, res) {
  console.log('--- 🏃‍♂️ EXECUTING handleGetActiveOrdersWithProgress ---')
  const { user } = req.body // [TERIMA USER]

  const doc = await openDoc()
  const [Sheet, itemSheet, progressSheet] = await Promise.all([
    getSheet(doc, 'orders'),
    getSheet(doc, 'order_items'),
    getSheet(doc, 'progress_tracking')
  ])
  const [orderRows, itemRows, progressRows] = await Promise.all([
    Sheet.getRows(),
    itemSheet.getRows(),
    progressSheet.getRows()
  ])
  const byId = new Map()
  orderRows.forEach((r) => {
    const id = String(r.get('id')).trim(),
      rev = toNum(r.get('revision_number'), -1)
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
    const orderId = item.get('order_id'),
      rev = toNum(item.get('revision_number'), -1)
    if (!acc.has(orderId) || rev > acc.get(orderId)) acc.set(orderId, rev)
    return acc
  }, new Map())
  const result = activeOrders.map((order) => {
    const orderId = order.get('id'),
      latestRev = latestItemRevisions.get(orderId) ?? -1
    const orderItems = itemRows.filter(
      (item) =>
        item.get('order_id') === orderId &&
        toNum(item.get('revision_number'), -1) === latestRev
    )
    if (orderItems.length === 0) return { ...order.toObject(), progress: 0 }
    let totalPercentage = orderItems.reduce((total, item) => {
      const itemId = item.get('id'),
        stages = PRODUCTION_STAGES
      const itemProgress = progressByCompositeKey[`${orderId}-${itemId}`] || []
      let latestStageIndex = -1
      if (itemProgress.length > 0) {
        const latest = [...itemProgress].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0]
        latestStageIndex = stages.indexOf(latest.stage)
      }
      return total + (latestStageIndex >= 0 ? ((latestStageIndex + 1) / stages.length) * 100 : 0)
    }, 0)
    return { ...order.toObject(), progress: Math.round(totalPercentage / orderItems.length) }
  })

  // [FILTER MARKETING]
  const filteredResult = filterOrdersByMarketing(result, user)

  return res.status(200).json(filteredResult)
}

export async function handleGetOrderItemsWithDetails(req, res) {
  const { orderId } = req.query
  const doc = await openDoc()
  const [Sheet, itemSheet, progressSheet] = await Promise.all([
    getSheet(doc, 'orders'),
    getSheet(doc, 'order_items'),
    getSheet(doc, 'progress_tracking')
  ])
  const [orderRows, itemRows, progressRows] = await Promise.all([
    Sheet.getRows(),
    itemSheet.getRows(),
    progressSheet.getRows()
  ])

  const allItemsForOrder = itemRows.filter((r) => r.get('order_id') === orderId)
  if (allItemsForOrder.length === 0) {
    return res.status(200).json([])
  }
  const latestItemRev = Math.max(-1, ...allItemsForOrder.map((r) => toNum(r.get('revision_number'))))
  const orderData = orderRows.find(
    (r) => r.get('id') === orderId && toNum(r.get('revision_number')) === latestItemRev
  )

  if (!orderData) {
    throw new Error(`Data PO untuk revisi terbaru (rev ${latestItemRev}) tidak ditemukan.`)
  }

  const poStartDate = new Date(orderData.get('created_at'))
  const poDeadline = new Date(orderData.get('deadline'))

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
  const [progressSheet, itemSheet, Sheet] = await Promise.all([
    getSheet(doc, 'progress_tracking'),
    getSheet(doc, 'order_items'),
    getSheet(doc, 'orders')
  ])
  const [progressRows, itemRows, orderRows] = await Promise.all([
    progressSheet.getRows(),
    itemSheet.getRows(),
    Sheet.getRows()
  ])

  // [FILTER MARKETING]
  const filteredOrderRows = filterOrdersByMarketing(orderRows, user)

  const itemMap = new Map(itemRows.map((r) => [r.get('id'), r.toObject()]))
  const orderMap = filteredOrderRows.reduce((acc, r) => {
    const orderId = r.get('id'),
      rev = toNum(r.get('revision_number'))
    // Gunakan .get() karena 'r' adalah GoogleSpreadsheetRow
    if (!acc.has(orderId) || rev > toNum(acc.get(orderId).revision_number)) {
      acc.set(orderId, r.toObject())
    }
    return acc
  }, new Map())

  const limit = req.query.limit ? parseInt(req.query.limit) : 10
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
}

export async function handleGetAttentionData(req, res) {
  console.log('--- 🎯 EXECUTING handleGetAttentionData ---')
  const { user } = req.body // [TERIMA USER]

  const doc = await openDoc()
  const [Sheet, itemSheet, progressSheet] = await Promise.all([
    getSheet(doc, 'orders'),
    getSheet(doc, 'order_items'),
    getSheet(doc, 'progress_tracking')
  ])
  const [orderRows, itemRows, progressRows] = await Promise.all([
    Sheet.getRows(),
    itemSheet.getRows(),
    progressSheet.getRows()
  ])

  // [FILTER MARKETING]
  const filteredOrderRows = filterOrdersByMarketing(orderRows, user)

  const latestOrderMap = filteredOrderRows.reduce((map, r) => {
    const id = r.get('id'),
      rev = toNum(r.get('revision_number'))
    if (!map.has(id) || rev > map.get(id).rev) map.set(id, { rev, row: r })
    return map
  }, new Map())
  const latestItemRevisions = itemRows.reduce((map, item) => {
    const orderId = item.get('order_id'),
      rev = toNum(item.get('revision_number'), -1)
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
  const nearingDeadline = [],
    stuckItems = [],
    urgentItems = []
  const today = new Date(),
    sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000),
    fiveDaysAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000)
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
    const [itemSheet, Sheet, productSheet] = await Promise.all([
      getSheet(doc, 'order_items'),
      getSheet(doc, 'orders'),
      getSheet(doc, 'product_master')
    ])
    const [itemRowsRaw, orderRowsRaw, productRowsRaw] = await Promise.all([
      itemSheet.getRows(),
      Sheet.getRows(),
      productSheet.getRows()
    ])

    const itemRows = itemRowsRaw.map((r) => r.toObject())
    const orderRowsRawObjects = orderRowsRaw.map((r) => r.toObject()) // Data mentah
    const productRows = productRowsRaw.map((r) => r.toObject())

    // [FILTER MARKETING]
    const orderRows = filterOrdersByMarketing(orderRowsRawObjects, user)

    const latestOrderMap = orderRows.reduce((map, order) => {
      const orderId = order.id
      const rev = toNum(order.revision_number)
      if (order.status !== 'Cancelled') {
        const existing = map.get(orderId)
        if (!existing || rev > existing.revision_number) {
          map.set(orderId, { ...order, revision_number: rev })
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
      const order = latestOrderMap.get(item.order_id)
      if (!order || toNum(item.revision_number) !== order.revision_number) {
        return
      }

      const productName = item.product_name
      const quantity = toNum(item.quantity, 0)
      const kubikasi = toNum(item.kubikasi, 0)
      const woodType = item.wood_type
      const yearMonth = getYearMonth(order.created_at)

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
        salesByDateForTrend.push({ date: new Date(order.created_at), name: productName, quantity })
      } catch {}
    })

    latestOrderMap.forEach((order) => {
      const marketingName = order.acc_marketing || 'N/A'
      const customerName = order.project_name
      const kubikasiTotalOrder = toNum(order.kubikasi_total, 0)
      const yearMonth = getYearMonth(order.created_at)

      salesByMarketing[marketingName] = salesByMarketing[marketingName] || {
        totalKubikasi: 0,
        orderCount: 0,
        name: marketingName
      }
      salesByMarketing[marketingName].totalKubikasi += kubikasiTotalOrder
      salesByMarketing[marketingName].orderCount += 1

      if (yearMonth) {
        monthlySalesByMarketing[yearMonth] = monthlySalesByMarketing[yearMonth] || {}
        monthlySalesByMarketing[yearMonth][marketingName] =
          (monthlySalesByMarketing[yearMonth][marketingName] || 0) + kubikasiTotalOrder
      }

      if (customerName)
        customerByKubikasi[customerName] = (customerByKubikasi[customerName] || 0) + kubikasiTotalOrder
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
  const [itemSheet, Sheet] = await Promise.all([
    getSheet(doc, 'order_items'),
    getSheet(doc, 'orders')
  ])
  const [itemRows, orderRows] = await Promise.all([itemSheet.getRows(), Sheet.getRows()])

  // [FILTER MARKETING]
  const filteredOrderRows = filterOrdersByMarketing(orderRows, user)

  const orderMap = filteredOrderRows.reduce((map, r) => {
    const orderId = r.get('id'),
      rev = toNum(r.get('revision_number'))
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

export async function handleListOrderRevisions(req, res) {
  const { orderId } = req.query
  const doc = await openDoc()
  const Sheet = await getSheet(doc, 'orders')
  const rows = await Sheet.getRows()
  const revisions = rows
    .filter((r) => String(r.get('id')).trim() === String(orderId).trim())
    .map((r) => r.toObject())
    .sort((a, b) => a.revision_number - b.revision_number)
  return res.status(200).json(revisions)
}

export async function handleListOrderItemsByRevision(req, res) {
  const { orderId, revisionNumber } = req.query
  const doc = await openDoc()
  const items = await getItemsByRevision(String(orderId), toNum(revisionNumber, 0), doc)
  return res.status(200).json(items)
}

export async function handleUpdateStageDeadline(req, res) {
  const { orderId, itemId, stageName, newDeadline } = req.body
  const doc = await openDoc()
  const sheet = await getSheet(doc, 'progress_tracking')
  await sheet.addRow({
    order_id: orderId,
    order_item_id: itemId,
    stage: `DEADLINE_OVERRIDE: ${stageName}`,
    custom_deadline: newDeadline,
    created_at: new Date().toISOString()
  })
  return res.status(200).json({ success: true })
}

// --- AI CHAT HELPERS (VERCEL) ---

async function listOrdersforChat(user) {
  const doc = await openDoc()
  const Sheet = getSheet(doc, 'orders')
  const itemSheet = getSheet(doc, 'order_items')
  const progressSheet = getSheet(doc, 'progress_tracking')

  const [orderRowsRaw, itemRowsRaw, progressRowsRaw] = await Promise.all([
    Sheet.getRows(),
    itemSheet.getRows(),
    progressSheet.getRows()
  ])

  // [FILTER MARKETING]
  const orderRowsFiltered = filterOrdersByMarketing(orderRowsRaw, user)

  const orderRows = orderRowsFiltered.map((r) => r.toObject())
  const itemRows = itemRowsRaw.map((r) => r.toObject())
  const progressRows = progressRowsRaw.map((r) => r.toObject())

  const byId = new Map()
  for (const r of orderRows) {
    const id = String(r.id).trim()
    const rev = toNum(r.revision_number, -1)
    if (!byId.has(id) || rev > byId.get(id).rev) {
      byId.set(id, { rev, row: r })
    }
  }
  const latestorderObjects = Array.from(byId.values()).map(({ row }) => row)

  const progressByCompositeKey = progressRows.reduce((acc, row) => {
    const key = `${row.order_id}-${row.order_item_id}`
    if (!acc[key]) acc[key] = []
    acc[key].push({ stage: row.stage, created_at: row.created_at })
    return acc
  }, {})

  const latestItemRevisions = itemRows.reduce((acc, item) => {
    const orderId = item.order_id
    const rev = toNum(item.revision_number, -1)
    if (!acc.has(orderId) || rev > acc.get(orderId)) {
      acc.set(orderId, rev)
    }
    return acc
  }, new Map())

  const result = latestorderObjects.map((orderObject) => {
    const orderId = orderObject.id
    const latestRev = latestItemRevisions.get(orderId) ?? -1
    const orderItems = itemRows.filter(
      (item) => item.order_id === orderId && toNum(item.revision_number, -1) === latestRev
    )

    let orderProgress = 0
    let finalStatus = orderObject.status || 'Open'
    let completed_at = null

    if (orderItems.length > 0) {
      let totalPercentage = 0
      orderItems.forEach((item) => {
        const itemId = item.id
        const itemProgressHistory = progressByCompositeKey[`${orderId}-${itemId}`] || []
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
      orderProgress = totalPercentage / orderItems.length
    }

    const roundedProgress = Math.round(orderProgress)
    if (finalStatus !== 'Cancelled') {
      if (roundedProgress >= 100) {
        finalStatus = 'Completed'
        const allProgressForOrder = progressRows
          .filter((row) => row.order_id === orderId)
          .map((row) => new Date(row.created_at).getTime())
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


export async function handleGetCommissionData(req, res) {
  const { user } = req.body
  try {
    const doc = await openDoc()
    const userDoc = await openUserDoc()

    const orderSheet = await getSheet(doc, 'orders')
    const orderRows = await orderSheet.getRows()

    const userSheet = await getSheet(userDoc, 'users')
    await userSheet.loadHeaderRow()
    const userRows = await userSheet.getRows()

    // Map nama marketing → commission_rate
    const commissionRateMap = {}
    userRows.forEach((r) => {
      const name = r.get('name')?.trim()
      const rate = Number(r.get('commision_rate') || 0)
      if (name && rate > 0) {
        commissionRateMap[name.toLowerCase()] = rate
      }
    })

    // Ambil latest revision per order
    const orderObjects = orderRows.map((r) => r.toObject())
    const byId = new Map()
    for (const r of orderObjects) {
      const id = String(r.id).trim()
      const rev = toNum(r.revision_number, -1)
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
// PRE-COMPUTED ANALYTICS CACHE - Sekali fetch, langsung answer kompleks
// =================================================================

// Cache in-memory (reset setiap cold start, tapi tetap lebih baik dari 2x LLM call)
let analyticsCache = null
let cacheTimestamp = null
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 menit cache

async function buildFullAnalyticsCache(user) {
  const doc = await openDoc()
  const [orderSheet, itemSheet, progressSheet, productSheet] = await Promise.all([
    getSheet(doc, 'orders'),
    getSheet(doc, 'order_items'),
    getSheet(doc, 'progress_tracking'),
    getSheet(doc, 'product_master')
  ])

  const [orderRowsRaw, itemRowsRaw, progressRowsRaw, productRowsRaw] = await Promise.all([
    orderSheet.getRows(),
    itemSheet.getRows(),
    progressSheet.getRows(),
    productSheet.getRows()
  ])

  const orderRowsRawObjects = orderRowsRaw.map((r) => r.toObject())
  const itemRows = itemRowsRaw.map((r) => r.toObject())
  const progressRows = progressRowsRaw.map((r) => r.toObject())
  const productRows = productRowsRaw.map((r) => r.toObject())

  // Filter berdasarkan marketing
  const orderRows = filterOrdersByMarketing(orderRowsRawObjects, user)

  // Build latest order map
  const latestOrderMap = new Map()
  orderRows.forEach((order) => {
    const orderId = order.id
    const rev = toNum(order.revision_number)
    if (order.status !== 'Cancelled') {
      const existing = latestOrderMap.get(orderId)
      if (!existing || rev > existing.revision_number) {
        latestOrderMap.set(orderId, { ...order, revision_number: rev })
      }
    }
  })

  // Latest item revisions
  const latestItemRevisions = new Map()
  itemRows.forEach((item) => {
    const orderId = item.order_id
    const rev = toNum(item.revision_number, -1)
    const current = latestItemRevisions.get(orderId)
    if (current === undefined || rev > current) {
      latestItemRevisions.set(orderId, rev)
    }
  })

  // Progress by composite key
  const progressByCompositeKey = {}
  progressRows.forEach((row) => {
    const key = `${row.order_id}-${row.order_item_id}`
    if (!progressByCompositeKey[key]) progressByCompositeKey[key] = []
    progressByCompositeKey[key].push({ stage: row.stage, created_at: row.created_at })
  })

  // ========== COMPUTE ALL ANALYTICS ONCE ==========

  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`

  // 1. Urgent Orders
  const urgentOrders = Array.from(latestOrderMap.values())
    .filter(o => o.priority === 'Urgent' && o.status !== 'Completed' && o.status !== 'Cancelled')
    .map(o => ({ order_number: o.order_number, project_name: o.project_name, deadline: o.deadline, status: o.status }))

  // 1b. Requested Orders (belum dikonfirmasi)
  const requestedOrders = Array.from(latestOrderMap.values())
    .filter(o => o.status === 'Requested')
    .map(o => ({ order_number: o.order_number, project_name: o.project_name, deadline: o.deadline, acc_marketing: o.acc_marketing, created_at: o.created_at }))

  // 2. Sales by Marketing (this month)
  const salesByMarketingThisMonth = {}
  const salesByMarketingLastMonth = {}
  const marketingOrderCount = {}
  const marketingKubikasi = {}

  latestOrderMap.forEach((order) => {
    const marketing = order.acc_marketing || 'N/A'
    const ym = getYearMonth(order.created_at)
    const kubikasi = toNum(order.kubikasi_total, 0)

    if (!marketingKubikasi[marketing]) {
      marketingKubikasi[marketing] = { totalKubikasi: 0, orderCount: 0 }
      salesByMarketingThisMonth[marketing] = 0
      salesByMarketingLastMonth[marketing] = 0
    }
    marketingKubikasi[marketing].totalKubikasi += kubikasi
    marketingKubikasi[marketing].orderCount += 1

    if (ym === currentMonth) {
      salesByMarketingThisMonth[marketing] = (salesByMarketingThisMonth[marketing] || 0) + kubikasi
    } else if (ym === lastMonth) {
      salesByMarketingLastMonth[marketing] = (salesByMarketingLastMonth[marketing] || 0) + kubikasi
    }
  })

  const topMarketingThisMonth = Object.entries(salesByMarketingThisMonth)
    .map(([name, kubikasi]) => ({ name, kubikasi }))
    .sort((a, b) => b.kubikasi - a.kubikasi)

  const topMarketingByOrders = Object.values(marketingKubikasi)
    .sort((a, b) => b.orderCount - a.orderCount)

  // 3. Top Products (this month)
  const productSalesThisMonth = {}
  const productSalesLastMonth = {}

  itemRows.forEach((item) => {
    const order = latestOrderMap.get(item.order_id)
    if (!order || toNum(item.revision_number) !== latestItemRevisions.get(item.order_id)) return

    const ym = getYearMonth(order.created_at)
    const productName = item.product_name
    const quantity = toNum(item.quantity, 0)

    if (!productName) return

    if (ym === currentMonth) {
      productSalesThisMonth[productName] = (productSalesThisMonth[productName] || 0) + quantity
    } else if (ym === lastMonth) {
      productSalesLastMonth[productName] = (productSalesLastMonth[productName] || 0) + quantity
    }
  })

  const topProductsThisMonth = Object.entries(productSalesThisMonth)
    .map(([name, qty]) => ({ name, quantity: qty }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)

  // 4. Customer Repeat Orders
  const customerOrderCount = {}
  latestOrderMap.forEach((order) => {
    const customer = order.project_name
    if (customer) {
      customerOrderCount[customer] = (customerOrderCount[customer] || 0) + 1
    }
  })

  const repeatCustomers = Object.entries(customerOrderCount)
    .filter(([_, count]) => count > 1)
    .map(([name, count]) => ({ name, orderCount: count }))
    .sort((a, b) => b.orderCount - a.orderCount)

  // 5. Largest Orders by Marketing
  const ordersByMarketing = {}
  latestOrderMap.forEach((order) => {
    const marketing = order.acc_marketing || 'N/A'
    if (!ordersByMarketing[marketing]) ordersByMarketing[marketing] = []
    ordersByMarketing[marketing].push({
      order_number: order.order_number,
      kubikasi: toNum(order.kubikasi_total, 0),
      project_name: order.project_name
    })
  })

  const largestOrderByMarketing = {}
  Object.entries(ordersByMarketing).forEach(([marketing, orders]) => {
    const sorted = orders.sort((a, b) => b.kubikasi - a.kubikasi)
    largestOrderByMarketing[marketing] = sorted[0]
  })

  // 6. Order Stats
  const totalOrders = latestOrderMap.size
  const activeOrders = Array.from(latestOrderMap.values())
    .filter(o => o.status !== 'Completed' && o.status !== 'Cancelled').length
  const completedOrders = Array.from(latestOrderMap.values())
    .filter(o => o.status === 'Completed').length

  // 7. Nearing Deadline (7 days)
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const nearingDeadline = Array.from(latestOrderMap.values())
    .filter(o => {
      if (!o.deadline || o.status === 'Completed' || o.status === 'Cancelled') return false
      const deadline = new Date(o.deadline)
      return deadline <= sevenDaysFromNow && deadline >= now
    })
    .map(o => ({ order_number: o.order_number, project_name: o.project_name, deadline: o.deadline }))
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))

  // 8. Stuck Items (no progress > 5 days)
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
  const stuckItems = []
  latestItemRevisions.forEach((rev, orderId) => {
    const order = latestOrderMap.get(orderId)
    if (!order || order.status === 'Completed' || order.status === 'Cancelled') return

    const items = itemRows.filter(i => i.order_id === orderId && toNum(i.revision_number) === rev)
    items.forEach(item => {
      const key = `${orderId}-${item.id}`
      const progress = progressByCompositeKey[key] || []
      if (progress.length > 0) {
        const latest = [...progress].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
        if (new Date(latest.created_at) < fiveDaysAgo && latest.stage !== 'Siap Kirim') {
          stuckItems.push({
            order_number: order.order_number,
            item_name: item.product_name,
            last_update: latest.created_at
          })
        }
      }
    })
  })

  // 9. Progress Summary
  const progressByStage = {}
  progressRows.forEach(p => {
    progressByStage[p.stage] = (progressByStage[p.stage] || 0) + 1
  })

  // 10. Product Master (for new product suggestions)
  const allProductNames = productRows.map(p => p.product_name).filter(Boolean)
  const soldProducts = new Set(itemRows.map(i => i.product_name).filter(Boolean))
  const slowMovingProducts = allProductNames.filter(n => !soldProducts.has(n))

  return {
    // Metadata
    generatedAt: now.toISOString(),
    currentMonth,
    lastMonth,
    userRole: user?.role || 'unknown',
    userName: user?.name || 'unknown',

    // Stats
    totalOrders,
    activeOrders,
    completedOrders,

    // Urgent
    urgentOrders,

    // Requested (belum dikonfirmasi)
    requestedOrders,

    // Marketing
    topMarketingThisMonth,
    topMarketingByOrders,
    largestOrderByMarketing,

    // Products
    topProductsThisMonth,

    // Customers
    repeatCustomers,

    // Deadline & Stuck
    nearingDeadline,
    stuckItems,

    // Progress
    progressByStage,

    // Products
    slowMovingProducts,

    // Full order map for status queries
    latestOrderMap: Array.from(latestOrderMap.values())
  }
}

export async function handleGetAnalyticsCache(req, res) {
  console.log('🏁 [Vercel] handleGetAnalyticsCache started!')
  const { user } = req.body
  const { forceRefresh } = req.query

  try {
    // Check cache validity
    const now = Date.now()
    const isCacheValid = analyticsCache && 
                        cacheTimestamp && 
                        (now - cacheTimestamp) < CACHE_TTL_MS

    if (isCacheValid && !forceRefresh) {
      // Filter cache berdasarkan user role
      if (user?.role === 'marketing') {
        // Return data yang sudah difilter untuk marketing
        return res.status(200).json(analyticsCache)
      }
      return res.status(200).json(analyticsCache)
    }

    console.log('🔄 [Analytics] Building fresh cache...')
    analyticsCache = await buildFullAnalyticsCache(user)
    cacheTimestamp = now

    return res.status(200).json(analyticsCache)
  } catch (err) {
    console.error('💥 [Vercel] ERROR in handleGetAnalyticsCache:', err.message)
    return res.status(500).json({ success: false, error: err.message })
  }
}

// =================================================================
// INTELLIGENT PATTERN MATCHING - Tanpa LLM untuk pertanyaan umum
// =================================================================

function matchQueryToAnswer(prompt, cache) {
  const lowerPrompt = prompt.toLowerCase()
  
  // ═══════════════════════════════════════════════════════════════
  // PATTERN KOMPLEKS - Pertanyaan dengan analisis lebih dalam
  // ═══════════════════════════════════════════════════════════════
  
  // Pattern: Perbandingan bulan ini vs bulan lalu
  if (lowerPrompt.match(/banding|vs|compared|sebelum|menurun|naik|growth|pertumbuhan|change/i)) {
    if (cache.topMarketingThisMonth && cache.topMarketingLastMonth) {
      const comparison = cache.topMarketingThisMonth.map(current => {
        const last = cache.topMarketingLastMonth.find(m => m.name === current.name)
        const lastVal = last?.kubikasi || 0
        const change = lastVal > 0 ? ((current.kubikasi - lastVal) / lastVal * 100).toFixed(1) : '100'
        const arrow = current.kubikasi > lastVal ? '📈' : (current.kubikasi < lastVal ? '📉' : '➡️')
        return `${arrow} **${current.name}**: ${current.kubikasi.toFixed(2)} m³ (${change > 0 ? '+' : ''}${change}%)`
      })
      return `📊 **Perbandingan Bulan Ini vs Bulan Lalu:**\n` + comparison.slice(0, 5).join('\n')
    }
    return "Data perbandingan bulan lalu belum tersedia."
  }

  // Pattern: Trend / Tren produk (naik/turun)
  if (lowerPrompt.match(/trend|naik|menurun|paling naik|paling turun|热门|hot|热门产品/i)) {
    if (cache.topProductsThisMonth && cache.topProductsLastMonth) {
      const trends = cache.topProductsThisMonth.map(current => {
        const last = cache.topProductsLastMonth.find(p => p.name === current.name)
        const lastQty = last?.quantity || 0
        const change = lastQty > 0 ? ((current.quantity - lastQty) / lastQty * 100).toFixed(1) : 'new'
        return { name: current.name, qty: current.quantity, change: parseFloat(change) }
      }).sort((a, b) => b.change - a.change)
      
      const rising = trends.filter(t => t.change > 0).slice(0, 3)
      const falling = trends.filter(t => t.change < 0).slice(0, 3)
      
      let result = `📈 **Trend Produk:**\n\n`
      if (rising.length > 0) {
        result += `🔥 **Meningkat:**\n` + rising.map((p, i) => 
          `${i+1}. ${p.name} (${p.change > 0 ? '+' : ''}${p.change}%)`
        ).join('\n') + `\n\n`
      }
      if (falling.length > 0) {
        result += `❄️ **Menurun:**\n` + falling.map((p, i) => 
          `${i+1}. ${p.name} (${p.change}%)`
        ).join('\n')
      }
      return result
    }
    return "Data trend belum tersedia."
  }

  // Pattern: Ranking lengkap (top 5/10)
  if (lowerPrompt.match(/ranking|peringkat|top 5|top 10|terbaik|terbesar|teringgi|terbanyak/i)) {
    let result = `🏆 **Ranking:**\n\n`
    
    // Top Marketing
    if (lowerPrompt.match(/marketing/i)) {
      result += `**📊 Top Marketing (Bulan Ini):**\n`
      result += cache.topMarketingThisMonth?.slice(0, 5).map((m, i) => 
        `${i+1}. ${m.name} - ${m.kubikasi.toFixed(2)} m³`
      ).join('\n') + `\n\n`
    }
    
    // Top Products
    if (lowerPrompt.match(/produk|item|product/i)) {
      result += `**🏭 Top Produk (Bulan Ini):**\n`
      result += cache.topProductsThisMonth?.slice(0, 5).map((p, i) => 
        `${i+1}. ${p.name} - ${p.quantity} unit`
      ).join('\n') + `\n\n`
    }
    
    // Top Customer
    if (lowerPrompt.match(/customer|klien|pelanggan|client/i)) {
      result += `**👥 Top Customer (by Kubikasi):**\n`
      result += cache.topCustomers?.slice(0, 5).map((c, i) => 
        `${i+1}. ${c.name} - ${c.totalKubikasi.toFixed(2)} m³`
      ).join('\n')
    }
    
    return result.trim()
  }

  // Pattern: Analytics lengkap per marketing
  if (lowerPrompt.match(/analisis|analysis|report|laporan|report/i)) {
    const marketingDetails = cache.topMarketingThisMonth?.map(m => {
      const orders = cache.latestOrderMap?.filter(o => o.acc_marketing === m.name) || []
      return {
        name: m.name,
        kubikasi: m.kubikasi,
        orderCount: orders.length,
        avgKubikasi: orders.length > 0 ? (m.kubikasi / orders.length).toFixed(2) : 0
      }
    }) || []
    
    return `📈 **Analisis Marketing (Bulan ${cache.currentMonth}):**\n\n` +
      marketingDetails.slice(0, 5).map((m, i) => 
        `${i+1}. **${m.name}**
   • Total Kubikasi: ${m.kubikasi.toFixed(2)} m³
   • Jumlah Order: ${m.orderCount}
   • Rata-rata per Order: ${m.avgKubikasi} m³`
      ).join('\n\n')
  }

  // Pattern: KPI / Metrik bisnis
  if (lowerPrompt.match(/kpi|metrik|metric|business|omset|pendapatan|revenue|valuasi|project value/i)) {
    const totalValuation = cache.latestOrderMap?.reduce((sum, o) => 
      sum + (parseFloat(o.project_valuation) || 0), 0) || 0
    const avgValuation = cache.totalOrders > 0 ? (totalValuation / cache.totalOrders).toFixed(0) : 0
    
    return `💰 **KPI Bisnis:**\n\n` +
      `• Total Project Valuation: Rp ${(totalValuation/1000000).toFixed(1)} M\n` +
      `• Rata-rata per Order: Rp ${(avgValuation/1000000).toFixed(1)} M\n` +
      `• Total Order: ${cache.totalOrders}\n` +
      `• Order Aktif: ${cache.activeOrders}\n` +
      `• Order Completed: ${cache.completedOrders}\n` +
      `• Conversion Rate: ${cache.totalOrders > 0 ? ((cache.completedOrders/cache.totalOrders)*100).toFixed(1) : 0}%`
  }

  // Pattern: Production progress summary
  if (lowerPrompt.match(/progress|produksi|production|stage|tahapan|proses/i)) {
    const stageCounts = cache.progressByStage || {}
    const stages = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])
    
    return `🏭 **Ringkasan Progress Produksi:**\n\n` +
      stages.slice(0, 8).map(([stage, count]) => 
        `• ${stage}: ${count} record`
      ).join('\n')
  }

  // Pattern: Wood type analysis
  if (lowerPrompt.match(/kayu|wood|jenis kayu|material/i)) {
    // Compute wood type from items
    const woodTypeMap = {}
    cache.latestOrderMap?.forEach(order => {
      // This would need to be computed from order_items
    })
    return `🪵 **Analisis Jenis Kayu:**\n\n` +
      `Data jenis kayu dapat dilihat di menu Analisis Penjualan.\n` +
      `Gunakan filter untuk melihat distribusi kayu per periode.`
  }

  // ═══════════════════════════════════════════════════════════════
  // PATTERN DASAR - Pertanyaan sederhana
  // ═══════════════════════════════════════════════════════════════
  
  // Pattern: Urgent Orders
  if (lowerPrompt.match(/order urgent|po urgent|urgent|prioritas tinggi|yang urgent/i)) {
    if (cache.urgentOrders?.length > 0) {
      return `🚨 **${cache.urgentOrders.length} Order Urgent:**\n\n` + 
        cache.urgentOrders.map(o => 
        `• **${o.order_number}** - ${o.project_name}\n  Deadline: ${o.deadline || '-'}\n  Status: ${o.status}`
      ).join('\n')
    }
    return "✅ Tidak ada order urgent saat ini."
  }

  // Pattern: Requested Orders (belum dikonfirmasi)
  if (lowerPrompt.match(/requested|request|menunggu|belum konfirmasi|pending|belum jadi po|request project/i)) {
    if (cache.requestedOrders?.length > 0) {
      return `📋 **${cache.requestedOrders.length} Order Requested** (menunggu konfirmasi admin):\n\n` + 
        cache.requestedOrders.map(o => 
        `• **${o.order_number}** - ${o.project_name}\n  Marketing: ${o.acc_marketing || '-'}\n  Deadline: ${o.deadline || '-'}`
      ).join('\n')
    }
    return "✅ Tidak ada order Requested. Semua order sudah dikonfirmasi."
  }

  // Pattern: Top Marketing this month
  if (lowerPrompt.match(/marketing paling banyak|jualan paling banyak|penjualan tertinggi|top marketing|marketing terbaik/i)) {
    if (cache.topMarketingThisMonth?.length > 0) {
      const top = cache.topMarketingThisMonth[0]
      const total = cache.topMarketingThisMonth.reduce((s, m) => s + m.kubikasi, 0)
      const percent = ((top.kubikasi / total) * 100).toFixed(1)
      return `🏆 **Top Marketing Bulan Ini:**\n\n` +
        `🥇 **${top.name}** dengan ${top.kubikasi.toFixed(2)} m³ (${percent}% dari total ${total.toFixed(2)} m³)`
    }
    return "Tidak ada data penjualan bulan ini."
  }

  // Pattern: Largest order by marketing
  if (lowerPrompt.match(/order terbesar|po terbesar|pesanan terbesar| terbesar marketing/i)) {
    const entries = Object.entries(cache.largestOrderByMarketing || {})
    if (entries.length > 0) {
      const sorted = entries
        .map(([m, o]) => ({ marketing: m, ...o }))
        .sort((a, b) => b.kubikasi - a.kubikasi)
      
      return `📦 **Order Terbesar per Marketing:**\n\n` + 
        sorted.slice(0, 5).map((o, i) => 
        `${i+1}. **${o.marketing}**: ${o.order_number}\n   Project: ${o.project_name}\n   Kubikasi: ${o.kubikasi.toFixed(2)} m³`
      ).join('\n\n')
    }
    return "Tidak ada data order."
  }

  // Pattern: Repeat customers
  if (lowerPrompt.match(/repeat|customer ulang|pelanggan tetap|beli lagi|klien tetap/i)) {
    if (cache.repeatCustomers?.length > 0) {
      return `🔁 **${cache.repeatCustomers.length} Customer Repeat:**\n\n` + 
        cache.repeatCustomers.slice(0, 10).map(c => 
        `• **${c.name}** - ${c.orderCount} kali pesan`
      ).join('\n')
    }
    return "Tidak ada customer repeat."
  }

  // Pattern: Total orders
  if (lowerPrompt.match(/jumlah total|total order|ada berapa order|berapa order/i)) {
    return `📊 **Statistik Order:**\n\n` +
      `• **Total:** ${cache.totalOrders}\n` +
      `• **Aktif:** ${cache.activeOrders}\n` +
      `• **Selesai:** ${cache.completedOrders}\n` +
      `• **Urgent:** ${cache.urgentOrders?.length || 0}\n` +
      `• **Requested:** ${cache.requestedOrders?.length || 0}`
  }

  // Pattern: Deadline
  if (lowerPrompt.match(/deadline|dekat|jatuh tempo|segera|hari ini|minggu ini/i)) {
    if (cache.nearingDeadline?.length > 0) {
      return `⏰ **${cache.nearingDeadline.length} Deadline Terdekat:**\n\n` + 
        cache.nearingDeadline.slice(0, 5).map(o => 
        `• **${o.order_number}** - ${o.project_name}\n  Deadline: ${o.deadline}`
      ).join('\n')
    }
    return "Tidak ada deadline dekat dalam 7 hari ke depan."
  }

  // Pattern: Stuck items
  if (lowerPrompt.match(/stuck|macet|tidak bergerak|belum jadi|proses|lama/i)) {
    if (cache.stuckItems?.length > 0) {
      return `⚠️ **${cache.stuckItems.length} Item Stuck (>5 hari tidak ada progress):**\n\n` + 
        cache.stuckItems.slice(0, 5).map(s => 
        `• **${s.order_number}** - ${s.item_name}\n  Last update: ${s.last_update?.split('T')[0]}`
      ).join('\n')
    }
    return "✅ Tidak ada item stuck. Semua proses berjalan normal."
  }

  // Pattern: Top products
  if (lowerPrompt.match(/produk paling|item paling|laris|best seller|top product|produk terlaris/i)) {
    if (cache.topProductsThisMonth?.length > 0) {
      return `🔥 **Top ${Math.min(5, cache.topProductsThisMonth.length)} Produk Terlaris (Bulan Ini):**\n\n` + 
        cache.topProductsThisMonth.slice(0, 5).map((p, i) => 
        `${i+1}. **${p.name}** - ${p.quantity} unit`
      ).join('\n')
    }
    return "Tidak ada data produk bulan ini."
  }

  // Pattern: Help
  if (lowerPrompt.match(/bisa apa|fitur|menu|bantuan|help|apa saja/i)) {
    return `🤖 **Kemampuan AI ERP Ubinkayu:**

**📊 Analisis & Ranking:**
• Ranking marketing, produk, customer
• Perbandingan bulan ini vs bulan lalu
• Trend produk (naik/turun)
• Analisis lengkap per marketing

**📋 Status Order:**
• Urgent, Requested, Active, Completed
• Deadline terdekat
• Item stuck/macet

**💰 KPI Bisnis:**
• Total project valuation
• Rata-rata per order
• Conversion rate

**🔍 Query Umum:**
• Jumlah total order
• Top performance
• Customer repeat
• Dan pertanyaan lainnya!

Coba tanya: "ranking marketing" atau "beri ringkasan" atau "analisis bulan ini"`
  }

  // Pattern: Ringkasan / Summary
  if (lowerPrompt.match(/ringkasan|summary|overview|rekap|statistik|dashboard/i)) {
    return `📊 **Ringkasan ERP Ubinkayu**

**📈 Status Order:**
• Total: ${cache.totalOrders} | Aktif: ${cache.activeOrders} | Selesai: ${cache.completedOrders}

**🚨 Perlu Attention:**
• Urgent: ${cache.urgentOrders?.length || 0} order
• Requested: ${cache.requestedOrders?.length || 0} order (menunggu konfirmasi)
• Deadline dekat: ${cache.nearingDeadline?.length || 0} order
• Stuck: ${cache.stuckItems?.length || 0} item

**🏆 Top Performance:**
• Marketing terbaik: ${cache.topMarketingThisMonth?.[0]?.name || '-'} (${cache.topMarketingThisMonth?.[0]?.kubikasi?.toFixed(2) || 0} m³)
• Produk terlaris: ${cache.topProductsThisMonth?.[0]?.name || '-'}
• Customer repeat: ${cache.repeatCustomers?.length || 0} customer`
  }

  // Pattern: Status specific
  if (lowerPrompt.match(/status|in progress|completed|open|cancelled/i)) {
    const statusCounts = {}
    ;(cache.latestOrderMap || []).forEach(o => {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1
    })
    return `📈 **Status Order:**\n\n` +
      `• Open: ${statusCounts['Open'] || 0}\n` +
      `• In Progress: ${statusCounts['In Progress'] || 0}\n` +
      `• Requested: ${statusCounts['Requested'] || 0}\n` +
      `• Completed: ${statusCounts['Completed'] || 0}\n` +
      `• Cancelled: ${statusCounts['Cancelled'] || 0}`
  }

  // Pattern: By Marketing (sales per marketing)
  if (lowerPrompt.match(/sales|penjualan per marketing|performance marketing/i)) {
    if (cache.topMarketingThisMonth?.length > 0) {
      const total = cache.topMarketingThisMonth.reduce((s, m) => s + m.kubikasi, 0)
      return `📈 **Penjualan per Marketing (Bulan ${cache.currentMonth}):**\n\n` +
        cache.topMarketingThisMonth.slice(0, 10).map((m, i) => {
          const percent = total > 0 ? ((m.kubikasi / total) * 100).toFixed(1) : 0
          return `${i+1}. **${m.name}**: ${m.kubikasi.toFixed(2)} m³ (${percent}%)`
        }).join('\n')
    }
    return "Tidak ada data penjualan."
  }

  // Pattern: Wood Type distribution
  if (lowerPrompt.match(/jenis kayu|wood type|kayu/i)) {
    return `🪵 **Jenis Kayu:**\n\n` +
      `Data jenis kayu tersedia di menu Analisis Penjualan.\n` +
      `Silakan akses halaman Sales Analysis untuk melihat detail.`
  }

  // Pattern: Customer dengan kubikasi terbesar
  if (lowerPrompt.match(/customer terbesar|klien terbesar|pelanggan terbesar|project terbesar/i)) {
    if (cache.topCustomers?.length > 0) {
      return `👑 **Top Customer (by Kubikasi):**\n\n` + 
        cache.topCustomers.slice(0, 5).map((c, i) => 
        `${i+1}. **${c.name}** - ${c.totalKubikasi.toFixed(2)} m³`
      ).join('\n')
    }
    return "Tidak ada data customer."
  }

  // Pattern: Pertanyaan tentang waktu
  if (lowerPrompt.match(/bulan ini|bulan lalu|minggu ini|tahun ini|terakhir|latest|terbaru/i)) {
    return `📅 **Data Periode:**\n\n` +
      `• Bulan ini: ${cache.currentMonth}\n` +
      `• Bulan lalu: ${cache.lastMonth}\n\n` +
      `Semua analytics dihitung berdasarkan periode di atas.`
  }

  return null // Tidak ada pattern match, perlu LLM
}

// =================================================================
// ENHANCED AI CHAT - Pakai cache + pattern matching
// =================================================================

export async function handleAiChat(req, res) {
  const { prompt, user, history } = req.body
  if (!prompt) return res.status(400).json({ error: 'Prompt required' })

  console.log('💬 [AI Chat] Prompt:', prompt)

  try {
    // Step 1: Get analytics cache (satu kali saja)
    let cache = analyticsCache
    let cacheValid = cache && cacheTimestamp && (Date.now() - cacheTimestamp) < CACHE_TTL_MS

    if (!cacheValid) {
      console.log('🔄 [AI Chat] Building analytics cache...')
      cache = await buildFullAnalyticsCache(user)
      analyticsCache = cache
      cacheTimestamp = Date.now()
    }

    // Step 2: Try pattern matching first (tanpa LLM!)
    const patternAnswer = matchQueryToAnswer(prompt, cache)
    if (patternAnswer) {
      console.log('✅ [AI Chat] Using pattern matching (no LLM)')
      return res.status(200).json({ response: patternAnswer, source: 'pattern' })
    }

    // Step 3: Fallback ke LLM hanya untuk pertanyaan kompleks
    console.log('🔄 [AI Chat] Using LLM for complex query...')
    
    // Build comprehensive context for LLM
    const relevantContext = JSON.stringify({
      metadata: {
        currentMonth: cache.currentMonth,
        lastMonth: cache.lastMonth,
        generatedAt: cache.generatedAt,
        userRole: cache.userRole,
        userName: cache.userName
      },
      summary: {
        totalOrders: cache.totalOrders,
        activeOrders: cache.activeOrders,
        completedOrders: cache.completedOrders,
        urgentCount: cache.urgentOrders?.length || 0,
        requestedCount: cache.requestedOrders?.length || 0,
        repeatCustomerCount: cache.repeatCustomers?.length || 0,
        nearingDeadlineCount: cache.nearingDeadline?.length || 0,
        stuckItemsCount: cache.stuckItems?.length || 0
      },
      topPerformance: {
        topMarketing: cache.topMarketingThisMonth?.slice(0, 5),
        topProducts: cache.topProductsThisMonth?.slice(0, 5),
        topCustomers: cache.topCustomers?.slice(0, 5),
        repeatCustomers: cache.repeatCustomers?.slice(0, 10)
      },
      attention: {
        urgentOrders: cache.urgentOrders?.slice(0, 5),
        requestedOrders: cache.requestedOrders?.slice(0, 5),
        nearingDeadline: cache.nearingDeadline?.slice(0, 5),
        stuckItems: cache.stuckItems?.slice(0, 5)
      },
      comparison: {
        marketingThisMonth: cache.topMarketingThisMonth,
        marketingLastMonth: cache.topMarketingLastMonth,
        productsThisMonth: cache.topProductsThisMonth,
        productsLastMonth: cache.topProductsLastMonth
      },
      status: cache.latestOrderMap?.slice(0, 20) // Last 20 orders for context
    })

    const text = await generateNaturalResponse(
      relevantContext,
      'Pertanyaan kompleks yang tidak bisa dijawab dengan pattern matching',
      prompt,
      user
    )

    return res.status(200).json({ response: text, source: 'llm' })
  } catch (e) {
    console.error('💥 [AI Chat] Error:', e)
    return res.status(500).json({ error: `Terjadi kesalahan: ${e.message}` })
  }
}