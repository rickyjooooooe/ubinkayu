// file: src/renderer/pages/PODetailPage.tsx

/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import React, { useState, useEffect } from 'react';
import { POHeader, POItem, PORevision, RevisionHistoryItem, ProductionStage } from '../types'; // Impor semua tipe yang relevan
import * as apiService from '../apiService';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar'; // Pastikan ProgressBar diimpor

// --- Helper Functions ---

// 1. Fungsi Perbandingan Revisi
interface ComparisonResult {
  headerChanges: string[];
  added: POItem[];
  removed: POItem[];
  modified: {
    item: POItem;
    changes: string[];
  }[];
}

const findHeaderChanges = (current: PORevision, previous: PORevision): string[] => {
  const changes: string[] = [];
  const fieldLabels: { [key in keyof PORevision]?: string } = {
    project_name: 'Customer',
    priority: 'Prioritas',
    deadline: 'Deadline',
    notes: 'Catatan',
    marekting: 'Marketing',
    alamat_kirim: 'Alamat Kirim' // <-- Ensure this is present
  };

  for (const key in fieldLabels) {
    const field = key as keyof PORevision;
    const currentValue = current[field] || '';
    const previousValue = previous[field] || '';
    if (currentValue !== previousValue) {
      changes.push(
        `${fieldLabels[field]}: "${previousValue || 'Kosong'}" → "${currentValue || 'Kosong'}"`
      );
    }
  }
  return changes;
};

const generateItemKey = (item: POItem): string => {
  // Kunci sebaiknya berdasarkan atribut yang relatif stabil
  return `${item.product_name}-${item.wood_type}-${item.profile}-${item.thickness_mm}x${item.width_mm}x${item.length_mm}`;
};

const findItemChanges = (newItem: POItem, oldItem: POItem): string[] => {
  const changes: string[] = [];
  const fieldsToCompare: (keyof POItem)[] = [
    'color', 'finishing', 'sample', 'quantity', 'satuan', 'notes', 'location'
  ]; // Field yang ingin dilacak perubahannya

  fieldsToCompare.forEach((field) => {
    const newValue = newItem[field] || '';
    const oldValue = oldItem[field] || '';
    if (newValue !== oldValue) {
      const fieldLabel = field.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
      changes.push(`${fieldLabel}: "${oldValue || ''}" → "${newValue || ''}"`);
    }
  });
  return changes;
};

const compareRevisions = (
  current: RevisionHistoryItem, // Revisi yang LEBIH BARU
  previous: RevisionHistoryItem // Revisi yang LEBIH LAMA
): ComparisonResult => {
  const headerChanges = findHeaderChanges(current.revision, previous.revision);

  // Gunakan ID item jika konsisten antar revisi, jika tidak gunakan generateItemKey
  // Asumsi ID item unik per baris di sheet `order_items`
  const currentItemsMap = new Map(current.items.map(item => [item.id, item]));
  const previousItemsMap = new Map(previous.items.map(item => [item.id, item]));

  const added: POItem[] = [];
  const removed: POItem[] = [];
  const modified: { item: POItem; changes: string[] }[] = [];

  currentItemsMap.forEach((currentItem, itemId) => {
    if (!previousItemsMap.has(itemId)) {
      // Jika ID tidak ada di revisi sebelumnya, cek berdasarkan generateItemKey
      const itemKey = generateItemKey(currentItem);
      const matchedOldItem = previous.items.find(oldItem => generateItemKey(oldItem) === itemKey);
      if (!matchedOldItem) {
          added.push(currentItem); // Benar-benar item baru
      } else {
          // Item dengan spesifikasi dasar sama tapi ID berbeda (mungkin dihapus lalu ditambah lagi)
          // Anggap sebagai modifikasi
          const itemChanges = findItemChanges(currentItem, matchedOldItem);
          if (itemChanges.length > 0) {
              modified.push({ item: currentItem, changes: itemChanges });
          }
      }
    } else {
      // Item dengan ID sama ditemukan, cek perubahan field
      const previousItem = previousItemsMap.get(itemId)!;
      const itemChanges = findItemChanges(currentItem, previousItem);
      if (itemChanges.length > 0) {
        modified.push({ item: currentItem, changes: itemChanges });
      }
    }
  });

  previousItemsMap.forEach((previousItem, itemId) => {
    if (!currentItemsMap.has(itemId)) {
       // Cek apakah item ini 'muncul lagi' di revisi baru dengan ID berbeda
       const itemKey = generateItemKey(previousItem);
       const matchedNewItem = current.items.find(newItem => generateItemKey(newItem) === itemKey);
       if (!matchedNewItem) {
           removed.push(previousItem); // Benar-benar dihapus
       }
       // Jika ada matchedNewItem, perubahan sudah ditangani di loop currentItemsMap
    }
  });


  return { headerChanges, added, removed, modified };
};


