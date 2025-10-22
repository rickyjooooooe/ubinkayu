import { createCanvas, loadImage } from 'canvas'
import fs from 'fs'
import path from 'path'
import { app, shell } from 'electron'

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
  if (!text) return;
  const paragraphs = text.split('\n');
  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      y += lineHeight;
      continue;
    }
    let line = '';
    const words = paragraph.split(' ');
    for (const word of words) {
      const testLine = line + (line ? ' ' : '') + word;
      if (context.measureText(testLine).width > maxWidth && line) {
        context.fillText(line, x, y);
        y += lineHeight;
        line = word;
      } else {
        line = testLine;
      }
    }
    context.fillText(line, x, y);
    y += lineHeight;
  }
}

function calculateLineCount(context, text, maxWidth) {
  if (!text) return 1;
  const paragraphs = text.split('\n');
  let totalLines = 0;
  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      totalLines++;
      continue;
    }
    let line = '';
    const words = paragraph.split(' ');
    for (const word of words) {
      const testLine = line + (line ? ' ' : '') + word;
      if (context.measureText(testLine).width > maxWidth && line) {
        totalLines++;
        line = word;
      } else {
        line = testLine;
      }
    }
    totalLines++;
  }
  return Math.max(1, totalLines);
}

export async function generatePOJpeg(poData, revisionNumber = 0) {
  try {
    const baseDir = path.resolve(app.getPath('documents'), 'UbinkayuERP', 'PO')
    const poFolderName = `${poData.po_number}-${poData.project_name}`.replace(/[/\\?%*:|"<>]/g, '-')
    const poDir = path.join(baseDir, poFolderName)
    ensureDirSync(poDir)
    const fileName = `PO-${poData.po_number.replace(/[/\\?%*:|"<>]/g, '-')}-Rev${revisionNumber}.jpeg`
    const filePath = path.join(poDir, fileName)

    const width = 1200
    const redColor = '#D92121'
    const blueColor = '#0000FF'
    const blackColor = '#333333'
    const greenColor = '#006400'
    const headerBgColor = '#F0F0F0'
    const totalBgColor = '#FFE6E6'
    const borderColor = '#AAAAAA'

    const baseFont = 'Calibri'
    const tableLeft = 30
    const tableWidth = width - 60
    const rowPadding = 8
    const itemLineHeight = 14

    const tempCanvas = createCanvas(width, 100)
    const ctx = tempCanvas.getContext('2d')

    let totalHeight = 0

    totalHeight += 70
    totalHeight += 60

    const items = poData.items || []
    items.forEach((item) => {
      ctx.font = `10px ${baseFont}`
      const poLines = calculateLineCount(
        ctx,
        `${poData.po_number || 'N/A'}\n${poData.project_name || 'N/A'}`,
        130 - rowPadding * 2
      )
      const produkText = `${item.product_name || ''}\n${item.wood_type || ''} ${item.profile || ''}`
      const produkLines = calculateLineCount(ctx, produkText, 180 - rowPadding * 2)
      const finishingText = `${item.finishing || ''}\n${item.sample || ''}`
      const finishingLines = calculateLineCount(ctx, finishingText, 170 - rowPadding * 2)

      const lokasiAndNotesText = [item.location, item.notes].filter(Boolean).join('\n') || '-'
      const lokasiLines = calculateLineCount(ctx, lokasiAndNotesText, 140 - rowPadding * 2)

      const maxLines = Math.max(poLines, produkLines, finishingLines, lokasiLines, 2)
      const rowHeight = maxLines * itemLineHeight + rowPadding * 2
      totalHeight += rowHeight
    })

    totalHeight += 30

    ctx.font = `10px ${baseFont}`
    const notesText = poData.notes || '-'
    const noteLineCount = calculateLineCount(ctx, notesText, tableWidth - 20)
    const notesSectionHeight = noteLineCount * 15 + 15 * 2 + 20 + 10
    totalHeight += notesSectionHeight

    totalHeight += 80

    let photoDrawHeight = 0
    if (poData.poPhotoPath && fs.existsSync(poData.poPhotoPath)) {
      try {
        const userImage = await loadImage(poData.poPhotoPath)
        const aspectRatio = userImage.height / userImage.width
        photoDrawHeight = tableWidth * aspectRatio
        totalHeight += 20 + 30 + photoDrawHeight
      } catch (imgError) {
        console.error('Gagal memuat gambar untuk kalkulasi tinggi:', imgError)
        totalHeight += 60
      }
    } else {
      totalHeight += 60
    }

    totalHeight += 30

    const canvas = createCanvas(width, totalHeight)
    const finalCtx = canvas.getContext('2d')

    finalCtx.fillStyle = '#FFFFFF'
    finalCtx.fillRect(0, 0, width, totalHeight)

    let currentY = 40
    finalCtx.font = `bold 24px ${baseFont}`
    finalCtx.fillStyle = redColor
    const headerText = `${poData.po_number || 'N/A'} ${poData.project_name || 'N/A'}`
    finalCtx.textAlign = 'center'
    finalCtx.fillText(headerText, width / 2, currentY)

    finalCtx.font = `bold 16px ${baseFont}`
    finalCtx.fillStyle = blackColor
    const date = poData.created_at ? new Date(poData.created_at) : new Date()
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    const dateText = `AD${year}年${month}月${day}日`
    const sbyText = `SBY R: ${revisionNumber}`
    finalCtx.textAlign = 'right'
    finalCtx.fillText(sbyText, width - 30, currentY - 15)
    finalCtx.fillText(dateText, width - 30, currentY + 10)
    finalCtx.textAlign = 'left'

    currentY += 30

    const cols = {
      rencKirim: { x: 0, width: 90 },
      noPo: { x: 90, width: 130 },
      produk: { x: 220, width: 180 },
      finishing: { x: 400, width: 170 },
      ukuran: { x: 570, width: 200 },
      kuantiti: { x: 770, width: 120 },
      kubikasi: { x: 890, width: 110 },
      lokasi: { x: 1000, width: 140 }
    }

    finalCtx.fillStyle = headerBgColor
    finalCtx.fillRect(tableLeft, currentY, tableWidth, 60)
    finalCtx.strokeStyle = borderColor
    finalCtx.lineWidth = 1

    finalCtx.fillStyle = greenColor
    finalCtx.font = `bold 10px ${baseFont}`
    finalCtx.textAlign = 'center'

    const drawHeader = (text, col, yOffset1, yOffset2) => {
      const lines = text.split('\n')
      finalCtx.fillText(lines[0], tableLeft + col.x + col.width / 2, currentY + yOffset1)
      if (lines[1]) {
        finalCtx.fillText(lines[1], tableLeft + col.x + col.width / 2, currentY + yOffset2)
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
    const ukuranSubWidth = cols.ukuran.width / 4
    finalCtx.fillText('UKURAN', ukuranStartX + cols.ukuran.width / 2, currentY + 20)
    finalCtx.beginPath()
    finalCtx.moveTo(ukuranStartX, currentY + 30)
    finalCtx.lineTo(ukuranStartX + cols.ukuran.width, currentY + 30)
    finalCtx.stroke()

    finalCtx.font = `bold 9px ${baseFont}`
    finalCtx.fillStyle = blackColor
    finalCtx.fillText('tbl', ukuranStartX + ukuranSubWidth / 2, currentY + 48)
    finalCtx.fillText('lebar', ukuranStartX + ukuranSubWidth + ukuranSubWidth / 2, currentY + 48)
    finalCtx.fillText(
      'panjang',
      ukuranStartX + ukuranSubWidth * 2 + ukuranSubWidth / 2,
      currentY + 48
    )
    finalCtx.fillText(
      'Tipe Pjg',
      ukuranStartX + ukuranSubWidth * 3 + ukuranSubWidth / 2,
      currentY + 48
    )

    Object.values(cols).forEach((col) =>
      finalCtx.strokeRect(tableLeft + col.x, currentY, col.width, 60)
    )
    finalCtx.strokeRect(ukuranStartX + ukuranSubWidth, currentY + 30, 0, 30)
    finalCtx.strokeRect(ukuranStartX + ukuranSubWidth * 2, currentY + 30, 0, 30)
    finalCtx.strokeRect(ukuranStartX + ukuranSubWidth * 3, currentY + 30, 0, 30)

    currentY += 60

    items.forEach((item) => {
      finalCtx.font = `10px ${baseFont}`
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

      const lokasiAndNotesForDraw = [item.location, item.notes].filter(Boolean).join(', ') || '-'
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
        currentY + rowPadding + 10
      )
      finalCtx.fillStyle = blackColor
      finalCtx.fillText(
        poDate,
        tableLeft + cols.rencKirim.x + cols.rencKirim.width / 2,
        currentY + rowPadding + 10 + itemLineHeight * 1.5
      )

      finalCtx.textAlign = 'left'
      wrapText(
        finalCtx,
        `${poData.po_number || 'N/A'}\n${poData.project_name || 'N/A'}`,
        tableLeft + cols.noPo.x + rowPadding,
        currentY + rowPadding + 10,
        cols.noPo.width - rowPadding * 2,
        itemLineHeight
      )
      wrapText(
        finalCtx,
        produkText,
        tableLeft + cols.produk.x + rowPadding,
        currentY + rowPadding + 10,
        cols.produk.width - rowPadding * 2,
        itemLineHeight
      )
      wrapText(
        finalCtx,
        finishingText,
        tableLeft + cols.finishing.x + rowPadding,
        currentY + rowPadding + 10,
        cols.finishing.width - rowPadding * 2,
        itemLineHeight
      )

      wrapText(
        finalCtx,
        lokasiAndNotesForDraw,
        tableLeft + cols.lokasi.x + rowPadding,
        currentY + rowPadding + 10,
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

      const quantityValue = (Number(item.quantity) || 0).toFixed(1);
      const quantity = `${quantityValue} ${item.satuan || 'pcs'}`
      finalCtx.fillText(
        quantity,
        tableLeft + cols.kuantiti.x + cols.kuantiti.width / 2,
        currentY + rowHeight / 2
      )
      const kubikasi = (Number(item.kubikasi) || 0).toFixed(3);
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
    finalCtx.fillRect(tableLeft, currentY, tableWidth, 30)
    finalCtx.strokeRect(tableLeft, currentY, tableWidth, 30)
    finalCtx.fillStyle = redColor
    finalCtx.font = `bold 12px ${baseFont}`
    finalCtx.textAlign = 'right'
    finalCtx.fillText(
      'TOTAL',
      tableLeft + cols.kuantiti.x + cols.kuantiti.width - rowPadding,
      currentY + 20
    )
    finalCtx.textAlign = 'center'
    const totalKubikasi = poData.kubikasi_total
      ? (Number(poData.kubikasi_total) || 0).toFixed(3) + ' m³'
      : '0.000 m³'
    finalCtx.fillText(
      totalKubikasi,
      tableLeft + cols.kubikasi.x + cols.kubikasi.width / 2,
      currentY + 20
    )
    currentY += 30

    const notesBoxY = currentY
    const notesLineHeight = 15
    const notesPadding = notesLineHeight * 2
    finalCtx.fillStyle = greenColor
    finalCtx.font = `bold 10px ${baseFont}`
    finalCtx.textAlign = 'left'
    finalCtx.fillText(
      'Cara kerja / request klien / detail lainnya:',
      tableLeft + 10,
      notesBoxY + notesPadding
    )
    finalCtx.fillStyle = blackColor
    finalCtx.font = `10px ${baseFont}`

    const notesBoxHeight = noteLineCount * notesLineHeight + notesPadding + 20
    wrapText(
      finalCtx,
      notesText,
      tableLeft + 10,
      notesBoxY + notesPadding + 20,
      tableWidth - 20,
      notesLineHeight
    )
    finalCtx.strokeRect(tableLeft, notesBoxY, tableWidth, notesBoxHeight)
    currentY += notesBoxHeight + 10

    const approvalTableHeight = 80
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
    finalCtx.font = `bold 9px ${baseFont}`
    finalCtx.textAlign = 'center'

    approvalCols.forEach((title, index) => {
      const colX = tableLeft + index * approvalColWidth
      finalCtx.strokeStyle = borderColor
      finalCtx.strokeRect(colX, currentY, approvalColWidth, approvalTableHeight)
      finalCtx.fillStyle = greenColor
      finalCtx.fillText(title, colX + approvalColWidth / 2, currentY + 15)
      finalCtx.beginPath()
      finalCtx.moveTo(colX, currentY + 25)
      finalCtx.lineTo(colX + approvalColWidth, currentY + 25)
      finalCtx.stroke()

      finalCtx.fillText('tgl:', colX + approvalColWidth / 2, currentY + approvalTableHeight - 10)

      if (title === 'ACC Mrktng' && poData.marketing) {
        finalCtx.fillStyle = blackColor
        finalCtx.font = `bold 10px ${baseFont}`
        finalCtx.fillText(
          poData.marketing,
          colX + approvalColWidth / 2,
          currentY + approvalTableHeight / 2
        )
      }
    })


    finalCtx.fillStyle = greenColor
    finalCtx.font = `10px ${baseFont}`
    finalCtx.textAlign = 'right'
    finalCtx.fillText('Tanggal cetak:', width - 30, currentY + 30)
    finalCtx.fillText(new Date().toLocaleDateString('id-ID'), width - 30, currentY + 45)
    currentY += approvalTableHeight

    currentY += 20
    finalCtx.fillStyle = blackColor
    finalCtx.font = `bold 14px ${baseFont}`
    finalCtx.textAlign = 'left'
    finalCtx.fillText('Lampiran: Foto Referensi', tableLeft, currentY)
    currentY += 30

    if (poData.poPhotoPath && fs.existsSync(poData.poPhotoPath)) {
      try {
        const userImage = await loadImage(poData.poPhotoPath)
        finalCtx.drawImage(userImage, tableLeft, currentY, tableWidth, photoDrawHeight)
      } catch (imgError) {
        console.error('Gagal menggambar gambar referensi:', imgError)
        finalCtx.fillStyle = redColor
        finalCtx.font = `12px ${baseFont}`
        finalCtx.textAlign = 'left'
        finalCtx.fillText(`Gagal memuat file gambar: ${poData.poPhotoPath}`, tableLeft, currentY)
      }
    } else {
      finalCtx.font = `12px ${baseFont}`
      finalCtx.fillStyle = '#888'
      finalCtx.textAlign = 'left'
      finalCtx.fillText('Tidak ada foto referensi yang dilampirkan.', tableLeft, currentY)
    }

    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.95 })
    fs.writeFileSync(filePath, buffer)
    shell.openPath(filePath)
    return { success: true, path: filePath }
  } catch (error) {
    console.error('❌ Gagal generate JPEG:', error)
    return { success: false, error: error.message }
  }
}
