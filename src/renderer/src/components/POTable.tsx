// file: src/renderer/src/components/POTable.tsx

import React from 'react'
import { POHeader } from '../types'
import { Button } from './Button'
import { ProgressBar } from './ProgressBar'

interface POTableProps {
  poList: POHeader[]
  onDeletePO: (poId: string) => Promise<void>
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
  // [BARU] Fungsi format tanggal revisi terakhir (termasuk waktu)
  const formatLastRevisedDate = (d: string | undefined) =>
    d
      ? new Date(d).toLocaleString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '-'

  const getStatusBadgeClass = (s: string | undefined) =>
    `status-badge status-${(s || 'open').toLowerCase().replace(' ', '-')}`

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
              <td className="product-list-cell">
                {po.items && po.items.length > 0 ? (
                  <ul>
                    {/* --- PERUBAHAN KUNCI ADA DI SINI --- */}
                    {po.items.map((item) => (
                      <li key={item.id}>
                        <span>
                          {item.product_name} ({item.wood_type || 'N/A'})
                        </span>
                        <strong>{Number(item.kubikasi || 0).toFixed(4)} m³</strong>
                      </li>
                    ))}
                    {/* --- AKHIR PERUBAHAN --- */}
                  </ul>
                ) : (
                  <span>-</span>
                )}
              </td>
              <td>{Number(po.kubikasi_total || 0).toFixed(3)} m³</td>
              <td>
                <span className={`status-badge ${(po.priority || 'Normal').toLowerCase()}`}>
                  {po.priority || 'Normal'}
                </span>
              </td>
              <td>
                {/* SEKARANG: Panggil fungsi getStatusBadgeClass */}
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
                  <Button variant="secondary" onClick={() => onShowDetail(po)}>
                    Detail
                  </Button>
                  <Button onClick={() => onEditPO(po)}>Revisi</Button>
                  <Button variant="primary" onClick={() => onShowProgress(po)}>
                    Update
                  </Button>
                  <Button variant="danger" onClick={() => onDeletePO(po.id)}>
                    Hapus
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default POTable
