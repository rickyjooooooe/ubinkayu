/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/ban-ts-comment */

// [DIUBAH] Impor React dan hooks yang diperlukan
import React, { useMemo, useState } from 'react'
import { POHeader } from '../types'
import { Card } from '../components/Card'

import {
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts'

import { LuPackage, LuHourglass, LuCheck } from 'react-icons/lu'

import { useWindowWidth } from '../hooks/useWindowWidth'
// [DIHAPUS] Tidak perlu apiService untuk GDrive lagi
// import * as apiService from '../apiService'

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

interface DashboardPageProps {
  poList: POHeader[]
  isLoading: boolean
  onShowDetail?: (order: POHeader) => void
}

const StatCard = ({ title, value, icon: IconComponent, cardClassName }) => (
  <Card className={`summary-card ${cardClassName || ''}`}>
    <div className="card-content">
      <span className="summary-value">{value ?? '-'}</span> {/* Handle null/undefined */}
      <p className="summary-label">{title}</p>
    </div>
    {IconComponent && <IconComponent className="summary-icon" />}
  </Card>
)

const DashboardPage: React.FC<DashboardPageProps> = ({ poList, isLoading, onShowDetail }) => {
  const [isOverdueExpanded, setIsOverdueExpanded] = useState(false)
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 500

  // [DIHAPUS] State untuk GDrive (driveUsageMB, driveError, isDriveLoading) tidak diperlukan lagi.
  // [DIHAPUS] useEffect untuk fetchDriveSize() tidak diperlukan lagi.

  const dashboardData = useMemo(() => {
    if (!poList || poList.length === 0) {
      return {
        totalPOs: 0,
        activeOrders: 0,
        completedPOs: 0,
        dailyPOData: [],
        statusPOData: [],
        nearingDeadlinePOs: [],
        overduePOs: [],
        totalDriveUsageMB: 0 // [BARU]
      }
    }

    // [PERBAIKAN] Logika kalkulasi GDrive diletakkan di sini
    let totalDriveUsageBytes = 0
    poList.forEach((order) => {
      // @ts-ignore
      totalDriveUsageBytes += Number(order.file_size_bytes || 0)
    })

    const totalPOs = poList.length
    const activeOrders = poList.filter(
      (order) => order.status !== 'Completed' && order.status !== 'Cancelled'
    ).length
    const completedPOs = poList.filter((order) => order.status === 'Completed').length

    // [MODIFIKASI] Data dihitung per HARI, bukan per bulan
    const dailyCounts = poList.reduce((acc, order) => {
      const day = new Date(order.created_at).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short'
      })
      acc[day] = (acc[day] || 0) + 1
      return acc
    }, {})

    const completedCounts = poList.reduce((acc, order) => {
      if (order.status === 'Completed' && order.completed_at) {
        const day = new Date(order.completed_at).toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short'
        })
        acc[day] = (acc[day] || 0) + 1
      }
      return acc
    }, {})

    const allDaysSet = new Set([...Object.keys(dailyCounts), ...Object.keys(completedCounts)])
    const allDaysSorted = Array.from(allDaysSet).sort((a, b) => {
      // [PERBAIKAN] Logika parsing tanggal yang lebih aman
      const [dayA, monthA] = a.split(' ')
      const [dayB, monthB] = b.split(' ')
      const dateA = new Date(`${dayA} ${monthA} ${new Date().getFullYear()}`)
      const dateB = new Date(`${dayB} ${monthB} ${new Date().getFullYear()}`)
      if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return 0 // Fallback
      return dateA.getTime() - dateB.getTime()
    })

    const dailyPOData = allDaysSorted.map((day) => ({
      name: day,
      'Order Baru': dailyCounts[day] || 0,
      'Order Selesai': completedCounts[day] || 0
    }))

    const statusCounts = poList.reduce((acc, order) => {
      const status = order.status || 'Open'
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {})
    const statusPOData = Object.keys(statusCounts).map((status) => ({
      name: status,
      value: statusCounts[status]
    }))

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const nextTwoWeeks = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000)

    const nearingDeadlinePOs = poList
      .filter((order) => {
        if (!order.deadline || order.status === 'Completed' || order.status === 'Cancelled') return false
        const deadlineDate = parseLocalDate(order.deadline)
        if (!deadlineDate) return false
        return deadlineDate >= today && deadlineDate <= nextTwoWeeks
      })
      .sort((a, b) => {
        const dateA = parseLocalDate(a.deadline)
        const dateB = parseLocalDate(b.deadline)
        return (dateA?.getTime() || 0) - (dateB?.getTime() || 0)
      })

    const overduePOs = poList
      .filter((order) => {
        if (!order.deadline) return false
        const lowerStatus = (order.status || '').toLowerCase()
        if (
          lowerStatus === 'completed' ||
          lowerStatus === 'cancelled' ||
          lowerStatus === 'selesai' ||
          lowerStatus === 'batal'
        )
          return false
        const deadlineDate = parseLocalDate(order.deadline)
        if (!deadlineDate) return false
        return deadlineDate < today
      })
      .sort((a, b) => {
        const dateA = parseLocalDate(a.deadline)
        const dateB = parseLocalDate(b.deadline)
        return (dateA?.getTime() || 0) - (dateB?.getTime() || 0)
      })

    // [PERBAIKAN] Pastikan semua nilai dikembalikan dari useMemo
    return {
      totalPOs,
      activeOrders,
      completedPOs,
      dailyPOData,
      statusPOData,
      nearingDeadlinePOs,
      overduePOs,
      totalDriveUsageMB: totalDriveUsageBytes / (1024 * 1024) // Konversi ke MB
    }
  }, [poList]) // Dependensi hanya poList

  const todayFormatted = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const PIE_COLORS = {
    Open: '#3182CE',
    'In Progress': '#D69E2E',
    Completed: '#38A169',
    Cancelled: '#E53E3E'
  }

  const summaryStats = useMemo(() => {
    if (!Array.isArray(poList)) {
      return { totalPOs: 0, activeOrders: 0, completedPOs: 0, gdriveUsageMB: 0 };
    }
    const totalPOs = poList.length;
    const activeOrders = poList.filter(p => p.status !== 'Completed' && p.status !== 'Cancelled').length;
    const completedPOs = poList.filter(p => p.status === 'Completed').length;
    // Calculate GDrive usage (sum file_size_bytes and convert to MB)
    const totalBytes = poList.reduce((sum, order) => sum + Number(order.file_size_bytes || 0), 0);
    const gdriveUsageMB = totalBytes / (1024 * 1024); // Convert bytes to MB

    return {
      totalPOs,
      activeOrders,
      completedPOs,
      gdriveUsageMB: gdriveUsageMB.toFixed(2) // Format to 2 decimal places
    };
  }, [poList])

  if (isLoading) {
    // You might want a better loading indicator
    return <div className="page-container" style={{ textAlign: 'center', paddingTop: '5rem' }}>Loading Dashboard Data...</div>;
  }
  const visibleOverduePOs = isOverdueExpanded
    ? dashboardData.overduePOs
    : dashboardData.overduePOs.slice(0, 5)

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Dashboard Order UbinKayu</h1>
          <p>Ringkasan aktivitas produksi PT Ubinkayu — {todayFormatted}</p>
        </div>
      </div>

      {!isLoading && dashboardData.overduePOs.length > 0 && (
        <Card className="attention-card" style={{ backgroundColor: '#FEF2F2', borderLeft: '4px solid #EF4444', padding: '20px' }}>
          <h4 style={{ color: '#991B1B', margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600 }}>🚨 Perhatian! Terlewat Deadline ({dashboardData.overduePOs.length} Order)</h4>
          <p style={{ color: '#7F1D1D', fontSize: '13.5px', margin: '0 0 16px 0', lineHeight: 1.4 }}>
            Order berikut telah melewati target tanggal kirim tetapi belum selesai diproduksi:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {visibleOverduePOs.map((order, idx) => (
              <div
                key={order.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 4px',
                  borderBottom: idx === visibleOverduePOs.length - 1 ? 'none' : '1px solid #FCA5A5'
                }}
              >
                {/* Bagian Kiri: Info Order dan Customer */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <strong style={{ color: '#991B1B', fontSize: '14px' }}>{order.order_number}</strong>
                  <span style={{ color: '#7F1D1D', fontSize: '14px' }}>- {order.project_name}</span>
                </div>

                {/* Bagian Kanan: Badge Lewat dan Detail Link */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
                  <span style={{ color: '#EF4444', fontWeight: 'bold', fontSize: '13px' }}>
                    Lewat: {(() => {
                      const parsed = parseLocalDate(order.deadline)
                      return parsed
                        ? parsed.toLocaleDateString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric'
                          })
                        : order.deadline
                    })()}
                  </span>
                  {onShowDetail && (
                    <button
                      onClick={() => onShowDetail(order)}
                      style={{
                        background: '#EF4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = '#DC2626')}
                      onMouseOut={(e) => (e.currentTarget.style.background = '#EF4444')}
                    >
                      Detail
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {dashboardData.overduePOs.length > 5 && (
            <div style={{ textAlign: 'center', marginTop: '12px' }}>
              <button
                onClick={() => setIsOverdueExpanded(!isOverdueExpanded)}
                style={{
                  background: 'transparent',
                  color: '#991B1B',
                  border: '1px solid #FCA5A5',
                  borderRadius: '6px',
                  padding: '6px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = '#FEE2E2'
                  e.currentTarget.style.borderColor = '#EF4444'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.borderColor = '#FCA5A5'
                }}
              >
                {isOverdueExpanded ? 'Tampilkan Lebih Sedikit ▲' : `Tampilkan ${dashboardData.overduePOs.length - 5} Lainnya ▼`}
              </button>
            </div>
          )}
        </Card>
      )}

      {!isLoading && dashboardData.nearingDeadlinePOs.length > 0 && (
        <Card className="attention-card">
          <h4>Perhatian!</h4>
          <p>
            Ada <strong>{dashboardData.nearingDeadlinePOs.length} Order</strong> yang akan
            jatuh tempo dalam 14 hari ke depan.
          </p>

          {/* [MODIFIKASI] Daftar ini sekarang akan scrollable */}
          <div className="attention-list">
            {dashboardData.nearingDeadlinePOs.map((order) => (
              <div key={order.id} className="attention-item">

                {/* Bagian Kiri: Info Order dan Customer */}
                <div className="attention-info">
                  <p className="attention-line-1">
                    <strong>{order.order_number}</strong>
                    <span className="customer-name"> - {order.project_name}</span>
                  </p>
                </div>

                {/* Bagian Kanan: Badge Deadline yang ringkas */}
                <div className="attention-deadline-badge">
                  {new Date(order.deadline || 0).toLocaleDateString('id-ID', {
                    day: '2-digit',
                    month: 'short' // Dibuat ringkas (mis: Okt)
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* [DIUBAH] Pastikan Anda memiliki CSS untuk 4 kolom */}
      <div className="dashboard-summary-grid">
        <StatCard
          title="Total Order"
          value={summaryStats.totalPOs}
          icon={LuPackage}
          cardClassName="total-order-card" // Class for specific styling
        />
        <StatCard
          title="Order Aktif (Produksi)"
          value={summaryStats.activeOrders}
          icon={LuHourglass}
          cardClassName="active-order-card"
        />
        <StatCard
          title="Order Selesai"
          value={summaryStats.completedPOs}
          icon={LuCheck}
          cardClassName="completed-order-card"
        />
      </div>

      <div className="dashboard-widgets-grid">
        {/* Grafik LineChart (Tidak Berubah) */}
        <Card>
          <h4>Order Baru per Hari</h4>
          {isLoading ? (
            <p>Memuat data...</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={dashboardData.dailyPOData}
                margin={{ top: 20, right: 30, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="Order Baru"
                  stroke="#8884d8"
                  strokeWidth={2}
                  activeDot={{ r: 8 }}
                />
                <Line type="monotone" dataKey="Order Selesai" stroke="#38A169" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Grafik PieChart (Tidak Berubah) */}
        <Card>
          <h4>Komposisi Status Order</h4>
          {isLoading ? (
            <p>Memuat data...</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={dashboardData.statusPOData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={isMobile ? 60 : 100}
                  label={!isMobile}
                >
                  {dashboardData.statusPOData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[entry.name] || '#8884d8'} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend
                  layout={isMobile ? 'horizontal' : 'vertical'}
                  verticalAlign={isMobile ? 'bottom' : 'middle'}
                  align={isMobile ? 'center' : 'right'}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Tabel Deadline (Tidak Berubah) */}
      <Card>
        <h4>🚨 Order Mendekati Deadline (14 Hari ke Depan)</h4>
        {isLoading ? (
          <p>Memuat data...</p>
        ) : dashboardData.nearingDeadlinePOs.length > 0 ? (
          <div className="table-container">
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Nomor Order</th>
                  <th>Customer</th>
                  <th>Deadline</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {dashboardData.nearingDeadlinePOs.map((order) => (
                  <tr key={order.id}>
                    <td>{order.order_number}</td>
                    <td>{order.project_name}</td>
                    <td>{new Date(order.deadline || 0).toLocaleDateString('id-ID')}</td>
                    <td>
                      <span
                        className={`status-badge status-${(order.status || 'open').toLowerCase().replace(' ', '-')}`}
                      >
                        {order.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Tidak ada Order yang mendekati deadline. Kerja bagus! 👍</p>
        )}
      </Card>
    </div>
  )
}

export default DashboardPage