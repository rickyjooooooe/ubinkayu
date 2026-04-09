// file: api/_helpers.js

import { GoogleSpreadsheet } from 'google-spreadsheet'
import { JWT } from 'google-auth-library'
import { Buffer } from 'buffer'
import { google } from 'googleapis'
import stream from 'stream'
import { promisify } from 'util'
import path from 'path'

const pipeline = promisify(stream.pipeline)

// =================================================================
// HELPER UTAMA
// =================================================================

const SPREADSHEET_ID = '1Bp5rETvaAe9nT4DrNpm-WsQqQlPNaau4gIzw1nA5Khk'
const USER_SPREADSHEET_ID = '1nNk-49aah-dWuEoVwMiU40BXek3slHyvzIgIXOAgE6Q'
export const PO_ARCHIVE_FOLDER_ID = '1-1Gw1ay4iQoFNFe2KcKDgCwOIi353QEC'
export const PROGRESS_PHOTOS_FOLDER_ID = '1UfUQoqNBSsth9KzGRUmjenwegmsA6hbK'

export const PRODUCTION_STAGES = [
  'Cari Bahan Baku',
  'Sawmill',
  'KD',
  'Pembahanan',
  'Moulding',
  'Coating',
  'Siap Kirim'
]

export const DEFAULT_STAGE_DURATIONS = {
  Pembahanan: 7, // 1 minggu
  Moulding: 7, // 1 minggu
  KD: 14, // 2 minggu
  Coating: 14, // 2 minggu
  'Cari Bahan Baku': 0, // Default 0 jika tidak ada durasi spesifik
  Sawmill: 0,
  'Siap Kirim': 0
}

// file: api/_helpers.js
export function getAuth() {
  console.log('🏁 [Vercel Auth] getAuth function started.') // Log 1: Fungsi dimulai

  const rawKey = process.env.GOOGLE_PRIVATE_KEY || ''
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL

  if (!rawKey || !email) {
    console.error('❌ [Vercel Auth] FAIL: Missing env vars.')
    throw new Error('Server configuration error: Missing credentials.')
  }
  console.log('✅ [Vercel Auth] Env vars retrieved for:', email) // Log 2: Env vars ada

  let formattedKey = ''
  try {
    console.log('⏳ [Vercel Auth] Attempting Base64 decode...') // Log 3: Sebelum decode
    const decodedKey = Buffer.from(rawKey, 'base64').toString('utf8')
    console.log('✅ [Vercel Auth] Base64 decoded.') // Log 4: Setelah decode
    console.log('⏳ [Vercel Auth] Attempting newline replace...') // Log 5: Sebelum replace
    formattedKey = decodedKey.replace(/\\n/g, '\n')
    console.log('✅ [Vercel Auth] Newlines replaced.') // Log 6: Setelah replace

    if (formattedKey.length < 100 || !formattedKey.includes('-----BEGIN PRIVATE KEY-----')) {
      console.error('❌ [Vercel Auth] FAIL: Formatted key seems invalid.')
      throw new Error('Server configuration error: Invalid private key format.')
    }
    console.log('🔑 [Vercel Auth] Key formatted successfully.') // Log 7: Format OK
  } catch (e) {
    console.error('❌ [Vercel Auth] FAIL: Error during key processing:', e.message) // Log 8: Error saat proses key
    throw new Error('Server configuration error: Key processing failed.')
  }

  try {
    console.log('⏳ [Vercel Auth] Creating JWT instance...') // Log 9: Sebelum JWT
    const jwtInstance = new JWT({
      email: email,
      key: formattedKey,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ]
    })
    console.log('✅ [Vercel Auth] JWT instance created successfully.') // Log 10: JWT OK
    return jwtInstance
  } catch (jwtError) {
    console.error('❌ [Vercel Auth] FAIL: Error creating JWT instance:', jwtError.message) // Log 11: Error JWT
    throw new Error('Server configuration error: JWT creation failed.')
  }
}

// Fungsi untuk membuka dokumen spreadsheet
export async function openDoc() {
  const auth = getAuth()
  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth)
  await doc.loadInfo()
  return doc
}

export async function openUserDoc() {
  const auth = getAuth() // Memakai getAuth Vercel
  const doc = new GoogleSpreadsheet(USER_SPREADSHEET_ID, auth) // Pakai ID User
  await doc.loadInfo()
  return doc
}

const ALIASES = {
  orders: ['orders', 'purchase_orders', 'purchase_order'],
  order_items: ['order_items', 'purchase_order_items', 'po_items'],
  product_master: ['product_master', 'products'],
  progress_tracking: ['order_items_progress', 'progress'],
  users: ['users_credentials', 'users']
}

