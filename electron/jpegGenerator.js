import { createCanvas, loadImage } from 'canvas'
import fs from 'fs'
import path from 'path'
import { app, shell } from 'electron'

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

// --- FUNGSI HELPER (TETAP SAMA) ---
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

export async function generatePOJpeg(poData, revisionNumber = 0, openFile = true) {
  try {
    const baseDir = path.resolve(app.getPath('documents'), 'UbinkayuERP', 'PO')
    const poFolderName = `${poData.po_number}-${poData.project_name}`.replace(/[/\\?%*:|"<>]/g, '-')
    const poDir = path.join(baseDir, poFolderName)
    ensureDirSync(poDir)
    const fileName = `PO-${poData.po_number.replace(/[/\\?%*:|"<>]/g, '-')}-Rev${revisionNumber}.jpeg`
    const filePath = path.join(poDir, fileName)

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

    const baseFont = 'Calibri' // Electron menggunakan Calibri

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

    const items = poData.items || []
    items.forEach((item) => {
      ctx.font = `${10 * scaleFactor}px ${baseFont}` // [DIUBAH]
      const poLines = calculateLineCount(
        ctx,
        `${poData.po_number || 'N/A'}\n${poData.project_name || 'N/A'}`,
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

      const lokasiAndNotesText = [item.location, item.notes].filter(Boolean).join('\n') || '-' // [DIUBAH] Pakai \n
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
    const notesText = poData.notes || '-'
    const noteLineCount = calculateLineCount(ctx, notesText, tableWidth - 20 * scaleFactor) // [DIUBAH]
    // [DIUBAH]
    const notesSectionHeight =
      noteLineCount * (15 * scaleFactor) + 15 * scaleFactor * 2 + 20 * scaleFactor + 10 * scaleFactor
    totalHeight += notesSectionHeight

    totalHeight += 80 * scaleFactor // [DIUBAH]

    let photoDrawHeight = 0
    // [DIUBAH] Logika ini spesifik untuk Electron (poPhotoPath)
    if (poData.poPhotoPath && fs.existsSync(poData.poPhotoPath)) {
      try {
        const userImage = await loadImage(poData.poPhotoPath)
        const aspectRatio = userImage.height / userImage.width
        photoDrawHeight = tableWidth * aspectRatio // tableWidth sudah di-scale
        totalHeight += 20 * scaleFactor + 30 * scaleFactor + photoDrawHeight // [DIUBAH]
      } catch (imgError) {
        console.error('Gagal memuat gambar untuk kalkulasi tinggi:', imgError)
        totalHeight += 60 * scaleFactor // [DIUBAH]
      }
    } else {
      totalHeight += 60 * scaleFactor // [DIUBAH]
    }

    totalHeight += 30 * scaleFactor // [DIUBAH]

    const canvas = createCanvas(width, totalHeight)
    const finalCtx = canvas.getContext('2d')

    // --- [BARU] Atur Kualitas Teks dan Anti-Aliasing ---
    finalCtx.patternQuality = 'best'
    finalCtx.quality = 'best'
    finalCtx.imageSmoothingEnabled = true
    finalCtx.textDrawingMode = 'path' // Render teks sebagai vektor (LEBIH TAJAM)
    // --- [AKHIR BARU] ---

    finalCtx.fillStyle = '#FFFFFF'
    finalCtx.fillRect(0, 0, width, totalHeight)

    let currentY = 40 * scaleFactor // [DIUBAH]
    finalCtx.font = `bold ${24 * scaleFactor}px ${baseFont}` // [DIUBAH]
    finalCtx.fillStyle = redColor
    const headerText = `${poData.po_number || 'N/A'} ${poData.project_name || 'N/A'}`
    finalCtx.textAlign = 'center'
    finalCtx.fillText(headerText, width / 2, currentY)

    finalCtx.font = `bold ${16 * scaleFactor}px ${baseFont}` // [DIUBAH]
    finalCtx.fillStyle = blackColor
    const date = poData.created_at ? new Date(poData.created_at) : new Date()
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
        `${poData.po_number || 'N/A'}\n${poData.project_name || 'N/A'}`,
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
      const deadline = poData.deadline
        ? new Date(poData.deadline).toLocaleDateString('id-ID')
        : 'N/A'
      const poDate = poData.created_at
        ? new Date(poData.created_at).toLocaleDateString('id-ID')
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
        `${poData.po_number || 'N/A'}\n${poData.project_name || 'N/A'}`,
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

      const quantityValue = (Number(item.quantity) || 0).toFixed(1)
      const quantity = `${quantityValue} ${item.satuan || 'pcs'}`
      finalCtx.fillText(
        quantity,
        tableLeft + cols.kuantiti.x + cols.kuantiti.width / 2,
        currentY + rowHeight / 2
      )
      const kubikasi = (Number(item.kubikasi) || 0).toFixed(3) // [DIUBAH] Menjadi toFixed(3)
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
    const totalKubikasi = poData.kubikasi_total
      ? (Number(poData.kubikasi_total) || 0).toFixed(3) + ' m³'
      : '0.000 m³'
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

      if (title === 'ACC Mrktng' && poData.marketing) {
        finalCtx.fillStyle = blackColor
        finalCtx.font = `bold ${10 * scaleFactor}px ${baseFont}` // [DIUBAH]
        finalCtx.fillText(
          poData.marketing,
          colX + approvalColWidth / 2,
          currentY + approvalTableHeight / 2
        )
      }
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

    // [DIUBAH] Logika ini spesifik untuk Electron (poPhotoPath)
    if (poData.poPhotoPath && fs.existsSync(poData.poPhotoPath)) {
      try {
        const userImage = await loadImage(poData.poPhotoPath)
        finalCtx.drawImage(userImage, tableLeft, currentY, tableWidth, photoDrawHeight) // Koordinat sudah di-scale
      } catch (imgError) {
        console.error('Gagal menggambar gambar referensi:', imgError)
        finalCtx.fillStyle = redColor
        finalCtx.font = `${12 * scaleFactor}px ${baseFont}` // [DIUBAH]
        finalCtx.textAlign = 'left'
        finalCtx.fillText(`Gagal memuat file gambar: ${poData.poPhotoPath}`, tableLeft, currentY)
      }
    } else {
      finalCtx.font = `${12 * scaleFactor}px ${baseFont}` // [DIUBAH]
      finalCtx.fillStyle = '#888'
      finalCtx.textAlign = 'left'
      finalCtx.fillText('Tidak ada foto referensi yang dilampirkan.', tableLeft, currentY)
    }

    // --- [DIUBAH] Kualitas Output ---
    const buffer = canvas.toBuffer('image/jpeg', { quality: 1, progressive: true }) // Kualitas 100%
    fs.writeFileSync(filePath, buffer)

    // Buka file jika ini adalah 'preview'
    if (openFile) {
      shell.openPath(filePath)
    }

    return { success: true, path: filePath }
  } catch (error) {
    console.error('❌ Gagal generate JPEG:', error)
    return { success: false, error: error.message }
  }
}