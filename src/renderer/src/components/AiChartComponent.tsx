// Asumsi Anda menggunakan Recharts (sesuai screenshot)
// Pastikan Anda mengimpor semua ini
import React from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart, // <-- Impor BARU
  Pie, // <-- Impor BARU
  Cell // <-- Impor BARU
} from 'recharts'

// Definisikan tipe untuk payload Anda
interface ChartPayload {
  type: 'bar' | 'pie' | 'line'
  data: { name: string; value: number }[]
  dataKey: string // Ini akan selalu 'value' (standarisasi dari backend)
  nameKey: string // Ini akan selalu 'name' (standarisasi dari backend)
}

// Props untuk komponen Anda
interface AiChartComponentProps {
  payload: ChartPayload
}

// Tambahkan warna untuk Pie Chart
const COLORS = ['#FF8042', '#00C49F', '#FFBB28', '#0088FE', '#AF19FF']

const AiChartComponent: React.FC<AiChartComponentProps> = ({ payload }) => {
  if (!payload || !payload.data) {
    return null // Jangan render apa-apa jika data tidak valid
  }

  const { type, data, dataKey, nameKey } = payload

  // --- [INI ADALAH LOGIKA UTAMA] ---
  // Gunakan switch untuk menentukan chart yang akan dirender
  switch (type) {
    case 'bar':
      return (
        <ResponsiveContainer width="100%" height={300}>
          {/* Ini adalah kode BarChart Anda yang sudah ada */}
          <BarChart data={data} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
            <XAxis dataKey={nameKey} fontSize={10} />
            <YAxis fontSize={10} />
            <Tooltip />
            <Legend />
            {/* Saya sesuaikan 'fill' agar warnanya oranye seperti di screenshot Anda */}
            <Bar dataKey={dataKey} fill="#FF8042" name="Value" />
          </BarChart>
        </ResponsiveContainer>
      )

    case 'pie':
      return (
        <ResponsiveContainer width="100%" height={300}>
          {/* Ini adalah kode BARU untuk PieChart */}
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              // Tampilkan label nama dan persentase
              label={({ name, percent }: any) => `${name} (${(percent * 100).toFixed(0)}%)`}
              outerRadius={80} // Sesuaikan ukuran
              fill="#8884d8"
              dataKey={dataKey}
              nameKey={nameKey}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )

    // Tambahkan case 'line' di sini jika Anda ingin mengembangkannya nanti
    // case 'line':
    //   return <LineChart ... />

    default:
      return <div>Chart tipe &apos;{type}&apos; tidak didukung.</div>
  }
}

export default AiChartComponent