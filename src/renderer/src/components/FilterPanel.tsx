/* eslint-disable prettier/prettier */
import React from 'react'
import { Card } from './Card'
import { Input } from './Input'

interface FilterPanelProps {
  filters: any
  onFilterChange: (name: string, value: any) => void
  orderCount: { displayed: number; total: number }
  availableWoodTypes?: string[]
  availableProductTypes?: string[]
  filteredWoodKubikasi?: number | null;
  selectedWoodType?: string;
  // [TAMBAH] Prop baru untuk opsi filter
  availableMarketing?: string[];
  availableRevisers?: string[];
  availableFinishing?: string[];
  availableSample?: string[];
}

const FilterPanel: React.FC<FilterPanelProps> = ({
  filters,
  onFilterChange,
  orderCount,
  availableWoodTypes = [],
  availableProductTypes = [],
  filteredWoodKubikasi,
  selectedWoodType,
  // [TAMBAH] Destructure prop baru
  availableMarketing = [],
  availableRevisers = [],
  availableFinishing = [],
  availableSample = []
}) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    onFilterChange(e.target.name, e.target.value)
  }

  return (
    <Card className="filter-panel refined-filter">
      <div className="filter-header">
        <h3>📊 Sort & Filter Purchase Order</h3>
        <span>
          Menampilkan {orderCount.displayed} dari {orderCount.total} PO
        </span>
      </div>

      <div className="filter-grid-refined">

        {/* --- Bagian Atas: Urutkan & Pencarian --- */}
        <div className="form-group sort-group">
          <label>Urutkan Berdasarkan</label>
          <select name="sortBy" value={filters.sortBy} onChange={handleInputChange}>
            {/* Opsi yang sudah ada */}
            <option value="created-desc">PO Terbaru (Tgl Masuk)</option>
            <option value="created-asc">PO Terlama (Tgl Masuk)</option>
            <option value="deadline-asc">Target Kirim (Terdekat)</option>
            <option value="deadline-desc">Target Kirim (Terjauh)</option>
            <option value="priority">Prioritas (Urgent {'>'} High {'>'} Normal)</option>
            
            {/* [TAMBAH] Opsi Sort Baru */}
            <option value="revisi-desc">Tgl Revisi (Terbaru)</option>
            <option value="revisi-asc">Tgl Revisi (Terlama)</option>
            <option value="marketing-asc">Marketing (A-Z)</option>
            <option value="marketing-desc">Marketing (Z-A)</option>
          </select>
        </div>
        <div className="form-group search-group">
          <label>Pencarian</label>
          <Input
            label="" type="text" name="searchQuery"
            placeholder="Cari berdasarkan nomor PO atau nama customer..."
            value={filters.searchQuery} onChange={handleInputChange}
          />
        </div>

        {/* --- Bagian Tengah: Filter Dropdown --- */}
        <div className="form-group">
          <label>Status PO</label>
          <select name="status" value={filters.status} onChange={handleInputChange}>
            <option value="all">Semua Status</option>
            <option value="Open">Open</option>
            <option value="In Progress">In Progress</option>
            {/* 'Completed' dan 'Cancelled' seharusnya ada di tab "PO Selesai" */}
          </select>
        </div>
        <div className="form-group">
          <label>Prioritas</label>
          <select name="priority" value={filters.priority} onChange={handleInputChange}>
            <option value="all">Semua Prioritas</option>
            <option value="Urgent">Urgent</option>
            <option value="High">High</option>
            <option value="Normal">Normal</option>
          </select>
        </div>
        <div className="form-group">
          <label>Jenis Kayu</label>
          <select name="woodType" value={filters.woodType || 'all'} onChange={handleInputChange}>
            <option value="all">Semua Jenis Kayu</option>
            {availableWoodTypes.map((woodType) => (<option key={woodType} value={woodType}>{woodType}</option>))}
          </select>
        </div>
        <div className="form-group">
          <label>Produk</label>
          <select name="productType" value={filters.productType || 'all'} onChange={handleInputChange}>
            <option value="all">Semua Produk</option>
            {availableProductTypes.map((productType) => (<option key={productType} value={productType}>{productType}</option>))}
          </select>
        </div>
        
        {/* [TAMBAH] Filter Dropdown Baru */}
        <div className="form-group">
          <label>Finishing</label>
          <select name="finishing" value={filters.finishing || 'all'} onChange={handleInputChange}>
            <option value="all">Semua Finishing</option>
            {availableFinishing.map((name) => (<option key={name} value={name}>{name}</option>))}
          </select>
        </div>
        <div className="form-group">
          <label>Sample</label>
          <select name="sample" value={filters.sample || 'all'} onChange={handleInputChange}>
            <option value="all">Semua Sample</option>
            {availableSample.map((name) => (<option key={name} value={name}>{name}</option>))}
          </select>
        </div>
        <div className="form-group">
          <label>Marketing</label>
          <select name="marketing" value={filters.marketing || 'all'} onChange={handleInputChange}>
            <option value="all">Semua Marketing</option>
            {availableMarketing.map((name) => (<option key={name} value={name}>{name}</option>))}
          </select>
        </div>
        <div className="form-group">
          <label>Terakhir Direvisi Oleh</label>
          <select name="lastRevisedBy" value={filters.lastRevisedBy || 'all'} onChange={handleInputChange}>
            <option value="all">Semua Perevisi</option>
            {availableRevisers.map((name) => (<option key={name} value={name}>{name}</option>))}
            <option value="N/A">Belum Direvisi</option>
          </select>
        </div>

        {/* --- Bagian Bawah: Filter Tanggal --- */}
        <div className="form-group date-filter-group">
          <label>Tanggal Input</label>
          <div className="date-range-group">
            <Input label="" type="date" name="dateFrom" value={filters.dateFrom} onChange={handleInputChange} />
            <span>sampai</span>
            <Input label="" type="date" name="dateTo" value={filters.dateTo} onChange={handleInputChange} />
          </div>
        </div>
        <div className="form-group date-filter-group">
          <label>Tanggal Kirim</label>
          <Input
            label="" type="date" name="deadlineDate"
            value={filters.deadlineDate} onChange={handleInputChange}
          />
        </div>

      </div> {/* Akhir filter-grid-refined */}

      {/* Ringkasan Kubikasi */}
      {filteredWoodKubikasi !== null && filteredWoodKubikasi !== undefined && selectedWoodType && selectedWoodType !== 'all' && (
        <div className="filter-summary">
          <p>
            Total Kubikasi untuk <strong>{selectedWoodType}</strong>:
            {' '}
            <strong>{filteredWoodKubikasi.toFixed(3)} m³</strong>
          </p>
        </div>
      )}

    </Card>
  )
}

export default FilterPanel