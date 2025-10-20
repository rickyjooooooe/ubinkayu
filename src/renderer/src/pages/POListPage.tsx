// file: src/renderer/src/pages/POListPage.tsx

import React, { useState, useMemo } from 'react'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import FilterPanel from '../components/FilterPanel'
import { POHeader } from '../types'
import POTable from '../components/POTable'

interface POListPageProps {
  poList: POHeader[]
  onAddPO: () => void
  onDeletePO: (poId: string) => Promise<void>
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
  // 1. State 'viewMode' dihapus. State baru untuk tab ditambahkan.
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

  // Logika filter dipisah menjadi dua tahap agar lebih mudah dibaca
  const listByTab = useMemo(() => {
    if (activeTab === 'active') {
      return poList.filter((po) => po.status !== 'Completed' && po.status !== 'Cancelled')
    }
    // Jika tab 'completed'
    return poList.filter((po) => po.status === 'Completed')
  }, [poList, activeTab])

  const { availableWoodTypes, availableProductTypes } = useMemo(() => {
    const woodTypes = new Set<string>()
    const productTypes = new Set<string>()
    // Opsi filter tetap diambil dari keseluruhan poList
    poList.forEach((po) => {
      po.items?.forEach((item) => {
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

  const filteredAndSortedPOs = useMemo(() => {
    // 2. Proses filter sekarang dimulai dari listByTab, bukan poList
    let processedPOs = [...listByTab]

    // ... (Logika filter lainnya tetap sama) ...
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
        po.items?.some((item) => item.wood_type === filters.woodType)
      )
    }
    if (filters.productType !== 'all') {
      processedPOs = processedPOs.filter((po) =>
        po.items?.some((item) => item.product_name === filters.productType)
      )
    }
    if (filters.deadlineDate) {
      processedPOs = processedPOs.filter((po) => {
        // Pastikan PO memiliki deadline sebelum membandingkan
        if (!po.deadline) return false

        // Ambil hanya bagian tanggal (YYYY-MM-DD) dari data PO
        const poDeadlineDate = new Date(po.deadline).toISOString().split('T')[0]

        // Bandingkan dengan tanggal dari filter
        return poDeadlineDate === filters.deadlineDate
      })
    }

    // Logika sorting tetap sama
    const priorityMap: Record<string, number> = { urgent: 1, high: 2, normal: 3 }
    switch (filters.sortBy) {
      case 'deadline-asc':
        processedPOs.sort(
          (a, b) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime()
        )
        break
      // ... (kasus sorting lainnya)
      case 'deadline-desc':
        processedPOs.sort(
          (a, b) => new Date(b.deadline || 0).getTime() - new Date(a.deadline || 0).getTime()
        )
        break
      case 'created-desc':
        processedPOs.sort(
          (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        )
        break
      case 'created-asc':
        processedPOs.sort(
          (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        )
        break
      case 'priority':
        processedPOs.sort(
          (a, b) =>
            (priorityMap[(a.priority || 'normal').toLowerCase()] || 4) -
            (priorityMap[(b.priority || 'normal').toLowerCase()] || 4)
        )
        break
    }
    return processedPOs
  }, [listByTab, filters])

  // 3. renderContent disederhanakan, hanya untuk merender tabel
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
    // Selalu render POTable
    return (
      <POTable
        poList={filteredAndSortedPOs}
        onShowDetail={onShowDetail}
        onEditPO={onEditPO}
        onDeletePO={onDeletePO}
        onShowProgress={onShowProgress}
      />
    )
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
        // Hitungan PO sekarang didasarkan pada tab yang aktif
        poCount={{ displayed: filteredAndSortedPOs.length, total: listByTab.length }}
        availableWoodTypes={availableWoodTypes}
        availableProductTypes={availableProductTypes}
      />

      {/* 4. 'view-switcher' diganti dengan tab filter baru */}
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
