// file: src/renderer/src/components/Navbar.tsx

import React from 'react'
import logo from '../assets/WhatsApp Image 2025-09-09 at 14.30.02 - Edited.png'
import {
  LuLayoutDashboard,
  LuListOrdered,
  LuTrendingUp,
  LuActivity,
  LuRefreshCw,
  LuLoader, // Ganti nama impor agar konsisten
  LuBrainCircuit
} from 'react-icons/lu'
// Impor hook
import { useWindowWidth } from '../hooks/useWindowWidth'
import './Navbar.css'

interface NavbarProps {
  currentView: string
  onNavigate: (view: 'dashboard' | 'list' | 'tracking' | 'analysis' | 'aiChat') => void
  onRefresh: () => void
  isRefreshing: boolean
}

const Navbar: React.FC<NavbarProps> = ({ currentView, onNavigate, onRefresh, isRefreshing }) => {
  // --- DETEKSI UKURAN LAYAR ---
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth <= 768 // Sesuaikan breakpoint ini jika perlu (samakan dengan CSS)

  const handleLinkClick = (view: 'dashboard' | 'list' | 'tracking' | 'analysis' | 'aiChat') => {
    onNavigate(view)
  }

  const getLinkClass = (viewName: 'dashboard' | 'list' | 'tracking' | 'analysis' | 'aiChat') => {
    const listViews = ['list', 'input', 'detail', 'history']
    const trackingViews = ['tracking', 'updateProgress']

    if (viewName === 'list' && listViews.includes(currentView)) return 'active'
    if (viewName === 'tracking' && trackingViews.includes(currentView)) return 'active'
    if (viewName === 'aiChat' && currentView === 'aiChat') return 'active' // Cek untuk AI
    if (viewName === currentView) return 'active'

    return ''
  }

  // Definisikan SEMUA link yang mungkin ada
  const allNavLinks = [
    { id: 'dashboard', label: 'Dashboard', Icon: LuLayoutDashboard },
    { id: 'list', label: 'Purchase Orders', Icon: LuListOrdered },
    { id: 'tracking', label: 'Progress', Icon: LuActivity },
    { id: 'analysis', label: 'Analysis', Icon: LuTrendingUp },
    { id: 'aiChat', label: 'AI Assist', Icon: LuBrainCircuit, mobileOnly: true } // <-- Tandai mobileOnly
  ]

  // --- FILTER LINK BERDASARKAN UKURAN LAYAR ---
  const linksToRender = isMobile
    ? allNavLinks // Tampilkan semua di mobile
    : allNavLinks.filter((link) => !link.mobileOnly) // Sembunyikan yang mobileOnly di desktop

  return (
    // Navbar tetap di atas untuk desktop, berubah jadi bawah di mobile via CSS
    <nav className="navbar">
      <div className="navbar-brand">
        <img src={logo} alt="Ubinkayu Logo" className="navbar-logo" />
      </div>

      <div className="navbar-links">
        {/* Gunakan linksToRender untuk map */}
        {linksToRender.map((link) => (
          <a
            key={link.id}
            href="#"
            onClick={() => handleLinkClick(link.id as any)} // Cast 'as any' sementara
            className={`nav-link ${getLinkClass(link.id as any)}`} // Cast 'as any' sementara
          >
            <link.Icon className="nav-icon" />
            {/* Ganti span biasa jadi span dengan class agar bisa ditarget CSS */}
            <span className="nav-link-label">{link.label}</span>
          </a>
        ))}
      </div>

      {/* Tombol Refresh Desktop (Tetap ada, akan disembunyikan via CSS di mobile) */}
      <div className="navbar-actions">
        <button
          className="btn btn-secondary refresh-btn-desktop"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? <LuLoader className="spin-icon" /> : <LuRefreshCw />}
          {/* Sembunyikan teks di mobile jika perlu (bisa via CSS) */}
          <span className="refresh-btn-text">{isRefreshing ? 'Memuat...' : 'Refresh'}</span>
        </button>
      </div>
      {/* FAB Refresh sudah dihapus, tidak perlu lagi */}
    </nav>
  )
}

export default Navbar
