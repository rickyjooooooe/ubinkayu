/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import React, { useState, useEffect } from 'react'
import { POHeader, Message } from './types'
import Navbar from './components/Navbar'
import POListPage from './pages/POListPage'
import InputPOPage from './pages/InputPOPage'
import PODetailPage from './pages/PODetailPage'
import ProgressTrackingPage from './pages/ProgressTrackingPage'
import DashboardPage from './pages/DashboardPage'
import UpdateProgressPage from './pages/UpdateProgressPage'
import AnalysisPage from './pages/AnalysisPage'
import Chatbot from './components/Chatbot'
import { useWindowWidth } from './hooks/useWindowWidth'
import * as apiService from './apiService'

// Definisikan tipe untuk view
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

// Definisikan pesan awal di luar komponen
const initialChatMessage: Message = {
  sender: 'bot',
  text: 'Halo! Saya Asisten AI Ubinkayu. Ada yang bisa saya bantu?'
}

function App() {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth <= 768

  // --- STATE APLIKASI ---
  const [view, setView] = useState<AppView>('dashboard')

  // [PERBAIKAN] Hapus deklarasi duplikat. Cukup satu state untuk allPOs.
  const [allPOs, setAllPOs] = useState<POHeader[]>([])

  const [editingPO, setEditingPO] = useState<POHeader | null>(null)
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [trackingPO, setTrackingPO] = useState<POHeader | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [previousView, setPreviousView] = useState<AppView>('dashboard')

  // --- STATE CHATBOT ---
  const [chatMessages, setChatMessages] = useState<Message[]>([initialChatMessage])
  const [chatInputText, setChatInputText] = useState('')
  const [isChatProcessing, setIsChatProcessing] = useState(false)

  // --- FUNGSI DATA PO ---
  const fetchPOs = async () => {
    try {
      // @ts-ignore
      const pos: POHeader[] = await apiService.listPOs()
      setAllPOs(pos)
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
    initialFetch()
  }, [])

  // --- FUNGSI HANDLER ---
  const handleDeletePO = async (poId: string) => {
    const poToDelete = allPOs.find((po) => po.id === poId)
    const poInfo = poToDelete ? `${poToDelete.po_number} - ${poToDelete.project_name}` : poId
    const confirmMessage = `⚠️ PERINGATAN PENGHAPUSAN\n\nPO: ${poInfo}\n\nData yang akan dihapus PERMANEN:\n• Semua revisi PO\n• Semua item & progress\n• File PDF & foto dari Google Drive\n\nTindakan ini TIDAK DAPAT DIBATALKAN!\n\nApakah Anda yakin ingin melanjutkan?`

    if (window.confirm(confirmMessage)) {
      setIsLoading(true)
      try {
        // @ts-ignore
        const result = await apiService.deletePO(poId)
        if (result.success) {
          alert(`✅ PENGHAPUSAN BERHASIL\n\n${result.message}`)

          // [PERBAIKAN] Panggil fetchPOs() cukup sekali
          await fetchPOs() // Muat ulang daftar PO
        } else {
          // @ts-ignore
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

  // [PERBAIKAN] Ini adalah versi yang benar untuk auto-refresh
  const handleBackToList = async () => {
    setIsLoading(true) // Tampilkan loading spinner
    await fetchPOs() // Ambil data PO terbaru
    setIsLoading(false) // Sembunyikan loading spinner
    handleNavigate('list') // Pindah halaman
  }

  const handleSelectPOForTracking = (po: POHeader) => {
    setTrackingPO(po)
    setView('updateProgress')
  }

  const handleShowProgress = (po: POHeader) => {
    setTrackingPO(po)
    setView('updateProgress')
  }

  // --- FUNGSI NAVIGASI & CHAT ---
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

  // --- LOGIKA INTI CHATBOT ---
  const processUserQuery = async (query: string): Promise<string> => {
    if (!allPOs || allPOs.length === 0) {
      if (query.toLowerCase().includes('bantuan') || query.toLowerCase().includes('siapa')) {
        // Tetap izinkan pertanyaan dasar ini
      } else {
        return 'Maaf, data PO belum tersedia untuk dianalisis saat ini.'
      }
    }

    try {
      // @ts-ignore
      const aiResponse = await apiService.ollamaChat(query)
      if (aiResponse) {
        return aiResponse
      } else {
        return "Maaf, Asisten AI canggih hanya tersedia di aplikasi desktop. Coba tanyakan 'bantuan'."
      }
    } catch (error) {
      console.error('Error di fallback AI:', error)
      return `Maaf, terjadi kesalahan: ${(error as Error).message}`
    }
  }

  const handleChatSendMessage = async () => {
    if (!chatInputText.trim() || isChatProcessing) return
    const userMessage: Message = { sender: 'user', text: chatInputText }
    setChatMessages((prev) => [...prev, userMessage])
    setIsChatProcessing(true)

    const botText = await processUserQuery(chatInputText)
    const botMessage: Message = { sender: 'bot', text: botText }

    setChatMessages((prev) => [...prev, botMessage])
    setIsChatProcessing(false)
    setChatInputText('')
  }

  const handleChatInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setChatInputText(e.target.value)
  }

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleChatSendMessage()
    }
  }

  const handleChatReset = () => {
    setChatMessages([initialChatMessage])
    setChatInputText('')
    setIsChatProcessing(false)
  }
  // --- AKHIR LOGIKA CHATBOT ---

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
              // onShowHistory prop removed
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
        return (
          <Chatbot
            mode="page"
            // allPOs={allPOs} // Dihapus karena tidak dipakai
            onMinimize={handleMinimizeChat}
            messages={chatMessages}
            inputText={chatInputText}
            isProcessing={isChatProcessing}
            onSendMessage={handleChatSendMessage}
            onInputChange={handleChatInputChange}
            onKeyDown={handleChatKeyDown}
            onChatReset={handleChatReset}
          />
        )
      case 'list':
      default:
        return (
          <POListPage
            poList={allPOs} // Kirim data PO yang sudah di-refresh
            onAddPO={handleShowInputForm}
            // @ts-ignore
            onDeletePO={handleDeletePO}
            onEditPO={handleEditPO}
            onShowDetail={handleShowDetail}
            onShowProgress={handleShowProgress}
            isLoading={isLoading} // Kirim status loading
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
        <Chatbot
          mode="widget"
          // allPOs={allPOs} // Dihapus karena tidak dipakai
          onMaximize={handleMaximizeChat}
          messages={chatMessages}
          inputText={chatInputText}
          isProcessing={isChatProcessing}
          onSendMessage={handleChatSendMessage}
          onInputChange={handleChatInputChange}
          onKeyDown={handleChatKeyDown}
          onChatReset={handleChatReset}
        />
      )}
    </div>
  )
}

export default App