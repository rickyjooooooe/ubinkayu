// file: src/renderer/src/pages/CommissionView.tsx

import React, { useState, useEffect, useMemo } from 'react'
import * as apiService from '../apiService'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'

interface User { name: string; role?: string }

interface CommissionItem {
  order_id: string
  order_number: string
  project_name: string
  marketing_name: string
  commission_rate: number
  project_valuation: number
  commission_amount: number
  status: string
  deadline: string | null
  created_at: string
}

interface CommissionViewProps { currentUser: User | null }

const ORANGE = '#f97316'
const BAR_COLORS = ['#f97316','#fb923c','#fdba74','#fed7aa','#fcd34d','#fbbf24']

const CommissionView: React.FC<CommissionViewProps> = ({ currentUser }) => {
  const [data, setData] = useState<CommissionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const userRole = currentUser?.role
  const isAdminOrManager = userRole === 'admin' || userRole === 'manager'

  const loadData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await (apiService as any).getCommissionData(currentUser)
      if (Array.isArray(result)) setData(result)
      else throw new Error(result?.error || 'Format data tidak valid.')
    } catch (err: any) {
      setError(err.message || 'Gagal memuat data komisi.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadData() }, [currentUser])

  // Filter by date range
  const filtered = useMemo(() => {
    let result = [...data]
    if (dateFrom) {
      const from = new Date(dateFrom)
      result = result.filter(d => d.created_at && new Date(d.created_at) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo)
      to.setDate(to.getDate() + 1)
      result = result.filter(d => d.created_at && new Date(d.created_at) < to)
    }
    return result
  }, [data, dateFrom, dateTo])

  // Summary stats
  const summary = useMemo(() => {
    const totalKomisi = filtered.reduce((a, d) => a + (d.commission_amount || 0), 0)
    const totalValuasi = filtered.reduce((a, d) => a + (d.project_valuation || 0), 0)
    const marketingSet = new Set(filtered.map(d => d.marketing_name).filter(Boolean))

    // Per marketing aggregation
    const byMarketing: Record<string, { name: string; totalKomisi: number; totalValuasi: number; count: number; rate: number }> = {}
    filtered.forEach(d => {
      if (!byMarketing[d.marketing_name]) {
        byMarketing[d.marketing_name] = { name: d.marketing_name, totalKomisi: 0, totalValuasi: 0, count: 0, rate: d.commission_rate }
      }
      byMarketing[d.marketing_name].totalKomisi += d.commission_amount || 0
      byMarketing[d.marketing_name].totalValuasi += d.project_valuation || 0
      byMarketing[d.marketing_name].count++
    })

    return {
      totalKomisi,
      totalValuasi,
      totalProject: filtered.length,
      totalMarketing: marketingSet.size,
      byMarketing: Object.values(byMarketing).sort((a, b) => b.totalKomisi - a.totalKomisi)
    }
  }, [filtered])

  // Chart data
  const chartData = useMemo(() =>
    summary.byMarketing.map(m => ({ name: m.name, komisi: m.totalKomisi }))
  , [summary.byMarketing])

  const formatRupiah = (val: number) => {
    if (!val || isNaN(val)) return 'Rp 0'
    if (val >= 1_000_000_000) return `Rp ${(val / 1_000_000_000).toFixed(1).replace('.', ',')} M`
    if (val >= 1_000_000) return `Rp ${(val / 1_000_000).toFixed(1).replace('.', ',')} jt`
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)
  }

  const formatRupiahFull = (val: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0)

  const formatChartY = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(0)}jt`
    if (val >= 1_000) return `${(val / 1_000).toFixed(0)}rb`
    return `${val}`
  }

  const handleFilter = () => loadData()

  const handleExportExcel = () => {
    // Simple CSV export
    const headers = ['Marketing', 'Total Project', 'Total Penjualan', 'Rate (%)', 'Komisi']
    const rows = summary.byMarketing.map(m => [
      m.name, m.count, m.totalValuasi, m.rate, m.totalKomisi
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'komisi_marketing.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) return (
    <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px', flexDirection: 'column', gap: '12px' }}>
      <style>{`@keyframes comm-spin { to { transform: rotate(360deg) } }`}</style>
      <div style={{ width: '36px', height: '36px', border: '3px solid #fed7aa', borderTopColor: ORANGE, borderRadius: '50%', animation: 'comm-spin 0.8s linear infinite' }} />
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Memuat data komisi...</p>
    </div>
  )

  if (error) return (
    <div className="page-container">
      <Card><p style={{ color: 'var(--color-text-danger)' }}>❌ {error}</p></Card>
    </div>
  )

  return (
    <div className="page-container">
      <style>{`
        .comm-tr:hover td { background: var(--color-background-secondary); }
        .comm-badge-paid { background: #dcfce7; color: #16a34a; padding: 3px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; }
        .comm-badge-unpaid { background: #fef9c3; color: #92400e; padding: 3px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; }
      `}</style>

      {/* ── Header ── */}
      <div className="page-header" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Komisi Marketing</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: '14px' }}>
            Tracking komisi berdasarkan penjualan project
          </p>
        </div>
      </div>

      {/* ── Filter Tanggal ── */}
      <Card style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '180px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Dari Tanggal</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', fontSize: '13px', borderRadius: '8px', border: '0.5px solid var(--color-border-secondary)', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', boxSizing: 'border-box' as const }} />
          </div>
          <div style={{ flex: 1, minWidth: '180px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Sampai Tanggal</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', fontSize: '13px', borderRadius: '8px', border: '0.5px solid var(--color-border-secondary)', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', boxSizing: 'border-box' as const }} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleFilter} style={{ padding: '9px 18px', background: ORANGE, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
              📅 Filter
            </button>
            {isAdminOrManager && (
              <button onClick={handleExportExcel} style={{ padding: '9px 18px', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-secondary)', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                ↓ Export Excel
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* ── Stat Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '1.5rem' }}>
        {/* Total Marketing */}
        {isAdminOrManager && (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: '8px' }}>Total Marketing</div>
                <div style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-1px', color: 'var(--color-text-primary)', lineHeight: 1 }}>{summary.totalMarketing}</div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '6px' }}>Marketing aktif</div>
              </div>
              <div style={{ width: '44px', height: '44px', background: '#eff6ff', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>👥</div>
            </div>
          </Card>
        )}

        {/* Total Project */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: '8px' }}>Total Project</div>
              <div style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-1px', color: 'var(--color-text-primary)', lineHeight: 1 }}>{summary.totalProject}</div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '6px' }}>Project terjual</div>
            </div>
            <div style={{ width: '44px', height: '44px', background: '#f5f3ff', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>📋</div>
          </div>
        </Card>

        {/* Total Penjualan */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: '8px' }}>Total Penjualan</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>{formatRupiahFull(summary.totalValuasi)}</div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '6px' }}>Periode saat ini</div>
            </div>
            <div style={{ width: '44px', height: '44px', background: '#f0fdf4', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>📈</div>
          </div>
        </Card>

        {/* Total Komisi */}
        <Card style={{ borderColor: '#fed7aa', background: '#fff7ed' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#c2410c', fontWeight: 500, marginBottom: '8px' }}>Total Komisi</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: ORANGE, lineHeight: 1.2 }}>{formatRupiahFull(summary.totalKomisi)}</div>
              <div style={{ fontSize: '12px', color: '#c2410c', marginTop: '6px' }}>Total komisi marketing</div>
            </div>
            <div style={{ width: '44px', height: '44px', background: '#ffedd5', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>💰</div>
          </div>
        </Card>
      </div>

      {/* ── Bar Chart ── */}
      {isAdminOrManager && chartData.length > 0 && (
        <Card style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: 'var(--color-text-primary)' }}>Komisi per Marketing</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 8, right: 16, left: 16, bottom: 8 }}>
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' as string }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatChartY} tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' as string }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(val: number) => [formatRupiahFull(val), 'Komisi']}
                contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '0.5px solid var(--color-border-secondary)' }}
              />
              <Bar dataKey="komisi" radius={[6, 6, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Tabel Detail Per Marketing ── */}
      {isAdminOrManager && (
        <Card style={{ padding: 0, overflow: 'hidden', marginBottom: '1.5rem' }}>
          <div style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Detail Komisi Marketing</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'var(--color-background-secondary)' }}>
                <th style={th}>Marketing</th>
                <th style={{ ...th, textAlign: 'center' }}>Total Project</th>
                <th style={{ ...th, textAlign: 'right' }}>Total Penjualan</th>
                <th style={{ ...th, textAlign: 'center' }}>Rate (%)</th>
                <th style={{ ...th, textAlign: 'right' }}>Komisi</th>
                <th style={{ ...th, textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.byMarketing.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>Tidak ada data</td></tr>
              ) : summary.byMarketing.map((m, idx) => (
                <tr key={m.name} className="comm-tr" style={{ borderTop: idx === 0 ? 'none' : '0.5px solid var(--color-border-tertiary)' }}>
                  <td style={td}>
                    <span style={{ color: ORANGE, fontWeight: 600, cursor: 'pointer' }}>{m.name}</span>
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>{m.count}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 500 }}>{formatRupiahFull(m.totalValuasi)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
                      {m.rate}%
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{formatRupiahFull(m.totalKomisi)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span className="comm-badge-paid">Paid</span>
                  </td>
                </tr>
              ))}
            </tbody>
            {summary.byMarketing.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: '1.5px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)' }}>
                  <td style={{ ...td, fontWeight: 600 }}>Total</td>
                  <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{summary.totalProject}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{formatRupiahFull(summary.totalValuasi)}</td>
                  <td />
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#16a34a', fontSize: '14px' }}>{formatRupiahFull(summary.totalKomisi)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </Card>
      )}

      {/* ── Tabel Detail Per Order (untuk marketing view atau detail) ── */}
      {!isAdminOrManager && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Detail Komisi per Order</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'var(--color-background-secondary)' }}>
                <th style={th}>Nomor Order</th>
                <th style={th}>Customer</th>
                <th style={th}>Tgl Masuk</th>
                <th style={{ ...th, textAlign: 'right' }}>Valuasi</th>
                <th style={{ ...th, textAlign: 'center' }}>Rate</th>
                <th style={{ ...th, textAlign: 'right' }}>Komisi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>💰</div>
                  <div>Tidak ada data komisi.</div>
                </td></tr>
              ) : filtered.map((item, idx) => (
                <tr key={item.order_id} className="comm-tr" style={{ borderTop: idx === 0 ? 'none' : '0.5px solid var(--color-border-tertiary)' }}>
                  <td style={td}><span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{item.order_number}</span></td>
                  <td style={td}><div style={{ fontWeight: 500 }}>{item.project_name}</div></td>
                  <td style={{ ...td, color: 'var(--color-text-secondary)' }}>{item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 500 }}>{formatRupiahFull(item.project_valuation)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '3px 9px', borderRadius: '6px', fontSize: '12px', fontWeight: 700 }}>
                      {item.commission_rate}%
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <span style={{ fontWeight: 800, fontSize: '14px', color: '#16a34a' }}>{formatRupiahFull(item.commission_amount)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'left', fontWeight: 600,
  color: 'var(--color-text-secondary)', fontSize: '11px',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  borderBottom: '0.5px solid var(--color-border-secondary)',
}
const td: React.CSSProperties = {
  padding: '12px 14px', verticalAlign: 'middle',
}

export default CommissionView