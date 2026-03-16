/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import React, { useState, useMemo } from 'react';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import FilterPanel from '../components/FilterPanel';
import { POHeader, User } from '../types'
import POTable from '../components/POTable';
import RequestTable from '../components/Requesttable';

interface POListPageProps {
  poList: POHeader[];
  onAddPO: () => void;
  onDeletePO: (poId: string, poInfo: string) => Promise<void>;
  onEditPO: (po: POHeader) => void;
  onShowDetail: (po: POHeader) => void;
  onShowProgress: (po: POHeader) => void;
  onConfirmRequest: (po: POHeader) => void; // [BARU] callback untuk admin konfirmasi request
  isLoading: boolean;
  currentUser: User | null;
}

const POListPage: React.FC<POListPageProps> = ({
  poList,
  onAddPO,
  isLoading,
  onDeletePO,
  onEditPO,
  onShowDetail,
  onShowProgress,
  onConfirmRequest,
  currentUser
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
    woodType: 'all',
    productType: 'all',
    marketing: 'all',
    lastRevisedBy: 'all',
    finishing: 'all',
    sample: 'all'
  });

  const userRole = currentUser?.role

  // ── [BARU] Pisahkan PO Requested dari list utama ──────────────
  const { requestedPOs, regularPOs } = useMemo(() => {
    if (!poList) return { requestedPOs: [], regularPOs: [] }
    return {
      requestedPOs: poList.filter((po) => po.status === 'Requested'),
      regularPOs: poList.filter((po) => po.status !== 'Requested'),
    }
  }, [poList])

  // Pisahkan PO berdasarkan tab aktif (hanya dari regularPOs)
  const listByTab = useMemo(() => {
    if (activeTab === 'active') {
      return regularPOs.filter((po) => po.status !== 'Completed' && po.status !== 'Cancelled');
    }
    return regularPOs.filter((po) => po.status === 'Completed');
  }, [regularPOs, activeTab]);

  const {
    availableWoodTypes, availableProductTypes, availableMarketing,
    availableRevisers, availableFinishing, availableSample
  } = useMemo(() => {
    const woodTypes = new Set<string>(), productTypes = new Set<string>(),
      marketingNames = new Set<string>(), reviserNames = new Set<string>(),
      finishingNames = new Set<string>(), sampleNames = new Set<string>();
    (regularPOs || []).forEach((po) => {
      if (po.acc_marketing) marketingNames.add(po.acc_marketing);
      if (po.lastRevisedBy && po.lastRevisedBy !== 'N/A') reviserNames.add(po.lastRevisedBy);
      (po.items || []).forEach((item) => {
        if (item.wood_type) woodTypes.add(item.wood_type);
        if (item.product_name) productTypes.add(item.product_name);
        if (item.finishing) finishingNames.add(item.finishing);
        if (item.sample) sampleNames.add(item.sample);
      });
    });
    return {
      availableWoodTypes: Array.from(woodTypes).sort(),
      availableProductTypes: Array.from(productTypes).sort(),
      availableMarketing: Array.from(marketingNames).sort(),
      availableRevisers: Array.from(reviserNames).sort(),
      availableFinishing: Array.from(finishingNames).sort(),
      availableSample: Array.from(sampleNames).sort()
    };
  }, [regularPOs]);

  const handleFilterChange = (name: string, value: any) => {
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const filteredAndSortedPOs = useMemo(() => {
    let processedPOs = [...listByTab];
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      processedPOs = processedPOs.filter((po) =>
        po.po_number?.toLowerCase().includes(query) || po.project_name?.toLowerCase().includes(query)
      );
    }
    if (filters.status !== 'all') processedPOs = processedPOs.filter((po) => (po.status || 'Open').toLowerCase() === filters.status.toLowerCase());
    if (filters.priority !== 'all') processedPOs = processedPOs.filter((po) => (po.priority || 'Normal').toLowerCase() === filters.priority.toLowerCase());
    if (filters.dateFrom) { try { const d = new Date(filters.dateFrom); processedPOs = processedPOs.filter(po => { try { return new Date(po.created_at) >= d } catch { return false } }) } catch { } }
    if (filters.dateTo) { try { const d = new Date(filters.dateTo); d.setDate(d.getDate() + 1); processedPOs = processedPOs.filter(po => { try { return new Date(po.created_at) < d } catch { return false } }) } catch { } }
    if (filters.deadlineDate) { try { processedPOs = processedPOs.filter((po) => { if (!po.deadline) return false; try { return new Date(po.deadline).toISOString().split('T')[0] === filters.deadlineDate } catch { return false } }) } catch { } }
    if (filters.marketing !== 'all') processedPOs = processedPOs.filter((po) => po.acc_marketing === filters.marketing);
    if (filters.lastRevisedBy !== 'all') {
      if (filters.lastRevisedBy === 'N/A') processedPOs = processedPOs.filter(po => !po.lastRevisedBy || po.lastRevisedBy === 'N/A');
      else processedPOs = processedPOs.filter(po => po.lastRevisedBy === filters.lastRevisedBy);
    }
    const itemFiltersActive = filters.woodType !== 'all' || filters.productType !== 'all' || filters.finishing !== 'all' || filters.sample !== 'all';
    if (itemFiltersActive) {
      processedPOs = processedPOs.filter(po =>
        (po.items || []).some(item =>
          (filters.woodType === 'all' || item.wood_type === filters.woodType) &&
          (filters.productType === 'all' || item.product_name === filters.productType) &&
          (filters.finishing === 'all' || item.finishing === filters.finishing) &&
          (filters.sample === 'all' || item.sample === filters.sample)
        )
      );
    }
    const priorityMap: Record<string, number> = { urgent: 1, high: 2, normal: 3 };
    switch (filters.sortBy) {
      case 'deadline-asc': processedPOs.sort((a, b) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime()); break;
      case 'deadline-desc': processedPOs.sort((a, b) => new Date(b.deadline || 0).getTime() - new Date(a.deadline || 0).getTime()); break;
      case 'created-desc': processedPOs.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()); break;
      case 'created-asc': processedPOs.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()); break;
      case 'priority': processedPOs.sort((a, b) => (priorityMap[a.priority?.toLowerCase() || 'normal'] || 3) - (priorityMap[b.priority?.toLowerCase() || 'normal'] || 3)); break;
      case 'revisi-desc': processedPOs.sort((a, b) => new Date(b.lastRevisedDate || 0).getTime() - new Date(a.lastRevisedDate || 0).getTime()); break;
      case 'revisi-asc': processedPOs.sort((a, b) => new Date(a.lastRevisedDate || 0).getTime() - new Date(b.lastRevisedDate || 0).getTime()); break;
      case 'marketing-asc': processedPOs.sort((a, b) => (a.acc_marketing || '').localeCompare(b.acc_marketing || '')); break;
      case 'marketing-desc': processedPOs.sort((a, b) => (b.acc_marketing || '').localeCompare(a.acc_marketing || '')); break;
      default: processedPOs.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()); break;
    }
    return processedPOs;
  }, [listByTab, filters]);

  const filteredWoodKubikasi = useMemo(() => {
    if (filters.woodType === 'all') return null;
    let total = 0;
    filteredAndSortedPOs.forEach(po => (po.items || []).forEach(item => { if (item.wood_type === filters.woodType) total += Number(item.kubikasi || 0) }));
    return total;
  }, [filteredAndSortedPOs, filters.woodType]);

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '-';
    try { return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return '-' }
  };
  const formatDateTime = (dateString?: string | null) => {
    if (!dateString) return '-';
    try { return new Date(dateString).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) } catch { return '-' }
  };
  const formatRupiah = (val?: string | number | null) => {
    if (!val) return '-'
    const n = Number(val)
    if (isNaN(n) || n === 0) return '-'
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)
  }

  // ── Render section Request Order dari Marketing (admin & manager) ─────────
  const renderRequestedSection = () => {
    if (userRole !== 'admin' && userRole !== 'manager') return null

    return (
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Request Order dari Marketing
          </h2>
          {requestedPOs.length > 0 ? (
            <span style={{
              background: 'var(--color-background-warning)', color: 'var(--color-text-warning)',
              fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px'
            }}>
              {requestedPOs.length} menunggu
            </span>
          ) : (
            <span style={{
              background: 'var(--color-background-secondary)', color: 'var(--color-text-tertiary)',
              fontSize: '11px', fontWeight: 500, padding: '3px 10px', borderRadius: '20px'
            }}>
              Tidak ada request
            </span>
          )}
        </div>
        <RequestTable
          requestList={requestedPOs}
          onShowDetail={onShowDetail}
          onConfirmRequest={onConfirmRequest}
          currentUserRole={userRole}
        />
      </div>
    )
  }

    const renderContent = () => {
    if (isLoading) return <p>⏳ Loading data Order...</p>;
    if (filteredAndSortedPOs.length === 0) {
      return (
        <Card>
          <p>{activeTab === 'active' ? 'Tidak ada Order aktif yang cocok dengan kriteria filter Anda.' : 'Tidak ada Order yang sudah selesai cocok dengan kriteria filter Anda.'}</p>
        </Card>
      );
    }
    if (activeTab === 'completed') {
      return (
        <div className="po-table-container">
          <table className="po-table">
            <thead>
              <tr>
                <th>Customer</th><th>Revisi Oleh</th><th>Tgl Revisi</th>
                <th>Tanggal Masuk</th><th>Target Kirim</th>
                <th>Jenis Kayu & Produk</th><th>Total Kubikasi</th>
                <th>Marketing</th><th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedPOs.map((po) => (
                <tr key={po.id}>
                  <td><div className="customer-cell"><strong>{po.project_name}</strong><span>No: {po.po_number}</span></div></td>
                  <td>{po.lastRevisedBy && po.lastRevisedBy !== 'N/A' ? po.lastRevisedBy : '-'}</td>
                  <td>{formatDateTime(po.lastRevisedDate)}</td>
                  <td>{formatDate(po.created_at)}</td>
                  <td>{formatDate(po.deadline)}</td>
                  <td className="product-list-cell">
                    {po.items && po.items.length > 0 ? (
                      <ul>{po.items.map((item) => (
                        <li key={item.id || `${po.id}-${item.product_name}`}>
                          <span>{item.product_name} ({item.wood_type || 'N/A'})</span>
                          <strong>{Number(item.kubikasi || 0).toFixed(4)} m³</strong>
                        </li>
                      ))}</ul>
                    ) : <span>-</span>}
                  </td>
                  <td>{Number(po.kubikasi_total || 0).toFixed(3)} m³</td>
                  <td>{po.acc_marketing || '-'}</td>
                  <td>
                    <div className="actions-cell">
                      <Button variant="secondary" onClick={() => onShowDetail(po)}>Detail</Button>
                      {po.pdf_link && (
                        // @ts-ignore
                        <Button variant="secondary" onClick={() => window.api?.openExternalLink(po.pdf_link)}>PDF</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else {
      return (
        <POTable
          poList={filteredAndSortedPOs}
          onShowDetail={onShowDetail}
          onEditPO={onEditPO}
          onDeletePO={(poId) => {
            const poInfo = regularPOs?.find(p => p.id === poId);
            const infoString = poInfo ? `${poInfo.po_number} - ${poInfo.project_name}` : poId;
            return onDeletePO(poId, infoString);
          }}
          onShowProgress={onShowProgress}
          currentUserRole={userRole}
        />
      );
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Kelola Order</h1>
          <p>Pantau dan kelola semua pesanan produksi dengan fitur sort dan filter</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Marketing bisa kirim request */}
          {userRole === 'marketing' && (
            <Button onClick={onAddPO}>+ Request Order Baru</Button>
          )}
          {/* Admin/manager tetap bisa tambah PO langsung */}
          {(userRole === 'manager' || userRole === 'admin') && (
            <Button onClick={onAddPO}>+ Tambah Order Baru</Button>
          )}
        </div>
      </div>

      {/* [BARU] Section request masuk — hanya tampil untuk admin */}
      {!isLoading && renderRequestedSection()}

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
        <button className={`view-switcher-btn ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
          Order Aktif ({activeTab === 'active' ? filteredAndSortedPOs.length : listByTab.filter(po => po.status !== 'Completed' && po.status !== 'Cancelled').length})
        </button>
        <button className={`view-switcher-btn ${activeTab === 'completed' ? 'active' : ''}`} onClick={() => setActiveTab('completed')}>
          Order Selesai ({activeTab === 'completed' ? filteredAndSortedPOs.length : listByTab.filter(po => po.status === 'Completed').length})
        </button>
      </div>

      {renderContent()}
    </div>
  );
};

export default POListPage;