// Fungsi untuk mendapatkan sheet berdasarkan alias
export function getSheet(doc, key) {
  const titles = ALIASES[key] || [key]
  for (const t of titles) {
    if (doc.sheetsByTitle[t]) return doc.sheetsByTitle[t]
  }
  throw new Error(`Sheet "${titles[0]}" tidak ditemukan.`)
}

// Fungsi untuk konversi ke angka
export function toNum(v, def = 0) {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : def
}

// Fungsi untuk mendapatkan ID berikutnya
export async function getNextIdFromSheet(sheet) {
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

// Fungsi untuk membersihkan payload item
export function scrubItemPayload(item) {
  const { id, order_id, revision_id, revision_number, ...rest } = item || {}
  return rest
}

// Fungsi untuk mengekstrak ID file Google Drive dari URL
export function extractGoogleDriveFileId(driveUrl) {
  if (!driveUrl || typeof driveUrl !== 'string') return null
  const patterns = [/\/d\/([a-zA-Z0-9-_]+)/, /id=([a-zA-Z0-9-_]+)/]
  for (const pattern of patterns) {
    const match = driveUrl.match(pattern)
    if (match && match[1]) return match[1]
  }
  return null
}

// Fungsi untuk menghapus file dari Google Drive
export async function deleteGoogleDriveFile(fileId) {
  try {
    if (!fileId) return { success: false, error: 'File ID tidak valid', fileId }
    const auth = getAuth()
    const drive = google.drive({ version: 'v3', auth })
    await drive.files.delete({ fileId: fileId, supportsAllDrives: true })
    return { success: true, fileId }
  } catch (error) {
    return { success: false, error: error.message, fileId }
  }
}

// =================================================================
// GENERATOR JPEG (Disalin dari jpegGenerator.js)
// =================================================================

export async function generateOrderJpeg(orderData, revisionNumber = 0) {
  try {
    // --- 1. DYNAMIC IMPORT ---
    const { createCanvas, loadImage, registerFont } = await import('canvas')
    const fontPath = path.join(process.cwd(), 'api/fonts/Roboto-Regular.ttf')
    registerFont(fontPath, { family: 'Roboto' })

    // --- 2. FUNGSI HELPER SINKRON (WRAPTEXT, DLL) ---
    // (Fungsi wrapText dan calculateLineCount tetap sama persis, tidak perlu disalin ulang)
    function wrapText(context, text, x, y, maxWidth, lineHeight) {
      if (!text) return
      const paragraphs = text.split('\n')
      for (const paragraph of paragraphs) {
        if (paragraph.length === 0) {
          y += lineHeight
          continue
        }
        let line = ''
        const words = paragraph.split(' ')
        for (const word of words) {
          const testLine = line + (line ? ' ' : '') + word
          if (context.measureText(testLine).width > maxWidth && line) {
            context.fillText(line, x, y)
            y += lineHeight
            line = word
          } else {
            line = testLine
          }
        }
        context.fillText(line, x, y)
        y += lineHeight
      }
    }
    function calculateLineCount(context, text, maxWidth) {
      if (!text) return 1
      const paragraphs = text.split('\n')
      let totalLines = 0
      for (const paragraph of paragraphs) {
        if (paragraph.length === 0) {
          totalLines++
          continue
        }
        let line = ''
        const words = paragraph.split(' ')
        for (const word of words) {
          const testLine = line + (line ? ' ' : '') + word
          if (context.measureText(testLine).width > maxWidth && line) {
            totalLines++
            line = word
          } else {
            line = testLine
          }
        }
        totalLines++
      }
      return Math.max(1, totalLines)
    }
    // --- AKHIR FUNGSI HELPER ---

    // --- 3. LOGIKA UTAMA ---

    // --- [BARU] Tambahkan Skala ---
    const scaleFactor = 2 // Render 2x lebih besar untuk ketajaman
    const baseWidth = 1200 // Lebar dasar
    const width = baseWidth * scaleFactor // Lebar canvas baru (2400px)

    const redColor = '#D92121'
    const blueColor = '#0000FF'
    const blackColor = '#333333'
    const greenColor = '#006400'
    const headerBgColor = '#F0F0F0'
    const totalBgColor = '#FFE6E6'
    const borderColor = '#AAAAAA'

    const baseFont = 'Roboto' // Vercel menggunakan Roboto

    // --- [DIUBAH] Kalikan semua nilai statis dengan scaleFactor ---
    const tableLeft = 30 * scaleFactor
    const tableWidth = width - 60 * scaleFactor
    const rowPadding = 8 * scaleFactor
    const itemLineHeight = 14 * scaleFactor

    const tempCanvas = createCanvas(width, 100 * scaleFactor) // Kalikan tinggi juga
    const ctx = tempCanvas.getContext('2d')

    let totalHeight = 0
    totalHeight += 70 * scaleFactor
    totalHeight += 60 * scaleFactor

    const items = orderData.items || []
    items.forEach((item) => {
      ctx.font = `${10 * scaleFactor}px ${baseFont}` // [DIUBAH]
      const poLines = calculateLineCount(
        ctx,
        `${orderData.order_number || 'N/A'}\n${orderData.project_name || 'N/A'}`,
        130 * scaleFactor - rowPadding * 2 // [DIUBAH]
      )
      const produkText = `${item.product_name || ''}\n${item.wood_type || ''} ${item.profile || ''}`
      const produkLines = calculateLineCount(
        ctx,
        produkText,
        180 * scaleFactor - rowPadding * 2 // [DIUBAH]
      )
      const finishingText = `${item.finishing || ''}\n${item.sample || ''}`
      const finishingLines = calculateLineCount(
        ctx,
        finishingText,
        170 * scaleFactor - rowPadding * 2 // [DIUBAH]
      )
      const lokasiAndNotesText = [item.location, item.notes].filter(Boolean).join('\n') || '-'
      const lokasiLines = calculateLineCount(
        ctx,
        lokasiAndNotesText,
        140 * scaleFactor - rowPadding * 2 // [DIUBAH]
      )

      const maxLines = Math.max(poLines, produkLines, finishingLines, lokasiLines, 2)
      const rowHeight = maxLines * itemLineHeight + rowPadding * 2
      totalHeight += rowHeight
    })

    totalHeight += 30 * scaleFactor // [DIUBAH]

    ctx.font = `${10 * scaleFactor}px ${baseFont}` // [DIUBAH]
    const notesText = orderData.notes || '-'
    const noteLineCount = calculateLineCount(ctx, notesText, tableWidth - 20 * scaleFactor) // [DIUBAH]
    // [DIUBAH]
    const notesSectionHeight =
      noteLineCount * (15 * scaleFactor) + 15 * scaleFactor * 2 + 20 * scaleFactor + 10 * scaleFactor
    totalHeight += notesSectionHeight

    totalHeight += 80 * scaleFactor // [DIUBAH]

    let photoDrawHeight = 0
    if (orderData.poPhotoBase64) {
      try {
        const imageBuffer = Buffer.from(orderData.poPhotoBase64, 'base64')
        const userImage = await loadImage(imageBuffer)
        const aspectRatio = userImage.height / userImage.width
        photoDrawHeight = tableWidth * aspectRatio // tableWidth sudah di-scale
        totalHeight += 20 * scaleFactor + 30 * scaleFactor + photoDrawHeight // [DIUBAH]
      } catch (imgError) {
        console.error('Gagal memuat gambar dari Base64:', imgError)
        totalHeight += 60 * scaleFactor // [DIUBAH]
      }
    } else {
      totalHeight += 60 * scaleFactor // [DIUBAH]
    }
    totalHeight += 30 * scaleFactor // [DIUBAH]

    const canvas = createCanvas(width, totalHeight)
    const finalCtx = canvas.getContext('2d')

    // --- [BARU] Atur Kualitas Teks dan Anti-Aliasing ---
    finalCtx.patternQuality = 'best' // Kualitas pola (jika ada)
    finalCtx.quality = 'best' // Kualitas render keseluruhan
    finalCtx.imageSmoothingEnabled = true // Tetap aktifkan anti-aliasing
    finalCtx.textDrawingMode = 'path' // Render teks sebagai vektor (LEBIH TAJAM)
    // --- [AKHIR BARU] ---

    finalCtx.fillStyle = '#FFFFFF'
    finalCtx.fillRect(0, 0, width, totalHeight)

    let currentY = 40 * scaleFactor // [DIUBAH]
    finalCtx.font = `bold ${24 * scaleFactor}px ${baseFont}` // [DIUBAH]
    finalCtx.fillStyle = redColor
    const headerText = `${orderData.order_number || 'N/A'} ${orderData.project_name || 'N/A'}`
    finalCtx.textAlign = 'center'
    finalCtx.fillText(headerText, width / 2, currentY)

    finalCtx.font = `bold ${16 * scaleFactor}px ${baseFont}` // [DIUBAH]
    finalCtx.fillStyle = blackColor
    const date = orderData.created_at ? new Date(orderData.created_at) : new Date()
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    const dateText = `AD${year}年${month}月${day}日`
    const sbyText = `SBY R: ${revisionNumber}`
    finalCtx.textAlign = 'right'
    finalCtx.fillText(sbyText, width - 30 * scaleFactor, currentY - 15 * scaleFactor) // [DIUBAH]
    finalCtx.fillText(dateText, width - 30 * scaleFactor, currentY + 10 * scaleFactor) // [DIUBAH]
    finalCtx.textAlign = 'left'

    currentY += 30 * scaleFactor // [DIUBAH]

    // --- [DIUBAH] Kalikan semua nilai 'cols' ---
    const cols = {
      rencKirim: { x: 0, width: 90 * scaleFactor },
      noPo: { x: 90 * scaleFactor, width: 130 * scaleFactor },
      produk: { x: 220 * scaleFactor, width: 180 * scaleFactor },
      finishing: { x: 400 * scaleFactor, width: 170 * scaleFactor },
      ukuran: { x: 570 * scaleFactor, width: 200 * scaleFactor },
      kuantiti: { x: 770 * scaleFactor, width: 120 * scaleFactor },
      kubikasi: { x: 890 * scaleFactor, width: 110 * scaleFactor },
      lokasi: { x: 1000 * scaleFactor, width: 140 * scaleFactor }
    }

    finalCtx.fillStyle = headerBgColor
    finalCtx.fillRect(tableLeft, currentY, tableWidth, 60 * scaleFactor) // [DIUBAH]
    finalCtx.strokeStyle = borderColor
    finalCtx.lineWidth = 1 * scaleFactor // [DIUBAH]

    finalCtx.fillStyle = greenColor
    finalCtx.font = `bold ${10 * scaleFactor}px ${baseFont}` // [DIUBAH]
    finalCtx.textAlign = 'center'

    const drawHeader = (text, col, yOffset1, yOffset2) => {
      const lines = text.split('\n')
      finalCtx.fillText(
        lines[0],
        tableLeft + col.x + col.width / 2,
        currentY + yOffset1 * scaleFactor // [DIUBAH]
      )
      if (lines[1]) {
        finalCtx.fillText(
          lines[1],
          tableLeft + col.x + col.width / 2,
          currentY + yOffset2 * scaleFactor // [DIUBAH]
        )
      }
    }

    drawHeader('Renc Kirim\n/ TGL PO', cols.rencKirim, 25, 45)
    drawHeader('No PO\n/ Nama Proyek', cols.noPo, 25, 45)
    drawHeader('Produk / Kayu / Profil', cols.produk, 35, 0)
    drawHeader('Finishing / gloss / sample', cols.finishing, 35, 0)
    drawHeader('KUANTITI', cols.kuantiti, 35, 0)
    drawHeader('KUBIKASI', cols.kubikasi, 35, 0)
    drawHeader('Lokasi & Keterangan lain', cols.lokasi, 35, 0)

    const ukuranStartX = tableLeft + cols.ukuran.x
    const ukuranSubWidth = cols.ukuran.width / 4 // Ini sudah di-scale
    finalCtx.fillText('UKURAN', ukuranStartX + cols.ukuran.width / 2, currentY + 20 * scaleFactor) // [DIUBAH]
    finalCtx.beginPath()
    finalCtx.moveTo(ukuranStartX, currentY + 30 * scaleFactor) // [DIUBAH]
    finalCtx.lineTo(ukuranStartX + cols.ukuran.width, currentY + 30 * scaleFactor) // [DIUBAH]
    finalCtx.stroke()

    finalCtx.font = `bold ${9 * scaleFactor}px ${baseFont}` // [DIUBAH]
    finalCtx.fillStyle = blackColor
    finalCtx.fillText('tbl', ukuranStartX + ukuranSubWidth / 2, currentY + 48 * scaleFactor) // [DIUBAH]
    finalCtx.fillText(
      'lebar',
      ukuranStartX + ukuranSubWidth + ukuranSubWidth / 2,
      currentY + 48 * scaleFactor // [DIUBAH]
    )
    finalCtx.fillText(
      'panjang',
      ukuranStartX + ukuranSubWidth * 2 + ukuranSubWidth / 2,
      currentY + 48 * scaleFactor // [DIUBAH]
    )
    finalCtx.fillText(
      'Tipe Pjg',
      ukuranStartX + ukuranSubWidth * 3 + ukuranSubWidth / 2,
      currentY + 48 * scaleFactor // [DIUBAH]
    )

    Object.values(cols).forEach((col) =>
      finalCtx.strokeRect(tableLeft + col.x, currentY, col.width, 60 * scaleFactor) // [DIUBAH]
    )
    finalCtx.strokeRect(
      ukuranStartX + ukuranSubWidth,
      currentY + 30 * scaleFactor,
      0,
      30 * scaleFactor // [DIUBAH]
    )
    finalCtx.strokeRect(
      ukuranStartX + ukuranSubWidth * 2,
      currentY + 30 * scaleFactor,
      0,
      30 * scaleFactor // [DIUBAH]
    )
    finalCtx.strokeRect(
      ukuranStartX + ukuranSubWidth * 3,
      currentY + 30 * scaleFactor,
      0,
      30 * scaleFactor // [DIUBAH]
    )

    currentY += 60 * scaleFactor // [DIUBAH]

    items.forEach((item) => {
      finalCtx.font = `${10 * scaleFactor}px ${baseFont}` // [DIUBAH]
      // (calculateLineCount widths sudah di-scale)
      const poLines = calculateLineCount(
        finalCtx,
        `${orderData.order_number || 'N/A'}\n${orderData.project_name || 'N/A'}`,
        cols.noPo.width - rowPadding * 2
      )
      const produkText = `${item.product_name || ''}\n${item.wood_type || ''} ${item.profile || ''}`
      const produkLines = calculateLineCount(
        finalCtx,
        produkText,
        cols.produk.width - rowPadding * 2
      )
      const finishingText = `${item.finishing || ''}\n${item.sample || ''}`
      const finishingLines = calculateLineCount(
        finalCtx,
        finishingText,
        cols.finishing.width - rowPadding * 2
      )

      const lokasiAndNotesForDraw = [item.location, item.notes].filter(Boolean).join('\n') || '-' // [DIUBAH] Pakai \n
      const lokasiLines = calculateLineCount(
        finalCtx,
        lokasiAndNotesForDraw,
        cols.lokasi.width - rowPadding * 2
      )

      const maxLines = Math.max(poLines, produkLines, finishingLines, lokasiLines, 2)
      const rowHeight = maxLines * itemLineHeight + rowPadding * 2

      finalCtx.textAlign = 'center'
      const deadline = orderData.deadline
        ? new Date(orderData.deadline).toLocaleDateString('id-ID')
        : 'N/A'
      const poDate = orderData.created_at
        ? new Date(orderData.created_at).toLocaleDateString('id-ID')
        : 'N/A'
      finalCtx.fillStyle = blueColor
      finalCtx.fillText(
        deadline,
        tableLeft + cols.rencKirim.x + cols.rencKirim.width / 2,
        currentY + rowPadding + 10 * scaleFactor // [DIUBAH]
      )
      finalCtx.fillStyle = blackColor
      finalCtx.fillText(
        poDate,
        tableLeft + cols.rencKirim.x + cols.rencKirim.width / 2,
        currentY + rowPadding + 10 * scaleFactor + itemLineHeight * 1.5 // [DIUBAH]
      )

      finalCtx.textAlign = 'left'
      wrapText(
        finalCtx,
        `${orderData.order_number || 'N/A'}\n${orderData.project_name || 'N/A'}`,
        tableLeft + cols.noPo.x + rowPadding,
        currentY + rowPadding + 10 * scaleFactor, // [DIUBAH]
        cols.noPo.width - rowPadding * 2,
        itemLineHeight
      )
      wrapText(
        finalCtx,
        produkText,
        tableLeft + cols.produk.x + rowPadding,
        currentY + rowPadding + 10 * scaleFactor, // [DIUBAH]
        cols.produk.width - rowPadding * 2,
        itemLineHeight
      )
      wrapText(
        finalCtx,
        finishingText,
        tableLeft + cols.finishing.x + rowPadding,
        currentY + rowPadding + 10 * scaleFactor, // [DIUBAH]
        cols.finishing.width - rowPadding * 2,
        itemLineHeight
      )

      wrapText(
        finalCtx,
        lokasiAndNotesForDraw,
        tableLeft + cols.lokasi.x + rowPadding,
        currentY + rowPadding + 10 * scaleFactor, // [DIUBAH]
        cols.lokasi.width - rowPadding * 2,
        itemLineHeight
      )

      finalCtx.textAlign = 'center'
      finalCtx.fillText(
        (item.thickness_mm || '0').toString(),
        tableLeft + cols.ukuran.x + ukuranSubWidth / 2,
        currentY + rowHeight / 2
      )
      finalCtx.fillText(
        (item.width_mm || '0').toString(),
        tableLeft + cols.ukuran.x + ukuranSubWidth + ukuranSubWidth / 2,
        currentY + rowHeight / 2
      )
      finalCtx.fillText(
        (item.length_mm || '0').toString(),
        tableLeft + cols.ukuran.x + ukuranSubWidth * 2 + ukuranSubWidth / 2,
        currentY + rowHeight / 2
      )
      finalCtx.fillText(
        (item.length_type || '-').toString(),
        tableLeft + cols.ukuran.x + ukuranSubWidth * 3 + ukuranSubWidth / 2,
        currentY + rowHeight / 2
      )

      const quantity = `${item.quantity || 0} ${item.satuan || 'pcs'}`
      finalCtx.fillText(
        quantity,
        tableLeft + cols.kuantiti.x + cols.kuantiti.width / 2,
        currentY + rowHeight / 2
      )
      const kubikasi = toNum(item.kubikasi, 0).toFixed(4)
      finalCtx.fillText(
        kubikasi,
        tableLeft + cols.kubikasi.x + cols.kubikasi.width / 2,
        currentY + rowHeight / 2
      )

      finalCtx.strokeRect(tableLeft, currentY, tableWidth, rowHeight)

      Object.values(cols).forEach((col) => {
        if (col.x > 0) {
          finalCtx.beginPath()
          finalCtx.moveTo(tableLeft + col.x, currentY)
          finalCtx.lineTo(tableLeft + col.x, currentY + rowHeight)
          finalCtx.stroke()
        }
      })

      finalCtx.beginPath()
      finalCtx.moveTo(ukuranStartX + ukuranSubWidth, currentY)
      finalCtx.lineTo(ukuranStartX + ukuranSubWidth, currentY + rowHeight)
      finalCtx.stroke()

      finalCtx.beginPath()
      finalCtx.moveTo(ukuranStartX + ukuranSubWidth * 2, currentY)
      finalCtx.lineTo(ukuranStartX + ukuranSubWidth * 2, currentY + rowHeight)
      finalCtx.stroke()

      finalCtx.beginPath()
      finalCtx.moveTo(ukuranStartX + ukuranSubWidth * 3, currentY)
      finalCtx.lineTo(ukuranStartX + ukuranSubWidth * 3, currentY + rowHeight)
      finalCtx.stroke()

      currentY += rowHeight
    })

    finalCtx.fillStyle = totalBgColor
    finalCtx.fillRect(tableLeft, currentY, tableWidth, 30 * scaleFactor) // [DIUBAH]
    finalCtx.strokeRect(tableLeft, currentY, tableWidth, 30 * scaleFactor) // [DIUBAH]
    finalCtx.fillStyle = redColor
    finalCtx.font = `bold ${12 * scaleFactor}px ${baseFont}` // [DIUBAH]
    finalCtx.textAlign = 'right'
    finalCtx.fillText(
      'TOTAL',
      tableLeft + cols.kuantiti.x + cols.kuantiti.width - rowPadding,
      currentY + 20 * scaleFactor // [DIUBAH]
    )
    finalCtx.textAlign = 'center'
    const totalKubikasi = toNum(orderData.kubikasi_total, 0).toFixed(4) + ' m³'
    finalCtx.fillText(
      totalKubikasi,
      tableLeft + cols.kubikasi.x + cols.kubikasi.width / 2,
      currentY + 20 * scaleFactor // [DIUBAH]
    )
    currentY += 30 * scaleFactor // [DIUBAH]

    const notesBoxY = currentY
    const notesLineHeight = 15 * scaleFactor // [DIUBAH]
    const notesPadding = notesLineHeight * 2
    finalCtx.fillStyle = greenColor
    finalCtx.font = `bold ${10 * scaleFactor}px ${baseFont}` // [DIUBAH]
    finalCtx.textAlign = 'left'
    finalCtx.fillText(
      'Cara kerja / request klien / detail lainnya:',
      tableLeft + 10 * scaleFactor, // [DIUBAH]
      notesBoxY + notesPadding
    )
    finalCtx.fillStyle = blackColor
    finalCtx.font = `${10 * scaleFactor}px ${baseFont}` // [DIUBAH]

    const notesBoxHeight = noteLineCount * notesLineHeight + notesPadding + 20 * scaleFactor // [DIUBAH]
    wrapText(
      finalCtx,
      notesText,
      tableLeft + 10 * scaleFactor, // [DIUBAH]
      notesBoxY + notesPadding + 20 * scaleFactor, // [DIUBAH]
      tableWidth - 20 * scaleFactor, // [DIUBAH]
      notesLineHeight
    )
    finalCtx.strokeRect(tableLeft, notesBoxY, tableWidth, notesBoxHeight)
    currentY += notesBoxHeight + 10 * scaleFactor // [DIUBAH]

    const approvalTableHeight = 80 * scaleFactor // [DIUBAH]
    const approvalCols = [
      'Gambar MKT',
      'Gambar Pengawas',
      'Gambar Kerja',
      'Foto Lokasi',
      'ACC Mrktng',
      'ACC SPV',
      'ACC MNGR'
    ]
    const approvalTableWidth = tableWidth * 0.8
    const approvalColWidth = approvalTableWidth / approvalCols.length
    finalCtx.font = `bold ${9 * scaleFactor}px ${baseFont}` // [DIUBAH]
    finalCtx.textAlign = 'center'

    approvalCols.forEach((title, index) => {
      const colX = tableLeft + index * approvalColWidth
      finalCtx.strokeStyle = borderColor
      finalCtx.strokeRect(colX, currentY, approvalColWidth, approvalTableHeight)
      finalCtx.fillStyle = greenColor
      finalCtx.fillText(title, colX + approvalColWidth / 2, currentY + 15 * scaleFactor) // [DIUBAH]
      finalCtx.beginPath()
      finalCtx.moveTo(colX, currentY + 25 * scaleFactor) // [DIUBAH]
      finalCtx.lineTo(colX + approvalColWidth, currentY + 25 * scaleFactor) // [DIUBAH]
      finalCtx.stroke()
      finalCtx.fillText(
        'tgl:',
        colX + approvalColWidth / 2,
        currentY + approvalTableHeight - 10 * scaleFactor // [DIUBAH]
      )
    })

    finalCtx.fillStyle = greenColor
    finalCtx.font = `${10 * scaleFactor}px ${baseFont}` // [DIUBAH]
    finalCtx.textAlign = 'right'
    finalCtx.fillText('Tanggal cetak:', width - 30 * scaleFactor, currentY + 30 * scaleFactor) // [DIUBAH]
    finalCtx.fillText(
      new Date().toLocaleDateString('id-ID'),
      width - 30 * scaleFactor,
      currentY + 45 * scaleFactor // [DIUBAH]
    )
    currentY += approvalTableHeight

    currentY += 20 * scaleFactor // [DIUBAH]
    finalCtx.fillStyle = blackColor
    finalCtx.font = `bold ${14 * scaleFactor}px ${baseFont}` // [DIUBAH]
    finalCtx.textAlign = 'left'
    finalCtx.fillText('Lampiran: Foto Referensi', tableLeft, currentY)
    currentY += 30 * scaleFactor // [DIUBAH]

    if (orderData.poPhotoBase64) {
      try {
        const imageBuffer = Buffer.from(orderData.poPhotoBase64, 'base64')
        const userImage = await loadImage(imageBuffer)
        finalCtx.drawImage(
          userImage,
          30 * scaleFactor,
          currentY,
          width - 60 * scaleFactor,
          photoDrawHeight
        ) // [DIUBAH]
      } catch (imgError) {
        console.error('Gagal menggambar gambar referensi:', imgError)
        finalCtx.fillStyle = redColor
        finalCtx.font = `${12 * scaleFactor}px ${baseFont}` // [DIUBAH]
        finalCtx.textAlign = 'left'
        finalCtx.fillText(`Gagal memuat file gambar: ${orderData.poPhotoPath}`, tableLeft, currentY)
      }
    } else {
      finalCtx.font = `${12 * scaleFactor}px ${baseFont}` // [DIUBAH]
      finalCtx.fillStyle = '#888'
      finalCtx.textAlign = 'left'
      finalCtx.fillText(`Gagal memuat data gambar referensi.`, tableLeft, currentY)
    }

    // --- [DIUBAH] Kualitas Output ---
    const buffer = canvas.toBuffer('image/jpeg', { quality: 1, progressive: true }) // Kualitas 100%
    const fileName = `PO-${String(orderData.order_number).replace(/[/\\?%*:|"<>]/g, '-')}-Rev${revisionNumber}.jpeg`

    return { success: true, buffer: buffer, fileName: fileName }
  } catch (error) {
    console.error('❌ Gagal generate JPEG:', error)
    return { success: false, error: error.message }
  }
}

// Fungsi untuk generate JPEG dan upload ke Drive
export async function generateAndUploadOrder(orderData, revisionNumber) {
  try {
    const jpegResult = await generateOrderJpeg(orderData, revisionNumber)
    if (!jpegResult.success) throw new Error('Gagal membuat buffer JPEG.')

    const auth = getAuth()
    const drive = google.drive({ version: 'v3', auth })

    // Buat stream dari buffer untuk diunggah
    const bufferStream = new stream.PassThrough()
    bufferStream.end(jpegResult.buffer)

    const response = await drive.files.create({
      requestBody: {
        name: jpegResult.fileName, // Gunakan nama file dari hasil generate
        mimeType: 'image/jpeg',
        parents: [PO_ARCHIVE_FOLDER_ID]
      },
      media: { mimeType: 'image/jpeg', body: bufferStream },
      fields: 'id, webViewLink',
      supportsAllDrives: true
    })

    return { success: true, link: response.data.webViewLink }
  } catch (error) {
    console.error('❌ Proses Generate & Upload PO Gagal:', error)
    return { success: false, error: error.message }
  }
}

export async function processBatch(items, processor, batchSize = 5) {
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
      await new Promise((resolve) => setTimeout(resolve, 100)) // Jeda singkat antar batch
    }
  }
  return results
}

