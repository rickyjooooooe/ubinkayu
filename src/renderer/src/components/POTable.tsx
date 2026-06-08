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
  // Helper untuk memparsing tanggal dari string secara lokal agar aman dari offset timezone
  const parseLocalDate = (dateStr?: string | null): Date | null => {
    if (!dateStr || typeof dateStr !== 'string') return null
    const trimmed = dateStr.trim()
    if (!trimmed || trimmed === '-') return null

    // 1. Format YYYY-MM-DD atau YYYY/MM/DD
    const ymdMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10)
      const month = parseInt(ymdMatch[2], 10) - 1
      const day = parseInt(ymdMatch[3], 10)
      return new Date(year, month, day)
    }

    // 2. Format DD/MM/YYYY atau DD-MM-YYYY
    const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10)
      const month = parseInt(dmyMatch[2], 10) - 1
      const year = parseInt(dmyMatch[3], 10)
      return new Date(year, month, day)
    }

    // 3. Fallback ke parser bawaan JS
    const parsed = new Date(trimmed)
    if (!isNaN(parsed.getTime())) {
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
    }

    return null
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-'
    const parsed = parseLocalDate(dateString)
    if (!parsed) return dateString
    return parsed.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  }

  // Memeriksa apakah tanggal kirim sudah lewat (hanya untuk order yang belum Selesai/Batal)
  const isDeadlinePassed = (deadlineString?: string, status?: string) => {
    if (!deadlineString) return false
    const lowerStatus = (status || '').toLowerCase()
    if (
      lowerStatus === 'completed' ||
      lowerStatus === 'cancelled' ||
      lowerStatus === 'selesai' ||
      lowerStatus === 'batal'
    )
      return false

    const deadlineDate = parseLocalDate(deadlineString)
    if (!deadlineDate) return false

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    return deadlineDate < today
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
              <td
                style={
                  isDeadlinePassed(order.deadline, order.status)
                    ? { color: 'var(--color-text-error, #d92121)', fontWeight: 'bold' }
                    : undefined
                }
              >
                {formatDate(order.deadline)}
              </td>
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
                {order.acc_marketing || '-'} {/* <-- Tampilkan langsung dari order.acc_marketing */}
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
                  {(currentUserRole === 'manager' || currentUserRole?.toLowerCase() === 'orang pabrik') && (
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
