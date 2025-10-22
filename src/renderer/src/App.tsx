// file: src/renderer/src/App.tsx
import React, { useState, useEffect } from 'react'
import { POHeader } from './types'
import Navbar from './components/Navbar'
import POListPage from './pages/POListPage'
import InputPOPage from './pages/InputPOPage'
import PODetailPage from './pages/PODetailPage'
import ProgressTrackingPage from './pages/ProgressTrackingPage'
import DashboardPage from './pages/DashboardPage'
import RevisionHistoryPage from './pages/RevisionHistoryPage'
import UpdateProgressPage from './pages/UpdateProgressPage'
import AnalysisPage from './pages/AnalysisPage'
import Chatbot from './components/Chatbot'
import { useWindowWidth } from './hooks/useWindowWidth'
import * as apiService from './apiService'

// Definisikan tipe untuk view agar lebih aman
type AppView =
  | 'dashboard'
  | 'list'
  | 'input'
  | 'detail'
  | 'tracking'
  | 'history'
  | 'updateProgress'
  | 'analysis'
  | 'aiChat'

function App() {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth <= 768

  // --- STATE UTAMA ---
  const [view, setView] = useState<AppView>('dashboard')
  // Gunakan HANYA SATU state untuk daftar PO
  const [allPOs, setAllPOs] = useState<POHeader[]>([])
  const [editingPO, setEditingPO] = useState<POHeader | null>(null)
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [trackingPO, setTrackingPO] = useState<POHeader | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [previousView, setPreviousView] = useState<AppView>('dashboard')

  // --- FUNGSI-FUNGSI ---
  const fetchPOs = async () => {
    // Jangan set isLoading true di sini agar refresh terasa lebih halus
    try {
      const pos: POHeader[] = await apiService.listPOs()
      setAllPOs(pos) // <-- Gunakan setAllPOs
    } catch (error) {
      console.error('Gagal mengambil daftar PO:', error)
      alert(`Gagal mengambil daftar PO: ${(error as Error).message}`)
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchPOs()
    setIsRefreshing(false)
  }

  useEffect(() => {
    const initialFetch = async () => {
      setIsLoading(true)
      await fetchPOs()
      setIsLoading(false)
    }
    // Fetch data saat komponen pertama kali dimuat
    initialFetch()
  }, []) // Dependensi kosong agar hanya jalan sekali

  const handleDeletePO = async (poId: string) => {
    const poToDelete = allPOs.find((po) => po.id === poId)
    const poInfo = poToDelete ? `${poToDelete.po_number} - ${poToDelete.project_name}` : poId
    const confirmMessage = `⚠️ PERINGATAN PENGHAPUSAN\n\nPO: ${poInfo}\n\nData yang akan dihapus PERMANEN:\n• Semua revisi PO\n• Semua item & progress\n• File PDF & foto dari Google Drive\n\nTindakan ini TIDAK DAPAT DIBATALKAN!\n\nApakah Anda yakin ingin melanjutkan?`

    if (window.confirm(confirmMessage)) {
      setIsLoading(true)
      try {
        const result = await apiService.deletePO(poId)
        if (result.success) {
          alert(`✅ PENGHAPUSAN BERHASIL\n\n${result.message}`)
          fetchPOs() // Muat ulang daftar PO
        } else {
          throw new Error(result.error)
        }
      } catch (error) {
        alert(`❌ Gagal menghapus PO: ${(error as Error).message}\n\nSilakan coba lagi.`)
      } finally {
        setIsLoading(false)
      }
    }
  }

  const handleEditPO = (po: POHeader) => {
    setEditingPO(po)
    setView('input')
  }
  const handleShowInputForm = () => {
    setEditingPO(null)
    setView('input')
  }
  const handleShowDetail = (po: POHeader) => {
    setSelectedPoId(po.id)
    setView('detail')
  }
  const handleShowHistory = () => {
    if (selectedPoId) setView('history')
  }
  const handleBackToList = () => {
    handleNavigate('list')
  }
  const handleSelectPOForTracking = (po: POHeader) => {
    setTrackingPO(po)
    setView('updateProgress')
  }
  const handleShowProgress = (po: POHeader) => {
    setTrackingPO(po)
    setView('updateProgress')
  }

  const handleNavigate = (targetView: AppView): void => {
    if (targetView === 'aiChat' && view !== 'aiChat') {
      setPreviousView(view)
    }
    setSelectedPoId(null)
    setTrackingPO(null)
    setEditingPO(null)
    setView(targetView)
  }

  const handleMaximizeChat = () => {
    handleNavigate('aiChat')
  }
  const handleMinimizeChat = () => {
    setView(previousView)
  }

  const getCurrentPO = () => {
    if (!selectedPoId) return null
    return allPOs.find((p) => p.id === selectedPoId) || null
  }

  const renderContent = () => {
    const currentPO = getCurrentPO()
    switch (view) {
      case 'dashboard':
        return <DashboardPage poList={allPOs} isLoading={isLoading} />
      case 'input':
        return <InputPOPage onSaveSuccess={handleBackToList} editingPO={editingPO} />
      case 'detail':
        return (
          <PODetailPage
            po={currentPO}
            onBackToList={handleBackToList}
            onShowHistory={handleShowHistory}
          />
        )
      case 'tracking':
        return <ProgressTrackingPage onSelectPO={handleSelectPOForTracking} />
      case 'history':
        return (
          <RevisionHistoryPage
            poId={currentPO?.id || null}
            poNumber={currentPO?.po_number || null}
            onBack={() => setView('detail')}
          />
        )
      case 'updateProgress':
        return <UpdateProgressPage po={trackingPO} onBack={() => setView('tracking')} />
      case 'analysis':
        return <AnalysisPage />
      case 'aiChat':
        return <Chatbot mode="page" allPOs={allPOs} onMinimize={handleMinimizeChat} />
      case 'list':
      default:
        return (
          <POListPage
            poList={allPOs}
            onAddPO={handleShowInputForm}
            onDeletePO={handleDeletePO}
            onEditPO={handleEditPO}
            onShowDetail={handleShowDetail}
            onShowProgress={handleShowProgress}
            isLoading={isLoading}
          />
        )
    }
  }

  return (
    <div className="app-layout">
      <Navbar
        currentView={view}
        onNavigate={handleNavigate}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />
      <main className="main-content">{renderContent()}</main>
      {!isMobile && view !== 'aiChat' && (
        <Chatbot mode="widget" allPOs={allPOs} onMaximize={handleMaximizeChat} />
      )}
    </div>
  )
}

export default App
