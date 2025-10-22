import React, { useState, useEffect, useMemo } from 'react'
import { Card } from '../components/Card'
// Ensure ProductMaster is defined in your types file
import { POHeader, POItem, ProductMaster } from '../types'
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

// Helper function to calculate insights from an array of POHeaders
const calculateInsightsFromPOs = (pos: POHeader[]) => {
  const allItems = pos.flatMap((po) => po.items || [])
  if (allItems.length === 0) {
    return { topProduct: 'N/A', topWood: 'N/A', topColor: 'N/A', topFinishing: 'N/A' }
  }
  const count = (key: keyof POItem) =>
    allItems.reduce(
      (acc, item) => {
        const value = item[key] as string
        // Ensure quantity is treated as a number
        if (value) acc[value] = (acc[value] || 0) + Number(item.quantity || 1)
        return acc
      },
      {} as Record<string, number>
    )
  const getTopItem = (data: Record<string, number>) =>
    Object.keys(data).length > 0
      ? Object.keys(data).reduce((a, b) => (data[a] > data[b] ? a : b))
      : 'N/A'
  return {
    topProduct: getTopItem(count('product_name')),
    topWood: getTopItem(count('wood_type')),
    topColor: getTopItem(count('color')),
    topFinishing: getTopItem(count('finishing'))
  }
}

// Helper date formatting functions
const formatDate = (dateString?: string | null) => {
  if (!dateString) return '-'
  try {
    return new Date(dateString).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  } catch (e) {
    return '-'
  }
}
const formatDateTime = (dateString?: string | null) => {
  if (!dateString) return '-'
  try {
    return new Date(dateString).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  } catch (e) {
    return '-'
  }
}

// Define the structure for analysisData if not already in types.ts
interface CalculatedAnalysisData {
  woodTypeDistribution: { name: string; value: number }[]
  topCustomers: { name: string; totalKubikasi: number }[]
  topSellingProducts: { name: string; totalQuantity: number }[]
  trendingProducts: { name: string; last30: number; prev30: number; change: number }[]
  slowMovingProducts: string[]
}