/**
 * [VERCEL VERSION] Mengunggah foto referensi PO dari data Base64 ke Google Drive.
 * Mengunggah ke folder FOTO PROGRESS sesuai logika sheet.js.
 * @param {string} photoBase64 Data gambar dalam format Base64.
 * @param {string} orderNumber Nomor PO untuk penamaan file.
 * @param {string} customerName Nama customer untuk penamaan file.
 * @returns {Promise<{success: boolean, link?: string, size?: number, error?: string}>}
 */
export async function UploadOrderPhoto(photoBase64, orderNumber, customerName) {
  if (!photoBase64) {
    return { success: false, error: 'Tidak ada data Base64 foto.', size: 0 }
  }
  console.log(
    `⏳ [Vercel Drive] Uploading PO Reference Photo for PO ${orderNumber} to PROGRESS FOLDER...`
  ) // Log diubah
  try {
    const auth = getAuth()

    const imageBuffer = Buffer.from(photoBase64, 'base64')
    const safeCustomerName = (customerName || 'Customer').replace(/[/\\?%*:|"<>]/g, '-')
    const safeorderNumber = (orderNumber || 'NoPO').replace(/[/\\?%*:|"<>]/g, '-')
    // Penamaan file sama persis dengan sheet.js
    const fileName = `PO-${safeorderNumber}-${safeCustomerName.replace(/[/\\?%*:|"<>]/g, '-')}.jpg`
    const mimeType = 'image/jpeg'

    // Upload via auth.request
    const metadata = {
      name: fileName,
      mimeType: mimeType,
      parents: [PROGRESS_PHOTOS_FOLDER_ID] // <-- Unggah ke folder FOTO PROGRESS
    }
    const boundary = `----VercelRefPhotoBoundary${Date.now()}----`
    const metaPart = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n\r\n`
    )
    const mediaHeaderPart = Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`)
    const endBoundaryPart = Buffer.from(`\r\n--${boundary}--\r\n`)
    const requestBody = Buffer.concat([metaPart, mediaHeaderPart, imageBuffer, endBoundaryPart])

    const createResponse = await auth.request({
      /* ... (Opsi request sama) ... */
    })

    // Ambil Link & Ukuran
    const fileId = createResponse?.data?.id
    if (!fileId) {
      /* ... error handling ... */ throw new Error('Upload foto OK tapi ID tidak didapat.')
    }
    console.log(`✅ [Vercel Drive] Ref Photo uploaded (ID: ${fileId}). Fetching link & size...`)

    const getResponse = await auth.request({
      url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
      method: 'GET',
      params: { fields: 'webViewLink,size', supportsAllDrives: true }
    })
    const webViewLink = getResponse?.data?.webViewLink
    const fileSize = getResponse?.data?.size

    if (!webViewLink) {
      /* ... error handling ... */ throw new Error('Gagal get link/size foto.')
    }
    console.log(`✅ [Vercel Drive] Ref Photo Link: ${webViewLink}, Size: ${fileSize}`)

    return { success: true, link: webViewLink, size: Number(fileSize || 0) }
  } catch (error) {
    console.error('💥 [Vercel Drive] FAILED to upload PO Reference Photo:', error.message)
    // ... (Log error detail) ...
    return { success: false, error: error.message, size: 0 }
  }
}