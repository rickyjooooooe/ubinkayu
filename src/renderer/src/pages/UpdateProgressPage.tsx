// file: src/renderer/src/pages/UpdateProgressPage.tsx

import React, { useState, useEffect, useCallback } from 'react'
import { POHeader, POItem, ProductionStage } from '../types'
import * as apiService from '../apiService'
import { Button } from '../components/Button'
import { Card } from '../components/Card'

// Helper functions (asumsi sama)
const formatDate = (d: string | undefined | null): string => {
  if (!d) return '-'
  try {
    // Gunakan opsi yang lebih lengkap untuk kejelasan
    return new Date(d).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  } catch {
    return String(d)
  }
}
const formatDeadlineForInput = (isoString: string | undefined | null): string => {
  if (!isoString) return ''
  try {
    return new Date(isoString).toISOString().split('T')[0]
  } catch {
    return ''
  }
}

// Tahapan Produksi (bisa dipindah ke file constants jika dipakai di banyak tempat)
const STAGES: ProductionStage[] = [
  'Cari Bahan Baku',
  'Sawmill',
  'KD',
  'Pembahanan',
  'Moulding',
  'Coating',
  'Siap Kirim'
]

// --- Komponen ProgressItem (untuk satu item dalam PO) ---
const ProgressItem = ({
  item,
  poId,
  poNumber,
  onUpdate // Callback untuk refresh data setelah update berhasil
}: {
  item: POItem
  poId: string
  poNumber: string
  onUpdate: () => void
}) => {
  const isElectron = !!window.api // Cek apakah berjalan di Electron

  // Cari tahap terakhir dari riwayat progress item
  const latestLog = item.progressHistory?.[item.progressHistory.length - 1]
  const latestStage = latestLog?.stage
  const currentStageIndex = latestStage ? STAGES.indexOf(latestStage) : -1

  // --- State Internal Komponen Item ---
  const [notes, setNotes] = useState('')
  const [photoPath, setPhotoPath] = useState<string | null>(null) // Hanya untuk Electron
  const [photoBase64, setPhotoBase64] = useState<string | null>(null) // Hanya untuk Web/Vercel
  const [photoName, setPhotoName] = useState<string | null>(null) // Nama file yang dipilih
  const [isUpdating, setIsUpdating] = useState(false) // Status loading saat menyimpan
  const [editableDeadlines, setEditableDeadlines] = useState(item.stageDeadlines || []) // Deadline (bisa diedit)

  // Tahap berikutnya yang mungkin dipilih (filter dari STAGES)
  const futureStages = STAGES.slice(currentStageIndex + 1)

  // State untuk tahap yang dipilih di dropdown (default ke tahap pertama setelah tahap saat ini)
  const [selectedStage, setSelectedStage] = useState<string>(futureStages[0] || '')

  // Handler untuk mengubah deadline (hanya untuk 'Siap Kirim')
  const handleDeadlineChange = (stageName: string, newDate: string) => {
    // Hanya izinkan edit untuk 'Siap Kirim' dan jika ada tanggal baru
    if (!newDate || stageName !== 'Siap Kirim') return

    const newDeadlineISO = new Date(newDate).toISOString()
    // Optimistic UI update
    const updatedDeadlines = editableDeadlines.map((d) =>
      d.stageName === stageName ? { ...d, deadline: newDeadlineISO } : d
    )
    setEditableDeadlines(updatedDeadlines)

    // Panggil API untuk menyimpan deadline baru
    apiService
      .updateStageDeadline({ poId, itemId: item.id, stageName, newDeadline: newDeadlineISO })
      .then((result) => {
        if (!result.success) throw new Error(result.error || 'Gagal simpan deadline')
        console.log(`Deadline for ${stageName} updated successfully.`)
      })
      .catch((err) => {
        alert(`Gagal menyimpan deadline baru: ${err.message}`)
        // Rollback UI jika gagal
        setEditableDeadlines(item.stageDeadlines || [])
      })
  }

  // Handler untuk membuka link foto di tab/browser eksternal
  const handleViewPhoto = (url: string) => {
    if (url) {
      apiService.openExternalLink(url).catch((err) => console.error('Failed to open link:', err))
    }
  }

  // Handler untuk memilih file foto
  const handleSelectPhoto = async () => {
    if (isElectron) {
      // Electron: Buka dialog file
      try {
        const selectedPath = await apiService.openFileDialog()
        if (selectedPath) {
          setPhotoPath(selectedPath)
          setPhotoName(selectedPath.split(/[/\\]/).pop() || selectedPath)
          setPhotoBase64(null) // Reset base64 jika ada
        }
      } catch (err) {
        console.error('Error opening file dialog:', err)
        alert('Gagal membuka dialog file.')
      }
    } else {
      // Web/Vercel: Gunakan input file
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*' // Terima semua jenis gambar
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) {
          setPhotoName(file.name)
          const reader = new FileReader()
          reader.onload = (readerEvent) => {
            const base64String = readerEvent.target?.result as string
            // Ambil hanya data base64 (setelah 'base64,')
            setPhotoBase64(base64String.includes(',') ? base64String.split(',')[1] : base64String)
            setPhotoPath(null) // Reset path jika ada
          }
          reader.onerror = (err) => {
            console.error('Error reading file:', err)
            alert('Gagal membaca file gambar.')
          }
          reader.readAsDataURL(file)
        }
      }
      input.click()
    }
  }

  // Handler untuk menyimpan update progress
  const handleUpdate = async (stageToUpdate: string) => {
    if (!stageToUpdate) {
      alert('Pilih tahap tujuan terlebih dahulu.')
      return
    }
    // Update: Izinkan simpan tanpa catatan/foto jika memang tidak ada
    // if (!notes && !photoName) {
    //   alert('Harap isi catatan atau unggah foto.');
    //   return;
    // }

    setIsUpdating(true) // Mulai loading
    try {
      // Siapkan payload sesuai environment
      const payload = {
        poId,
        itemId: item.id,
        poNumber,
        stage: stageToUpdate,
        notes: notes.trim(), // Trim catatan
        // Kirim path jika di Electron, base64 jika di Web
        photoPath: isElectron ? photoPath : null,
        photoBase64: !isElectron ? photoBase64 : null
      }
      console.log('Sending progress update payload:', payload)

      const result = await apiService.updateItemProgress(payload)
      if (result.success) {
        alert(
          `Progress item ${item.product_name || 'Item'} berhasil diupdate ke tahap ${stageToUpdate}!`
        )
        // Panggil callback onUpdate untuk refresh data di halaman utama
        onUpdate()
        // Reset form setelah berhasil
        setNotes('')
        setPhotoPath(null)
        setPhotoBase64(null)
        setPhotoName(null)
        // Reset dropdown ke tahap berikutnya (jika masih ada)
        const newCurrentIndex = STAGES.indexOf(stageToUpdate as ProductionStage)
        const nextFutureStages = STAGES.slice(newCurrentIndex + 1)
        setSelectedStage(nextFutureStages[0] || '')
      } else {
        throw new Error(result.error || 'Terjadi kesalahan di backend saat menyimpan progress.')
      }
    } catch (err) {
      console.error('Failed to update progress:', err)
      alert(`Gagal update progress: ${(err as Error).message}`)
    } finally {
      setIsUpdating(false) // Selesai loading
    }
  }

  return (
    <Card className="item-card progress-item-card">
      {' '}
      {/* Tambah class spesifik */}
      {/* Header Item */}
      <div className="item-card-header">
        <h4>
          {item.product_name || 'Nama Produk ?'} ({item.wood_type || 'Kayu ?'})
        </h4>
        <span>
          Qty: {item.quantity || '?'} {item.satuan || '?'}
        </span>
      </div>
      {/* Timeline Progress */}
      <div className="timeline-container">
        <div className="progress-timeline">
          {STAGES.map((stage, index) => {
            const deadlineInfo = editableDeadlines.find((d) => d.stageName === stage)
            const isCompleted = index <= currentStageIndex
            const isOverdue =
              deadlineInfo?.deadline && new Date() > new Date(deadlineInfo.deadline) && !isCompleted
            const isEditable = stage === 'Siap Kirim' // Hanya deadline 'Siap Kirim' yang bisa diedit
            return (
              <div
                key={stage}
                className={`stage ${isCompleted ? 'completed' : ''} ${isOverdue ? 'overdue' : ''}`}
                title={isOverdue ? `Target terlewat: ${formatDate(deadlineInfo?.deadline)}` : ''}
              >
                <div className="stage-dot"></div>
                <div className="stage-name">{stage}</div>
                {/* Tampilkan Deadline */}
                {deadlineInfo?.deadline && (
                  <div className={`stage-deadline ${isEditable ? 'editable' : ''}`}>
                    <label htmlFor={`deadline-${item.id}-${stage}`}>Target:</label>
                    <input
                      id={`deadline-${item.id}-${stage}`}
                      type="date"
                      value={formatDeadlineForInput(deadlineInfo.deadline)}
                      onChange={(e) => handleDeadlineChange(stage, e.target.value)}
                      disabled={!isEditable || isUpdating} // Disable saat update
                      title={
                        isEditable
                          ? 'Ubah target tanggal kirim'
                          : `Target: ${formatDate(deadlineInfo.deadline)}`
                      }
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {/* Form Update (hanya tampil jika belum tahap 'Siap Kirim') */}
      {currentStageIndex < STAGES.length - 1 && (
        <div className="update-form">
          <h5>Update Progress Item</h5>
          {/* Dropdown Tahap Berikutnya */}
          <div className="form-group">
            <label htmlFor={`stage-select-${item.id}`}>Pilih Tahap Berikutnya:</label>
            <select
              id={`stage-select-${item.id}`}
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              disabled={isUpdating}
            >
              {/* Pastikan ada opsi default jika futureStages kosong */}
              {futureStages.length === 0 && <option value="">-- Selesai --</option>}
              {/* Opsi hanya berisi tahap setelah tahap saat ini */}
              {futureStages.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </div>
          {/* Textarea Catatan */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Tambahkan catatan progress (opsional)..."
            rows={3}
            disabled={isUpdating}
          />
          {/* Tombol Pilih Foto */}
          <div className="photo-upload-section">
            <Button
              variant="secondary"
              onClick={handleSelectPhoto}
              disabled={isUpdating}
              className="select-photo-btn"
            >
              {photoName ? `✅ Ganti Foto (${photoName})` : '📷 Unggah Foto (Opsional)'}
            </Button>
            {/* Tombol Hapus Foto Terpilih */}
            {photoName && (
              <Button
                variant="secondary" // Atau "danger"
                onClick={() => {
                  setPhotoPath(null)
                  setPhotoBase64(null)
                  setPhotoName(null)
                }}
                disabled={isUpdating}
                style={{ marginLeft: '10px' }}
                // Anda bisa menambahkan className di sini jika perlu styling ukuran
              >
                Hapus
              </Button>
            )}
          </div>
          {/* Tombol Simpan Progress */}
          <Button
            onClick={() => handleUpdate(selectedStage)}
            disabled={isUpdating || !selectedStage} // Disable jika tidak ada tahap dipilih
            className="save-progress-btn"
          >
            {isUpdating ? 'Menyimpan...' : `Simpan Progress ke ${selectedStage}`}
          </Button>
        </div>
      )}
      {/* Riwayat Progress */}
      {item.progressHistory && item.progressHistory.length > 0 && (
        <div className="history-log">
          <h6>Riwayat Progress</h6>
          {/* Urutkan dari terbaru ke terlama */}
          {[...item.progressHistory].reverse().map((log) => (
            <div key={log.id} className="log-entry">
              <div className="log-details">
                <p className="log-stage-time">
                  <strong>{log.stage}</strong> ({formatDate(log.created_at)})
                </p>
                {log.notes && <p className="log-notes">{log.notes}</p>}
              </div>
              {log.photo_url && (
                <Button
                  variant="secondary"
                  style={{ marginLeft: '10px' }}
                  onClick={() => handleViewPhoto(log.photo_url!)}
                  className="view-photo-btn"
                >
                  Lihat Foto
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// --- Komponen Halaman Utama ---
interface UpdateProgressPageProps {
  po: POHeader | null // PO yang dipilih untuk diupdate
  onBack: () => void // Callback untuk kembali
  onProgressSaved: () => void // <-- Prop baru ditambahkan di sini
}

const UpdateProgressPage: React.FC<UpdateProgressPageProps> = ({ po, onBack, onProgressSaved }) => {
  const [items, setItems] = useState<POItem[]>([]) // State untuk menyimpan detail item PO
  const [isLoading, setIsLoading] = useState(true) // State loading untuk fetch item

  // Fungsi untuk mengambil detail item PO (termasuk history & deadlines)
  const fetchItems = useCallback(async () => {
    if (!po?.id) {
      console.log('fetchItems skipped, no PO selected.')
      setItems([]) // Kosongkan item jika tidak ada PO
      setIsLoading(false) // Pastikan loading berhenti
      return
    }
    console.log(`Fetching items with details for PO ID: ${po.id}`)
    setIsLoading(true)
    try {
      const fetchedItems: POItem[] = await apiService.getPOItemsWithDetails(po.id)
      // Validasi hasil fetch
      if (Array.isArray(fetchedItems)) {
        setItems(fetchedItems)
        console.log(`Fetched ${fetchedItems.length} items successfully.`)
      } else {
        console.error('getPOItemsWithDetails did not return an array:', fetchedItems)
        setItems([])
        alert('Gagal memuat detail item: Format data tidak sesuai.')
      }
    } catch (err) {
      console.error('Gagal memuat detail item PO:', err)
      alert(`Gagal memuat detail item PO: ${(err as Error).message}`)
      setItems([]) // Kosongkan jika error
    } finally {
      setIsLoading(false) // Selesai loading
    }
  }, [po]) // Bergantung pada 'po' yang dipilih

  // Panggil fetchItems saat komponen mount atau saat 'po' berubah
  useEffect(() => {
    fetchItems()
  }, [fetchItems]) // fetchItems sudah di-memoize dengan useCallback

  // Handler yang akan dipanggil oleh ProgressItem setelah update berhasil
  const handleItemUpdateSuccess = () => {
    // 1. Refresh data item di halaman ini
    fetchItems()
    // 2. Panggil callback onProgressSaved untuk memberi tahu App.tsx agar refresh list PO
    onProgressSaved()
  }

  // Tampilan jika tidak ada PO terpilih
  if (!po) {
    return (
      <div className="page-container center-content">
        {' '}
        {/* Class untuk styling */}
        <Card>
          <p>Silakan pilih Purchase Order dari halaman Tracking terlebih dahulu.</p>
          <Button onClick={onBack} style={{ marginTop: '1rem' }}>
            Kembali ke Tracking
          </Button>
        </Card>
      </div>
    )
  }

  // Tampilan utama halaman
  return (
    <div className="page-container update-progress-page">
      {' '}
      {/* Class spesifik */}
      <div className="page-header">
        <div>
          <h1>Update Progress: PO {po.po_number || 'N/A'}</h1>
          <p>Customer: {po.project_name || 'N/A'}</p>
        </div>
        <Button onClick={onBack} variant="secondary">
          {' '}
          {/* Ganti variant */}
          Kembali ke Daftar Tracking
        </Button>
      </div>
      {/* Tampilan Loading atau Daftar Item */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>Memuat detail item PO...</div>
      ) : items.length > 0 ? (
        <div className="items-list-container">
          {' '}
          {/* Wrapper untuk item cards */}
          {items.map((item) => (
            <ProgressItem
              key={item.id}
              item={item}
              poId={po.id}
              poNumber={po.po_number || 'N/A'}
              // Kirim handler baru ini ke ProgressItem
              onUpdate={handleItemUpdateSuccess}
            />
          ))}
        </div>
      ) : (
        // Tampilan jika tidak ada item
        <Card style={{ textAlign: 'center', padding: '2rem' }}>
          <p>Tidak ada item yang ditemukan untuk PO ini pada revisi terbaru.</p>
          <p>Ini bisa terjadi jika PO baru saja dibuat tanpa item, atau ada masalah data.</p>
        </Card>
      )}
    </div>
  )
}

export default UpdateProgressPage
