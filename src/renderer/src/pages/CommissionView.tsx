// file: src/renderer/src/pages/CommissionView.tsx

import React, { useState, useEffect, useMemo } from 'react'
import * as apiService from '../apiService'
import { Card } from '../components/Card'
import { Button } from '../components/Button'

interface User {
  name: string
  role?: string
}

interface CommissionItem {
  po_id: string
  po_number: string
  project_name: string
  marketing_name: string
  commission_rate: number
  project_valuation: number
  commission_amount: number
  status: string
  deadline: string | null
  created_at: string
}

interface CommissionViewProps {
  currentUser: User | null
}

const CommissionView: React.FC<CommissionViewProps> = ({ currentUser }) => {
  const [data, setData] = useState<CommissionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMarketing, setSelectedMarketing] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const userRole = currentUser?.role
  const isAdminOrManager = userRole === 'admin' || userRole === 'manager'

  useEffect(() => {
    const load = async () => {
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
    load()
  }, [currentUser])

  const marketingOptions = useMemo(() => {
    const names = new Set(data.map(d => d.marketing_name).filter(Boolean))
    return Array.from(names).sort()
  }, [data])

  const filtered = useMemo(() => {
    let result = [...data]
    if (selectedMarketing !== 'all') result = result.filter(d => d.marketing_name === selectedMarketing)
    if (selectedStatus !== 'all') result = result.filter(d => d.status?.toLowerCase() === selectedStatus)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(d =>
        d.po_number?.toLowerCase().includes(q) ||
        d.project_name?.toLowerCase().includes(q) ||
        d.marketing_name?.toLowerCase().includes(q)
      )
    }
    return result
  }, [data, selectedMarketing, selectedStatus, searchQuery])

  const summary = useMemo(() => {
    const totalKomisi = filtered.reduce((acc, d) => acc + (d.commission_amount || 0), 0)
    const totalValuasi = filtered.reduce((acc, d) => acc + (d.project_valuation || 0), 0)
    const byMarketing: Record<string, { name: string; total: number; count: number; rate: number }> = {}
    filtered.forEach(d => {
      if (!byMarketing[d.marketing_name]) {
        byMarketing[d.marketing_name] = { name: d.marketing_name, total: 0, count: 0, rate: d.commission_rate }
      }
      byMarketing[d.marketing_name].total += d.commission_amount || 0
      byMarketing[d.marketing_name].count++
    })
    return { totalKomisi, totalValuasi, totalProject: filtered.length, byMarketing }
  }, [filtered])

  const formatRupiah = (val: number) => {
    if (!val || isNaN(val)) return 'Rp 0'
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)
  }

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '-'
    try { return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) }
    catch { return '-' }
  }

  const getStatusStyle = (status: string) => {
    const s = status?.toLowerCase()
    if (s === 'completed') return { bg: '#dcfce7', color: '#16a34a', label: 'Selesai' }
    if (s === 'in progress') return { bg: '#dbeafe', color: '#2563eb', label: 'Berjalan' }
    if (s === 'cancelled') return { bg: '#fee2e2', color: '#dc2626', label: 'Dibatalkan' }
    return { bg: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)', label: status || 'Open' }
  }

  const getInitials = (name: string) =>
    name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  const avatarColors = ['#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f43f5e', '#f59e0b']
  const getAvatarColor = (name: string) =>
    avatarColors[name?.charCodeAt(0) % avatarColors.length] || '#f97316'

  const hasActiveFilter = selectedMarketing !== 'all' || selectedStatus !== 'all' || searchQuery !== ''

  if (isLoading) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px', flexDirection: 'column', gap: '12px' }}>
        <style>{`@keyframes comm-spin { to { transform: rotate(360deg) } }`}</style>
        <div style={{ width: '36px', height: '36px', border: '3px solid #fed7aa', borderTopColor: '#f97316', borderRadius: '50%', animation: 'comm-spin 0.8s linear infinite' }} />
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Memuat data komisi...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <Card><p style={{ color: 'var(--color-text-danger)', fontSize: '14px' }}>❌ {error}</p></Card>
      </div>
    )
  }

  return (
    <div className="page-container">
      <style>{`
        .comm-row:hover td { background: var(--color-background-secondary); }
        .comm-mkt-pill { cursor: pointer; transition: border 0.15s, background 0.15s; border-radius: 10px; padding: 12px 14px; border: 0.5px solid var(--color-border-secondary); background: var(--color-background-secondary); }
        .comm-mkt-pill:hover { border-color: #f97316; }
        .comm-mkt-pill.active-pill { border: 1.5px solid #f97316; background: #fff7ed; }
        .comm-input { padding: 9px 14px; font-size: 13px; border-radius: 8px; border: 0.5px solid var(--color-border-secondary); background: var(--color-background-secondary); color: var(--color-text-primary); outline: none; width: 100%; box-sizing: border-box; }
        .comm-input:focus { border-color: #f97316; box-shadow: 0 0 0 3px rgba(249,115,22,0.1); }
        .comm-select { padding: 9px 14px; font-size: 13px; border-radius: 8px; border: 0.5px solid var(--color-border-secondary); background: var(--color-background-secondary); color: var(--color-text-primary); cursor: pointer; outline: none; }
        .comm-select:focus { border-color: #f97316; }
      `}</style>

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1>Komisi Marketing</h1>
          <p>{userRole === 'marketing' ? `Rekap komisi Order milik ${currentUser?.name}` : 'Rekap komisi seluruh tim marketing'}</p>
        </div>
        <div style={{ background: 'linear-gradient(135deg, #f97316, #fb923c)', borderRadius: '14px', padding: '14px 22px', color: '#fff', textAlign: 'right', boxShadow: '0 4px 18px rgba(249,115,22,0.28)' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, opacity: 0.85, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Total Komisi</div>
          <div style={{ fontSize: '20px', fontWeight: 800 }}>{formatRupiah(summary.totalKomisi)}</div>
          <div style={{ fontSize: '11px', opacity: 0.75, marginTop: '2px' }}>{summary.totalProject} project</div>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '1.5rem' }}>
        <Card>
          <div style={labelStyle}>Total Order</div>
          <div style={{ fontSize: '36px', fontWeight: 800, letterSpacing: '-2px', color: 'var(--color-text-primary)', lineHeight: 1 }}>{summary.totalProject}</div>
        </Card>
        <Card>
          <div style={labelStyle}>Total Valuasi</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text-primary)' }}>{formatRupiah(summary.totalValuasi)}</div>
        </Card>
        <Card style={{ borderColor: '#fed7aa', background: '#fff7ed' }}>
          <div style={{ ...labelStyle, color: '#c2410c' }}>Total Komisi</div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#c2410c' }}>{formatRupiah(summary.totalKomisi)}</div>
        </Card>
      </div>

      {/* ── Per Marketing (admin/manager) ── */}
      {isAdminOrManager && Object.keys(summary.byMarketing).length > 0 && (
        <Card style={{ marginBottom: '1.5rem' }}>
          <div style={sectionLabelStyle}>Per Marketing</div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '12px' }}>
            <div
              className={`comm-mkt-pill${selectedMarketing === 'all' ? ' active-pill' : ''}`}
              onClick={() => setSelectedMarketing('all')}
            >
              <div style={{ fontSize: '13px', fontWeight: 700, color: selectedMarketing === 'all' ? '#c2410c' : 'var(--color-text-primary)', marginBottom: '2px' }}>Semua</div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{data.length} project</div>
            </div>
            {Object.values(summary.byMarketing).sort((a, b) => b.total - a.total).map(m => (
              <div
                key={m.name}
                className={`comm-mkt-pill${selectedMarketing === m.name ? ' active-pill' : ''}`}
                onClick={() => setSelectedMarketing(selectedMarketing === m.name ? 'all' : m.name)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: getAvatarColor(m.name), color: '#fff', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {getInitials(m.name)}
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: selectedMarketing === m.name ? '#c2410c' : 'var(--color-text-primary)' }}>{m.name}</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>{m.count} project · rate {m.rate}%</div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#16a34a' }}>{formatRupiah(m.total)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Filter Bar dalam Card ── */}
      <Card style={{ marginBottom: '1.5rem' }}>
        <div style={sectionLabelStyle}>Filter & Pencarian</div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '13px', pointerEvents: 'none' }}>🔍</span>
            <input
              className="comm-input"
              type="text"
              placeholder="Cari nomor Order atau nama customer..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '34px' }}
            />
          </div>
          {isAdminOrManager && (
            <select className="comm-select" value={selectedMarketing} onChange={e => setSelectedMarketing(e.target.value)}>
              <option value="all">Semua Marketing</option>
              {marketingOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <select className="comm-select" value={selectedStatus} onChange={e => setSelectedStatus(e.target.value)}>
            <option value="all">Semua Status</option>
            <option value="completed">Selesai</option>
            <option value="in progress">Berjalan</option>
            <option value="open">Open</option>
          </select>
          {hasActiveFilter && (
            <Button variant="secondary" onClick={() => { setSelectedMarketing('all'); setSelectedStatus('all'); setSearchQuery('') }}>
              Reset Filter
            </Button>
          )}
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', background: 'var(--color-background-secondary)', padding: '6px 12px', borderRadius: '20px', fontWeight: 500 }}>
            {filtered.length} Order
          </span>
        </div>
      </Card>

      {/* ── Tabel Komisi ── */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
          <div style={sectionLabelStyle}>Daftar Komisi per Order</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: 'var(--color-background-secondary)', borderBottom: '0.5px solid var(--color-border-secondary)' }}>
              <th style={th}>Nomor Order</th>
              <th style={th}>Customer</th>
              {isAdminOrManager && <th style={th}>Marketing</th>}
              <th style={th}>Status</th>
              <th style={th}>Target Kirim</th>
              <th style={th}>Tgl Masuk</th>
              <th style={{ ...th, textAlign: 'right' }}>Valuasi Order</th>
              <th style={{ ...th, textAlign: 'center' }}>Rate</th>
              <th style={{ ...th, textAlign: 'right' }}>Komisi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={isAdminOrManager ? 9 : 8} style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>💰</div>
                  <div style={{ fontSize: '14px', fontWeight: 500 }}>Tidak ada data komisi yang cocok.</div>
                </td>
              </tr>
            ) : filtered.map((item, idx) => {
              const badge = getStatusStyle(item.status)
              return (
                <tr key={`${item.po_id}-${idx}`} className="comm-row" style={{ borderTop: idx === 0 ? 'none' : '0.5px solid var(--color-border-tertiary)' }}>
                  <td style={td}><span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{item.po_number}</span></td>
                  <td style={td}><div style={{ fontWeight: 500 }}>{item.project_name}</div></td>
                  {isAdminOrManager && (
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: getAvatarColor(item.marketing_name), color: '#fff', fontSize: '9px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {getInitials(item.marketing_name)}
                        </div>
                        <span style={{ fontWeight: 500 }}>{item.marketing_name || '-'}</span>
                      </div>
                    </td>
                  )}
                  <td style={td}>
                    <span style={{ background: badge.bg, color: badge.color, padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {badge.label}
                    </span>
                  </td>
                  <td style={{ ...td, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{formatDate(item.deadline)}</td>
                  <td style={{ ...td, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{formatDate(item.created_at)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 500 }}>{formatRupiah(item.project_valuation)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span style={{ background: '#fff7ed', color: '#c2410c', padding: '3px 9px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, border: '0.5px solid #fed7aa' }}>
                      {item.commission_rate}%
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <span style={{ fontWeight: 800, fontSize: '14px', color: '#16a34a' }}>{formatRupiah(item.commission_amount)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '1.5px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)' }}>
                <td colSpan={isAdminOrManager ? 6 : 5} style={{ padding: '13px 14px', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  Total ({filtered.length} Order)
                </td>
                <td style={{ padding: '13px 14px', textAlign: 'right', fontWeight: 700 }}>{formatRupiah(summary.totalValuasi)}</td>
                <td />
                <td style={{ padding: '13px 14px', textAlign: 'right', fontWeight: 800, fontSize: '15px', color: '#16a34a' }}>{formatRupiah(summary.totalKomisi)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </Card>

    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px', color: 'var(--color-text-secondary)', fontWeight: 600,
  marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em',
}
const sectionLabelStyle: React.CSSProperties = {
  fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)',
}
const th: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'left', fontWeight: 600,
  color: 'var(--color-text-secondary)', fontSize: '11px',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
const td: React.CSSProperties = {
  padding: '12px 14px', verticalAlign: 'middle',
}

export default CommissionView