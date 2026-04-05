/* eslint-disable outdoor/prettier */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import React, { useState, useEffect, useRef } from 'react'
import logo from '../assets/WhatsApp Image 2025-09-09 at 14.30.02 - Edited.png'
import {
  LuRefreshCw,
  LuLoader,
  LuLogOut,
  LuLayoutDashboard,
  LuListOrdered,
  LuActivity,
  LuTrendingUp,
  LuBrainCircuit,
  LuMoveHorizontal,
  LuWallet // Ikon baru untuk fitur Komisi
} from 'react-icons/lu'
import type { IconType } from 'react-icons'
import { Button } from './Button'
import { useWindowWidth } from '../hooks/useWindowWidth'
import './Navbar.css'
import type { User } from '../types'

// Tambahkan 'commission' ke dalam tipe AppView
type AppView = 'dashboard' | 'list' | 'tracking' | 'analysis' | 'aiChat' | 'commission'

interface NavLinkItem {
  id: AppView | 'more'
  label: string
  Icon: IconType
  mobileOnly?: boolean
}

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
    // Definisi grouping view agar tab tetap menyala saat di sub-halaman
    const trackingViews = ['tracking', 'updateProgress']
    const listViews = ['list', 'input', 'detail', 'history']
    const commissionViews = ['commission', 'requestProject', 'accProject']

    if (viewName === 'list' && listViews.includes(currentView)) return 'active'
    if (viewName === 'tracking' && trackingViews.includes(currentView)) return 'active'
    if (viewName === 'commission' && commissionViews.includes(currentView)) return 'active'
    if (viewName === 'more' && currentView === 'aiChat') return 'active'
    if (viewName === currentView) return 'active'
    return ''
  }

  // Definisi semua link navigasi
  const navLinksDefinition: NavLinkItem[] = [
    { id: 'dashboard', label: 'Dashboard', Icon: LuLayoutDashboard },
    { id: 'list', label: 'Order', Icon: LuListOrdered },
    { id: 'tracking', label: 'Progress', Icon: LuActivity },
    { id: 'analysis', label: 'Analysis', Icon: LuTrendingUp },
    { id: 'commission', label: 'Komisi', Icon: LuWallet }, // Fitur Baru
    { id: 'more', label: 'Lainnya', Icon: LuMoveHorizontal }
  ]

  const aiAssistLink: NavLinkItem = {
    id: 'aiChat',
    label: 'AI Assist',
    Icon: LuBrainCircuit,
    mobileOnly: true
  }

  // Logika Filter berdasarkan Role (Sangat Penting untuk Skripsi)
  const linksToRender = (
    isMobile ? navLinksDefinition : navLinksDefinition.filter((link) => link.id !== 'more')
  ).filter((link) => {
    if (!currentUser?.role) return true

    // 1. Sembunyikan 'Progress' jika user adalah Admin (Admin fokus ke Manajerial)
    if (link.id === 'tracking' && currentUser.role === 'admin') {
      return false
    }

    // 2. Sembunyikan 'Komisi' jika user adalah tim Produksi
    // Fitur ini hanya untuk Marketing (pelaku) dan Admin (pemberi ACC/Owner)
    if (link.id === 'commission' && currentUser.role === 'produksi') {
      return false
    }

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
        {linksToRender.map((link) => (
          <a
            key={link.id}
            id={`nav-link-${link.id}`}
            href="#"
            onClick={(e) => {
              e.preventDefault()
              handleLinkClick(link.id)
            }}
            className={`nav-link ${getLinkClass(link.id)} ${link.id === 'more' && isMoreMenuOpen ? 'more-open' : ''}`}
            title={link.label}
          >
            <link.Icon className="nav-icon" />
            <span className="nav-link-label">{link.label}</span>
          </a>
        ))}
      </div>

      {!isMobile && (
        <div className="navbar-actions">
          {currentUser?.name && (
            <span className="user-greeting">
              Hi, {currentUser.name.split(' ')[0]}!
            </span>
          )}
          <Button
            variant="secondary"
            className="refresh-btn-desktop"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh Data"
          >
            {isRefreshing ? <LuLoader className="spin-icon" /> : <LuRefreshCw />}
            <span className="refresh-btn-text">
              {isRefreshing ? 'Memuat...' : 'Refresh'}
            </span>
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
        </div>
      )}

      {isMobile && isMoreMenuOpen && (
        <div ref={moreMenuRef} className="more-menu-popup">
          <div className="more-menu-overlay" onClick={() => setIsMoreMenuOpen(false)}></div>
          <div className="more-menu-content">
            <button
              className={`more-menu-item ${currentView === aiAssistLink.id ? 'active' : ''}`}
              onClick={() => {
                onNavigate(aiAssistLink.id as AppView)
                setIsMoreMenuOpen(false)
              }}
            >
              <aiAssistLink.Icon />
              <span>{aiAssistLink.label}</span>
            </button>
            <button
              className="more-menu-item logout-item"
              onClick={() => {
                onLogout()
                setIsMoreMenuOpen(false)
              }}
            >
              <LuLogOut />
              <span>Logout ({currentUser?.name?.split(' ')[0]})</span>
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}

export default Navbar