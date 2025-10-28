/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/ban-ts-comment */

// [DIUBAH] Impor React dan hooks yang diperlukan
import React, { useMemo } from 'react'
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

import { LuPackage, LuHourglass, LuCheck, LuHardDrive } from 'react-icons/lu'

import { useWindowWidth } from '../hooks/useWindowWidth'
// [DIHAPUS] Tidak perlu apiService untuk GDrive lagi
// import * as apiService from '../apiService'

interface DashboardPageProps {
  poList: POHeader[]
  isLoading: boolean
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

const DashboardPage: React.FC<DashboardPageProps> = ({ poList, isLoading }) => {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 500

  // [DIHAPUS] State untuk GDrive (driveUsageMB, driveError, isDriveLoading) tidak diperlukan lagi.
  // [DIHAPUS] useEffect untuk fetchDriveSize() tidak diperlukan lagi.

  const dashboardData = useMemo(() => {
    if (!poList || poList.length === 0) {
      return {
        totalPOs: 0,
        activePOs: 0,
        completedPOs: 0,
        dailyPOData: [],
        statusPOData: [],
        nearingDeadlinePOs: [],
        totalDriveUsageMB: 0 // [BARU]
      }
    }

    // [PERBAIKAN] Logika kalkulasi GDrive diletakkan di sini
    let totalDriveUsageBytes = 0
    poList.forEach((po) => {
      // @ts-ignore
      totalDriveUsageBytes += Number(po.file_size_bytes || 0)
    })

    const totalPOs = poList.length
    const activePOs = poList.filter(
      (po) => po.status !== 'Completed' && po.status !== 'Cancelled'
    ).length
    const completedPOs = poList.filter((po) => po.status === 'Completed').length

    // [MODIFIKASI] Data dihitung per HARI, bukan per bulan
    const dailyCounts = poList.reduce((acc, po) => {
      const day = new Date(po.created_at).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short'
      })
      acc[day] = (acc[day] || 0) + 1
      return acc
    }, {})

    const completedCounts = poList.reduce((acc, po) => {
      if (po.status === 'Completed' && po.completed_at) {
        const day = new Date(po.completed_at).toLocaleDateString('id-ID', {
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
      'PO Baru': dailyCounts[day] || 0,
      'PO Selesai': completedCounts[day] || 0
    }))

    const statusCounts = poList.reduce((acc, po) => {
      const status = po.status || 'Open'
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {})
    const statusPOData = Object.keys(statusCounts).map((status) => ({
      name: status,
      value: statusCounts[status]
    }))

    const today = new Date()
    const nextTwoWeeks = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000)
    const nearingDeadlinePOs = poList
      .filter((po) => {
        if (!po.deadline || po.status === 'Completed' || po.status === 'Cancelled') return false
        const deadlineDate = new Date(po.deadline)
        return deadlineDate >= today && deadlineDate <= nextTwoWeeks
      })
      .sort((a, b) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime())

    // [PERBAIKAN] Pastikan semua nilai dikembalikan dari useMemo
    return {
      totalPOs,
      activePOs,
      completedPOs,
      dailyPOData,
      statusPOData,
      nearingDeadlinePOs,
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
      return { totalPOs: 0, activePOs: 0, completedPOs: 0, gdriveUsageMB: 0 };
    }
    const totalPOs = poList.length;
    const activePOs = poList.filter(p => p.status !== 'Completed' && p.status !== 'Cancelled').length;
    const completedPOs = poList.filter(p => p.status === 'Completed').length;
    // Calculate GDrive usage (sum file_size_bytes and convert to MB)
    const totalBytes = poList.reduce((sum, po) => sum + Number(po.file_size_bytes || 0), 0);
    const gdriveUsageMB = totalBytes / (1024 * 1024); // Convert bytes to MB

    return {
      totalPOs,
      activePOs,
      completedPOs,
      gdriveUsageMB: gdriveUsageMB.toFixed(2) // Format to 2 decimal places
    };
  }, [poList])

  if (isLoading) {
    // You might want a better loading indicator
    return <div className="page-container" style={{ textAlign: 'center', paddingTop: '5rem' }}>Loading Dashboard Data...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Dashboard PO UbinKayu</h1>
          <p>Ringkasan aktivitas produksi PT Ubinkayu — {todayFormatted}</p>
        </div>
      </div>

      {!isLoading && dashboardData.nearingDeadlinePOs.length > 0 && (
        <Card className="attention-card">
          <h4>Perhatian!</h4>
          <p>
            Ada <strong>{dashboardData.nearingDeadlinePOs.length} Purchase Order</strong> yang akan
            jatuh tempo dalam 14 hari ke depan.
          </p>

          {/* [MODIFIKASI] Ganti bagian ini dengan struktur yang lebih rapi */}
          <div className="attention-list">
            {dashboardData.nearingDeadlinePOs.map((po) => (
              <div key={po.id} className="attention-item">
                <div>
                  {' '}
                  {/* Wrapper untuk teks */}
                  <p className="attention-line-1">
                    <strong>{po.po_number}</strong>
                    <span className="customer-name"> - {po.project_name}</span>
                  </p>
                  <p className="attention-line-2">
                    Deadline:{' '}
                    {new Date(po.deadline || 0).toLocaleDateString('id-ID', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </p>
                </div>
                {/* Di sini Anda bisa menambahkan tombol jika perlu */}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* [DIUBAH] Pastikan Anda memiliki CSS untuk 4 kolom */}
      <div className="dashboard-summary-grid">
        <StatCard
          title="Total Purchase Order"
          value={summaryStats.totalPOs}
          icon={LuPackage}
          cardClassName="total-po-card" // Class for specific styling
        />
        <StatCard
          title="PO Aktif (Produksi)"
          value={summaryStats.activePOs}
          icon={LuHourglass}
          cardClassName="active-po-card"
        />
        <StatCard
          title="PO Selesai"
          value={summaryStats.completedPOs}
          icon={LuCheck}
          cardClassName="completed-po-card"
        />
        <StatCard
          title="Penggunaan GDrive"
          value={`${summaryStats.gdriveUsageMB} MB`} // Add MB unit
          icon={LuHardDrive}
          cardClassName="gdrive-card"
        />
      </div>

      <div className="dashboard-widgets-grid">
        {/* Grafik LineChart (Tidak Berubah) */}
        <Card>
          <h4>Purchase Order Baru per Hari</h4>
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
                  dataKey="PO Baru"
                  stroke="#8884d8"
                  strokeWidth={2}
                  activeDot={{ r: 8 }}
                />
                <Line type="monotone" dataKey="PO Selesai" stroke="#38A169" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Grafik PieChart (Tidak Berubah) */}
        <Card>
          <h4>Komposisi Status PO</h4>
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
        <h4>🚨 PO Mendekati Deadline (14 Hari ke Depan)</h4>
        {isLoading ? (
          <p>Memuat data...</p>
        ) : dashboardData.nearingDeadlinePOs.length > 0 ? (
          <div className="table-container">
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Nomor PO</th>
                  <th>Customer</th>
                  <th>Deadline</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {dashboardData.nearingDeadlinePOs.map((po) => (
                  <tr key={po.id}>
                    <td>{po.po_number}</td>
                    <td>{po.project_name}</td>
                    <td>{new Date(po.deadline || 0).toLocaleDateString('id-ID')}</td>
                    <td>
                      <span
                        className={`status-badge status-${(po.status || 'open').toLowerCase().replace(' ', '-')}`}
                      >
                        {po.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Tidak ada PO yang mendekati deadline. Kerja bagus! 👍</p>
        )}
      </Card>
    </div>
  )
}

export default DashboardPage
