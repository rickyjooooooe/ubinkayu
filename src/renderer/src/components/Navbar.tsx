import React from 'react'
import logo from '../assets/WhatsApp Image 2025-09-09 at 14.30.02 - Edited.png'
import {
  LuLayoutDashboard,
  LuListOrdered,
  LuTrendingUp,
  LuActivity,
  LuRefreshCw,
  LuLoader,
  LuBrainCircuit,
  LuLogOut // Impor ikon Logout
} from 'react-icons/lu'
import { useWindowWidth } from '../hooks/useWindowWidth'
import './Navbar.css'

interface NavbarProps {
  currentView: string
  onNavigate: (view: 'dashboard' | 'list' | 'tracking' | 'analysis' | 'aiChat') => void
  onRefresh: () => void
  isRefreshing: boolean
  onLogout: () => void // <-- Prop baru untuk logout
  userName?: string // <-- Prop baru untuk nama user (opsional)
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
  const isMobile = windowWidth <= 768

  const handleLinkClick = (view: 'dashboard' | 'list' | 'tracking' | 'analysis' | 'aiChat') => {
    onNavigate(view)
  }

  const getLinkClass = (viewName: string) => {
    // Tipe viewName lebih umum
    const listViews = ['list', 'input', 'detail'] // Hapus 'history'
    const trackingViews = ['tracking', 'updateProgress']

    if (viewName === 'list' && listViews.includes(currentView)) return 'active'
    if (viewName === 'tracking' && trackingViews.includes(currentView)) return 'active'
    if (viewName === currentView) return 'active'
    return ''
  }

  const allNavLinks = [
    /* ... array nav links sama ... */
  ]
  const linksToRender = isMobile ? allNavLinks : allNavLinks.filter((link) => !link.mobileOnly)

  return (
    <nav className="navbar">
      {/* Brand (Desktop) */}
      {!isMobile && (
        <div className="navbar-brand">
          <img src={logo} alt="Ubinkayu Logo" className="navbar-logo" />
        </div>
      )}

      {/* Nav Links */}
      <div className="navbar-links">
        {linksToRender.map((link) => (
          <a
            key={link.id}
            href="#"
            onClick={(e) => {
              e.preventDefault()
              handleLinkClick(link.id as any)
            }} // Tambah preventDefault
            className={`nav-link ${getLinkClass(link.id)}`}
          >
            <link.Icon className="nav-icon" />
            <span className="nav-link-label">{link.label}</span>
          </a>
        ))}
      </div>

      {/* Actions (Desktop: Refresh, User, Logout) */}
      {!isMobile && (
        <div className="navbar-actions">
          {/* Tampilkan Nama User jika ada */}
          {userName && <span className="user-greeting">Hi, {userName.split(' ')[0]}!</span>}
          {/* Tombol Refresh */}
          <Button
            variant="secondary"
            className="refresh-btn-desktop"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh Data" // Tambah title
          >
            {isRefreshing ? <LuLoader className="spin-icon" /> : <LuRefreshCw />}
            <span className="refresh-btn-text">{isRefreshing ? 'Memuat...' : 'Refresh'}</span>
          </Button>
          {/* Tombol Logout */}
          <Button
            variant="secondary" // Atau 'danger' jika ingin merah
            onClick={onLogout}
            title="Logout" // Tambah title
          >
            <LuLogOut />
            <span className="logout-btn-text">Logout</span>
          </Button>
        </div>
      )}

      {/* Tombol Logout (Mobile - bisa diletakkan di navbar atau menu lain) */}
      {/* Contoh: tambahkan sebagai item terakhir di navbar mobile */}
      {isMobile && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onLogout()
          }}
          className="nav-link logout-mobile" // Beri class khusus jika perlu styling beda
          title="Logout"
        >
          <LuLogOut className="nav-icon" />
          <span className="nav-link-label">Logout</span>
        </a>
      )}
    </nav>
  )
}

export default Navbar
