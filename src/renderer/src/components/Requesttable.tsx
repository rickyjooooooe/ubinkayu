// file: src/renderer/src/components/RequestTable.tsx

import React from 'react'
import { POHeader } from '../types'
import { Button } from './Button'

interface RequestTableProps {
  requestList: POHeader[]
  onShowDetail: (po: POHeader) => void
  onConfirmRequest: (po: POHeader) => void
  currentUserRole?: string | null
}

const RequestTable: React.FC<RequestTableProps> = ({
  requestList,
  onShowDetail,
  onConfirmRequest,
  currentUserRole
}) => {
  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  }

  const formatRupiah = (val?: string | number | null) => {
    if (!val) return '-'
    const n = Number(val)
    if (isNaN(n) || n === 0) return '-'
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(n)
  }

  const getPriorityClass = (priority?: string) => {
    const p = priority?.toLowerCase()
    if (p === 'urgent') return 'urgent'
    if (p === 'high') return 'high'
    return 'normal'
  }

  return (
    <div className="po-table-container">
      <table className="po-table">
        <thead>
          <tr>
            <th>Nomor PO</th>
            <th>Customer</th>
            <th>Marketing</th>
            <th>Target Kirim</th>
            <th>Prioritas</th>
            <th>Valuasi Project</th>
            <th>Alamat Kirim</th>
            <th>Catatan</th>
            <th>Tgl Request</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {requestList.length === 0 ? (
            <tr>
              <td colSpan={10} style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-secondary)' }}>
                Belum ada request project masuk dari marketing.
              </td>
            </tr>
          ) : (
            requestList.map((po) => (
              <tr key={po.id}>
                {/* Nomor PO */}
                <td>
                  <div className="customer-cell">
                    <strong>{po.po_number}</strong>
                    <span>ID: {po.id}</span>
                  </div>
                </td>

                {/* Customer */}
                <td>
                  <div className="customer-cell">
                    <strong>{po.project_name}</strong>
                  </div>
                </td>

                {/* Marketing */}
                <td>
                  <span className="status-badge" style={{
                    background: 'var(--color-background-info)',
                    color: 'var(--color-text-info)',
                    borderRadius: '20px',
                    padding: '3px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    whiteSpace: 'nowrap'
                  }}>
                    {po.acc_marketing || '-'}
                  </span>
                </td>

                {/* Target Kirim */}
                <td>{formatDate(po.deadline)}</td>

                {/* Prioritas */}
                <td>
                  <span className={`status-badge ${getPriorityClass(po.priority)}`}>
                    {po.priority || 'Normal'}
                  </span>
                </td>

                {/* Valuasi Project */}
                <td>
                  <strong>{formatRupiah((po as any).project_valuation)}</strong>
                </td>

                {/* Alamat Kirim */}
                <td style={{ maxWidth: '160px' }}>
                  <span style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    color: 'var(--color-text-secondary)',
                    fontSize: '13px'
                  } as React.CSSProperties}>
                    {po.alamat_kirim || '-'}
                  </span>
                </td>

                {/* Catatan */}
                <td style={{ maxWidth: '180px' }}>
                  <span style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    color: 'var(--color-text-secondary)',
                    fontSize: '13px'
                  } as React.CSSProperties}>
                    {po.notes || '-'}
                  </span>
                </td>

                {/* Tgl Request */}
                <td>{formatDate(po.created_at)}</td>

                {/* Aksi */}
                <td>
                  <div className="actions-cell">
                    <Button variant="secondary" onClick={() => onShowDetail(po)}>
                      Detail
                    </Button>
                    {(currentUserRole === 'admin' || currentUserRole === 'manager') && (
                      <Button onClick={() => onConfirmRequest(po)}>
                        + Buat Order
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export default RequestTable