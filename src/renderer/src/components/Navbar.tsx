import React, { useState, useEffect, useRef } from 'react'
import logo from '../assets/WhatsApp Image 2025-09-09 at 14.30.02 - Edited.png' // Pastikan path logo benar
import {
  // Hanya impor ikon yang dipakai + IconType
  LuRefreshCw,
  LuLoader,
  LuLogOut,
  LuLayoutDashboard,
  LuListOrdered,
  LuActivity,
  LuTrendingUp,
  LuBrainCircuit,
  LuMoveHorizontal
} from 'react-icons/lu'
// [FIX] Impor IconType dari 'react-icons' bukan 'react-icons/lu'
import type { IconType } from 'react-icons'
import { Button } from './Button' // <-- [FIX] Pastikan Button diimpor
import { useWindowWidth } from '../hooks/useWindowWidth'
import './Navbar.css' // Pastikan path CSS benar
import type { User } from '../types'

// Definisikan tipe view yang valid untuk navigasi
type AppView = 'dashboard' | 'list' | 'tracking' | 'analysis' | 'aiChat'

// Definisikan interface untuk objek link navigasi
interface NavLinkItem {
  id: AppView | 'more' // ID bisa string AppView atau 'more'
  label: string
  Icon: IconType // Gunakan IconType
  mobileOnly?: boolean // mobileOnly ditambahkan kembali jika diperlukan untuk filter
}

// Definisikan props untuk komponen Navbar
interface NavbarProps {
  currentView: string
  onNavigate: (view: AppView) => void
  onRefresh: () => void
  isRefreshing: boolean
  onLogout: () => void
  userName?: string
  currentUser: User | null
}

const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onNavigate,
  onRefresh,
  isRefreshing,
  onLogout,
  userName,
  currentUser
}) => {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth <= 768

  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  const handleLinkClick = (viewId: AppView | 'more') => {
    if (viewId === 'more') {
      setIsMoreMenuOpen((prev) => !prev)
    } else {
      setIsMoreMenuOpen(false)
      onNavigate(viewId)
    }
  }

  const getLinkClass = (viewName: string) => {
    const listViews = ['list', 'input', 'detail']
    const trackingViews = ['tracking', 'updateProgress']

    if (viewName === 'list' && listViews.includes(currentView)) return 'active'
    if (viewName === 'tracking' && trackingViews.includes(currentView)) return 'active'
    if (viewName === 'more' && currentView === 'aiChat') return 'active' // aiChat is under 'more'
    if (viewName === currentView) return 'active'
    return ''
  }

  // [FIX] Beri tipe NavLinkItem[] dan pastikan ikon diimpor
  // Pastikan ikon yang diimpor di atas sesuai dengan yang dipakai di sini
  const navLinksDefinition: NavLinkItem[] = [
    { id: 'dashboard', label: 'Dashboard', Icon: LuLayoutDashboard },
    { id: 'list', label: 'PO', Icon: LuListOrdered },
    { id: 'tracking', label: 'Progress', Icon: LuActivity },
    { id: 'analysis', label: 'Analysis', Icon: LuTrendingUp },
    { id: 'more', label: 'Lainnya', Icon: LuMoveHorizontal } // Link 'Lainnya' untuk mobile
  ]

  // AI Assist link data, used inside the 'more' menu
  const aiAssistLink: NavLinkItem = {
    id: 'aiChat',
    label: 'AI Assist',
    Icon: LuBrainCircuit,
    mobileOnly: true
  }

  // Filter link berdasarkan ukuran layar
  // Di desktop, tampilkan 4 item utama. Di mobile, tampilkan 5 item (termasuk 'more')
  const linksToRender = (
    isMobile ? navLinksDefinition : navLinksDefinition.filter((link) => link.id !== 'more')
  ).filter((link) => {
    if (!currentUser?.role) return true

    // Sembunyikan 'Progress' jika role adalah 'marketing' ATAU 'admin'
    if (
      link.id === 'tracking' &&
      (currentUser.role === 'marketing' || currentUser.role === 'admin')
    ) {
      return false
    }

    // Tampilkan semua link lainnya
    return true
  })

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        isMobile &&
        isMoreMenuOpen &&
        moreMenuRef.current &&
        !moreMenuRef.current.contains(event.target as Node)
      ) {
        const moreButton = document.getElementById('nav-link-more')
        if (moreButton && !moreButton.contains(event.target as Node)) {
          setIsMoreMenuOpen(false)
        }
      }
    }
    if (isMoreMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    } else {
      document.removeEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isMoreMenuOpen, isMobile])

  return (
    <nav className="navbar">
      {!isMobile && (
        <div className="navbar-brand">
          <img src={logo} alt="Ubinkayu Logo" className="navbar-logo" />
        </div>
      )}

      <div className="navbar-links">
        {linksToRender.map(
          (
            link // 'link' sekarang bertipe NavLinkItem
          ) => (
            <a
              key={link.id} // Aman
              id={`nav-link-${link.id}`} // Beri ID unik
              href="#"
              onClick={(e) => {
                e.preventDefault()
                handleLinkClick(link.id)
              }} // Aman
              className={`nav-link ${getLinkClass(link.id)} ${link.id === 'more' && isMoreMenuOpen ? 'more-open' : ''}`} // Aman
              title={link.label} // Aman
            >
              <link.Icon className="nav-icon" /> {/* Aman */}
              <span className="nav-link-label">{link.label}</span> {/* Aman */}
            </a>
          )
        )}
      </div>

      {!isMobile && (
        <div className="navbar-actions">
          {userName && <span className="user-greeting">Hi, {userName.split(' ')[0]}!</span>}
          {/* [FIX] Gunakan komponen Button yang sudah diimpor */}
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
          <Button
            variant="secondary"
            onClick={() => onLogout()}
            title="Logout"
            className="logout-btn-desktop"
          >
            <LuLogOut />
            <span className="logout-btn-text">Logout</span>
          </Button>
          {/* --- Akhir perbaikan Button --- */}
        </div>
      )}

      {isMobile && isMoreMenuOpen && (
        <div ref={moreMenuRef} className="more-menu-popup">
          <div className="more-menu-overlay" onClick={() => setIsMoreMenuOpen(false)}></div>
          <div className="more-menu-content">
            {/* Gunakan data aiAssistLink */}
            <button
              className={`more-menu-item ${currentView === aiAssistLink.id ? 'active' : ''}`}
              onClick={() => {
                onNavigate(aiAssistLink.id as AppView)
                setIsMoreMenuOpen(false)
              }}
            >
              <aiAssistLink.Icon /> {/* Render Ikon AI */}
              <span>{aiAssistLink.label}</span> {/* Render Label AI */}
            </button>
            <button
              className="more-menu-item logout-item"
              onClick={() => {
                onLogout()
                setIsMoreMenuOpen(false)
              }}
            >
              <LuLogOut />
              <span>Logout ({userName?.split(' ')[0]})</span>
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}

export default Navbar
