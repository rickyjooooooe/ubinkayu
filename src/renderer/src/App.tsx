import React, { useState, useEffect } from 'react'
// Impor Tipe Data (pastikan CurrentUser didefinisikan jika perlu detail lebih)
import { POHeader, Message } from './types'

// Impor Komponen Halaman
import Navbar from './components/Navbar'
import POListPage from './pages/POListPage'
import InputPOPage from './pages/InputPOPage'
import PODetailPage from './pages/PODetailPage'
import ProgressTrackingPage from './pages/ProgressTrackingPage'
import DashboardPage from './pages/DashboardPage'
// Hapus impor RevisionHistoryPage jika file sudah dihapus
// import RevisionHistoryPage from './pages/RevisionHistoryPage';
import UpdateProgressPage from './pages/UpdateProgressPage'
import AnalysisPage from './pages/AnalysisPage'
import Chatbot from './components/Chatbot'
import LoginPage from './pages/LoginPage' // Impor Halaman Login

// Impor Hook dan Service
import * as apiService from './apiService'
import { useWindowWidth } from './hooks/useWindowWidth'

// Definisikan Tipe View Aplikasi
type AppView =
  | 'dashboard'
  | 'list'
  | 'input'
  | 'detail'
  | 'tracking'
  // | 'history' // Hapus jika sudah digabung ke detail
  | 'updateProgress'
  | 'analysis'
  | 'aiChat'

// Tipe sederhana untuk data user yang login
interface CurrentUser {
  name: string
  role?: string // Role bersifat opsional
}

// Pesan awal untuk Chatbot
const initialChatMessage: Message = {
  sender: 'bot',
  text: 'Halo! Saya Asisten AI Ubinkayu. Ada yang bisa saya bantu?'
}

