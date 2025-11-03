// file: src/renderer/pages/AnalysisPage.tsx

import React, { useState, useEffect, useMemo } from 'react'
import { Card } from '../components/Card'
// Impor komponen Recharts yang dibutuhkan
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
  Cell,
  LineChart,
  Line
} from 'recharts'
import * as apiService from '../apiService'
import { useWindowWidth } from '../hooks/useWindowWidth' // Hook ukuran window
import { LuLightbulb } from 'react-icons/lu'
import { User } from '../types'

// --- Definisikan tipe data yang diterima dari backend ---
interface SalesByMarketing {
  name: string
  totalKubikasi: number
  poCount: number
}
interface MonthlyChartData {
  month: string // Format YYYY-MM
  [key: string]: string | number // Bisa berisi nama produk atau marketing sebagai key
}
interface AnalysisResultData {
  topSellingProducts: { name: string; totalQuantity: number; totalKubikasi: number }[]
  salesByMarketing: SalesByMarketing[]
  monthlyProductChartData: MonthlyChartData[]
  monthlyMarketingChartData: MonthlyChartData[]
  woodTypeDistribution: { name: string; value: number }[]
  topCustomers: { name: string; totalKubikasi: number }[]
  trendingProducts: { name: string; last30: number; prev30: number; change: number }[] // Include prev30 for context
  slowMovingProducts: string[]
}
// --- Akhir Tipe Data Baru ---

// Palet Warna untuk Charts
const COLORS = [
  '#0088FE',
  '#00C49F',
  '#FFBB28',
  '#FF8042',
  '#AF19FF',
  '#FF4560',
  '#775DD0',
  '#FEB019',
  '#3F51B5',
  '#03A9F4'
]

interface AnalysisPageProps {
  currentUser: User | null;
}

