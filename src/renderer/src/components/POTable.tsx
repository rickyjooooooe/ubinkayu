// file: src/renderer/src/components/POTable.tsx

import React from 'react'
import { POHeader, POItem } from '../types' // Import POItem
import { Button } from './Button'
import { ProgressBar } from './ProgressBar'

interface POTableProps {
  poList: POHeader[]
  // onDeletePO now accepts poInfo string
  onDeletePO: (poId: string, poInfo: string) => Promise<void>
  onEditPO: (po: POHeader) => void
  onShowDetail: (po: POHeader) => void
  onShowProgress: (po: POHeader) => void
}

const POTable: React.FC<POTableProps> = ({
  poList,
  onDeletePO,
  onEditPO,
  onShowDetail,
  onShowProgress
}) => {
  const formatDate = (dateString?: string) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  }

  const formatLastRevisedDate = (d: string | undefined) =>
    d
      ? new Date(d).toLocaleString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
      : '-'

  const getStatusBadgeClass = (s: string | undefined) =>
    `status-badge status-${(s || 'open').toLowerCase().replace(' ', '-')}`

  // Helper to render list items or '-'
  const renderItemList = (items: POItem[] | undefined, key: keyof POItem) => {
     if (!items || items.length === 0) return <span>-</span>;
     return (
       <ul>
         {items.map((item, index) => (
           <li key={item.id || index}>
             {/* Display value or '-' if empty */}
             {String(item[key] || '-')}
           </li>
         ))}
       </ul>
     );
  }

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
            <th>Finishing</th> {/* New Column */}
            <th>Sample</th>    {/* New Column */}
            <th>Marketing</th> {/* New Column */}
            <th>Location</th>  {/* New Column */}
           
            <th>Prioritas</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {poList.map((po) => (
            <tr key={po.id}>
              <td>
                <div className="customer-cell">
                  <strong>{po.project_name}</strong>
                  <span>PO: {po.po_number}</span>
                </div>
              </td>
              <td>{po.lastRevisedBy || '-'}</td>
              <td>{formatLastRevisedDate(po.lastRevisedDate)}</td>
              <td>{formatDate(po.created_at)}</td>
              <td>{formatDate(po.deadline)}</td>
              {/* Jenis Kayu & Produk (Including Kubikasi per item) */}
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
              {/* New Columns */}
              <td className="product-list-cell">{renderItemList(po.items, 'finishing')}</td>
              <td className="product-list-cell">{renderItemList(po.items, 'sample')}</td>
              <td className="product-list-cell">{renderItemList(po.items, 'marketing')}</td>
              <td className="product-list-cell">{renderItemList(po.items, 'location')}</td>
              {/* End of New Columns */}
              
              <td>
                <span className={`status-badge ${(po.priority || 'Normal').toLowerCase()}`}>
                  {po.priority || 'Normal'}
                </span>
              </td>
              <td>
                <span className={getStatusBadgeClass(po.status)}>{po.status || 'Open'}</span>
              </td>
              <td>
                <div className="progress-cell">
                  <span>{po.progress?.toFixed(0) || 0}%</span>
                  <ProgressBar value={po.progress || 0} />
                </div>
              </td>
              <td>
                <div className="actions-cell">
                  <Button variant="secondary" onClick={() => onShowDetail(po)}>Detail</Button>
                  <Button onClick={() => onEditPO(po)}>Revisi</Button>
                  <Button variant="primary" onClick={() => onShowProgress(po)}>Update</Button>
                  <Button
                    variant="danger"
                    onClick={() => onDeletePO(po.id, `${po.po_number} - ${po.project_name}`)}
                  >
                    Hapus
                  </Button>
                </div>
              </td>
            </tr>
          ))}
           {poList.length === 0 && (
             // Update colspan to 15 (original 11 + 4 new columns)
             <tr><td colSpan={15}>Tidak ada PO aktif yang cocok.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default POTable