import React, { useState } from 'react'
import { Card } from '../components/Card' // Asumsi path Card benar
import { Input } from '../components/Input' // Asumsi path Input benar
import { Button } from '../components/Button' // Asumsi path Button benar
import * as apiService from '../apiService' // Asumsi path apiService benar

// Tipe data yang diharapkan saat login sukses
interface LoginSuccessResponse {
  success: boolean
  name: string
  x
  role?: string // Opsional
}

interface LoginPageProps {
  onLoginSuccess: (userData: { name: string; role?: string }) => void // Callback ke App.tsx
}

const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault() // Mencegah reload halaman
    setError(null)
    setIsLoading(true)

    if (!username || !password) {
      setError('Username dan password harus diisi.')
      setIsLoading(false)
      return
    }

    try {
      // Panggil API backend Vercel (buat fungsi loginUser di apiService)
      const result: LoginSuccessResponse = await apiService.loginUser(username, password)

      if (result && result.success) {
        // Panggil callback untuk memberitahu App.tsx bahwa login berhasil
        onLoginSuccess({ name: result.name, role: result.role })
      } else {
        // Asumsi backend mengembalikan error jika gagal
        setError(result.error || 'Username atau password salah.')
      }
    } catch (err) {
      console.error('Login error:', err)
      setError((err as Error).message || 'Terjadi kesalahan saat mencoba login.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="page-container" style={{ maxWidth: '450px', margin: '5rem auto' }}>
      <Card>
        <h1 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Login ERP Ubinkayu</h1>
        <form onSubmit={handleLogin}>
          <Input
            label="Username"
            type="text"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Masukkan username"
            required
            disabled={isLoading}
          />
          <Input
            label="Password"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Masukkan password"
            required
            disabled={isLoading}
            style={{ marginTop: '1rem' }} // Beri jarak
          />

          {error && (
            <p style={{ color: 'red', marginTop: '1rem', textAlign: 'center', fontSize: '0.9em' }}>
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={isLoading}
            style={{ width: '100%', marginTop: '2rem' }} // Tombol full width
          >
            {isLoading ? 'Memproses...' : 'Login'}
          </Button>
        </form>
      </Card>
      <p style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.8em', color: '#888' }}>
        Hanya login, tidak ada registrasi. Hubungi admin untuk akses.
      </p>
      <p
        style={{
          marginTop: '1rem',
          textAlign: 'center',
          fontSize: '0.8em',
          color: 'darkred',
          fontWeight: 'bold'
        }}
      >
        PERINGATAN: Sistem login ini belum aman untuk produksi.
      </p>
    </div>
  )
}

export default LoginPage
