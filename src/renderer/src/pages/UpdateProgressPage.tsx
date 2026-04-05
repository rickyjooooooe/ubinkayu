/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { POHeader, POItem, ProductionStage, User } from '../types' // Pastikan User diimpor
import * as apiService from '../apiService'

// --- Helper Format Tanggal ---
const formatDate = (d: string | undefined | null): string => {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    })
  } catch { return String(d) }
}
const formatDeadlineForInput = (isoString: string | undefined | null): string => {
  if (!isoString) return ''
  try {
    return new Date(isoString).toISOString().split('T')[0]
  } catch { return '' }
}
// [DIHAPUS] formatApprovalDate dan ApprovalStatus dihapus

// Tahapan Produksi
const STAGES: ProductionStage[] = [
  'Cari Bahan Baku', 'Sawmill', 'KD', 'Pembahanan', 'Moulding', 'Coating', 'Siap Kirim'
]

// [DIHAPUS] Komponen ApprovalWorkflow dihapus

// --- Komponen ProgressItem (Untuk Produksi) ---
const ProgressItem = ({
  item,
  orderId,
  orderNumber,
  onUpdate,
  currentUser
}: {
  item: POItem
  orderId: string
  orderNumber: string
  onUpdate: () => void
  currentUser: User | null
}) => {
  const isElectron = !!(window as any).api

  // [LOGIKA PERAN] Tentukan apakah user adalah marketing
  const isMarketingRole = currentUser?.role?.toLowerCase() === 'marketing';

  const latestLog = item.progressHistory?.[item.progressHistory.length - 1]
  const latestStage = latestLog?.stage
  const currentStageIndex = latestStage ? STAGES.indexOf(latestStage) : -1

  const [notes, setNotes] = useState('')
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [photoBase64, setPhotoBase64] = useState<string | null>(null)
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false)
  const [editableDeadlines, setEditableDeadlines] = useState(item.stageDeadlines || [])

  const futureStages = STAGES.slice(currentStageIndex + 1)
  const [selectedStage, setSelectedStage] = useState<string>(futureStages[0] || '')

  useEffect(() => {
     const newCurrentIndex = latestStage ? STAGES.indexOf(latestStage) : -1;
     const newFutureStages = STAGES.slice(newCurrentIndex + 1);
     setSelectedStage(newFutureStages[0] || '');
  }, [latestStage]);

  const handleDeadlineChange = (stageName: string, newDate: string) => {
    if (!newDate || stageName !== 'Siap Kirim') return
    const newDeadlineISO = new Date(newDate).toISOString()
    const updatedDeadlines = editableDeadlines.map((d) =>
      d.stageName === stageName ? { ...d, deadline: newDeadlineISO } : d
    )
    setEditableDeadlines(updatedDeadlines)

    apiService
      .updateStageDeadline({ orderId, itemId: item.id, stageName, newDeadline: newDeadlineISO })
      .catch((err) => {
        alert(`Gagal menyimpan deadline baru: ${err.message}`)
        setEditableDeadlines(item.stageDeadlines || [])
      })
  }

  const handleViewPhoto = (url: string) => {
    if (url) {
      apiService.openExternalLink(url).catch((err) => console.error('Failed to open link:', err))
    }
  }

  const handleSelectPhoto = async () => {
    if (isElectron) {
      try {
        const selectedPath = await apiService.openFileDialog()
        if (selectedPath) {
          setPhotoPath(selectedPath)
          setPhotoName(selectedPath.split(/[/\\]/).pop() || selectedPath)
          setPhotoBase64(null)
        }
      } catch (err) {
        console.error('Error opening file dialog:', err)
        alert('Gagal membuka dialog file.')
      }
    } else {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) {
          setPhotoName(file.name)
          const reader = new FileReader()
          reader.onload = (readerEvent) => {
            const base64String = readerEvent.target?.result as string
            setPhotoBase64(base64String.includes(',') ? base64String.split(',')[1] : base64String)
            setPhotoPath(null)
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

  const sendSingleProgressUpdate = async (stage: string, updateNotes: string, updatePhotoPath: string | null, updatePhotoBase64: string | null) => {
    const payload = {
      orderId: orderId,
      itemId: item.id,
      orderNumber: orderNumber,
      stage: stage,
      notes: updateNotes,
      photoPath: isElectron ? updatePhotoPath : null,
      photoBase64: !isElectron ? updatePhotoBase64 : null
    };
    // @ts-ignore
    const result = await apiService.updateItemProgress(payload);
    // @ts-ignore
    if (!result.success) {
      // @ts-ignore
      throw new Error(result.error || `Gagal menyimpan progress tahap '${stage}'.`);
    }
  };

  const handleUpdate = async () => {
    const stageToUpdate = selectedStage;
    if (!stageToUpdate) return alert('Tahap tidak valid.');

    const targetStageIndex = STAGES.indexOf(stageToUpdate as ProductionStage);

    if (targetStageIndex <= currentStageIndex) {
      return alert('Tahap yang dipilih harus setelah tahap saat ini.');
    }

    setIsUpdating(true);
    try {
      // 1. Simpan progress untuk tahap-tahap yang di-skip
      for (let i = currentStageIndex + 1; i < targetStageIndex; i++) {
        await sendSingleProgressUpdate(STAGES[i], 'Tahap dilewati (skipped)', null, null);
      }

      // 2. Simpan progress untuk tahap tujuan
      const isSkipping = targetStageIndex > currentStageIndex + 1;
      const finalNotes = isSkipping ? (notes || 'Tahap dilewati (skipped)') : notes.trim();
      const finalPhotoPath = isSkipping ? null : photoPath;
      const finalPhotoBase64 = isSkipping ? null : photoBase64;

      await sendSingleProgressUpdate(stageToUpdate, finalNotes, finalPhotoPath, finalPhotoBase64);

      alert(`Progress item ${item.product_name} berhasil diupdate ke tahap '${stageToUpdate}'!`);
      onUpdate(); // Panggil refresh
      setNotes('');
      setPhotoPath(null);
      setPhotoBase64(null);
      setPhotoName(null);
    } catch (err) {
      alert(`Gagal update progress: ${(err as Error).message}`);
    } finally {
      setIsUpdating(false);
    }
  };


  return (
    <Card className="item-card progress-item-card">
      <div className="item-card-header">
        <h4>
          {item.product_name || 'Nama Produk ?'} ({item.wood_type || 'Kayu ?'})
        </h4>
        <span>
          Qty: {item.quantity || '?'} {item.satuan || '?'}
        </span>
      </div>

      <div className="timeline-container">
        <div className="progress-timeline">
          {STAGES.map((stage, index) => {
            const deadlineInfo = editableDeadlines.find((d) => d.stageName === stage)
            const isCompleted = index <= currentStageIndex
            const isOverdue =
              deadlineInfo?.deadline && new Date() > new Date(deadlineInfo.deadline) && !isCompleted
            // Marketing tidak bisa edit deadline
            const isEditable = stage === 'Siap Kirim' && !isMarketingRole
            return (
              <div
                key={stage}
                className={`stage ${isCompleted ? 'completed' : ''} ${isOverdue ? 'overdue' : ''}`}
                title={isOverdue ? `Target terlewat: ${formatDate(deadlineInfo?.deadline)}` : ''}
              >
                <div className="stage-dot"></div>
                <div className="stage-name">{stage}</div>
                {deadlineInfo?.deadline && (
                  <div className={`stage-deadline ${isEditable ? 'editable' : ''}`}>
                    <label htmlFor={`deadline-${item.id}-${stage}`}>Target:</label>
                    <input
                      id={`deadline-${item.id}-${stage}`}
                      type="date"
                      value={formatDeadlineForInput(deadlineInfo.deadline)}
                      onChange={(e) => handleDeadlineChange(stage, e.target.value)}
                      disabled={!isEditable || isUpdating}
                      title={isEditable ? 'Ubah target tanggal kirim' : `Target: ${formatDate(deadlineInfo.deadline)}`}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* [LOGIKA PERAN] Tampilkan form HANYA jika belum selesai */}
      {currentStageIndex < STAGES.length - 1 && !isMarketingRole && (
        <div className="update-form">
          <h5>{isMarketingRole ? 'Form Update (Hanya Lihat)' : 'Update Progress Item'}</h5>
          <div className="form-group">
            <label htmlFor={`stage-select-${item.id}`}>Pilih Tahap Berikutnya:</label>
            <select
              id={`stage-select-${item.id}`}
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              disabled={isUpdating || isMarketingRole} // <-- Di-disable jika marketing
            >
              {futureStages.length === 0 && <option value="">-- Selesai --</option>}
              {futureStages.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={isMarketingRole ? "Mode hanya lihat untuk Marketing" : "Tambahkan catatan progress (opsional)..."}
            rows={3}
            disabled={isUpdating || isMarketingRole} // <-- Di-disable jika marketing
          />
          <div className="photo-upload-section">
            <Button
              variant="secondary"
              onClick={handleSelectPhoto}
              disabled={isUpdating || isMarketingRole} // <-- Di-disable jika marketing
              className="select-photo-btn"
            >
              {photoName ? `✅ Ganti Foto (${photoName})` : '📷 Unggah Foto (Opsional)'}
            </Button>
            {photoName && (
              <Button
                variant="danger-text"
                onClick={() => {
                  setPhotoPath(null)
                  setPhotoBase64(null)
                  setPhotoName(null)
                }}
                disabled={isUpdating || isMarketingRole} // <-- Di-disable jika marketing
                style={{ marginLeft: '10px' }}
              >
                Hapus
              </Button>
            )}
          </div>
          <Button
            onClick={() => handleUpdate(selectedStage)}
            disabled={isUpdating || !selectedStage || isMarketingRole} // <-- Di-disable jika marketing
            className="save-progress-btn"
          >
            {isUpdating ? 'Menyimpan...' : `Simpan Progress ke ${selectedStage}`}
          </Button>
        </div>
      )}

      {/* Riwayat Progress (Tetap Tampil untuk semua peran) */}
      {item.progressHistory && item.progressHistory.length > 0 && (
        <div className="history-log">
          <h6>Riwayat Progress</h6>
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
  order: POHeader | null;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  currentUser: User | null;
}

const UpdateProgressPage: React.FC<UpdateProgressPageProps> = ({ order, onBack, onRefresh, currentUser }) => {
  const [items, setItems] = useState<POItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fungsi untuk mengambil item-item PO
  const fetchItems = useCallback(async () => {
    // [DIUBAH] Fetch item selama statusnya BUKAN 'Waiting for Approval'
    if (order?.id && order.status !== 'Waiting for Approval') {
      console.log(`Fetching items with details for PO ID: ${order.id}`)
      setIsLoading(true);
      try {
        // @ts-ignore
        const fetchedItems: POItem[] = await apiService.getorderItemsWithDetails(order.id);
        if (Array.isArray(fetchedItems)) {
          setItems(fetchedItems);
          console.log(`Fetched ${fetchedItems.length} items successfully.`)
        } else {
          console.error('getorderItemsWithDetails did not return an array:', fetchedItems)
          setItems([])
          alert('Gagal memuat detail item: Format data tidak sesuai.')
        }
      } catch (err) {
        console.error('Gagal memuat detail item PO:', err);
        alert(`Gagal memuat detail item PO: ${(err as Error).message}`);
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    } else {
      console.log(`Skipping item fetch for PO ${order?.id} with status ${order?.status}`);
      setItems([]);
      setIsLoading(false);
    }
  }, [order]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleItemUpdateSuccess = () => {
    fetchItems();
    onRefresh();
  }

  if (!order) {
    return (
      <div className="page-container center-content">
        <Card>
          <p>Silakan pilih Order dari halaman Tracking terlebih dahulu.</p>
          <Button onClick={onBack} style={{ marginTop: '1rem' }}>
            Kembali ke Tracking
          </Button>
        </Card>
      </div>
    );
  }

  // [DIHAPUS] Logika renderPageContent dihapus, karena kita selalu ingin menampilkan timeline
  // (Logika persetujuan sudah tidak ada)

  return (
    <div className="page-container update-progress-page">
      <div className="page-header">
        <div>
          <h1>
            {/* [DIUBAH] Judul disederhanakan */}
            Update Progress: Order {order.order_number}
          </h1>
          <p>Customer: {order.project_name}</p>
        </div>
        <Button onClick={onBack} variant="secondary">
          Kembali
        </Button>
      </div>

      {/* Selalu tampilkan timeline produksi */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>Memuat detail item PO...</div>
      ) : items.length > 0 ? (
        <div className="items-list-container">
          {items.map((item) => (
            <ProgressItem
              key={item.id}
              item={item}
              orderId={order.id}
              orderNumber={order.order_number || 'N/A'}
              onUpdate={handleItemUpdateSuccess}
              currentUser={currentUser} // Teruskan currentUser
            />
          ))}
        </div>
      ) : (
        <Card style={{ textAlign: 'center', padding: '2rem' }}>
          <p>Tidak ada item yang ditemukan untuk Order ini pada revisi terbaru.</p>
        </Card>
      )}
    </div>
  );
};

export default UpdateProgressPage;