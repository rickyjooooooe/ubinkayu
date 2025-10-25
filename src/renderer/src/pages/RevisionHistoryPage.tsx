/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import React, { useState, useEffect } from 'react'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { POItem, PORevision, RevisionHistoryItem } from '../types'
import * as apiService from '../apiService' // Pastikan ini diimpor

// --- [BARU] Helper Functions untuk Perbandingan Keseluruhan ---

interface ComparisonResult {
  headerChanges: string[]
  added: POItem[]
  removed: POItem[]
  modified: {
    item: POItem
    changes: string[]
  }[]
}

// [BARU] Fungsi untuk membandingkan informasi dasar PO
const findHeaderChanges = (current: PORevision, previous: PORevision): string[] => {
  const changes: string[] = []
  // Definisikan label yang lebih mudah dibaca untuk setiap field
  const fieldLabels: { [key in keyof PORevision]?: string } = {
    project_name: 'Customer',
    priority: 'Prioritas',
    deadline: 'Deadline',
    notes: 'Catatan',
    acc_marketing: 'Marketing' // Pastikan 'acc_marketing' ada di tipe PORevision
  }

  // Loop melalui field yang ingin kita bandingkan
  for (const key in fieldLabels) {
    const field = key as keyof PORevision
    if (current[field] !== previous[field]) {
      changes.push(
        `${fieldLabels[field]}: "${previous[field] || 'Kosong'}" → "${current[field] || 'Kosong'}"`
      )
    }
  }
  return changes
}

const generateItemKey = (item: POItem): string => {
  return `${item.product_name}-${item.wood_type}-${item.profile}-${item.thickness_mm}x${item.width_mm}x${item.length_mm}`
}

const findItemChanges = (newItem: POItem, oldItem: POItem): string[] => {
  const changes: string[] = []
  const fieldsToCompare: (keyof POItem)[] = ['color', 'finishing', 'sample', 'quantity', 'satuan', 'notes']

  fieldsToCompare.forEach((field) => {
    if (newItem[field] !== oldItem[field]) {
      changes.push(`${field}: "${oldItem[field] || ''}" → "${newItem[field] || ''}"`)
    }
  })
  return changes
}

// [DIUBAH] Nama fungsi utama menjadi compareRevisions
const compareRevisions = (current: RevisionHistoryItem, previous: RevisionHistoryItem): ComparisonResult => {
  // 1. Panggil fungsi baru untuk membandingkan Header
  const headerChanges = findHeaderChanges(current.revision, previous.revision)

  // 2. Logika perbandingan item yang sudah ada
  const currentMap = new Map(current.items.map((item) => [generateItemKey(item), item]))
  const previousMap = new Map(previous.items.map((item) => [generateItemKey(item), item]))

  const added: POItem[] = []
  const removed: POItem[] = []
  const modified: { item: POItem; changes: string[] }[] = []

  currentMap.forEach((currentItem, key) => {
    if (!previousMap.has(key)) {
      added.push(currentItem)
    } else {
      const previousItem = previousMap.get(key)!
      const itemChanges = findItemChanges(currentItem, previousItem)
      if (itemChanges.length > 0) {
        modified.push({ item: currentItem, changes: itemChanges })
      }
    }
  })

  previousMap.forEach((previousItem, key) => {
    if (!currentMap.has(key)) {
      removed.push(previousItem)
    }
  })

  // 3. Gabungkan semua hasil perubahan
  return { headerChanges, added, removed, modified }
}

// --- Akhir Helper Functions ---
// [BARU] Fungsi helper untuk membuat deskripsi item yang detail
const formatItemDescription = (item: POItem): string => {
  const parts = [
    item.product_name || 'Item',
    item.wood_type ? `(${item.wood_type})` : '',
    item.profile || '',
    item.color || '',
    item.finishing || '',
    `${item.thickness_mm || 0}x${item.width_mm || 0}x${item.length_mm || 0}`,
    item.notes || ''
  ];

  // Filter bagian yang kosong dan gabungkan dengan koma
  return parts.filter(Boolean).join(', ');
}
interface RevisionHistoryPageProps {
  poId: string | null
  poNumber: string | null
  onBack: () => void
}