const AnalysisPage: React.FC = () => {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 640

  // --- STATE ---
  const [allPOs, setAllPOs] = useState<POHeader[]>([])
  const [masterProducts, setMasterProducts] = useState<ProductMaster[]>([]) // State for master products
  const [isLoading, setIsLoading] = useState(true)
  const [filters, setFilters] = useState({
    wood_type: 'all',
    profile: 'all',
    color: 'all',
    finishing: 'all'
  })

  // --- FETCH DATA ---
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      try {
        const [poListData, productsData] = await Promise.all([
          apiService.listPOs(),
          apiService.getProducts() // Fetch master products
        ])
        setAllPOs(poListData)
        setMasterProducts(productsData) // Store master products
      } catch (err) {
        console.error('Gagal mengambil data analisis:', err)
        // Optionally show an error message to the user
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, []) // Empty dependency array means this runs once on mount

  // --- CALCULATE ANALYSIS DATA (ONLY FROM COMPLETED POs) ---
  const analysisData = useMemo((): CalculatedAnalysisData => {
    // Early return if data isn't ready
    if (!allPOs || !masterProducts || allPOs.length === 0) {
      return {
        woodTypeDistribution: [],
        topCustomers: [],
        topSellingProducts: [],
        trendingProducts: [],
        slowMovingProducts: []
      }
    }

    const completedPOs = allPOs.filter((po) => po.status === 'Completed')

    // Return empty structure if no completed POs, but list all master products as slow-moving
    if (completedPOs.length === 0) {
      return {
        woodTypeDistribution: [],
        topCustomers: [],
        topSellingProducts: [],
        trendingProducts: [],
        slowMovingProducts: masterProducts.map((p) => p.product_name)
      }
    }

    const salesData: Record<string, { totalQuantity: number; name: string }> = {}
    const salesByDate: { date: Date; name: string; quantity: number }[] = []
    const woodTypeData: Record<string, number> = {}
    const customerData: Record<string, number> = {}
    const soldProductNames = new Set<string>() // Use a Set for efficient lookup

    completedPOs.forEach((po) => {
      const customerName = po.project_name
      const kubikasiAsNumber = Number(po.kubikasi_total || 0) // Ensure kubikasi is a number
      if (customerName) {
        customerData[customerName] = (customerData[customerName] || 0) + kubikasiAsNumber
      }

      ;(po.items || []).forEach((item) => {
        const productName = item.product_name
        const quantity = Number(item.quantity || 0) // Ensure quantity is a number
        const woodType = item.wood_type

        if (!productName || quantity <= 0) return // Skip if no name or zero quantity

        soldProductNames.add(productName)

        salesData[productName] = salesData[productName] || { totalQuantity: 0, name: productName }
        salesData[productName].totalQuantity += quantity

        try {
          // Add try-catch for potential invalid dates
          salesByDate.push({ date: new Date(po.created_at), name: productName, quantity })
        } catch (e) {
          console.warn('Invalid PO creation date:', po.created_at)
        }

        if (woodType) {
          woodTypeData[woodType] = (woodTypeData[woodType] || 0) + quantity
        }
      })
    })

    // Process results
    const topSellingProducts = Object.values(salesData)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 10)
    const woodTypeDistribution = Object.entries(woodTypeData)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
    const topCustomers = Object.entries(customerData)
      .map(([name, totalKubikasi]) => ({ name, totalKubikasi: Number(totalKubikasi) }))
      .sort((a, b) => b.totalKubikasi - a.totalKubikasi)
      .slice(0, 5)

    // Calculate Trending Products
    const today = new Date()
    const thirtyDaysAgo = new Date(new Date().setDate(today.getDate() - 30))
    const sixtyDaysAgo = new Date(new Date().setDate(today.getDate() - 60))
    const salesLast30: Record<string, number> = {}
    const salesPrev30: Record<string, number> = {}
    salesByDate.forEach((sale) => {
      if (sale.date >= thirtyDaysAgo)
        salesLast30[sale.name] = (salesLast30[sale.name] || 0) + sale.quantity
      else if (sale.date >= sixtyDaysAgo)
        salesPrev30[sale.name] = (salesPrev30[sale.name] || 0) + sale.quantity
    })
    const trendingProducts = Object.keys(salesLast30)
      .map((name) => {
        const last30 = salesLast30[name]
        const prev30 = salesPrev30[name] || 0
        const change = prev30 === 0 && last30 > 0 ? 100 : ((last30 - prev30) / (prev30 || 1)) * 100
        return { name, last30, prev30, change }
      })
      .filter((p) => p.change > 20 && p.last30 > p.prev30)
      .sort((a, b) => b.change - a.change)

    // Calculate Slow Moving Products
    const allMasterProductNames = masterProducts.map((p) => p.product_name).filter(Boolean) // Filter out empty names
    const slowMovingProducts = allMasterProductNames.filter((name) => !soldProductNames.has(name))

    return {
      woodTypeDistribution,
      topCustomers,
      topSellingProducts,
      trendingProducts,
      slowMovingProducts
    }
  }, [allPOs, masterProducts]) // Dependencies are correct

  // --- OTHER MEMOIZED VALUES & HANDLERS ---
  const uniqueOptions = useMemo(() => {
    const wood_type = new Set<string>(),
      profile = new Set<string>(),
      color = new Set<string>(),
      finishing = new Set<string>()
    allPOs.forEach((po) => {
      ;(po.items || []).forEach((item) => {
        if (item.wood_type) wood_type.add(item.wood_type)
        if (item.profile) profile.add(item.profile)
        if (item.color) color.add(item.color)
        if (item.finishing) finishing.add(item.finishing)
      })
    })
    return {
      wood_type: [...wood_type].sort(),
      profile: [...profile].sort(),
      color: [...color].sort(),
      finishing: [...finishing].sort()
    }
  }, [allPOs])

  const filteredPOs = useMemo(() => {
    const completedPOs = allPOs.filter((po) => po.status === 'Completed')
    return completedPOs.filter((po) => {
      const hasMatchingItem = (po.items || []).some(
        (item) =>
          (filters.wood_type === 'all' || item.wood_type === filters.wood_type) &&
          (filters.profile === 'all' || item.profile === filters.profile) &&
          (filters.color === 'all' || item.color === filters.color) &&
          (filters.finishing === 'all' || item.finishing === filters.finishing)
      )
      const noFiltersActive =
        filters.wood_type === 'all' &&
        filters.profile === 'all' &&
        filters.color === 'all' &&
        filters.finishing === 'all'
      return noFiltersActive || hasMatchingItem
    })
  }, [allPOs, filters])

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
      return 'Saat ini belum ada tren penjualan produk yang signifikan dari PO yang sudah selesai.'
    }
    const topTrending = analysisData.trendingProducts
      .slice(0, 2)
      .map((p) => p.name)
      .join(' dan ')
    return `Dari PO yang sudah selesai, pertimbangkan menambah stok ${topTrending} karena permintaannya meningkat.`
  }, [analysisData])

  // --- RENDER LOGIC ---
  if (isLoading) {
    return (
      <div className="page-container">
        <p>🧠 Menganalisis data penjualan, mohon tunggu...</p>
      </div>
    )
  }
  // Check analysisData validity after loading
  if (!analysisData) {
    return (
      <div className="page-container">
        <p>Gagal memuat data analisis atau tidak ada data PO Selesai yang valid.</p>
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Analisis Penjualan (PO Selesai)</h1>
          <p>Wawasan berbasis data HANYA dari Purchase Order yang sudah selesai.</p>
        </div>
      </div>

      <h3>Ringkasan Umum (PO Selesai)</h3>
      <div className="dashboard-widgets-grid">
        {/* Wood Type Distribution */}
        <Card>
          <h4>{'📊 Distribusi Jenis Kayu Terlaris'}</h4>
          {analysisData.woodTypeDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={analysisData.woodTypeDistribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={isMobile ? 60 : 80}
                  fill="#8884d8"
                  label={
                    isMobile
                      ? false
                      : (props: any) => `${props.name} (${(props.percent * 100).toFixed(0)}%)`
                  }
                >
                  {analysisData.woodTypeDistribution.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `${value} unit`} /> <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p>Tidak ada data jenis kayu dari PO Selesai.</p>
          )}
        </Card>
        {/* Top Customers */}
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
            <p>Tidak ada data customer dari PO Selesai.</p>
          )}
        </Card>
      </div>
      {/* Top Selling Products */}
      <Card style={{ marginTop: '1.5rem' }}>
        <h4>{'🏆 Top 10 Produk Terlaris (Berdasarkan Kuantitas)'}</h4>
        {analysisData.topSellingProducts.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart
              layout="vertical"
              data={analysisData.topSellingProducts}
              margin={{ top: 20, right: 30, left: 100, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={150} interval={0} />
              <Tooltip formatter={(value) => `${value} unit`} /> <Legend />
              <Bar dataKey="totalQuantity" name="Total Kuantitas Terjual" fill="#8884d8" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p>Tidak ada data produk terlaris dari PO Selesai.</p>
        )}
      </Card>
      {/* Trending & Slow Moving */}
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
            <p>Tidak ada produk yang sedang tren naik dari PO Selesai.</p>
          )}
        </Card>
        <Card>
          <h4>{'❄️ Produk Kurang Laris (Belum Pernah Terjual di PO Selesai)'}</h4>
          {analysisData.slowMovingProducts.length > 0 ? (
            <ul className="insight-list">
              {analysisData.slowMovingProducts.slice(0, 5).map((name) => (
                <li key={name}>{name}</li>
              ))}
              {analysisData.slowMovingProducts.length > 5 && (
                <li>dan {analysisData.slowMovingProducts.length - 5} lainnya...</li>
              )}
            </ul>
          ) : (
            <p>Semua produk master pernah terjual setidaknya sekali di PO Selesai.</p>
          )}
        </Card>
      </div>
      {/* Recommendation */}
      <Card className="recommendation-card">
        <h4>{'📦 Rekomendasi Stok Cerdas'}</h4>
        <p>{recommendationText}</p>
      </Card>

      {/* --- INTERACTIVE EXPLORATION --- */}
      <h3 style={{ marginTop: '2rem' }}>Eksplorasi PO Selesai</h3>
      <Card>
        <div className="interactive-bi-layout">
          <div className="bi-filters">
            <h4>Filter Data</h4>
            {/* Filter Dropdowns */}
            <div className="form-group">
              <label>Jenis Kayu</label>
              <select name="wood_type" value={filters.wood_type} onChange={handleFilterChange}>
                <option value="all">Semua</option>
                {uniqueOptions.wood_type.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Profil</label>
              <select name="profile" value={filters.profile} onChange={handleFilterChange}>
                <option value="all">Semua</option>
                {uniqueOptions.profile.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Warna</label>
              <select name="color" value={filters.color} onChange={handleFilterChange}>
                <option value="all">Semua</option>
                {uniqueOptions.color.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Finishing</label>
              <select name="finishing" value={filters.finishing} onChange={handleFilterChange}>
                <option value="all">Semua</option>
                {uniqueOptions.finishing.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="bi-results">
            {/* Insights Card */}
            <Card className="insight-card">
              <h4>Kesimpulan Otomatis</h4>
              <p>
                Dari <strong>{filteredPOs.length}</strong> PO Selesai yang cocok:
              </p>
              <ul>
                <li>
                  Produk Paling Laris: <strong>{insights.topProduct}</strong>
                </li>
                <li>
                  Jenis Kayu Paling Umum: <strong>{insights.topWood}</strong>
                </li>
                <li>
                  Warna Paling Diminati: <strong>{insights.topColor}</strong>
                </li>
                <li>
                  Finishing Paling Populer: <strong>{insights.topFinishing}</strong>
                </li>
              </ul>
            </Card>
          </div>
        </div>

        {/* --- DETAILED TABLE OF FILTERED COMPLETED POs --- */}
        <div className="po-table-container" style={{ marginTop: '1.5rem' }}>
          <h4>Detail PO Selesai (Filter Aktif)</h4>
          <table className="po-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Tanggal Masuk</th>
                <th>Target Kirim</th>
                <th>Selesai Pada</th>
                <th>Jenis Kayu & Produk</th>
                <th>Total Kubikasi</th>
              </tr>
            </thead>
            <tbody>
              {filteredPOs.slice(0, 100).map((po) => (
                <tr key={po.id}>
                  <td>
                    <div className="customer-cell">
                      <strong>{po.project_name}</strong>
                      <span>PO: {po.po_number}</span>
                    </div>
                  </td>
                  <td>{formatDate(po.created_at)}</td>
                  <td>{formatDate(po.deadline)}</td>
                  <td>{formatDateTime(po.completed_at)}</td> {/* Tampilkan tanggal selesai */}
                  <td className="product-list-cell">
                    {po.items && po.items.length > 0 ? (
                      <ul>
                        {po.items.map((item) => (
                          <li key={item.id || `${po.id}-${item.product_name}`}>
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
                  <td>{Number(po.kubikasi_total || 0).toFixed(3)} m³</td>
                </tr>
              ))}
              {filteredPOs.length === 0 && (
                <tr>
                  <td colSpan={6}>Tidak ada data PO Selesai yang cocok dengan filter.</td>
                </tr>
              )}{' '}
              {/* Ubah colSpan */}
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