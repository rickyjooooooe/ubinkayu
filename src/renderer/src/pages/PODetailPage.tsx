import React, { useState, useEffect } from 'react'
import { POHeader, POItem } from '../types'
import * as apiService from '../apiService'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ProgressBar } from '../components/ProgressBar'

interface PODetailPageProps {
  po: POHeader | null
  onBackToList: () => void
  onShowHistory: () => void
}

const PODetailPage: React.FC<PODetailPageProps> = ({ po, onBackToList, onShowHistory }) => {
  const [items, setItems] = useState<POItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const stages = [
    'Cari Bahan Baku',
    'Sawmill',
    'KD',
    'Pembahanan',
    'Moulding',
    'Coating',
    'Siap Kirim'
  ]

  useEffect(() => {
    if (po?.id) {
      const fetchDetailedItems = async () => {
        setIsLoading(true)
        try {
          // --- PERUBAHAN PENTING: Gunakan getPOItemsWithDetails ---
          // Ini akan mengambil data item beserta riwayat progress-nya
          const poItems = await apiService.getPOItemsWithDetails(po.id)
          setItems(poItems)
        } catch (error) {
          console.error(`Gagal memuat detail item untuk PO ${po.id}:`, error)
        } finally {
          setIsLoading(false)
        }
      }
      fetchDetailedItems()
    }
  }, [po])

  if (!po) {
    return (
      <div className="page-container">
        <p>Data PO tidak ditemukan.</p>
        <Button onClick={onBackToList}>Kembali ke Daftar</Button>
      </div>
    )
  }

  const formatDate = (d?: string) =>
    d
      ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
      : '-'
  const getPriorityBadgeClass = (p?: string) => `status-badge ${(p || 'normal').toLowerCase()}`
  const getStatusBadgeClass = (s?: string) =>
    `status-badge status-${(s || 'open').toLowerCase().replace(' ', '-')}`

  const handleOpenFile = async () => {
    if (!po || !po.pdf_link) {
      alert('Link file PDF tidak ditemukan untuk PO ini.')
      return
    }

    // Cek sederhana apakah link valid (dimulai dengan http)
    if (!po.pdf_link.startsWith('http')) {
      alert(`Link file tidak valid atau masih dalam proses pembuatan:\n${po.pdf_link}`)
      return
    }

    try {
      // Gunakan apiService untuk membuka link (berfungsi di Electron & Web)
      const result = await apiService.openExternalLink(po.pdf_link)
      if (!result.success) {
        // Handle jika apiService mengembalikan error (misal, URL tidak valid di Electron)
        throw new Error(result.error || 'Gagal membuka link.')
      }
    } catch (error) {
      console.error('Gagal membuka file:', error)
      alert(`Gagal membuka link file:\n${(error as Error).message}`)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Detail Purchase Order: {po.po_number}</h1>
          <p>Menampilkan informasi dan item versi terbaru.</p>
        </div>
        <div className="header-actions">
          <Button onClick={onBackToList}>Kembali ke Daftar</Button>
          <Button variant="secondary" onClick={onShowHistory}>
            📜 Lihat Riwayat Revisi
          </Button>
          <Button onClick={handleOpenFile}>📄 Buka File</Button>
        </div>
      </div>

      <div className="detail-po-info">
        <Card className="po-summary-card">
          <div className="po-summary-header">
            <h3 className="po-summary-po-number">PO: {po.po_number}</h3>
            <span className={getStatusBadgeClass(po.status)}>{po.status || 'Open'}</span>
          </div>
          <p className="po-summary-customer">
            <strong>Customer:</strong> {po.project_name}
          </p>
          <div className="po-summary-grid">
            <div className="info-item">
              <label>Tanggal Input PO</label>
              <span>{formatDate(po.created_at)}</span>
            </div>
            <div className="info-item">
              <label>Target Kirim</label>
              <span>{formatDate(po.deadline)}</span>
            </div>
            <div className="info-item">
              <label>Prioritas</label>
              <span className={getPriorityBadgeClass(po.priority)}>{po.priority || '-'}</span>
            </div>
            <div className="info-item">
              <label>Total Kubikasi</label>
              <span>
                {po.kubikasi_total ? `${Number(po.kubikasi_total).toFixed(3)} m³` : '0.000 m³'}
              </span>
            </div>
            {/* --- INFO BARU DITAMBAHKAN DI SINI --- */}
            <div className="info-item">
              <label>Marketing</label>
              <span>{po.acc_marketing || '-'}</span>
            </div>
            <div className="info-item">
              <label>Alamat Kirim</label>
              <span>{po.alamat_kirim || '-'}</span>
            </div>
          </div>
          <div className="po-summary-progress">
            <div className="progress-info">
              <label>Progress Produksi Keseluruhan</label>
              <span>{po.progress?.toFixed(0) || 0}%</span>
            </div>
            <ProgressBar value={po.progress || 0} />
          </div>
        </Card>
        {po.notes && (
          <Card className="notes-card">
            <h4>Catatan PO</h4>
            <p>{po.notes}</p>
          </Card>
        )}
      </div>

      <div className="item-section-header">
        <h2>Daftar Item & Progressnya (Versi Terbaru)</h2>
      </div>
      {isLoading ? (
        <p>⏳ Loading data item...</p>
      ) : items.length === 0 ? (
        <Card>
          <p>Tidak ada item terdaftar untuk PO ini.</p>
        </Card>
      ) : (
        <Card>
          <div className="table-responsive">
            {/* --- TABEL ITEM YANG SUDAH DI-UPGRADE --- */}
            <table className="item-table detailed-item-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Produk & Spesifikasi</th>
                  <th>Ukuran & Qty</th>
                  <th>Kubikasi</th>
                  <th>Lokasi & Catatan</th>
                  <th>Progress Item</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  // Hitung progress untuk item ini
                  const latestStage = item.progressHistory?.[item.progressHistory.length - 1]?.stage
                  const currentStageIndex = latestStage ? stages.indexOf(latestStage) : -1
                  const itemProgress =
                    currentStageIndex >= 0 ? ((currentStageIndex + 1) / stages.length) * 100 : 0

                  return (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td>
                        <div className="product-spec-cell">
                          <strong>{item.product_name}</strong>
                          <span>
                            Kayu: {item.wood_type || '-'} | Profil: {item.profile || '-'}
                          </span>
                          <span>
                            Warna: {item.color || '-'} | Finish: {item.finishing || '-'} | Sample:{' '}
                            {item.sample || '-'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="size-qty-cell">
                          <span>
                            {`${item.thickness_mm || 0}x${item.width_mm || 0}x${item.length_mm || 0} mm`}{' '}
                            ({item.length_type || 'N/A'})
                          </span>
                          <strong>{`${item.quantity || 0} ${item.satuan || ''}`}</strong>
                        </div>
                      </td>
                      <td>
                        <strong>{Number(item.kubikasi || 0).toFixed(4)} m³</strong>
                      </td>
                      <td>
                        <div className="notes-location-cell">
                          <span>Lokasi: {item.location || '-'}</span>
                          <p>{item.notes || '-'}</p>
                        </div>
                      </td>
                      <td>
                        <div className="item-progress-cell">
                          <span>
                            {latestStage || 'Belum Mulai'} ({itemProgress.toFixed(0)}%)
                          </span>
                          <ProgressBar value={itemProgress} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

export default PODetailPage
