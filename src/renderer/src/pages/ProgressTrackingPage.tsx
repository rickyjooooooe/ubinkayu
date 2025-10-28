// file: src/renderer/src/pages/ProgressTrackingPage.tsx

/* eslint-disable @typescript-eslint/ban-ts-comment */
import React, { useState, useEffect, useMemo } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ProgressBar } from '../components/ProgressBar'
import { POHeader } from '../types' // Pastikan tipe ini ada di types.ts
import { formatDistanceToNow } from 'date-fns'
import { id } from 'date-fns/locale'
import * as apiService from '../apiService'

// Helper untuk format waktu "5 menit yang lalu"
const formatTimeAgo = (dateString: string | undefined | null): string => {
  if (!dateString) return '-'
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true, locale: id })
  } catch (error) {
    console.error('Error formatting time ago:', error)
    return String(dateString) // Kembalikan string asli jika error
  }
}

// Komponen untuk menampilkan satu PO (aktif atau selesai)
const POTrackingItem = ({
  po,
  onUpdateClick // Nama prop tetap sama
}: {
  po: POHeader
  onUpdateClick: (po: POHeader) => void
}) => {
  const getPriorityBadgeClass = (priority?: string) =>
    `status-badge priority-${(priority || 'normal').toLowerCase()}` // Tambahkan prefix 'priority-'

  // Tambah class untuk PO Selesai (opsional, untuk styling)
  const cardClassName = `po-tracking-item-card ${po.progress && po.progress >= 100 ? 'completed' : ''}`

  return (
    <Card className={cardClassName}>
      <div className="po-tracking-header">
        <div>
          <span className="po-tracking-number">{po.po_number || 'N/A'}</span>
          <p className="po-tracking-customer">{po.project_name || 'N/A'}</p>
        </div>
        <span className={getPriorityBadgeClass(po.priority)}>{po.priority || 'Normal'}</span>
      </div>
      <div className="po-tracking-progress">
        <span>Progress</span>
        {/* Tambah ikon centang jika selesai */}
        <span>
          {po.progress && po.progress >= 100 ? '✅ ' : ''}
          {po.progress?.toFixed(0) || 0}%
        </span>
      </div>
      <ProgressBar value={po.progress || 0} />
      <div className="po-tracking-footer">
        <div className="po-tracking-deadline">
          <span>
            Target:{' '}
            {po.deadline
              ? new Date(po.deadline).toLocaleDateString('id-ID', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric'
                })
              : '-'}
          </span>
        </div>
        {/* Tombol tetap ada, ganti teks jika sudah selesai */}
        <Button onClick={() => onUpdateClick(po)}>
          {po.progress && po.progress >= 100 ? 'Lihat Progress' : 'Update Progress'}
        </Button>
      </div>
    </Card>
  )
}

// Komponen untuk panel "Perlu Perhatian"
const AttentionCard = ({ title, items, icon, reasonKey, reasonPrefix }) => (
  <div className="attention-section">
    <h5>
      {icon} {title} ({items?.length || 0})
    </h5>
    {items && items.length > 0 ? (
      items.map((item, index) => (
        <div key={index} className="attention-item-small">
          <p>
            <strong>{item.item_name || 'N/A'}</strong> (PO: {item.po_number || 'N/A'})
          </p>
          <span>
            {reasonPrefix}:{' '}
            {reasonKey === 'deadline' || reasonKey === 'last_update'
              ? formatTimeAgo(item[reasonKey]) // Format tanggal/waktu
              : item[reasonKey] || '-'}
          </span>
        </div>
      ))
    ) : (
      <p className="no-attention-text">Tidak ada</p>
    )}
  </div>
)

// Komponen untuk menampilkan satu entri update terbaru
const UpdateEntry = ({ update }) => (
  <div className="update-entry">
    <div className="update-icon">⚙️</div>
    <div className="update-details">
      <p className="update-text">
        Item <strong>{update.item_name || 'N/A'}</strong> (PO: {update.po_number || 'N/A'}) masuk
        tahap <strong>{update.stage || '?'}</strong>.
      </p>
      <span className="update-time">{formatTimeAgo(update.created_at)}</span>
    </div>
  </div>
)