const formatItemDescription = (item: POItem): string => {
  const parts = [
    item.product_name || 'N/A',
    item.wood_type ? `(${item.wood_type})` : '',
    item.profile || '',
    item.color || '',
    item.finishing || '',
    item.sample ? `Sample:${item.sample}`: '',
    `${item.thickness_mm||0}x${item.width_mm||0}x${item.length_mm||0}mm (${item.length_type||'N/A'})`,
    item.notes ? `Notes:${item.notes}` : '',
    item.location ? `Loc:${item.location}` : ''
  ];
  return parts.filter(Boolean).join('; ');
};

// 2. Fungsi Format Tanggal & Badge
const formatDate = (d?: string | null): string =>
    d
      ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
      : '-';

const formatDateTime = (d?: string | null): string =>
      d
        ? new Date(d).toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour:'2-digit', minute:'2-digit', hour12: false })
        : '-';

const getPriorityBadgeClass = (p?: string): string => `status-badge ${(p || 'normal').toLowerCase()}`;

const getStatusBadgeClass = (s?: string): string =>
    `status-badge status-${(s || 'open').toLowerCase().replace(' ', '-')}`;

// 3. Konstanta Tahapan Produksi
const PRODUCTION_STAGES: ProductionStage[] = [
    'Cari Bahan Baku', 'Sawmill', 'KD', 'Pembahanan', 'Moulding', 'Coating', 'Siap Kirim'
];


// --- Komponen Utama ---

interface PODetailPageProps {
  order: POHeader | null; // PO Header TERBARU yang diterima dari App.tsx
  onBackToList: () => void;
}

