/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import React, { useState, useEffect, useMemo, useCallback } from 'react' // Tambahkan useCallback
import { Card } from '../components/Card'
// [UBAH] Import POHeader juga
import { AnalysisData, POItem, POHeader } from '../types'
import { useWindowWidth } from '../hooks/useWindowWidth'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell
} from 'recharts'

import * as apiService from '../apiService'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF']

// [DIUBAH] Helper insights sekarang bekerja dengan array POHeader
const calculateInsightsFromPOs = (pos: POHeader[]) => {
  const allItems = pos.flatMap(po => po.items || []); // Ambil semua item dari PO yang terfilter
  if (allItems.length === 0) {
    return { topProduct: 'N/A', topWood: 'N/A', topColor: 'N/A', topFinishing: 'N/A' };
  }
   // Logika count dan getTopItem tetap sama, tapi inputnya allItems
   const count = (key: keyof POItem) =>
     allItems.reduce(
       (acc, item) => {
         const value = item[key] as string
         if (value) acc[value] = (acc[value] || 0) + (item.quantity || 1)
         return acc
       },
       {} as Record<string, number>
     );
   const getTopItem = (data: Record<string, number>) =>
     Object.keys(data).length > 0
       ? Object.keys(data).reduce((a, b) => (data[a] > data[b] ? a : b))
       : 'N/A';

   return {
     topProduct: getTopItem(count('product_name')),
     topWood: getTopItem(count('wood_type')),
     topColor: getTopItem(count('color')),
     topFinishing: getTopItem(count('finishing'))
   };
}


