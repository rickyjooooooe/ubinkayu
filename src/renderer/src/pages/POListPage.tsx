/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import React, { useState, useMemo } from 'react';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import FilterPanel from '../components/FilterPanel';
import { POHeader } from '../types'; // Import POItem juga (jika belum)
import POTable from '../components/POTable';

interface POListPageProps {
  poList: POHeader[];
  onAddPO: () => void;
  onDeletePO: (poId: string, poInfo: string) => Promise<void>;
  onEditPO: (po: POHeader) => void;
  onShowDetail: (po: POHeader) => void;
  onShowProgress: (po: POHeader) => void;
  isLoading: boolean;
}

const POListPage: React.FC<POListPageProps> = ({
  poList,
  onAddPO,
  isLoading,
  onDeletePO,
  onEditPO,
  onShowDetail,
  onShowProgress
}) => {
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');

  const [filters, setFilters] = useState({
    sortBy: 'created-desc',
    searchQuery: '',
    status: 'all',
    priority: 'all',
    dateFrom: '',
    dateTo: '',
    deadlineDate: '',
    woodType: 'all',      // Item Level
    productType: 'all',   // Item Level
    marketing: 'all',     // Header Level (acc_marketing)
    lastRevisedBy: 'all', // Header Level
    finishing: 'all',     // Item Level
    sample: 'all'         // Item Level
  });

  // Pisahkan PO berdasarkan tab aktif
  const listByTab = useMemo(() => {
    if (!poList) return []; // Tambahkan null check
    if (activeTab === 'active') {
      return poList.filter((po) => po.status !== 'Completed' && po.status !== 'Cancelled');
    }
    return poList.filter((po) => po.status === 'Completed');
  }, [poList, activeTab]);

  // Ambil semua opsi unik untuk filter
  const {
    availableWoodTypes,
    availableProductTypes,
    availableMarketing,   // Nama marketing dari header PO (acc_marketing)
    availableRevisers,
    availableFinishing,   // Finishing dari item
    availableSample       // Sample dari item
  } = useMemo(() => {
    const woodTypes = new Set<string>();
    const productTypes = new Set<string>();
    const marketingNames = new Set<string>(); // Untuk acc_marketing
    const reviserNames = new Set<string>();
    const finishingNames = new Set<string>();
    const sampleNames = new Set<string>();

    (poList || []).forEach((po) => { // Tambahkan null check
      // Ambil dari header PO
      if (po.acc_marketing) marketingNames.add(po.acc_marketing);
      if (po.lastRevisedBy && po.lastRevisedBy !== 'N/A') reviserNames.add(po.lastRevisedBy);

      // Ambil dari item PO
      (po.items || []).forEach((item) => {
        if (item.wood_type) woodTypes.add(item.wood_type);
        if (item.product_name) productTypes.add(item.product_name);
        // Finishing dan Sample diambil dari item
        if (item.finishing) finishingNames.add(item.finishing);
        if (item.sample) sampleNames.add(item.sample);
        // Note: item.marketing (jika ada) mungkin berbeda dari po.acc_marketing
      });
    });
    return {
      availableWoodTypes: Array.from(woodTypes).sort(),
      availableProductTypes: Array.from(productTypes).sort(),
      availableMarketing: Array.from(marketingNames).sort(), // Hanya dari header
      availableRevisers: Array.from(reviserNames).sort(),
      availableFinishing: Array.from(finishingNames).sort(),
      availableSample: Array.from(sampleNames).sort()
    };
  }, [poList]);

  const handleFilterChange = (name: string, value: any) => {
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  // Filter dan sort PO
  const filteredAndSortedPOs = useMemo(() => {
    let processedPOs = [...listByTab];

    // --- Filter Berdasarkan Header PO ---
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      processedPOs = processedPOs.filter(
        (po) =>
          po.po_number?.toLowerCase().includes(query) || // Tambah null check
          po.project_name?.toLowerCase().includes(query) // Tambah null check
      );
    }
    if (filters.status !== 'all') {
      processedPOs = processedPOs.filter(
        (po) => (po.status || 'Open').toLowerCase() === filters.status.toLowerCase()
      );
    }
    if (filters.priority !== 'all') {
      processedPOs = processedPOs.filter(
        (po) => (po.priority || 'Normal').toLowerCase() === filters.priority.toLowerCase()
      );
    }
    if (filters.dateFrom) {
       try { // Tambah try-catch untuk tanggal
          const dateFrom = new Date(filters.dateFrom);
          processedPOs = processedPOs.filter(po => {
            try { return new Date(po.created_at) >= dateFrom; } catch { return false; }
          });
       } catch { console.warn("Invalid dateFrom filter"); }
    }
    if (filters.dateTo) {
       try { // Tambah try-catch untuk tanggal
          const dateToInclusive = new Date(filters.dateTo);
          dateToInclusive.setDate(dateToInclusive.getDate() + 1);
          processedPOs = processedPOs.filter(po => {
             try { return new Date(po.created_at) < dateToInclusive; } catch { return false; }
          });
       } catch { console.warn("Invalid dateTo filter"); }
    }
    if (filters.deadlineDate) {
      try { // Tambah try-catch untuk tanggal
        processedPOs = processedPOs.filter((po) => {
          if (!po.deadline) return false;
          try {
            const poDeadlineDate = new Date(po.deadline).toISOString().split('T')[0];
            return poDeadlineDate === filters.deadlineDate;
          } catch { return false; }
        });
      } catch { console.warn("Invalid deadlineDate filter"); }
    }
    // Filter Marketing (Header)
    if (filters.marketing !== 'all') {
        processedPOs = processedPOs.filter(
            (po) => po.acc_marketing === filters.marketing
        );
    }
    // Filter Perevisi Terakhir (Header)
    if (filters.lastRevisedBy !== 'all') {
       if (filters.lastRevisedBy === 'N/A') {
          processedPOs = processedPOs.filter(po => !po.lastRevisedBy || po.lastRevisedBy === 'N/A');
       } else {
          processedPOs = processedPOs.filter(po => po.lastRevisedBy === filters.lastRevisedBy);
       }
    }

    // --- Filter Berdasarkan Item PO ---
    // Filter ini hanya dijalankan JIKA ada filter item yang aktif
    const itemFiltersActive = filters.woodType !== 'all' ||
                              filters.productType !== 'all' ||
                              filters.finishing !== 'all' ||
                              filters.sample !== 'all';

    if (itemFiltersActive) {
       processedPOs = processedPOs.filter(po => {
          // Sebuah PO lolos jika SETIDAKNYA SATU itemnya cocok SEMUA kriteria filter item yang aktif
          return (po.items || []).some(item =>
             (filters.woodType === 'all' || item.wood_type === filters.woodType) &&
             (filters.productType === 'all' || item.product_name === filters.productType) &&
             (filters.finishing === 'all' || item.finishing === filters.finishing) &&
             (filters.sample === 'all' || item.sample === filters.sample)
             // Note: filter marketing item sengaja dihilangkan dari sini
             // karena filter marketing utama ada di header (acc_marketing)
          );
       });
    }

    // --- Sorting Logic ---
    const priorityMap: Record<string, number> = { urgent: 1, high: 2, normal: 3 };
    switch (filters.sortBy) {
        case 'deadline-asc':
            processedPOs.sort((a, b) => (new Date(a.deadline || 0).getTime()) - (new Date(b.deadline || 0).getTime()));
            break;
        case 'deadline-desc':
            processedPOs.sort((a, b) => (new Date(b.deadline || 0).getTime()) - (new Date(a.deadline || 0).getTime()));
            break;
        case 'created-desc':
            processedPOs.sort((a, b) => (new Date(b.created_at || 0).getTime()) - (new Date(a.created_at || 0).getTime()));
            break;
        case 'created-asc':
            processedPOs.sort((a, b) => (new Date(a.created_at || 0).getTime()) - (new Date(b.created_at || 0).getTime()));
            break;
        case 'priority':
            processedPOs.sort((a, b) =>
                (priorityMap[(a.priority || 'normal').toLowerCase()] || 4) -
                (priorityMap[(b.priority || 'normal').toLowerCase()] || 4)
            );
            break;
        case 'revisi-desc':
            processedPOs.sort((a, b) => (new Date(b.lastRevisedDate || 0).getTime()) - (new Date(a.lastRevisedDate || 0).getTime()));
            break;
        case 'revisi-asc':
            processedPOs.sort((a, b) => (new Date(a.lastRevisedDate || 0).getTime()) - (new Date(b.lastRevisedDate || 0).getTime()));
            break;
        case 'marketing-asc':
            processedPOs.sort((a, b) => (a.acc_marketing || '').localeCompare(b.acc_marketing || ''));
            break;
        case 'marketing-desc':
            processedPOs.sort((a, b) => (b.acc_marketing || '').localeCompare(a.acc_marketing || ''));
            break;
        // Default sort (jika sortBy tidak cocok)
        default:
             processedPOs.sort((a, b) => (new Date(b.created_at || 0).getTime()) - (new Date(a.created_at || 0).getTime()));
             break;
    }
    return processedPOs;
  }, [listByTab, filters]);

  // Hitung total kubikasi untuk ringkasan (logika ini sudah benar)
  const filteredWoodKubikasi = useMemo(() => {
    if (filters.woodType === 'all') {
      return null;
    }
    let totalKubikasiFiltered = 0;
    filteredAndSortedPOs.forEach(po => {
      (po.items || []).forEach(item => {
        if (item.wood_type === filters.woodType) {
          totalKubikasiFiltered += Number(item.kubikasi || 0);
        }
      });
    });
    return totalKubikasiFiltered;
  }, [filteredAndSortedPOs, filters.woodType]);

  // Helper format tanggal (logika ini sudah benar)
  const formatDate = (dateString?: string | null) => {
    // ... implementasi formatDate ...
     if (!dateString) return '-';
     try {
       return new Date(dateString).toLocaleDateString('id-ID', {
         day: '2-digit', month: 'short', year: 'numeric'
       });
     } catch { return '-'; }
  };
  const formatDateTime = (dateString?: string | null) => {
    // ... implementasi formatDateTime ...
     if (!dateString) return '-';
     try {
       return new Date(dateString).toLocaleString('id-ID', {
         day: '2-digit', month: 'short', year: 'numeric',
         hour: '2-digit', minute: '2-digit', hour12: false
       });
     } catch { return '-'; }
  };


  // Fungsi render konten (logika ini sudah benar)
  const renderContent = () => {
    if (isLoading) {
      return <p>⏳ Loading data PO...</p>;
    }
    if (filteredAndSortedPOs.length === 0) {
      return (
        <Card>
          <p>
            {activeTab === 'active'
              ? 'Tidak ada PO aktif yang cocok dengan kriteria filter Anda.'
              : 'Tidak ada PO yang sudah selesai cocok dengan kriteria filter Anda.'}
          </p>
        </Card>
      );
    }

    // Tabel PO Selesai
    if (activeTab === 'completed') {
      return (
        <div className="po-table-container">
          <table className="po-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Revisi Oleh</th>
                <th>Tgl Revisi</th>
                <th>Tanggal Masuk</th>
                <th>Target Kirim</th>
                <th>Jenis Kayu & Produk</th>
                <th>Total Kubikasi</th>
                <th>Marketing</th> {/* Tambah Marketing */}
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedPOs.map((po) => (
                <tr key={po.id}>
                  <td>
                    <div className="customer-cell">
                      <strong>{po.project_name}</strong>
                      <span>PO: {po.po_number}</span>
                    </div>
                  </td>
                  <td>{po.lastRevisedBy && po.lastRevisedBy !== 'N/A' ? po.lastRevisedBy : '-'}</td>
                  <td>{formatDateTime(po.lastRevisedDate)}</td>
                  <td>{formatDate(po.created_at)}</td>
                  <td>{formatDate(po.deadline)}</td>
                  <td className="product-list-cell">
                    {/* ... (logika tampilkan item sama) ... */}
                    {po.items && po.items.length > 0 ? (
                      <ul>
                        {po.items.map((item) => (
                          <li key={item.id || `${po.id}-${item.product_name}`}>
                            <span>{item.product_name} ({item.wood_type || 'N/A'})</span>
                            <strong>{Number(item.kubikasi || 0).toFixed(4)} m³</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span>-</span>
                    )}
                  </td>
                  <td>{Number(po.kubikasi_total || 0).toFixed(3)} m³</td>
                  <td>{po.acc_marketing || '-'}</td> {/* Tampilkan Marketing */}
                  <td>
                    <div className="actions-cell">
                      <Button variant="secondary" onClick={() => onShowDetail(po)}>
                        Detail
                      </Button>
                      {po.pdf_link && (
                         // @ts-ignore
                        <Button variant="secondary" onClick={() => window.api?.openExternalLink(po.pdf_link)}>
                           PDF
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else { // Tabel PO Aktif
      return (
        <POTable
          poList={filteredAndSortedPOs}
          onShowDetail={onShowDetail}
          onEditPO={onEditPO}
          onDeletePO={(poId) => {
              const poInfo = poList?.find(p => p.id === poId); // Gunakan poList dari props + null check
              const infoString = poInfo ? `${poInfo.po_number} - ${poInfo.project_name}` : poId;
              return onDeletePO(poId, infoString);
          }}
          onShowProgress={onShowProgress}
        />
      );
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Kelola Purchase Order</h1>
          <p>Pantau dan kelola semua pesanan produksi dengan fitur sort dan filter</p>
        </div>
        <Button onClick={onAddPO}>+ Tambah PO Baru</Button>
      </div>

      <FilterPanel
        filters={filters}
        onFilterChange={handleFilterChange}
        poCount={{ displayed: filteredAndSortedPOs.length, total: listByTab.length }}
        availableWoodTypes={availableWoodTypes}
        availableProductTypes={availableProductTypes}
        availableMarketing={availableMarketing}
        availableRevisers={availableRevisers}
        availableFinishing={availableFinishing}
        availableSample={availableSample}
        filteredWoodKubikasi={filteredWoodKubikasi}
        selectedWoodType={filters.woodType}
      />

      <div className="view-switcher">
        <button
          className={`view-switcher-btn ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          PO Aktif ({activeTab === 'active' ? filteredAndSortedPOs.length : listByTab.filter(po => po.status !== 'Completed' && po.status !== 'Cancelled').length}) {/* Tambah Hitungan */}
        </button>
        <button
          className={`view-switcher-btn ${activeTab === 'completed' ? 'active' : ''}`}
          onClick={() => setActiveTab('completed')}
        >
          PO Selesai ({activeTab === 'completed' ? filteredAndSortedPOs.length : listByTab.filter(po => po.status === 'Completed').length}) {/* Tambah Hitungan */}
        </button>
      </div>

      {renderContent()}
    </div>
  );
};

export default POListPage;