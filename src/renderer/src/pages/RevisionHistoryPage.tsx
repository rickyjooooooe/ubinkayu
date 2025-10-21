/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import React, { useState, useEffect } from 'react'
import { POItem, PORevision, RevisionHistoryItem } from '../types'
import * as apiService from '../apiService'
import { Button } from '../components/Button'

// --- START: Component & Service Definitions ---
// The following are defined here to resolve import errors.


const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className
}) => <div className={`card-container ${className || ''}`}>{children}</div>

// --- END: Component & Service Definitions ---

// --- START: Helper Functions for Comparison ---

interface ComparisonResult {
  headerChanges: string[]
  added: POItem[]
  removed: POItem[]
  modified: { item: POItem; changes: string[] }[]
}

const findHeaderChanges = (current: PORevision, previous: PORevision): string[] => {
  const changes: string[] = []
  const fieldLabels: { [key in keyof PORevision]?: string } = {
    project_name: 'Customer',
    priority: 'Prioritas',
    deadline: 'Deadline',
    notes: 'Catatan',
    acc_marketing: 'Marketing'
  }

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
  const fieldsToCompare: (keyof POItem)[] = [
    'color',
    'finishing',
    'sample',
    'quantity',
    'satuan',
    'notes'
  ]

  fieldsToCompare.forEach((field) => {
    if (newItem[field] !== oldItem[field]) {
      changes.push(`${field}: "${oldItem[field] || ''}" → "${newItem[field] || ''}"`)
    }
  })
  return changes
}

const compareRevisions = (
  current: RevisionHistoryItem,
  previous: RevisionHistoryItem
): ComparisonResult => {
  const headerChanges = findHeaderChanges(current.revision, previous.revision)
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

  return { headerChanges, added, removed, modified }
}

// --- END: Helper Functions ---

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
      ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
      : '-'

  const handleOpenPdf = (url: string) => {
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
              <div className="revision-header">
                <div className="revision-title-group">
                  <h3>Revisi #{revItem.revision.revision_number}</h3>
                  {index === 0 && (
                    <span className="status-badge status-completed">Versi Terbaru</span>
                  )}
                </div>
                <div className="revision-actions-group">
                  <span>Dibuat pada: {formatDate(revItem.revision.created_at)}</span>
                  {/* [TAMBAHKAN INI] Tampilkan nama perevisi jika ada */}
                    {revItem.revision.revised_by && (
                      <span className="reviser-info">
                        <strong>Direvisi oleh:</strong> {revItem.revision.revised_by}
                      </span>
                    )}
                  {revItem.revision.pdf_link && revItem.revision.pdf_link.startsWith('http') && (
                    <Button onClick={() => handleOpenPdf(revItem.revision.pdf_link!)}>
                      📄 Buka File Revisi Ini
                    </Button>
                  )}
                </div>
              </div>

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
                {revItem.revision.notes && (
                  <p>
                    <strong>Catatan:</strong> {revItem.revision.notes}
                  </p>
                )}
              </div>

              {!previousRevision ? (
                <p>
                  <em>Ini adalah versi awal.</em>
                </p>
              ) : hasChanges && changes ? (
                <div className="revision-changes-summary">
                  <h4>Ringkasan Perubahan dari Versi Sebelumnya:</h4>
                  {changes.headerChanges.length > 0 && (
                    <div className="change-section">
                      <h5>(~) Informasi Dasar Diubah:</h5>
                      <ul>
                        {changes.headerChanges.map((change, i) => (
                          <li key={i}>{change}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {changes.added.length > 0 && (
                    <div className="change-section">
                      <h5>(+) Item Ditambahkan:</h5>
                      <ul>
                        {changes.added.map((item) => (
                          <li key={item.id}>
                            {item.product_name} ({item.quantity} {item.satuan})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {changes.removed.length > 0 && (
                    <div className="change-section">
                      <h5>(-) Item Dihapus:</h5>
                      <ul>
                        {changes.removed.map((item) => (
                          <li key={item.id}>
                            {item.product_name} ({item.quantity} {item.satuan})
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
                          <li key={mod.item.id}>
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
                <p>
                  <em>Tidak ada perubahan dari versi sebelumnya.</em>
                </p>
              )}

              <h4>Item pada revisi ini:</h4>
              <div className="po-table-container">
                <table className="simple-table">
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
                        <td>{`${item.thickness_mm} x ${item.width_mm} x ${item.length_mm}`}</td>
                        <td>{`${item.quantity} ${item.satuan}`}</td>
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
