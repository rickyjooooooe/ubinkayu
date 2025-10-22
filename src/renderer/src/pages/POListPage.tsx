/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import React, { useState, useMemo } from 'react'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import FilterPanel from '../components/FilterPanel'
import { POHeader } from '../types'
import POTable from '../components/POTable' // Tabel untuk PO Aktif tetap dipakai
// Hapus import CompletedPOTable

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

  const [filters, setFilters] = useState({
    sortBy: 'created-desc',
    searchQuery: '',
    status: 'all',
    priority: 'all',
    dateFrom: '',
    dateTo: '',
    deadlineDate: '',
    woodType: 'all',
    productType: 'all'
  })

  // Pisahkan PO berdasarkan tab aktif
  const listByTab = useMemo(() => {
    if (activeTab === 'active') {
      return poList.filter((po) => po.status !== 'Completed' && po.status !== 'Cancelled')
    }
    return poList.filter((po) => po.status === 'Completed')
  }, [poList, activeTab])

  // Ambil opsi unik untuk filter
  const { availableWoodTypes, availableProductTypes } = useMemo(() => {
    const woodTypes = new Set<string>()
    const productTypes = new Set<string>()
    poList.forEach((po) => {
      ;(po.items || []).forEach((item) => {
        if (item.wood_type) woodTypes.add(item.wood_type)
        if (item.product_name) productTypes.add(item.product_name)
      })
    })
    return {
      availableWoodTypes: Array.from(woodTypes).sort(),
      availableProductTypes: Array.from(productTypes).sort()
    }
  }, [poList])

  const handleFilterChange = (name: string, value: any) => {
    setFilters((prev) => ({ ...prev, [name]: value }))
  }

  // Filter dan sort PO
  const filteredAndSortedPOs = useMemo(() => {
    let processedPOs = [...listByTab]
    // ... (Logika filter dan sort tidak berubah) ...
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
    if (filters.woodType !== 'all') {
      processedPOs = processedPOs.filter((po) =>
        (po.items || []).some((item) => item.wood_type === filters.woodType)
      )
    }
    if (filters.productType !== 'all') {
      processedPOs = processedPOs.filter((po) =>
        (po.items || []).some((item) => item.product_name === filters.productType)
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
    if (isLoading) {
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

    // [DIUBAH] Render tabel "PO Selesai" langsung di sini
    if (activeTab === 'completed') {
      return (
        <div className="po-table-container"> {/* Gunakan class yang sama */}
          <table className="po-table"> {/* Gunakan class yang sama */}
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
                  <td>{po.lastRevisedBy && po.lastRevisedBy !== 'N/A' ? po.lastRevisedBy : '-'}</td>
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
              {filteredAndSortedPOs.length === 0 && ( // Pengecekan ini sebenarnya sudah ada di atas
                 <tr><td colSpan={8}>Tidak ada PO yang sudah selesai.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      );
    } else { // Jika tab 'active'
      return (
        <POTable // Tetap gunakan komponen POTable untuk PO Aktif
          poList={filteredAndSortedPOs}
          onShowDetail={onShowDetail}
          onEditPO={onEditPO}
          onDeletePO={(poId) => { // Pastikan poInfo dikirim
              const poInfo = poList.find(p => p.id === poId);
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