// Definisikan Interface Props
interface ProgressTrackingPageProps {
  onSelectPO: (po: POHeader) => void
  poList: POHeader[] // Terima poList dari App.tsx
  isLoadingPOs: boolean // Terima status loading PO dari App.tsx
}

const ProgressTrackingPage: React.FC<ProgressTrackingPageProps> = ({
  onSelectPO,
  poList, // Gunakan prop ini
  isLoadingPOs // Gunakan prop ini
}) => {
  // State HANYA untuk data panel kanan (Perhatian & Update Terbaru) dan search
  const [attentionData, setAttentionData] = useState({
    nearingDeadline: [],
    stuckItems: [],
    urgentItems: []
  })
  const [recentUpdates, setRecentUpdates] = useState<any[]>([])
  const [isSidePanelLoading, setIsSidePanelLoading] = useState(true) // Loading untuk panel kanan
  const [searchTerm, setSearchTerm] = useState('')

  // useEffect HANYA untuk fetch data panel kanan
  useEffect(() => {
    const fetchSidePanelData = async () => {
      setIsSidePanelLoading(true) // Mulai loading panel kanan
      try {
        // Panggil API untuk attention dan updates
        // @ts-ignore - Asumsi tipe data attention & updates dari API service
        const [attention, updates] = await Promise.all([
          apiService.getAttentionData(),
          apiService.getRecentProgressUpdates() // Fetch update terbaru
        ])
        setAttentionData(attention || { nearingDeadline: [], stuckItems: [], urgentItems: [] }) // Default jika null
        setRecentUpdates(updates || []) // Default jika null
      } catch (err) {
        console.error('Gagal memuat data panel kanan (attention/updates):', err)
        // Set state error jika perlu (misalnya dengan state baru `sidePanelError`)
      } finally {
        setIsSidePanelLoading(false) // Selesai loading panel kanan
      }
    }
    fetchSidePanelData()
  }, []) // Hanya berjalan sekali saat komponen mount

  // useMemo untuk memisahkan dan memfilter PO Aktif dan Selesai
  const { activePOs, completedPOs } = useMemo(() => {
    if (!Array.isArray(poList)) return { activePOs: [], completedPOs: [] } // Pengaman jika poList bukan array

    // Pisahkan dulu berdasarkan progress
    const allActive = poList.filter((po) => (po.progress || 0) < 100 && po.status !== 'Cancelled')
    const allCompleted = poList.filter(
      (po) => (po.progress || 0) >= 100 && po.status !== 'Cancelled'
    )

    // Terapkan filter pencarian ke kedua grup jika ada searchTerm
    if (!searchTerm) {
      return { activePOs: allActive, completedPOs: allCompleted }
    }

    const lowerSearchTerm = searchTerm.toLowerCase()
    // Fungsi filter umum
    const filterFn = (po: POHeader) =>
      po.po_number?.toLowerCase().includes(lowerSearchTerm) ||
      po.project_name?.toLowerCase().includes(lowerSearchTerm)

    return {
      activePOs: allActive.filter(filterFn),
      completedPOs: allCompleted.filter(filterFn)
    }
  }, [poList, searchTerm]) // Bergantung pada prop poList dan state searchTerm

  return (
    <div className="page-container tracking-page-padding">
      {' '}
      {/* Tambah class padding */}
      <div className="page-header">
        <div>
          <h1>Tracking Progress Produksi</h1>
          <p>Pantau dan update kemajuan pengerjaan Purchase Order</p>
        </div>
        {/* Opsional: Tombol refresh jika diperlukan */}
      </div>
      {/* Input Pencarian */}
      <Card className="filter-panel-simple">
        <input
          type="text"
          placeholder="Cari Nomor PO atau Nama Customer..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input-full"
        />
      </Card>
      {/* Layout Utama (Grid 2 Kolom) */}
      <div className="tracking-layout">
        {/* --- Kolom Kiri: Daftar PO --- */}
        <div className="po-list-column">
          {' '}
          {/* Ganti nama class agar lebih deskriptif */}
          {/* Bagian PO Aktif */}
          <Card>
            <h3>PO Aktif ({isLoadingPOs ? '...' : activePOs.length})</h3>
            {isLoadingPOs ? (
              <p style={{ textAlign: 'center', padding: '2rem' }}>Memuat daftar PO...</p>
            ) : activePOs.length > 0 ? (
              <div className="po-tracking-list-wrapper">
                {activePOs.map((po) => (
                  <POTrackingItem
                    key={`active-${po.id || po.po_number}`}
                    po={po}
                    onUpdateClick={onSelectPO}
                  />
                ))}
              </div>
            ) : searchTerm ? (
              <p style={{ textAlign: 'center', padding: '2rem' }}>
                Tidak ada PO aktif yang cocok dengan "{searchTerm}".
              </p>
            ) : (
              <p style={{ textAlign: 'center', padding: '2rem' }}>Tidak ada PO aktif saat ini.</p>
            )}
          </Card>
          {/* Bagian PO Selesai */}
          {/* Tampilkan jika tidak loading DAN (ada PO selesai ATAU sedang mencari) */}
          {!isLoadingPOs && (completedPOs.length > 0 || searchTerm) && (
            <Card style={{ marginTop: '1.5rem' }}>
              {' '}
              {/* Beri jarak atas */}
              <h3>PO Selesai ({completedPOs.length})</h3>
              {completedPOs.length > 0 ? (
                <div className="po-tracking-list-wrapper completed-list">
                  {' '}
                  {/* Class berbeda? */}
                  {completedPOs.map((po) => (
                    // Gunakan komponen yang sama, event handler tetap onSelectPO
                    <POTrackingItem
                      key={`completed-${po.id || po.po_number}`}
                      po={po}
                      onUpdateClick={onSelectPO}
                    />
                  ))}
                </div>
              ) : (
                // Tampil hanya jika ada searchTerm tapi tidak ada hasil
                searchTerm && (
                  <p style={{ textAlign: 'center', padding: '2rem' }}>
                    Tidak ada PO selesai yang cocok dengan "{searchTerm}".
                  </p>
                )
                // Jika tidak ada search term dan tidak ada PO selesai, bagian ini tidak tampil (atau tampilkan pesan default jika mau)
              )}
            </Card>
          )}
        </div>{' '}
        {/* Akhir .po-list-column */}
        {/* --- Kolom Kanan: Perhatian & Update Terbaru --- */}
        <div className="side-panel-column">
          {' '}
          {/* Ganti nama class */}
          {/* Kartu Perhatian */}
          <Card className="side-panel-card attention-combined-card">
            {' '}
            {/* Ganti nama class */}
            <h4>🚨 Perlu Perhatian</h4>
            {isSidePanelLoading ? (
              <p style={{ textAlign: 'center', padding: '1rem' }}>Memuat data perhatian...</p>
            ) : (
              <div className="attention-wrapper">
                <AttentionCard
                  title="Prioritas Urgent"
                  items={attentionData.urgentItems}
                  icon="🔥"
                  reasonKey="current_stage"
                  reasonPrefix="Tahap"
                />
                <AttentionCard
                  title="Mendekati Deadline"
                  items={attentionData.nearingDeadline}
                  icon="📅"
                  reasonKey="deadline"
                  reasonPrefix="Target"
                />
                <AttentionCard
                  title="Item Macet (> 5 Hari)"
                  items={attentionData.stuckItems}
                  icon="⏳"
                  reasonKey="last_update"
                  reasonPrefix="Update"
                />
              </div>
            )}
          </Card>
          {/* Kartu Update Terbaru */}
          <Card className="side-panel-card" style={{ marginTop: '1.5rem' }}>
            {' '}
            {/* Ganti nama class */}
            <h4>Update Terbaru</h4>
            {isSidePanelLoading ? (
              <p style={{ textAlign: 'center', padding: '1rem' }}>Memuat aktivitas terbaru...</p>
            ) : recentUpdates.length > 0 ? (
              <div className="updates-list">
                {recentUpdates.map((update) => (
                  <UpdateEntry key={update.id} update={update} />
                ))}
              </div>
            ) : (
              <p className="no-updates-text">Belum ada update progress terbaru.</p>
            )}
          </Card>
        </div>{' '}
        {/* Akhir .side-panel-column */}
      </div>{' '}
      {/* Akhir .tracking-layout */}
    </div>
  )
}

export default ProgressTrackingPage
