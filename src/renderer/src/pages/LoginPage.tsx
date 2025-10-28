import React, { useState } from 'react'
import { Card } from '../components/Card'
import { Input } from '../components/Input' // Kita masih pakai ini untuk username
import { Button } from '../components/Button'
import * as apiService from '../apiService'

// --- [BARU] Definisikan Ikon SVG sebagai konstanta ---
// Kita letakkan di luar komponen agar tidak dibuat ulang setiap render
const EyeIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{ width: '20px', height: '20px' }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 10.224 7.68 6 12 6s8.577 4.224 9.964 5.683c.25.312.25.827 0 1.139-1.387 1.459-5.54 5.683-9.964 5.683S3.423 13.781 2.036 12.322Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
);

const EyeSlashIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{ width: '20px', height: '20px' }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 14.334 7.21 18 12 18c.996 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.79 0 8.774 3.666 10.066 6.027a1.531 1.531 0 0 1 0 1.446A10.451 10.451 0 0 1 17.772 17.772M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.243 4.243L15 12m-3-3L6.228 6.228" />
  </svg>
);
// --- Akhir Ikon SVG ---


// Tipe data sukses
interface LoginSuccessResponse {
  success: true
  name: string
  role?: string
}
// Tipe data gagal
interface LoginErrorResponse {
  success: false
  error: string
}
// Tipe gabungan
type LoginResponse = LoginSuccessResponse | LoginErrorResponse

interface LoginPageProps {
  onLoginSuccess: (userData: { name: string; role?: string }) => void // Callback ke App.tsx
}

const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // State untuk menampilkan/menyembunyikan password
  const [showPassword, setShowPassword] = useState(false)

  // --- Definisikan Akun Dummy ---
  const DUMMY_USERNAME = 'test'
  const DUMMY_PASSWORD = 'test'
  const DUMMY_USER_DATA = { name: 'Test User (Dummy)', role: 'tester' }
  // --- Akhir Akun Dummy ---

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    if (!username || !password) {
      setError('Username dan password harus diisi.')
      setIsLoading(false)
      return
    }

    // --- Pengecekan Akun Dummy ---
    if (username === DUMMY_USERNAME && password === DUMMY_PASSWORD) {
      console.log('Dummy user login successful!')
      onLoginSuccess(DUMMY_USER_DATA)
      setIsLoading(false)
      return
    }
    // --- Akhir Pengecekan Dummy ---

    // --- Logika Login via API (Jika bukan dummy) ---
    try {
      console.log('Attempting API login for:', username)
      const result: LoginResponse = await apiService.loginUser(username, password)

      if (result && result.success === true) {
        onLoginSuccess({ name: result.name, role: result.role })
      } else if (result && result.success === false) {
        setError(result.error || 'Username atau password salah.')
      } else {
        console.error('Unexpected login response structure:', result)
        setError('Respons login tidak valid dari server.')
      }
    } catch (err) {
      console.error('Login error:', err)
      setError((err as Error).message || 'Terjadi kesalahan saat mencoba login.')
    } finally {
      setIsLoading(false)
    }
    // --- Akhir Logika API ---
  } // Akhir handleLogin

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

          {/* --- [MODIFIKASI] Ganti <Input> dengan <input> manual + ikon --- */}
          <div style={{ marginTop: '1rem' }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '0.9em',
                fontWeight: '500',
                color: '#333' // Samakan warna label
              }}
            >
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                // Tipe input diatur oleh state
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan password"
                required
                disabled={isLoading}
                style={{
                  // Styling agar mirip dengan komponen <Input> Anda
                  width: '100%',
                  padding: '10px 40px 10px 12px', // padding kanan 40px untuk ikon
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1em',
                  boxSizing: 'border-box' // Penting agar padding tidak merusak lebar
                }}
              />
              <button
                type="button" // PENTING: agar tidak men-submit form
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#888',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                {/* Ganti ikon berdasarkan state */}
                {showPassword ? EyeSlashIcon : EyeIcon}
              </button>
            </div>
          </div>
          {/* --- Akhir Modifikasi --- */}


          {error && (
            <p style={{ color: 'red', marginTop: '1rem', textAlign: 'center', fontSize: '0.9em' }}>
              {error}
            </p>
          )}

          <Button type="submit" disabled={isLoading} style={{ width: '100%', marginTop: '2rem' }}>
            {isLoading ? 'Memproses...' : 'Login'}
          </Button>
        </form>
      </Card>
      <p style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.8em', color: '#888' }}>
        Hanya login, tidak ada registrasi. Hubungi admin untuk akses.
      </p>
    </div>
  )
}

export default LoginPage