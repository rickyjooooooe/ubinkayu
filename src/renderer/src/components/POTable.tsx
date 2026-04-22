// file: src/renderer/src/components/POTable.tsx

import React from 'react'
import { POHeader, POItem } from '../types' // Import POItem
import { Button } from './Button'
import { ProgressBar } from './ProgressBar'

interface POTableProps {
  poList: POHeader[]
  // onDeletePO now accepts OrderInfo string
  onDeletePO: (orderId: string, OrderInfo: string) => Promise<void>
  onEditPO: (order: POHeader) => void
  onShowDetail: (order: POHeader) => void
  onShowProgress: (order: POHeader) => void
  currentUserRole?: string | null
}

const POTable: React.FC<POTableProps> = ({
  poList,
  onDeletePO,
  onEditPO,
  onShowDetail,
  onShowProgress,
  currentUserRole
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
    if (!items || items.length === 0) return <span>-</span>
    return (
      <ul>
        {items.map((item, index) => (
          <li key={item.id || index}>
            {/* Display value or '-' if empty */}
            {String(item[key] || '-')}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="order-table-container">
      <table className="order-table">
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
            <th>Sample</th> {/* New Column */}
            <th>Marketing</th> {/* New Column */}
            <th>Location</th> {/* New Column */}
            <th>Prioritas</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {poList.map((order) => (
            <tr key={order.id}>
              <td>
                <div className="customer-cell">
                  <strong>{order.project_name}</strong>
                  <span>PO: {order.order_number}</span>
                </div>
              </td>
              <td>{order.lastRevisedBy || '-'}</td>
              <td>{formatLastRevisedDate(order.lastRevisedDate)}</td>
              <td>{formatDate(order.created_at)}</td>
              <td>{formatDate(order.deadline)}</td>
              {/* Jenis Kayu & Produk (Including Kubikasi per item) */}
              <td className="product-list-cell">
                {order.items && order.items.length > 0 ? (
                  <ul>
                    {order.items.map((item) => (
                      <li key={item.id || `${order.id}-${item.product_name}`}>
                        <span>
                          {item.product_name} ({item.wood_type || 'N/A'})
                        </span>
                        <strong>{Number(item.kubikasi || 0).toFixed(4)} m³</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span>-</span>
                )}
              </td>
              <td>{Number(order.kubikasi_total || 0).toFixed(3)} m³</td>
              {/* New Columns */}
              <td className="product-list-cell">{renderItemList(order.items, 'finishing')}</td>
              <td className="product-list-cell">{renderItemList(order.items, 'sample')}</td>
              <td>
                {order.marekting || '-'} {/* <-- Tampilkan langsung dari order.marekting */}
              </td>
              <td className="product-list-cell">{renderItemList(order.items, 'location')}</td>
              {/* End of New Columns */}

              <td>
                <span className={`status-badge ${(order.priority || 'Normal').toLowerCase()}`}>
                  {order.priority || 'Normal'}
                </span>
              </td>
              <td>
                <span className={getStatusBadgeClass(order.status)}>{order.status || 'Open'}</span>
              </td>
              <td>
                <div className="progress-cell">
                  <span>{order.progress?.toFixed(0) || 0}%</span>
                  <ProgressBar value={order.progress || 0} />
                </div>
              </td>
              <td>
                <div className="actions-cell">
                  {/* --- [PERUBAHAN LOGIKA DI SINI] --- */}

                  {/* Tombol Detail: Tampil untuk semua */}
                  <Button variant="secondary" onClick={() => onShowDetail(order)}>
                    Detail
                  </Button>

                  {/* Tombol Revisi: Hanya manager & admin */}
                  {(currentUserRole === 'manager' || currentUserRole === 'admin') && (
                    <Button onClick={() => onEditPO(order)}>Revisi</Button>
                  )}

                  {/* Tombol Update: Hanya manager & orang pabrik */}
                  {(currentUserRole === 'manager' || currentUserRole === 'orang pabrik') && (
                    <Button variant="primary" onClick={() => onShowProgress(order)}>
                      Update
                    </Button>
                  )}

                  {/* Tombol Hapus: Hanya manager & admin */}
                  {(currentUserRole === 'manager' || currentUserRole === 'admin') && (
                    <Button
                      variant="danger"
                      onClick={() => onDeletePO(order.id, `${order.order_number} - ${order.project_name}`)}
                    >
                      Hapus
                    </Button>
                  )}

                  {/* --- [AKHIR PERUBAHAN LOGIKA] --- */}
                </div>
              </td>
            </tr>
          ))}
          {poList.length === 0 && (
            // Update colspan to 15 (original 11 + 4 new columns)
            <tr>
              <td colSpan={15}>Tidak ada PO aktif yang cocok.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default POTable