const AnalysisPage: React.FC<AnalysisPageProps> = ({ currentUser }) => {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 768 // Adjust breakpoint if needed

  // --- State untuk menyimpan data analisis ---
  const [analysisData, setAnalysisData] = useState<AnalysisResultData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // --- Fetch Data dari Backend ---
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      try {
        const data: AnalysisResultData = await apiService.getProductSalesAnalysis(currentUser)
        setAnalysisData(data)
      } catch (err) {
        console.error('Gagal mengambil data analisis:', err)
        setAnalysisData(null)
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [currentUser])

  // --- Memo untuk mendapatkan daftar nama produk & marketing untuk chart bulanan ---
  const { productKeysForChart, marketingKeysForChart } = useMemo(() => {
    if (!analysisData) return { productKeysForChart: [], marketingKeysForChart: [] }

    // Ambil top 5 produk berdasarkan total quantity
    const top5Products = analysisData.topSellingProducts.slice(0, 5).map((p) => p.name)

    // Ambil semua nama marketing dari data bulanan
    const marketingKeys = new Set<string>()
    analysisData.monthlyMarketingChartData.forEach((monthData) => {
      Object.keys(monthData).forEach((key) => {
        if (key !== 'month') marketingKeys.add(key)
      })
    })

    return {
      productKeysForChart: top5Products,
      marketingKeysForChart: Array.from(marketingKeys)
    }
  }, [analysisData])

  const recommendationText = useMemo(() => {
    if (!analysisData?.trendingProducts || analysisData.trendingProducts.length === 0) {
      return 'Saat ini belum ada tren penjualan produk yang signifikan untuk dasar rekomendasi stok.'
    }
    if (analysisData.trendingProducts.length === 1) {
      const topTrending = analysisData.trendingProducts[0]
      return (
        <>
          Pertimbangkan menambah stok untuk <strong>{topTrending.name}</strong> karena permintaannya
          meningkat signifikan (+{topTrending.change.toFixed(0)}%) dalam sebulan terakhir (
          {topTrending.prev30 || 0} → {topTrending.last30 || 0} unit).
        </>
      )
    }
    // Ambil 2 teratas
    const topTwoTrending = analysisData.trendingProducts.slice(0, 2)
    return (
      <>
        Fokuskan penambahan stok pada <strong>{topTwoTrending[0].name}</strong> (+
        {topTwoTrending[0].change.toFixed(0)}%) dan <strong>{topTwoTrending[1].name}</strong> (+
        {topTwoTrending[1].change.toFixed(0)}%) karena permintaannya sedang meningkat pesat.
      </>
    )
  }, [analysisData])
  // --- Render Logic ---
  if (isLoading) {
    return (
      <div className="page-container">
        <p>🧠 Menganalisis data, mohon tunggu...</p>
      </div>
    )
  }

  if (!analysisData) {
    return (
      <div className="page-container">
        <p>Gagal memuat data analisis atau tidak ada data PO yang valid.</p>
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Analisis Purchase Order</h1>
          <p>Wawasan berbasis data dari SEMUA Purchase Order (kecuali Cancelled).</p>
        </div>
      </div>

      {/* --- Card Performa Marketing --- */}
      <Card style={{ marginBottom: '1.5rem' }}>
        <h4>⭐ Performa Marketing (Total Kubikasi PO)</h4>
        {analysisData.salesByMarketing.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              layout="vertical"
              data={analysisData.salesByMarketing}
              margin={{ left: 100, right: 30 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={100} interval={0} fontSize={11} />
              <Tooltip
                formatter={(value, name) => {
                  if (name === 'Total m³') return [`${Number(value).toFixed(3)} m³`, name]
                  if (name === 'Jumlah PO') return [`${value} PO`, name]
                  return [value, name]
                }}
              />
              <Legend />
              <Bar dataKey="totalKubikasi" name="Total m³" fill={COLORS[0]} />
              <Bar dataKey="poCount" name="Jumlah PO" fill={COLORS[1]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p>Tidak ada data penjualan per marketing.</p>
        )}
      </Card>

      {/* --- Card Top Selling Products --- */}
      <Card style={{ marginBottom: '1.5rem' }}>
        <h4>🏆 Top 10 Produk (Berdasarkan Kuantitas & Kubikasi)</h4>
        {analysisData.topSellingProducts.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart
              layout="vertical"
              data={analysisData.topSellingProducts}
              margin={{ left: 150, right: 30 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={150} interval={0} fontSize={10} />
              <Tooltip
                formatter={(value, name) => {
                  if (name === 'Total Kuantitas') return [`${value} unit`, name]
                  if (name === 'Total Kubikasi') return [`${Number(value).toFixed(3)} m³`, name]
                  return [value, name]
                }}
              />
              <Legend />
              <Bar dataKey="totalQuantity" name="Total Kuantitas" fill={COLORS[2]} />
              <Bar dataKey="totalKubikasi" name="Total Kubikasi" fill={COLORS[3]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p>Tidak ada data produk.</p>
        )}
      </Card>

      {/* --- Grafik Penjualan Bulanan --- */}
      <div className="dashboard-widgets-grid">
        {/* Grafik Marketing Bulanan */}
        <Card>
          <h4>📈 Tren Penjualan Marketing per Bulan (m³)</h4>
          {analysisData.monthlyMarketingChartData.length > 0 && marketingKeysForChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={analysisData.monthlyMarketingChartData}
                margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => `${Number(value).toFixed(3)} m³`} />
                <Legend />
                {marketingKeysForChart.map((key, index) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stroke={COLORS[index % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p>Data penjualan marketing bulanan tidak cukup.</p>
          )}
        </Card>
        {/* Grafik Produk Bulanan */}
        <Card>
          <h4>📈 Tren Penjualan Top 5 Produk per Bulan (Unit)</h4>
          {analysisData.monthlyProductChartData.length > 0 && productKeysForChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={analysisData.monthlyProductChartData}
                margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis allowDecimals={false} />
                <Tooltip formatter={(value) => `${value} unit`} />
                <Legend />
                {productKeysForChart.map((key, index) => (
                  // Isi nilai 0 jika data produk tidak ada di bulan tsb
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stroke={COLORS[index % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p>Data penjualan produk bulanan tidak cukup.</p>
          )}
        </Card>
      </div>

      {/* --- Widget Lainnya --- */}
      <div className="dashboard-widgets-grid" style={{ marginTop: '1.5rem' }}>
        {/* Wood Type Distribution */}
        <Card>
          <h4>📊 Distribusi Jenis Kayu (Unit Terjual)</h4>
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
                  labelLine={false}
                  label={
                    !isMobile &&
                    ((props: any) => `${props.name} (${(props.percent * 100).toFixed(0)}%)`)
                  }
                >
                  {analysisData.woodTypeDistribution.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `${value} unit`} />
                <Legend
                  layout={isMobile ? 'horizontal' : 'vertical'}
                  verticalAlign={isMobile ? 'bottom' : 'middle'}
                  align={isMobile ? 'center' : 'right'}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p>Tidak ada data jenis kayu.</p>
          )}
        </Card>
        {/* Top Customers */}
        <Card>
          <h4>⭐ Top 10 Customer (Berdasarkan Volume m³)</h4>
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
            <p>Tidak ada data customer.</p>
          )}
        </Card>
      </div>
      <div className="dashboard-widgets-grid" style={{ marginTop: '1.5rem' }}>
        {/* Trending Products */}
        <Card>
          <h4>🔥 Produk Tren Naik (&gt;10% dalam sebulan)</h4>
          {analysisData.trendingProducts.length > 0 ? (
            <ul className="insight-list">
              {analysisData.trendingProducts.map((p) => (
                <li key={p.name}>
                  <span>
                    <strong>{p.name}</strong> ({p.prev30 || 0} → {p.last30 || 0} unit)
                  </span>
                  <span className="trend-up">+{p.change.toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Tidak ada produk yang tren naik signifikan.</p>
          )}
        </Card>
        {/* Slow Moving Products */}
        <Card>
          <h4>❄️ Produk Belum Terjual (dari Master)</h4>
          {analysisData.slowMovingProducts.length > 0 ? (
            <ul className="insight-list">
              {analysisData.slowMovingProducts.slice(0, 10).map((name) => (
                <li key={name}>{name}</li>
              ))}
              {analysisData.slowMovingProducts.length > 10 && (
                <li>... dan {analysisData.slowMovingProducts.length - 10} lainnya</li>
              )}
            </ul>
          ) : (
            <p>Semua produk master pernah terjual.</p>
          )}
        </Card>
      </div>
      <Card className="recommendation-card">
        <div className="recommendation-icon">
          <LuLightbulb /> {/* Gunakan ikon */}
        </div>
        <div className="recommendation-content">
          <h4>📦 Rekomendasi Stok Cerdas</h4>
          <p>{recommendationText}</p> {/* Tampilkan teks rekomendasi */}
        </div>
      </Card>
    </div> // Akhir page-container
  )
}

export default AnalysisPage