function App() {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth <= 768

  // --- State Aplikasi ---
  const [view, setView] = useState<AppView>('dashboard') // View default saat login
  const [allPOs, setAllPOs] = useState<POHeader[]>([])
  const [editingPO, setEditingPO] = useState<POHeader | null>(null)
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null) // Untuk halaman detail
  const [isLoading, setIsLoading] = useState(true) // Loading awal PO List
  const [trackingPO, setTrackingPO] = useState<POHeader | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [previousView, setPreviousView] = useState<AppView>('dashboard') // Untuk kembali dari AI Chat

  // --- State Chatbot ---
  const [chatMessages, setChatMessages] = useState<Message[]>([initialChatMessage])
  const [chatInputText, setChatInputText] = useState('')
  const [isChatProcessing, setIsChatProcessing] = useState(false)

  // --- State Login ---
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null) // Awalnya null (belum login)
  const [isAuthLoading, setIsAuthLoading] = useState(true) // Loading status login awal

  // --- Cek Status Login Awal dari Session Storage ---
  useEffect(() => {
    console.log('Checking initial auth status...')
    const storedUser = sessionStorage.getItem('erpUser')
    if (storedUser) {
      try {
        const userData: CurrentUser = JSON.parse(storedUser)
        setCurrentUser(userData)
        console.log('User session restored:', userData.name)
      } catch (e) {
        console.error('Failed to parse stored user data, clearing session.')
        sessionStorage.removeItem('erpUser')
      }
    } else {
      console.log('No active user session found.')
    }
    setIsAuthLoading(false) // Selesai cek status login awal
  }, []) // Hanya dijalankan sekali saat mount

  // --- Fungsi Pengambilan Data PO ---
  const fetchPOs = async () => {
    // Hanya fetch jika sudah login dan proses cek auth awal selesai
    if (!currentUser || isAuthLoading) {
      console.log('fetchPOs skipped, user not logged in or auth check pending.')
      setAllPOs([])
      setIsLoading(false) // Pastikan loading selesai jika tidak fetch
      return
    }
    console.log('Fetching PO list...')
    setIsLoading(true)
    try {
      const pos: POHeader[] = await apiService.listPOs()
      // Lakukan validasi dasar pada data yang diterima
      if (Array.isArray(pos)) {
        setAllPOs(pos)
        console.log(`Fetched ${pos.length} POs successfully.`)
      } else {
        console.error('listPOs did not return an array:', pos)
        setAllPOs([])
        alert('Gagal memuat data PO: Format data tidak sesuai.')
      }
    } catch (error) {
      console.error('Gagal mengambil daftar PO:', error)
      alert(`Gagal mengambil daftar PO: ${(error as Error).message}`)
      // Pertimbangkan logout jika error otentikasi
      // if (error.message.includes('401') || error.message.includes('403')) {
      //    handleLogout("Sesi Anda mungkin berakhir, silakan login kembali.");
      // }
      setAllPOs([]) // Kosongkan data jika error
    } finally {
      setIsLoading(false) // Set loading selesai baik sukses maupun gagal
    }
  }

  const handleRefresh = async () => {
    if (!currentUser) return // Jangan refresh jika belum login
    console.log('Refreshing PO list...')
    setIsRefreshing(true)
    await fetchPOs()
    setIsRefreshing(false)
  }

  // Fetch POs saat user login atau saat refresh (jika sudah login)
  // Dipanggil ketika currentUser berubah (login/logout) ATAU saat isAuthLoading selesai
  useEffect(() => {
    if (currentUser && !isAuthLoading) {
      fetchPOs()
    } else if (!currentUser && !isAuthLoading) {
      // Jika logout setelah auth check selesai
      setAllPOs([])
      setIsLoading(false) // Set loading selesai
      console.log('User logged out, clearing PO data.')
    }
  }, [currentUser, isAuthLoading]) // Dependensi

  // --- Handler Aksi PO ---
  const handleDeletePO = async (poId: string, poInfo: string) => {
    // Tampilkan konfirmasi yang lebih jelas
    const confirmMessage = `⚠️ Hapus PO Permanen ⚠️\n\nPO: ${poInfo}\n\nSemua revisi, item, progress, dan file terkait akan dihapus.\nTindakan ini TIDAK DAPAT DIBATALKAN!\n\nYakin ingin melanjutkan?`
    // Gunakan confirm() bawaan browser (atau modal custom jika ada)
    // Note: Di Electron, confirm() mungkin tidak selalu tampil di depan, pertimbangkan modal custom
    if (window.confirm(confirmMessage)) {
      setIsLoading(true) // Bisa gunakan state loading terpisah jika perlu
      try {
        const result = await apiService.deletePO(poId)
        if (result.success) {
          alert(`✅ PO ${poInfo} berhasil dihapus.\n${result.message}`)
          await fetchPOs() // Muat ulang daftar PO
        } else {
          throw new Error(result.error || 'Gagal menghapus PO di backend.')
        }
      } catch (error) {
        alert(`❌ Gagal menghapus PO: ${(error as Error).message}`)
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
  const handleBackToList = () => {
    handleNavigate('list')
  } // Handler kembali ke daftar
  const handleSelectPOForTracking = (po: POHeader) => {
    setTrackingPO(po)
    setView('updateProgress')
  }
  const handleShowProgress = (po: POHeader) => {
    setTrackingPO(po)
    setView('updateProgress')
  } // Alias untuk konsistensi

  // --- Fungsi Navigasi Utama ---
  const handleNavigate = (targetView: AppView): void => {
    if (!currentUser) {
      // Blok navigasi jika belum login
      console.warn('Navigation blocked, user not logged in.')
      return
    }
    console.log(`Navigating from ${view} to ${targetView}`)
    if (targetView === 'aiChat' && view !== 'aiChat') {
      setPreviousView(view)
    }
    // Reset state halaman saat navigasi
    setSelectedPoId(null)
    setTrackingPO(null)
    setEditingPO(null)
    setView(targetView)
  }

  // --- Handler Login & Logout ---
  const handleLoginSuccess = (userData: CurrentUser) => {
    console.log('Login successful:', userData.name)
    setCurrentUser(userData)
    sessionStorage.setItem('erpUser', JSON.stringify(userData))
    setView('dashboard') // Arahkan ke dashboard
    // Fetch PO akan otomatis terpanggil oleh useEffect [currentUser]
  }

  const handleLogout = (message?: string) => {
    console.log('Logging out...')
    setCurrentUser(null)
    sessionStorage.removeItem('erpUser')
    setAllPOs([])
    setIsLoading(false) // Set loading selesai
    setView('dashboard') // Arahkan ke dashboard (yang akan menampilkan login)
    if (message) {
      alert(message) // Tampilkan pesan jika ada (misal dari error fetch)
    }
  }

  // --- Handler AI Chat ---
  const handleMaximizeChat = () => {
    handleNavigate('aiChat')
  }
  const handleMinimizeChat = () => {
    setView(previousView)
  } // Kembali ke view sebelum AI Chat
  const handleChatSendMessage = async () => {
    if (!chatInputText.trim() || isChatProcessing) return
    const userMessage: Message = { sender: 'user', text: chatInputText }
    // Optimistic UI update
    setChatMessages((prev) => [...prev, userMessage])
    const currentInput = chatInputText // Simpan input saat ini
    setChatInputText('') // Kosongkan input segera
    setIsChatProcessing(true)

    try {
      const botText = await apiService.ollamaChat(currentInput) // Panggil API
      const botMessage: Message = {
        sender: 'bot',
        text: botText || 'Maaf, saya tidak menerima respons.'
      }
      setChatMessages((prev) => [...prev, botMessage])
    } catch (error) {
      console.error('Error sending chat message:', error)
      const errorMessage: Message = {
        sender: 'bot',
        text: `Maaf, terjadi error: ${(error as Error).message}`
      }
      setChatMessages((prev) => [...prev, errorMessage])
      setChatInputText(currentInput) // Kembalikan input jika gagal kirim
    } finally {
      setIsChatProcessing(false)
    }
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

  // --- Logika Render Konten Utama ---
  const getCurrentPO = (): POHeader | null => {
    if (!selectedPoId) return null
    // Pastikan allPOs adalah array sebelum find
    return Array.isArray(allPOs) ? allPOs.find((p) => p.id === selectedPoId) || null : null
  }

  const renderContent = () => {
    // Tampilkan loading jika sedang memeriksa status auth awal
    if (isAuthLoading) {
      return (
        <div className="page-container" style={{ textAlign: 'center', paddingTop: '5rem' }}>
          ⏳ Memeriksa sesi login...
        </div>
      )
    }

    // Jika belum login, tampilkan halaman login
    if (!currentUser) {
      return <LoginPage onLoginSuccess={handleLoginSuccess} />
    }

    // --- Jika sudah login, tampilkan halaman sesuai view ---
    const currentPO = getCurrentPO() // Dapatkan PO hanya jika diperlukan
    switch (view) {
      case 'dashboard':
        // Tampilkan loading dashboard jika PO belum selesai dimuat
        return <DashboardPage poList={allPOs} isLoading={isLoading} />
      case 'list':
        return (
          <POListPage
            poList={allPOs}
            onAddPO={handleShowInputForm}
            onDeletePO={handleDeletePO}
            onEditPO={handleEditPO}
            onShowDetail={handleShowDetail}
            onShowProgress={handleShowProgress}
            isLoading={isLoading} // Kirim status loading PO list
          />
        )
      case 'input':
        return <InputPOPage onSaveSuccess={handleBackToList} editingPO={editingPO} />
      case 'detail':
        // PODetailPage punya loading internal untuk history
        return <PODetailPage po={currentPO} onBackToList={handleBackToList} />
      case 'tracking':
        // ProgressTrackingPage punya loading internal
        return <ProgressTrackingPage onSelectPO={handleSelectPOForTracking} />
      // Hapus case 'history'
      case 'updateProgress':
        // UpdateProgressPage punya loading internal
        return <UpdateProgressPage po={trackingPO} onBack={() => setView('tracking')} />
      case 'analysis':
        // AnalysisPage punya loading internal
        return <AnalysisPage />
      case 'aiChat':
        return (
          <Chatbot
            mode="page"
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
      default:
        // Fallback ke dashboard jika view tidak valid
        console.warn('Invalid view state:', view, 'defaulting to dashboard.')
        setView('dashboard') // Perbaiki state view
        return <DashboardPage poList={allPOs} isLoading={isLoading} />
    }
  }

  return (
    <div className="app-layout">
      {/* Navbar hanya tampil jika sudah login */}
      {currentUser && (
        <Navbar
          currentView={view}
          onNavigate={handleNavigate}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          onLogout={handleLogout}
          userName={currentUser.name} // Kirim nama user ke Navbar
        />
      )}
      {/* Beri style berbeda pada main content jika belum login */}
      <main
        className="main-content"
        style={
          !currentUser
            ? {
                paddingTop: '0',
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }
            : {}
        }
      >
        {renderContent()}
      </main>

      {/* Chat Widget hanya tampil jika login, bukan mobile, dan bukan halaman AI */}
      {currentUser && !isMobile && view !== 'aiChat' && (
        <Chatbot
          mode="widget"
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