const AnalysisPage: React.FC = () => {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 640
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null)
  const [allItems, setAllItems] = useState<POItem[]>([]) // Tetap simpan allItems untuk uniqueOptions
  const [allPOs, setAllPOs] = useState<POHeader[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [filters, setFilters] = useState({
    wood_type: 'all',
    profile: 'all',
    color: 'all',
    finishing: 'all'
  })

  // Helper function for formatting dates
  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  };
  // Helper function for formatting date and time
   const formatDateTime = (dateString?: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  };


  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      try {
        // Ambil semua data yang dibutuhkan
        // @ts-ignore
        const [summaryData, itemData, poListData] = await Promise.all([
          apiService.getProductSalesAnalysis(),
          apiService.getSalesItemData(), // Mungkin masih berguna untuk uniqueOptions
          apiService.listPOs() // Ambil semua PO (dengan item list)
        ])
        setAnalysisData(summaryData)
        setAllItems(itemData)
        setAllPOs(poListData)
      } catch (err) {
        console.error('Gagal mengambil data analisis:', err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [])

  // uniqueOptions bisa tetap diambil dari allItems atau diubah ke allPOs
  const uniqueOptions = useMemo(() => {
    const wood_type = new Set<string>()
    const profile = new Set<string>()
    const color = new Set<string>()
    const finishing = new Set<string>()
    // Ambil opsi dari allPOs agar lebih relevan dengan tabel PO
    allPOs.forEach(po => {
       (po.items || []).forEach(item => {
           if (item.wood_type) wood_type.add(item.wood_type);
           if (item.profile) profile.add(item.profile);
           if (item.color) color.add(item.color);
           if (item.finishing) finishing.add(item.finishing);
       });
    });
    return {
      wood_type: [...wood_type].sort(),
      profile: [...profile].sort(),
      color: [...color].sort(),
      finishing: [...finishing].sort()
    }
  }, [allPOs]) // Ubah dependensi

  // [DIROMBAK] Filter sekarang diterapkan pada PO, bukan item
  const filteredPOs = useMemo(() => {
    // 1. Ambil hanya PO yang 'Completed'
    const completedPOs = allPOs.filter(po => po.status === 'Completed');

    // 2. Terapkan filter dropdown pada PO
    return completedPOs.filter((po) => {
      // Cek apakah *minimal satu* item di PO ini cocok dengan filter
      const hasMatchingItem = (po.items || []).some(item =>
        (filters.wood_type === 'all' || item.wood_type === filters.wood_type) &&
        (filters.profile === 'all' || item.profile === filters.profile) &&
        (filters.color === 'all' || item.color === filters.color) &&
        (filters.finishing === 'all' || item.finishing === filters.finishing)
      );
      // Jika tidak ada filter aktif ATAU ada item yang cocok, tampilkan PO ini
      const noFiltersActive = filters.wood_type === 'all' && filters.profile === 'all' && filters.color === 'all' && filters.finishing === 'all';
      return noFiltersActive || hasMatchingItem;
    });
  }, [allPOs, filters])

  // Insights dihitung dari PO yang terfilter
  const insights = useMemo(() => calculateInsightsFromPOs(filteredPOs), [filteredPOs])

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const recommendationText = useMemo(() => {
    if (
      !analysisData ||
      !analysisData.trendingProducts ||
      analysisData.trendingProducts.length === 0
    ) {
      return 'Saat ini belum ada tren penjualan produk yang signifikan.'
    }
    const topTrending = analysisData.trendingProducts
      .slice(0, 2)
      .map((p) => p.name)
     .join(' dan ')
    return `Pertimbangkan untuk menambah stok untuk produk ${topTrending} karena permintaannya sedang meningkat pesat.`; // Semicolon added
  }, [analysisData])


  if (isLoading) {
    return (
      <div className="page-container">
        <p>🧠 Menganalisis data penjualan, mohon tunggu...</p>
      </div>
    )
  }
  if (!analysisData) {
    return (
      <div className="page-container">
        <p>Gagal memuat data analisis.</p>
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Analisis & Prediksi Penjualan</h1>
          <p>Wawasan berbasis data untuk membantu pengambilan keputusan stok.</p>
        </div>
      </div>

      {/* --- BAGIAN RINGKASAN UMUM (GRAFIK) --- */}
      <h3>Ringkasan Umum</h3>
      <div className="dashboard-widgets-grid">
        <Card>
          <h4>{'📊 Distribusi Jenis Kayu Terlaris'}</h4>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={analysisData.woodTypeDistribution}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                fill="#8884d8"
                label={isMobile ? false : (props: any) => `${props.name} (${(props.percent * 100).toFixed(0)}%)`}
              >
                {analysisData.woodTypeDistribution.map((_entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${value} unit`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <h4>{'⭐ Top 5 Customer (Berdasarkan Volume m³)'}</h4>
          {analysisData.topCustomers.length > 0 ? (
            <ol className="top-customer-list">
              {analysisData.topCustomers.map((c) => (
                <li key={c.name}>
                  <span>{c.name}</span>
                  <strong>{c.totalKubikasi.toFixed(3)} m³</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p>Belum ada data kubikasi customer.</p>
          )}
        </Card>
      </div>
      <Card style={{ marginTop: '1.5rem' }}>
        <h4>{'🏆 Top 10 Produk Terlaris (Berdasarkan Kuantitas)'}</h4>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            layout="vertical"
            data={analysisData.topSellingProducts.slice()} // Use slice() for safety if modifying data later
            margin={{ top: 20, right: 30, left: 100, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={150} interval={0} />
            <Tooltip formatter={(value) => `${value} unit`} />
            <Legend />
            <Bar dataKey="totalQuantity" name="Total Kuantitas Terjual" fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <div className="dashboard-widgets-grid" style={{ marginTop: '1.5rem' }}>
        <Card>
          <h4>{'🔥 Produk Tren Naik (>20% dalam sebulan)'}</h4>
          {analysisData.trendingProducts.length > 0 ? (
            <ul className="insight-list">
              {analysisData.trendingProducts.map((p) => (
                <li key={p.name}>
                  <strong>{p.name}</strong>
                  <span className="trend-up">+{p.change.toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Tidak ada produk yang sedang tren naik.</p>
          )}
        </Card>
        <Card>
          <h4>{'❄️ Produk Kurang Laris (Belum Pernah Terjual)'}</h4>
          {analysisData.slowMovingProducts.length > 0 ? (
            <ul className="insight-list">
              {analysisData.slowMovingProducts.slice(0, 5).map((name) => (
                <li key={name}>{name}</li>
              ))}
              {analysisData.slowMovingProducts.length > 5 && <li>dan lainnya...</li>}
            </ul>
          ) : (
            <p>Semua produk pernah terjual. Kerja bagus!</p>
          )}
        </Card>
      </div>
      <Card className="recommendation-card">
        <h4>{'📦 Rekomendasi Stok Cerdas'}</h4>
        <p>{recommendationText}</p>
      </Card>

      {/* --- BAGIAN EKSPLORASI DATA INTERAKTIF --- */}
      <h3 style={{ marginTop: '2rem' }}>Eksplorasi PO Selesai</h3> {/* Judul diubah */}
      <Card>
        <div className="interactive-bi-layout">
          <div className="bi-filters">
            <h4>Filter Data</h4>
            <div className="form-group">
              <label>Jenis Kayu</label>
              <select name="wood_type" value={filters.wood_type} onChange={handleFilterChange}>
                <option value="all">Semua</option>
                {uniqueOptions.wood_type.map((o) => (<option key={o} value={o}>{o}</option>))}
              </select>
            </div>
            <div className="form-group">
              <label>Profil</label>
              <select name="profile" value={filters.profile} onChange={handleFilterChange}>
                <option value="all">Semua</option>
                {uniqueOptions.profile.map((o) => (<option key={o} value={o}>{o}</option>))}
              </select>
            </div>
            <div className="form-group">
              <label>Warna</label>
              <select name="color" value={filters.color} onChange={handleFilterChange}>
                <option value="all">Semua</option>
                {uniqueOptions.color.map((o) => (<option key={o} value={o}>{o}</option>))}
              </select>
            </div>
            <div className="form-group">
              <label>Finishing</label>
              <select name="finishing" value={filters.finishing} onChange={handleFilterChange}>
                <option value="all">Semua</option>
                {uniqueOptions.finishing.map((o) => (<option key={o} value={o}>{o}</option>))}
              </select>
            </div>
          </div>
          <div className="bi-results">
            {/* Insights sekarang dihitung dari PO terfilter */}
            <Card className="insight-card">
              <h4>Kesimpulan Otomatis</h4>
              <p>Dari <strong>{filteredPOs.length}</strong> PO Selesai yang cocok:</p>
              <ul>
                 <li>Produk Paling Laris: <strong>{insights.topProduct}</strong></li>
                 <li>Jenis Kayu Paling Umum: <strong>{insights.topWood}</strong></li>
                 <li>Warna Paling Diminati: <strong>{insights.topColor}</strong></li>
                 <li>Finishing Paling Populer: <strong>{insights.topFinishing}</strong></li>
              </ul>
            </Card>
          </div>
        </div>

        {/* [DIROMBAK TOTAL] Tabel Data Berbasis PO */}
        <div className="po-table-container" style={{ marginTop: '1.5rem' }}>
          <h4>Detail PO Selesai (Filter Aktif)</h4>
          <table className="po-table"> {/* Class po-table agar styling konsisten */}
            <thead>
              <tr>
                <th>Customer</th>
                <th>Revisi Oleh</th>
                <th>Tgl Revisi</th>
                <th>Tanggal Masuk</th>
                <th>Target Kirim</th>
                <th>Jenis Kayu & Produk</th>
                <th>Total Kubikasi</th>
                {/* Tambahkan kolom Aksi jika perlu */}
              </tr>
            </thead>
            <tbody>
              {/* Iterasi melalui filteredPOs */}
              {filteredPOs.slice(0, 100).map((po) => (
                <tr key={po.id}>
                  <td>
                    <div className="customer-cell">
                      <strong>{po.project_name}</strong>
                      <span>PO: {po.po_number}</span>
                    </div>
                  </td>
                  <td>{po.lastRevisedBy && po.lastRevisedBy !== 'N/A' ? po.lastRevisedBy : '-'}</td>
                  <td>{formatDateTime(po.lastRevisedDate)}</td>
                  <td>{formatDate(po.created_at)}</td>
                  <td>{formatDate(po.deadline)}</td>
                  <td className="product-list-cell">
                    {po.items && po.items.length > 0 ? (
                      <ul>
                        {po.items.map((item) => (
                          // Pastikan item memiliki id unik atau gunakan index
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
                  {/* Tambahkan sel Aksi jika perlu */}
                </tr>
              ))}
              {filteredPOs.length === 0 && (
                 <tr><td colSpan={7}>Tidak ada data PO Selesai yang cocok dengan filter.</td></tr>
              )}
            </tbody>
          </table>
          {filteredPOs.length > 100 && (
            <p style={{ textAlign: 'center', marginTop: '1rem' }}>
              <i>Dan {filteredPOs.length - 100} PO lainnya...</i>
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}

export default AnalysisPage