const RevisionHistoryPage: React.FC<RevisionHistoryPageProps> = ({ poId, poNumber, onBack }) => {
  const [history, setHistory] = useState<RevisionHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (poId) {
      const fetchHistoryData = async () => {
        setIsLoading(true)
        try {
          // @ts-ignore
          const data = await apiService.getRevisionHistory(poId)
          setHistory(data)
        } catch (error) {
          console.error(`Gagal memuat histori untuk PO ID ${poId}:`, error)
        } finally {
          setIsLoading(false)
        }
      }
      fetchHistoryData()
    }
  }, [poId])

  const formatDate = (d: string | undefined | null) =>
    d
      ? new Date(d).toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'long',
          year: 'numeric'
        })
      : '-'

  const handleOpenPdf = (url: string) => {
    // @ts-ignore
    apiService.openExternalLink(url)
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Riwayat Revisi: PO {poNumber}</h1>
          <p>Menampilkan semua versi perubahan untuk Purchase Order ini.</p>
        </div>
        <Button onClick={onBack} variant="secondary">Kembali ke Detail</Button>
      </div>

      {isLoading ? (
        <p>⏳ Memuat riwayat revisi...</p>
      ) : history.length > 0 ? (
        history.map((revItem, index) => {
          const previousRevision = history[index + 1]
          const changes = previousRevision ? compareRevisions(revItem, previousRevision) : null
          const hasChanges =
            changes &&
            (changes.headerChanges.length > 0 ||
              changes.added.length > 0 ||
              changes.removed.length > 0 ||
              changes.modified.length > 0)

          return (
            <Card key={revItem.revision.revision_number} className="revision-history-card">
              {/* Header Revisi (Tampilan Tidak Berubah) */}
              <div className="revision-header">
                <div className="revision-title-group">
                  <h3>Revisi #{revItem.revision.revision_number}</h3>
                  {index === 0 && <span className="status-badge status-completed">Versi Terbaru</span>}
                </div>
                {/* [PERBAIKAN] Mengembalikan grup tombol/aksi ke sini */}
                <div className="revision-actions-group">
                  <span>Dibuat pada: {formatDate(revItem.revision.created_at)}</span>

                  {/* Tampilkan nama perevisi jika ada */}
                  {revItem.revision.revised_by && (
                    <span className="reviser-info">
                      <strong>Direvisi oleh:</strong> {revItem.revision.revised_by}
                    </span>
                  )}

                  {/* Tombol Buka PDF dikembalikan */}
                  {revItem.revision.pdf_link && revItem.revision.pdf_link.startsWith('http') && (
                    <Button onClick={() => handleOpenPdf(revItem.revision.pdf_link!)}>
                      📄 Buka File Revisi Ini
                    </Button>
                  )}
                </div>
              </div>

              {/* Detail Revisi (Tampilan Tidak Berubah) */}
              <div className="revision-details">
                <p>
                  <strong>Customer:</strong> {revItem.revision.project_name || '-'}
                </p>
                <p>
                  <strong>Prioritas:</strong> {revItem.revision.priority || 'Normal'}
                </p>
                <p>
                  <strong>Status:</strong> {revItem.revision.status || '-'}
                </p>
                <p>
                  <strong>Deadline:</strong> {formatDate(revItem.revision.deadline)}
                </p>
                {/* [TAMBAH] Tampilkan Marketing */}
                 <p>
                  <strong>Marketing:</strong> {revItem.revision.acc_marketing || '-'}
                </p>
                {revItem.revision.notes && (
                  <p>
                    <strong>Catatan:</strong> {revItem.revision.notes}
                  </p>
                )}
              </div>

              {/* JSX untuk menampilkan CATATAN perubahan */}
             {/* [DIROMBAK] JSX untuk menampilkan CATATAN perubahan */}
             {!previousRevision ? (
                <p><em>Ini adalah versi awal.</em></p>
              ) : hasChanges && changes ? (
                <div className="revision-changes-summary">
                  <h4>Ringkasan Perubahan dari Versi Sebelumnya:</h4>

                  {changes.headerChanges.length > 0 && (
                     <div className="change-section">
                        <h5>(~) Informasi Dasar Diubah:</h5>
                        <ul>
                           {changes.headerChanges.map((change, i) => (
                              <li key={i} className="change-modified">{change}</li>
                           ))}
                        </ul>
                     </div>
                  )}
                  {changes.added.length > 0 && (
                    <div className="change-section">
                      <h5>(+) Item Ditambahkan:</h5>
                      <ul>
                        {/* [PERBAIKAN] Menggunakan formatItemDescription */}
                        {changes.added.map((item) => (
                          <li key={item.id} className="change-added">
                            {formatItemDescription(item)}
                            <strong> — {item.quantity} {item.satuan}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {changes.removed.length > 0 && (
                    <div className="change-section">
                      <h5>(-) Item Dihapus:</h5>
                      <ul>
                        {/* [PERBAIKAN] Menggunakan formatItemDescription */}
                        {changes.removed.map((item) => (
                          <li key={item.id} className="change-removed">
                            {formatItemDescription(item)}
                            <strong> — {item.quantity} {item.satuan}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {changes.modified.length > 0 && (
                    <div className="change-section">
                      <h5>(~) Item Diubah:</h5>
                      <ul>
                        {changes.modified.map((mod) => (
                          <li key={mod.item.id} className="change-modified">
                            <strong>{mod.item.product_name}:</strong>
                            <ul>
                              {mod.changes.map((change, i) => (
                                <li key={i}>{change}</li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p><em>Tidak ada perubahan dari versi sebelumnya.</em></p>
              )}

              {/* Tabel Item (Tidak Berubah) */}
              <h4>Item pada revisi ini:</h4>
              <div className="table-responsive">
                <table className="simple-table item-table">
                  <thead>
                    <tr>
                      <th>Produk</th>
                      <th>Jenis Kayu</th>
                      <th>Profil</th>
                      <th>Warna</th>
                      <th>Finishing</th>
                      <th>Ukuran (mm)</th>
                      <th>Qty</th>
                      <th>Catatan Item</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revItem.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.product_name || '-'}</td>
                        <td>{item.wood_type || '-'}</td>
                        <td>{item.profile || '-'}</td>
                        <td>{item.color || '-'}</td>
                        <td>{item.finishing || '-'}</td>
                        <td>{`${item.thickness_mm || 0} x ${item.width_mm || 0} x ${item.length_mm || 0}`}</td>
                        <td>{`${item.quantity || 0} ${item.satuan || ''}`}</td>
                        <td>{item.notes || '-'}</td>
                      </tr>
                    ))}
                    {revItem.items.length === 0 && (
                      <tr>
                        <td colSpan={8}>Tidak ada item pada revisi ini.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        })
      ) : (
        <Card>
          <p>Tidak ada data riwayat revisi yang ditemukan untuk PO ini.</p>
        </Card>
      )}
    </div>
  )
}

export default RevisionHistoryPage