/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import React, { useState, useMemo } from 'react'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import FilterPanel from '../components/FilterPanel'
import { POHeader, POItem } from '../types' // Import POItem
import POTable from '../components/POTable' // Tabel untuk PO Aktif tetap dipakai

interface POListPageProps {
  poList: POHeader[]
  onAddPO: () => void
  onDeletePO: (poId: string, poInfo: string) => Promise<void>
  onEditPO: (po: POHeader) => void
  onShowDetail: (po: POHeader) => void
  onShowProgress: (po: POHeader) => void
  isLoading: boolean
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
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active')

  // [DIHAPUS] State poListData dan filterOptions dihapus karena kita menggunakan props 'poList'

  const [filters, setFilters] = useState({
    sortBy: 'created-desc',
    searchQuery: '',
    status: 'all',
    priority: 'all',
    dateFrom: '',
    dateTo: '',
    deadlineDate: '',
    woodType: 'all',
    productType: 'all',
    marketing: 'all',     // State filter baru
    lastRevisedBy: 'all', // State filter baru
    finishing: 'all',     // State filter baru
    sample: 'all'         // State filter baru
  })

  // [DIHAPUS] useEffect untuk fetchData() dihapus.
  // Komponen ini sekarang menerima data dari props, tidak mengambil sendiri.

  // Pisahkan PO berdasarkan tab aktif
  const listByTab = useMemo(() => {
    if (activeTab === 'active') {
      return poList.filter((po) => po.status !== 'Completed' && po.status !== 'Cancelled')
    }
    return poList.filter((po) => po.status === 'Completed')
  }, [poList, activeTab]) // Bergantung pada poList dari props

  // [DIUBAH] Ambil semua opsi unik untuk filter
  const { 
    availableWoodTypes, 
    availableProductTypes, 
    availableMarketing, 
    availableRevisers,
    availableFinishing,
    availableSample
  } = useMemo(() => {
    const woodTypes = new Set<string>()
    const productTypes = new Set<string>()
    const marketingNames = new Set<string>()
    const reviserNames = new Set<string>()
    const finishingNames = new Set<string>() // <-- Baru
    const sampleNames = new Set<string>()    // <-- Baru

    poList.forEach((po) => {
      // @ts-ignore
      if (po.acc_marketing) marketingNames.add(po.acc_marketing);
      // @ts-ignore
      if (po.lastRevisedBy && po.lastRevisedBy !== 'N/A') reviserNames.add(po.lastRevisedBy);

      (po.items || []).forEach((item) => {
        if (item.wood_type) woodTypes.add(item.wood_type)
        if (item.product_name) productTypes.add(item.product_name)
        // @ts-ignore
        if (item.marketing) marketingNames.add(item.marketing);
        // @ts-ignore
        if (item.finishing) finishingNames.add(item.finishing); // <-- Baru
        // @ts-ignore
        if (item.sample) sampleNames.add(item.sample);       // <-- Baru
      })
    })
    return {
      availableWoodTypes: Array.from(woodTypes).sort(),
      availableProductTypes: Array.from(productTypes).sort(),
      availableMarketing: Array.from(marketingNames).sort(),
      availableRevisers: Array.from(reviserNames).sort(),
      availableFinishing: Array.from(finishingNames).sort(), // <-- Baru
      availableSample: Array.from(sampleNames).sort()       // <-- Baru
    }
  }, [poList])
  const handleFilterChange = (name: string, value: any) => {
    setFilters((prev) => ({ ...prev, [name]: value }))
  }

