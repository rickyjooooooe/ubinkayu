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

  return (
    <div className="po-table-container">
      <table className="po-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Tanggal Masuk</th>
            <th>Target Kirim</th>
            {/* --- KOLOM BARU DITAMBAHKAN DI SINI --- */}
            <th>Jenis Kayu & Produk</th>
            <th>Total Kubikasi</th>
            {/* --- AKHIR KOLOM BARU --- */}
            <th>Prioritas</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {poList.map((po) => (
            <tr key={po.id}>
              {/* Nomor PO dipindahkan ke dalam Customer untuk menghemat ruang */}
              <td>
                <div className="customer-cell">
                  <strong>{po.project_name}</strong>
                  <span>PO: {po.po_number}</span>
                </div>
              </td>
              <td>{formatDate(po.created_at)}</td>
              <td>{formatDate(po.deadline)}</td>
              {/* --- SEL BARU UNTUK MENAMPILKAN ITEM --- */}
              <td className="product-list-cell">
                {po.items && po.items.length > 0 ? (
                  <ul>
                    {po.items.map((item) => (
                      <li key={item.id}>
                        {item.product_name} ({item.wood_type || 'N/A'})
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span>-</span>
                )}
              </td>
              {/* --- SEL BARU UNTUK KUBIKASI --- */}
              <td>
                {Number(po.kubikasi_total || 0).toFixed(3)} m³
              </td>
              {/* --- AKHIR SEL BARU --- */}
              <td>
                <span className={`status-badge ${(po.priority || 'Normal').toLowerCase()}`}>
                  {po.priority || 'Normal'}
                </span>
              </td>
              <td>
                <span className={`status-badge status-${(po.status || 'open').toLowerCase().replace(' ', '-')}`}>
                  {po.status || 'Open'}
                </span>
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