const PODetailPage: React.FC<PODetailPageProps> = ({ order, onBackToList }) => {
  // State untuk item detail dari revisi TERBARU
  const [items, setItems] = useState<POItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // State untuk menyimpan data SEMUA revisi (termasuk itemnya)
  const [history, setHistory] = useState<RevisionHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);

  useEffect(() => {
    // Reset state saat PO berubah atau menjadi null
    setItems([]);
    setHistory([]);
    setIsLoading(true);
    setIsHistoryLoading(true);

    if (order?.id) {
      const fetchAllDetails = async () => {
        try {
          // Ambil data item terbaru (dengan progress & deadline) dan data histori revisi
          const [latestItemsData, historyData] = await Promise.all([
            apiService.GetOrderItemsWithDetails(order.id),
            apiService.getRevisionHistory(order.id)
          ]);

          // Validasi data (pastikan array)
          setItems(Array.isArray(latestItemsData) ? latestItemsData : []);
          setHistory(Array.isArray(historyData) ? historyData : []);

        } catch (error) {
          console.error(`Gagal memuat detail & histori PO ${order.id}:`, error);
          setItems([]); // Set kosong jika error
          setHistory([]); // Set kosong jika error
        } finally {
          setIsLoading(false);
          setIsHistoryLoading(false);
        }
      };
      fetchAllDetails();
    } else {
      // Jika order null, langsung set loading selesai
      setIsLoading(false);
      setIsHistoryLoading(false);
    }
  }, [order]); // Efek hanya bergantung pada objek 'order'

  // Fungsi untuk membuka link eksternal (PDF)
  const handleOpenFile = async (url?: string | null) => {
    // Gunakan URL yang diberikan (untuk revisi lama) atau URL dari PO terbaru
    const targetUrl = url || order?.pdf_link;
    if (!targetUrl) {
      alert('Link file PDF tidak ditemukan.');
      return;
    }
    // Cek sederhana apakah link valid
    if (!targetUrl.startsWith('http')) {
      alert(`Link file tidak valid atau error:\n${targetUrl}`);
      return;
    }
    try {
      // @ts-ignore : window.api might not exist in web environment
      const result = await apiService.openExternalLink(targetUrl);
      if (result && !result.success) { // Cek result jika ada
        throw new Error(result.error || 'Gagal membuka link via apiService.');
      }
    } catch (error) {
      console.error('Gagal membuka file:', error);
      alert(`Gagal membuka link file:\n${(error as Error).message}`);
    }
  };

  // --- Render ---

  // Tampilan jika data PO utama tidak ada
  if (!order) {
     return (
       <div className="page-container">
         <p>Data Order tidak ditemukan atau belum dipilih.</p>
         <Button onClick={onBackToList}>Kembali ke Daftar</Button>
       </div>
     );
  }

  // Tampilan utama
  return (
    <div className="page-container">
      {/* Header Halaman */}
      <div className="page-header">
        <div>
          <h1>Detail Order: {order.order_number || 'N/A'}</h1>
          <p>Menampilkan informasi terbaru dan riwayat revisi.</p>
        </div>
        <div className="header-actions">
          <Button onClick={onBackToList}>Kembali ke Daftar</Button>
          <Button onClick={() => handleOpenFile()}>📄 Buka File (Terbaru)</Button>
        </div>
      </div>

      {/* --- Bagian Detail Order Terbaru --- */}
      <div className="detail-order-info">
        {/* Card Ringkasan PO Terbaru */}
        <Card className="order-summary-card">
           <div className="order-summary-header">
             <h3 className="order-summary-order-number">PO: {order.order_number || 'N/A'}</h3>
             <span className={getStatusBadgeClass(order.status)}>{order.status || 'Open'}</span>
           </div>
           <p className="order-summary-customer">
             <strong>Customer:</strong> {order.project_name || 'N/A'}
           </p>
           <div className="order-summary-grid">
             <div className="info-item"> <label>Tgl Revisi Terbaru</label> <span>{formatDateTime(order.lastRevisedDate)}</span> </div>
             <div className="info-item"> <label>Direvisi Oleh</label> <span>{order.lastRevisedBy || '-'}</span> </div>
             <div className="info-item"> <label>Target Kirim</label> <span>{formatDate(order.deadline)}</span> </div>
             <div className="info-item"> <label>Prioritas</label> <span className={getPriorityBadgeClass(order.priority)}>{order.priority || '-'}</span> </div>
             <div className="info-item"> <label>Total Kubikasi</label> <span>{order.kubikasi_total ? `${Number(order.kubikasi_total).toFixed(3)} m³` : '0.000 m³'}</span> </div>
             <div className="info-item"> <label>Marketing</label> <span>{order.marekting || '-'}</span> </div>
             {/* <div className="info-item"> <label>Alamat Kirim</label> <span>{order.alamat_kirim || '-'}</span> </div> */}
           </div>
           <div className="order-summary-progress">
             <div className="progress-info"> <label>Progress Produksi Keseluruhan</label> <span>{order.progress?.toFixed(0) || 0}%</span> </div>
             <ProgressBar value={order.progress || 0} />
           </div>
        </Card>
        {/* Card Catatan PO Terbaru */}
        {order.notes && (
          <Card className="notes-card">
            <h4>Catatan PO (Terbaru)</h4>
            <p style={{ whiteSpace: 'pre-wrap' }}>{order.notes}</p> {/* pre-wrap untuk menjaga format spasi/baris baru */}
          </Card>
        )}
      </div>

      {/* Foto Referensi */}
      {(order as any).foto_link && (order as any).foto_link !== 'Tidak ada foto' && !(order as any).foto_link?.startsWith('ERROR') && (
        <Card style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h4 style={{ margin: 0 }}>📷 Foto Referensi</h4>
            <Button onClick={() => handleOpenFile((order as any).foto_link)}>
              🖼️ Lihat Foto Referensi
            </Button>
          </div>
        </Card>
      )}

      {/* --- Bagian Item Terbaru --- */}
      <div className="item-section-header">
        <h2>Daftar Item & Progressnya (Versi Terbaru - Revisi #{history[0]?.revision.revision_number ?? 'N/A'})</h2>
      </div>
      {isLoading ? (
        <p>⏳ Loading data item terbaru...</p>
      ) : items.length === 0 ? (
        <Card><p>Tidak ada item terdaftar untuk versi terbaru Order ini.</p></Card>
      ) : (
        <Card>
          <div className="table-responsive">
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
                    const latestStageLog = item.progressHistory?.slice().reverse().find(log => !log.stage.startsWith('DEADLINE_OVERRIDE')); // Cari log progress terakhir
                    const latestStage = latestStageLog?.stage;
                    const currentStageIndex = latestStage ? (PRODUCTION_STAGES as readonly string[]).indexOf(latestStage) : -1;
                    const itemProgress = currentStageIndex >= 0 ? ((currentStageIndex + 1) / PRODUCTION_STAGES.length) * 100 : 0;
                    return (
                      <tr key={item.id}>
                        <td>{index + 1}</td>
                        <td>
                          <div className="product-spec-cell">
                            <strong>{item.product_name || 'N/A'}</strong>
                            <span>Kayu: {item.wood_type || '-'} | Profil: {item.profile || '-'}</span>
                            <span>Warna: {item.color || '-'} | Finish: {item.finishing || '-'} | Sample: {item.sample || '-'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="size-qty-cell">
                            <span>{`${item.thickness_mm || 0}x${item.width_mm || 0}x${item.length_mm || 0} mm`} ({item.length_type || 'N/A'})</span>
                            <strong>{`${item.quantity || 0} ${item.satuan || ''}`}</strong>
                          </div>
                        </td>
                        <td><strong>{Number(item.kubikasi || 0).toFixed(4)} m³</strong></td>
                        <td>
                          <div className="notes-location-cell">
                            <span>Lokasi: {item.location || '-'}</span>
                            <p style={{ whiteSpace: 'pre-wrap' }}>{item.notes || '-'}</p>
                          </div>
                        </td>
                        <td>
                          <div className="item-progress-cell">
                            <span>{latestStage || 'Belum Mulai'} ({itemProgress.toFixed(0)}%)</span>
                            <ProgressBar value={itemProgress} />
                            {latestStageLog && <span style={{fontSize: '0.75em', color: '#777'}}>Update: {formatDateTime(latestStageLog.created_at)}</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* --- Bagian Riwayat Revisi --- */}
      <div className="item-section-header" style={{ marginTop: '2.5rem', borderTop: '1px solid #e0e0e0', paddingTop: '1.5rem' }}>
        <h2>Riwayat Revisi Sebelumnya</h2>
      </div>
      {isHistoryLoading ? (
        <p>⏳ Memuat riwayat revisi...</p>
      ) : history.length <= 1 ? (
         <Card><p>Tidak ada riwayat revisi sebelumnya untuk Order ini.</p></Card>
      ) : (
        // Loop mulai dari index 1 untuk melewati revisi terbaru
        history.slice(1).map((revItem, indexInSlice) => {
          const currentHistoryIndex = indexInSlice + 1; // Index di array history asli
          const nextRevisionInHistory = history[currentHistoryIndex - 1]; // Revisi setelahnya (lebih baru)
          const changes = nextRevisionInHistory ? compareRevisions(nextRevisionInHistory, revItem) : null; // Bandingkan revItem (lama) dengan yg LEBIH BARU
          const hasChanges =
            changes &&
            (changes.headerChanges.length > 0 ||
              changes.added.length > 0 ||
              changes.removed.length > 0 ||
              changes.modified.length > 0);

          return (
            <Card key={revItem.revision.revision_number} className="revision-history-card" style={{ marginBottom: '1.5rem' }}>
              {/* Header Revisi */}
              <div className="revision-header">
                <div className="revision-title-group">
                  <h3>Revisi #{revItem.revision.revision_number}</h3>
                </div>
                <div className="revision-actions-group">
                  <span>Dibuat: {formatDateTime(revItem.revision.created_at)}</span>
                  {revItem.revision.revised_by && (
                    <span className="reviser-info">
                      <strong>Oleh:</strong> {revItem.revision.revised_by}
                    </span>
                  )}
                  {revItem.revision.pdf_link && revItem.revision.pdf_link.startsWith('http') && (
                    <Button onClick={() => handleOpenFile(revItem.revision.pdf_link)}>
                      📄 Buka File Revisi Ini
                    </Button>
                  )}
                </div>
              </div>

              {/* Detail Header Revisi INI */}
              <div className="revision-details">
                 {/* ... Tampilkan detail header revisi ini ... */}
                 <p><strong>Customer:</strong> {revItem.revision.project_name || '-'}</p>
                 <p><strong>Prioritas:</strong> {revItem.revision.priority || 'Normal'}</p>
                 <p><strong>Status:</strong> {revItem.revision.status || '-'}</p>
                 <p><strong>Deadline:</strong> {formatDate(revItem.revision.deadline)}</p>
                 <p><strong>Marketing:</strong> {revItem.revision.marekting || '-'}</p>
                 {revItem.revision.notes && <p><strong>Catatan:</strong> <span style={{ whiteSpace: 'pre-wrap' }}>{revItem.revision.notes}</span></p>}
              </div>

              {/* Ringkasan Perubahan DARI revisi ini KE revisi berikutnya */}
               {changes && nextRevisionInHistory ? ( // Pastikan nextRevision ada
                 <div className="revision-changes-summary">
                   <h4>Perubahan ke Revisi #{nextRevisionInHistory.revision.revision_number}:</h4>
                   {!hasChanges ? (
                      <p><em>Tidak ada perubahan signifikan terdeteksi.</em></p>
                   ) : (
                     <>
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
                             <h5>(+) Item Ditambah:</h5>
                             <ul>{changes.added.map((item) => <li key={`a-${item.id}`}>{formatItemDescription(item)} ({item.quantity} {item.satuan})</li>)}</ul>
                           </div>
                       )}
                       {changes.removed.length > 0 && (
                           <div className="change-section">
                             <h5>(-) Item Dihapus:</h5>
                             <ul>{changes.removed.map((item) => <li key={`r-${item.id}`}>{formatItemDescription(item)} ({item.quantity} {item.satuan})</li>)}</ul>
                           </div>
                       )}
                       {changes.modified.length > 0 && (
                           <div className="change-section">
                             <h5>(~) Item Diubah:</h5>
                             <ul>
                               {changes.modified.map((mod, modIdx) => (
                                 <li key={`m-${mod.item.id}-${modIdx}`}>
                                   <strong>{mod.item.product_name || 'N/A'}:</strong>
                                   <ul>{mod.changes.map((change, cIdx) => <li key={`c-${cIdx}`}>{change}</li>)}</ul>
                                 </li>
                               ))}
                             </ul>
                           </div>
                       )}
                     </>
                   )}
                 </div>
               ) : indexInSlice === history.length - 2 ? ( // Ini adalah revisi paling awal (index 0 asli)
                  <p><em>Ini adalah versi awal.</em></p>
               ) : null}


              {/* Tabel Item untuk Revisi INI */}
              <h4>Item pada Revisi #{revItem.revision.revision_number}:</h4>
              <div className="table-responsive">
                <table className="simple-table item-table">
                   <thead>
                     <tr>
                       <th>Produk</th><th>Spesifikasi</th><th>Ukuran (mm)</th>
                       <th>Qty</th><th>Catatan</th><th>Lokasi</th>
                     </tr>
                   </thead>
                   <tbody>
                     {revItem.items.map((item) => (
                       <tr key={item.id}>
                         <td>{item.product_name || '-'}</td>
                         <td>
                            {/* Gabungkan spesifikasi */}
                            {[item.wood_type, item.profile, item.color, item.finishing, item.sample]
                             .filter(Boolean).join('; ') || '-'}
                         </td>
                         <td>{`${item.thickness_mm || 0}x${item.width_mm || 0}x${item.length_mm || 0}`} ({item.length_type || 'N/A'})</td>
                         <td>{`${item.quantity || 0} ${item.satuan || ''}`}</td>
                         <td style={{ whiteSpace: 'pre-wrap' }}>{item.notes || '-'}</td>
                         <td>{item.location || '-'}</td>
                       </tr>
                     ))}
                     {revItem.items.length === 0 && <tr><td colSpan={6}>Tidak ada item.</td></tr>} {/* Update colspan */}
                   </tbody>
                </table>
              </div>
            </Card>
          )
        })
      )}
    </div> // Akhir page-container
  );
};

export default PODetailPage;