  // Filter dan sort PO
  const filteredAndSortedPOs = useMemo(() => {
    let processedPOs = [...listByTab]
    
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase()
      processedPOs = processedPOs.filter(
        (po) =>
          po.po_number.toLowerCase().includes(query) ||
          po.project_name.toLowerCase().includes(query)
      )
    }
    if (filters.status !== 'all') {
      processedPOs = processedPOs.filter(
        (po) => (po.status || 'Open').toLowerCase() === filters.status.toLowerCase()
      )
    }
    if (filters.priority !== 'all') {
      processedPOs = processedPOs.filter(
        (po) => (po.priority || 'Normal').toLowerCase() === filters.priority.toLowerCase()
      )
    }
    if (filters.dateFrom) {
       processedPOs = processedPOs.filter(po => new Date(po.created_at) >= new Date(filters.dateFrom));
    }
    if (filters.dateTo) {
       const dateToInclusive = new Date(filters.dateTo);
       dateToInclusive.setDate(dateToInclusive.getDate() + 1);
       processedPOs = processedPOs.filter(po => new Date(po.created_at) < dateToInclusive);
    }
    if (filters.deadlineDate) {
      processedPOs = processedPOs.filter((po) => {
        if (!po.deadline) return false
        const poDeadlineDate = new Date(po.deadline).toISOString().split('T')[0]
        return poDeadlineDate === filters.deadlineDate
      })
    }
    // [DIUBAH] Filter item diperluas
    if (
      filters.woodType !== 'all' || 
      filters.productType !== 'all' || 
      filters.marketing !== 'all' ||
      filters.finishing !== 'all' ||
      filters.sample !== 'all'
    ) {
       processedPOs = processedPOs.filter(po => {
          return (po.items || []).some(item =>
             (filters.woodType === 'all' || item.wood_type === filters.woodType) &&
             (filters.productType === 'all' || item.product_name === filters.productType) &&
             // @ts-ignore
             (filters.marketing === 'all' || item.marketing === filters.marketing) &&
             // @ts-ignore
             (filters.finishing === 'all' || item.finishing === filters.finishing) &&
             // @ts-ignore
             (filters.sample === 'all' || item.sample === filters.sample)
          );
       });
    }
    // Filter Item (Kayu, Produk, Marketing)
  // Filter Perevisi Terakhir
    if (filters.lastRevisedBy !== 'all') {
       if (filters.lastRevisedBy === 'N/A') {
          // @ts-ignore
          processedPOs = processedPOs.filter(po => !po.lastRevisedBy || po.lastRevisedBy === 'N/A');
       } else {
          // @ts-ignore
          processedPOs = processedPOs.filter(po => po.lastRevisedBy === filters.lastRevisedBy);
       }
    }
    
    // --- Sorting Logic ---
    const priorityMap: Record<string, number> = { urgent: 1, high: 2, normal: 3 }
    switch (filters.sortBy) {
      case 'deadline-asc':
        processedPOs.sort((a, b) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime())
        break
      case 'deadline-desc':
        processedPOs.sort((a, b) => new Date(b.deadline || 0).getTime() - new Date(a.deadline || 0).getTime())
        break
      case 'created-desc':
        processedPOs.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        break
      case 'created-asc':
        processedPOs.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
        break
      case 'priority':
        processedPOs.sort((a, b) =>
            (priorityMap[(a.priority || 'normal').toLowerCase()] || 4) -
            (priorityMap[(b.priority || 'normal').toLowerCase()] || 4)
        )
        break;
      
      // [TAMBAH] Logika Sort Baru
      case 'revisi-desc':
        // @ts-ignore
        processedPOs.sort((a, b) => new Date(b.lastRevisedDate || 0).getTime() - new Date(a.lastRevisedDate || 0).getTime())
        break;
      case 'revisi-asc':
         // @ts-ignore
        processedPOs.sort((a, b) => new Date(a.lastRevisedDate || 0).getTime() - new Date(b.lastRevisedDate || 0).getTime())
        break;
      case 'marketing-asc':
         // @ts-ignore
        processedPOs.sort((a, b) => (a.acc_marketing || '').localeCompare(b.acc_marketing || ''))
        break;
      case 'marketing-desc':
         // @ts-ignore
        processedPOs.sort((a, b) => (b.acc_marketing || '').localeCompare(a.acc_marketing || ''))
        break;
    }
    return processedPOs
  }, [listByTab, filters])

  // Hitung total kubikasi untuk ringkasan
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

  // Helper format tanggal
  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  };
   const formatDateTime = (dateString?: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  };


  // Fungsi render konten (termasuk kedua tabel)
  const renderContent = () => {
    if (isLoading) { // Menggunakan isLoading dari props
      return <p>⏳ Loading data PO dari Google Sheets...</p>
    }
    if (filteredAndSortedPOs.length === 0) {
      return (
        <Card>
          <p>
            {activeTab === 'active'
              ? 'Tidak ada PO aktif yang cocok dengan kriteria filter Anda.'
              : 'Tidak ada PO yang sudah selesai.'}
          </p>
        </Card>
      )
    }

    // Render tabel "PO Selesai" langsung di sini
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
                  {/* @ts-ignore */}
                  <td>{po.lastRevisedBy && po.lastRevisedBy !== 'N/A' ? po.lastRevisedBy : '-'}</td>
                  {/* @ts-ignore */}
                  <td>{formatDateTime(po.lastRevisedDate)}</td>
                  <td>{formatDate(po.created_at)}</td>
                  <td>{formatDate(po.deadline)}</td>
                  <td className="product-list-cell">
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
                  <td>
                    <div className="actions-cell">
                      <Button variant="secondary" onClick={() => onShowDetail(po)}>
                        Lihat Detail
                      </Button>
                      {po.pdf_link && (
                         // @ts-ignore
                        <Button variant="secondary" onClick={() => window.api.openExternalLink(po.pdf_link)}>
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
    } else { // Jika tab 'active'
      return (
        <POTable // Gunakan komponen POTable untuk PO Aktif
          poList={filteredAndSortedPOs}
          onShowDetail={onShowDetail}
          onEditPO={onEditPO}
          onDeletePO={(poId) => {
              const poInfo = poList.find(p => p.id === poId); // Gunakan poList dari props
              const infoString = poInfo ? `${poInfo.po_number} - ${poInfo.project_name}` : poId;
              return onDeletePO(poId, infoString);
          }}
          onShowProgress={onShowProgress}
        />
      )
    }
  }

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
        availableMarketing={availableMarketing}   // <-- Teruskan prop
        availableRevisers={availableRevisers}     // <-- Teruskan prop
        availableFinishing={availableFinishing} // <-- Teruskan prop
        availableSample={availableSample}         // <-- Teruskan prop
        filteredWoodKubikasi={filteredWoodKubikasi}
        selectedWoodType={filters.woodType}
      />

      <div className="view-switcher">
        <button
          className={`view-switcher-btn ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          PO Aktif
        </button>
        <button
          className={`view-switcher-btn ${activeTab === 'completed' ? 'active' : ''}`}
          onClick={() => setActiveTab('completed')}
        >
          PO Selesai
        </button>
      </div>

      {renderContent()}
    </div>
  )
}

export default POListPage