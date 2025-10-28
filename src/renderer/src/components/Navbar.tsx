import React from 'react'
import logo from '../assets/WhatsApp Image 2025-09-09 at 14.30.02 - Edited.png' // Pastikan path logo benar
import {
  // Impor ikon yang benar-benar dipakai + IconType
  LuRefreshCw,
  LuLoader,
  LuLogOut,
  // Contoh jika Anda ingin menambahkan ikon lain:
  LuLayoutDashboard,
  LuListOrdered,
  LuActivity,
  LuTrendingUp,
  LuBrainCircuit
} from 'react-icons/lu'
import type { IconType } from 'react-icons'
import { Button } from './Button' // <-- Impor Button
import { useWindowWidth } from '../hooks/useWindowWidth'
import './Navbar.css' // Pastikan path CSS benar

// Definisikan tipe view yang valid untuk navigasi
type AppView = 'dashboard' | 'list' | 'tracking' | 'analysis' | 'aiChat'

// Definisikan interface untuk objek link navigasi
interface NavLinkItem {
  id: AppView // Gunakan tipe AppView
  label: string
  Icon: IconType // Tipe ikon dari react-icons
  mobileOnly?: boolean
}

// Definisikan props untuk komponen Navbar
interface NavbarProps {
  currentView: string // Bisa lebih spesifik jika AppView digunakan di App.tsx
  onNavigate: (view: AppView) => void // Gunakan tipe AppView
  onRefresh: () => void
  isRefreshing: boolean
  onLogout: () => void
  userName?: string
}

const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onNavigate,
  onRefresh,
  isRefreshing,
  onLogout,
  userName
}) => {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth <= 768 // Sesuaikan breakpoint jika perlu

  const handleLinkClick = (view: AppView) => {
    onNavigate(view)
  }

  // Fungsi untuk menentukan class 'active' (tidak berubah)
  const getLinkClass = (viewName: string) => {
    const listViews = ['list', 'input', 'detail']
    const trackingViews = ['tracking', 'updateProgress']

    if (viewName === 'list' && listViews.includes(currentView)) return 'active'
    if (viewName === 'tracking' && trackingViews.includes(currentView)) return 'active'
    if (viewName === currentView) return 'active'
    return ''
  }

  // Beri tipe pada array allNavLinks dan isi dengan data link
  // Ganti ikon sesuai kebutuhan Anda
  const allNavLinks: NavLinkItem[] = [
    { id: 'dashboard', label: 'Dashboard', Icon: LuLayoutDashboard },
    { id: 'list', label: 'Purchase Orders', Icon: LuListOrdered },
    { id: 'tracking', label: 'Progress', Icon: LuActivity },
    { id: 'analysis', label: 'Analysis', Icon: LuTrendingUp },
    { id: 'aiChat', label: 'AI Assist', Icon: LuBrainCircuit, mobileOnly: true } // AI hanya tampil di mobile nav
  ]

  // Filter link berdasarkan ukuran layar
  const linksToRender = isMobile ? allNavLinks : allNavLinks.filter((link) => !link.mobileOnly)

  return (
    <nav className="navbar">
      {/* Brand (Hanya Desktop) */}
      {!isMobile && (
        <div className="navbar-brand">
          <img src={logo} alt="Ubinkayu Logo" className="navbar-logo" />
        </div>
      )}

      {/* Nav Links */}
      <div className="navbar-links">
        {linksToRender.map((link) => (
          <a
            key={link.id} // Aman
            href="#"
            // Pastikan event handler benar
            onClick={(e) => {
              e.preventDefault()
              handleLinkClick(link.id)
            }}
            className={`nav-link ${getLinkClass(link.id)}`} // Aman
          >
            {/* Render ikon dan label */}
            <link.Icon className="nav-icon" /> {/* Aman */}
            <span className="nav-link-label">{link.label}</span> {/* Aman */}
          </a>
        ))}
        {/* Tombol Logout Khusus Mobile (jika diletakkan di dalam .navbar-links) */}
        {isMobile && (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              onLogout()
            }}
            className="nav-link logout-mobile" // Beri class khusus jika perlu styling
            title="Logout"
          >
            <LuLogOut className="nav-icon" />
            <span className="nav-link-label">Logout</span>
          </a>
        )}
      </div>

      {/* Actions (Hanya Desktop: Refresh, User, Logout) */}
      {!isMobile && (
        <div className="navbar-actions">
          {/* Sapaan User */}
          {userName && <span className="user-greeting">Hi, {userName.split(' ')[0]}!</span>}

          {/* Tombol Refresh */}
          <Button
            variant="secondary"
            className="refresh-btn-desktop"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh Data"
          >
            {isRefreshing ? <LuLoader className="spin-icon" /> : <LuRefreshCw />}
            <span className="refresh-btn-text">{isRefreshing ? 'Memuat...' : 'Refresh'}</span>
          </Button>

          {/* Tombol Logout */}
          <Button
            variant="secondary" // Atau variant lain sesuai desain
            onClick={onLogout}
            title="Logout"
            className="logout-btn-desktop" // Beri class khusus jika perlu
          >
            <LuLogOut />
            <span className="logout-btn-text">Logout</span>
          </Button>
        </div>
      )}
    </nav>
  )
}

export default Navbar
