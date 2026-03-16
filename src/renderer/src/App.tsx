import React, { useState, useEffect } from 'react'

// Impor Komponen Halaman dan Navigasisd
import Navbar from './components/Navbar'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import POListPage from './pages/POListPage'
import InputPOPage from './pages/InputPOPage'
import PODetailPage from './pages/PODetailPage'
import ProgressTrackingPage from './pages/ProgressTrackingPage'
import UpdateProgressPage from './pages/UpdateProgressPage'
import AnalysisPage from './pages/AnalysisPage'
import Chatbot from './components/Chatbot' // Asumsi widget chatbot
import CommissionView from './pages/CommissionView'

// Impor Tipe Data dan Hooks
import { POHeader, Message } from './types' // Asumsi tipe ini ada di types.ts
import * as apiService from './apiService'
import { useWindowWidth } from './hooks/useWindowWidth'

// --- Tipe Data (Types) ---

// Tipe untuk view/halaman yang valid
type AppView =
  | 'dashboard'
  | 'list'
  | 'input'
  | 'detail'
  | 'tracking'
  | 'updateProgress'
  | 'analysis'
  | 'aiChat'
  | 'commission'

// Tipe sederhana untuk data user yang login (konsistenkan nama)
interface User {
  name: string
  role?: string
}

// Tipe untuk data sesi yang disimpan
interface SessionData {
  user: User
  expiry: number // Timestamp kedaluwarsa dalam milidetik
}

// Pesan awal untuk Chatbot
const initialChatMessage: Message = {
  sender: 'bot',
  text: 'Halo! Saya Asisten AI Ubinkayu. Ada yang bisa saya bantu?',
  timestamp: new Date()
}

function App() {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth <= 768

  // --- State Aplikasi ---
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [view, setView] = useState<AppView>('dashboard')
  const [allPOs, setAllPOs] = useState<POHeader[]>([])
  const [editingPO, setEditingPO] = useState<POHeader | null>(null)
  const [formMode, setFormMode] = useState<'new' | 'request' | 'confirm' | 'edit'>('new')
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null)
  const [trackingPO, setTrackingPO] = useState<POHeader | null>(null)
  const [previousView, setPreviousView] = useState<AppView>('dashboard')

  // --- State Loading ---
  const [isAuthLoading, setIsAuthLoading] = useState(true) // Loading status login awal
  const [isLoadingPOs, setIsLoadingPOs] = useState(false) // Loading khusus untuk fetch PO
  const [isRefreshing, setIsRefreshing] = useState(false)

  // --- State Chatbot ---
  const [chatMessages, setChatMessages] = useState<Message[]>([initialChatMessage])
  const [chatInputText, setChatInputText] = useState('')
  const [isChatProcessing, setIsChatProcessing] = useState(false)
  const [isTtsEnabled, setIsTtsEnabled] = useState(false)

  // --- Efek: Cek Sesi Saat Aplikasi Dimuat ---
  useEffect(() => {
    console.log('Memeriksa sesi login...')
    setIsAuthLoading(true) // Mulai pemeriksaan
    const storedSessionJSON = sessionStorage.getItem('erpUser')

    if (storedSessionJSON) {
      try {
        const sessionData: SessionData = JSON.parse(storedSessionJSON)
        const now = new Date().getTime()

        if (now > sessionData.expiry) {
          // Sesi kedaluwarsa
          console.log('Sesi kedaluwarsa, hapus sesi.')
          sessionStorage.removeItem('erpUser')
          setCurrentUser(null)
        } else {
          // Sesi valid
          console.log('Sesi valid ditemukan, mengatur user.')
          setCurrentUser(sessionData.user)
        }
      } catch (e) {
        // Gagal parse JSON, anggap tidak valid
        console.error('Gagal parse data sesi:', e)
        sessionStorage.removeItem('erpUser')
        setCurrentUser(null)
      }
    } else {
      // Tidak ada sesi
      console.log('Tidak ada sesi ditemukan.')
      setCurrentUser(null)
    }

    // Tandai pemeriksaan sesi selesai
    setIsAuthLoading(false)
    console.log('Pemeriksaan sesi selesai.')
  }, []) // <-- Array kosong: hanya berjalan sekali saat mount

  // --- Efek: Fetch Data PO Saat User Terautentikasi ---
  useEffect(() => {
    // Hanya fetch jika:
    // 1. Pemeriksaan sesi awal sudah selesai (isAuthLoading false)
    // 2. Ada pengguna yang login (currentUser tidak null)
    if (!isAuthLoading && currentUser) {
      fetchPOs() // Panggil fetch data
    } else if (!isAuthLoading && !currentUser) {
      // Jika pemeriksaan selesai TAPI tidak ada user (logout atau sesi habis)
      setAllPOs([]) // Pastikan data PO kosong
      setIsLoadingPOs(false) // Pastikan loading PO mati
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, isAuthLoading]) // <-- Berjalan saat currentUser atau isAuthLoading berubah

  // --- Fungsi Pengambilan Data PO ---
  const fetchPOs = async (isRefresh = false) => {
    if (!currentUser) return // Pengaman tambahan

    console.log(isRefresh ? 'Refreshing PO list...' : 'Fetching PO list...')
    if (isRefresh) {
      setIsRefreshing(true)
    } else {
      setIsLoadingPOs(true) // Gunakan state loading PO khusus
    }

    try {
      const pos: POHeader[] = await apiService.listPOs(currentUser)
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
      setAllPOs([])
      // Pertimbangkan logout paksa jika error otentikasi
      // if (error is related to auth) { handleLogout('Sesi berakhir...'); }
    } finally {
      setIsLoadingPOs(false) // Matikan loading PO
      setIsRefreshing(false) // Matikan loading refresh
    }
  }

  // --- Handler Tombol Refresh ---
  const handleRefresh = () => {
    if (!currentUser || isRefreshing) return
    fetchPOs(true) // Kirim true untuk menandakan refresh
  }

  // --- Handler Login & Logout ---
  const handleLoginSuccess = (sessionData: SessionData) => {
    console.log('Login berhasil, menyimpan sesi:', sessionData)
    sessionStorage.setItem('erpUser', JSON.stringify(sessionData))
    setCurrentUser(sessionData.user)
    setView('dashboard')

    console.log('Resetting chat history for new user.')
    setChatMessages([initialChatMessage])
    setChatInputText('')
    setIsChatProcessing(false)
  }

  const handleLogout = (message?: any) => {
    console.log('Logging out...')
    setCurrentUser(null)
    sessionStorage.removeItem('erpUser')
    setAllPOs([])
    setIsLoadingPOs(false) // Reset loading PO juga
    setIsRefreshing(false)
    setView('dashboard') // Kembali ke view awal (yang akan jadi Login)

    setChatMessages([initialChatMessage])
    setChatInputText('')
    setIsChatProcessing(false)

    // Logika alert yang aman
    if (message && typeof message === 'string') {
      alert(message)
    } else if (message && typeof message === 'object' && message.message) {
      alert(message.message)
    }
    // MouseEvent akan diabaikan
  }

  // --- Handler Navigasi ---
  const handleNavigate = (targetView: AppView): void => {
    if (!currentUser) return // Blok jika belum login
    console.log(`Navigating from ${view} to ${targetView}`)
    if (targetView === 'aiChat' && view !== 'aiChat') {
      setPreviousView(view)
    }
    // Reset state halaman spesifik saat navigasi
    setSelectedPoId(null)
    setTrackingPO(null)
    setEditingPO(null)
    setView(targetView)
  }

  // --- Handler Aksi PO (Delete, Edit, Detail, Track) ---
  const handleDeletePO = async (poId: string, poInfo: string) => {
    const confirmMessage = `⚠️ Hapus PO Permanen ⚠️\n\nPO: ${poInfo}\n\nSemua data terkait akan dihapus.\nTindakan ini TIDAK DAPAT DIBATALKAN!\n\nYakin?`
    if (window.confirm(confirmMessage)) {
      setIsLoadingPOs(true) // Tampilkan loading selama proses delete
      try {
        const result = await apiService.deletePO(poId)
        if (result.success) {
          alert(`✅ PO ${poInfo} berhasil dihapus.\n${result.message}`)
          fetchPOs() // Muat ulang daftar setelah delete
        } else {
          throw new Error(result.error || 'Gagal menghapus PO di backend.')
        }
      } catch (error) {
        alert(`❌ Gagal menghapus PO: ${(error as Error).message}`)
        setIsLoadingPOs(false) // Matikan loading jika gagal
      }
      // setIsLoadingPOs(false) akan dipanggil di finally fetchPOs jika sukses
    }
  }
  const handleEditPO = (po: POHeader) => {
    setEditingPO(po)
    setFormMode('edit')
    setView('input')
  }
  const handleShowInputForm = () => {
    setEditingPO(null)
    // Marketing → mode request, admin/manager → mode new
    setFormMode(currentUser?.role === 'marketing' ? 'request' : 'new')
    setView('input')
  }
  const handleConfirmRequest = (po: POHeader) => {
    setEditingPO(po)
    setFormMode('confirm')
    setView('input')
  }
  const handleShowDetail = (po: POHeader) => {
    setSelectedPoId(po.id)
    setView('detail')
  }
  const handleBackToList = () => {
    handleNavigate('list')
  }
  const handleSelectPOForTracking = (po: POHeader) => {
    setTrackingPO(po)
    setView('updateProgress')
  }
  // const handleShowProgress = (po: POHeader) => { setTrackingPO(po); setView('updateProgress'); }; // Sama dengan di atas

  // --- Handler AI Chat (Fungsi tetap sama) ---
  const handleMaximizeChat = () => {
    handleNavigate('aiChat')
  }
  const handleMinimizeChat = () => {
    setView(previousView)
  }

  const speak = (text: string) => {
    // BARIS KUNCI: Jangan lakukan apa-apa jika TTS tidak aktif
    if (!isTtsEnabled) return

    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'id-ID'
      window.speechSynthesis.speak(utterance)
    } catch (error) {
      console.error('Text-to-Speech error:', error)
    }
  }

  const handleToggleTts = (): void => {
    setIsTtsEnabled((prev) => !prev)
    // Hentikan suara jika sedang diputar saat mematikan
    if (isTtsEnabled) {
      window.speechSynthesis.cancel()
    }
  }

  const handleChatSendMessage = async () => {
    if (!chatInputText.trim() || isChatProcessing) return

    // 1. Buat pesan user DENGAN timestamp
    const userMessage: Message = {
      sender: 'user',
      text: chatInputText,
      timestamp: new Date() // <-- TAMBAHKAN INI
    }
    const updatedMessages = [...chatMessages, userMessage]
    setChatMessages(updatedMessages)

    const currentInput = chatInputText
    setChatInputText('')
    setIsChatProcessing(true)

    try {
      const history = chatMessages.slice(-6)
      const botText = await apiService.ollamaChat(currentInput, currentUser, history)

      const botMessage: Message = {
        sender: 'bot',
        text: botText || 'Maaf, saya tidak menerima respons.',
        timestamp: new Date()
      }
      setChatMessages((prev) => [...prev, botMessage])

      // PANGGIL FUNGSI SPEAK DI SINI
      speak(botText)
    } catch (error) {
      console.error('Error sending chat message:', error)
      const errorText = `Maaf, terjadi error: ${(error as Error).message}` // Teks error

      const errorMessage: Message = {
        sender: 'bot',
        text: errorText,
        timestamp: new Date()
      }
      setChatMessages((prev) => [...prev, errorMessage])

      // (Opsional) Anda bisa juga membuat bot membacakan pesan error
      // speak(errorText)

      setChatInputText(currentInput)
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
    if (!selectedPoId || !Array.isArray(allPOs)) return null
    return allPOs.find((p) => p.id === selectedPoId) || null
  }

  const renderContent = () => {
    // 1. Tampilkan loading jika sedang memeriksa sesi awal
    if (isAuthLoading) {
      return (
        <div className="page-container" style={{ textAlign: 'center', paddingTop: '5rem' }}>
          ⏳ Memeriksa sesi login...
        </div>
      )
    }

    // 2. Jika pemeriksaan selesai TAPI belum login, tampilkan halaman Login
    if (!currentUser) {
      return <LoginPage onLoginSuccess={handleLoginSuccess} />
    }

    // --- 3. Jika sudah login, tampilkan halaman sesuai 'view' ---
    const currentPO = getCurrentPO()
    switch (view) {
      case 'dashboard':
        // Gunakan isLoadingPOs untuk dashboard
        return <DashboardPage poList={allPOs} isLoading={isLoadingPOs} />
      case 'list':
        return (
          <POListPage
            poList={allPOs}
            onAddPO={handleShowInputForm}
            onDeletePO={handleDeletePO}
            onEditPO={handleEditPO}
            onShowDetail={handleShowDetail}
            onShowProgress={handleSelectPOForTracking}
            onConfirmRequest={handleConfirmRequest}
            isLoading={isLoadingPOs}
            currentUser={currentUser}
          />
        )
      case 'input':
        // InputPOPage mungkin punya loading internal saat submit
        return (
          <InputPOPage
            onSaveSuccess={() => {
              fetchPOs() // Refresh list setelah simpan
              handleNavigate('list') // Kembali ke list
            }}
            editingPO={editingPO}
            currentUser={currentUser}
            mode={formMode}
          />
        )
      case 'detail':
        // PODetailPage punya loading internal untuk history
        return <PODetailPage po={currentPO} onBackToList={handleBackToList} />
      case 'tracking':
        // ProgressTrackingPage punya loading internal untuk daftar PO-nya
        return (
          <ProgressTrackingPage
            onSelectPO={handleSelectPOForTracking}
            poList={allPOs}
            isLoadingPOs={isLoadingPOs}
            currentUser={currentUser}
          />
        )
      case 'updateProgress':
        // UpdateProgressPage punya loading internal untuk detail item
        return (
          <UpdateProgressPage
            po={trackingPO}
            onBack={() => handleNavigate('tracking')} // Gunakan handleNavigate
            onProgressSaved={() => fetchPOs(true)} // Refresh PO list setelah simpan progress
            currentUser={currentUser}
          />
        )
      case 'analysis':
        return <AnalysisPage currentUser={currentUser} />
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
            isTtsEnabled={isTtsEnabled}
            onToggleTts={handleToggleTts}
          />
        )
        case 'commission':
          return <CommissionView currentUser={currentUser} />
      default:
        console.warn('Invalid view state:', view, 'defaulting to dashboard.')
        setView('dashboard') // Perbaiki state view
        return <DashboardPage poList={allPOs} isLoading={isLoadingPOs} />
    }
  }

  return (
    <div className="app-layout">
      {/* Navbar hanya tampil jika sudah login (dan auth check selesai) */}
      {!isAuthLoading && currentUser && (
        <Navbar
          currentView={view}
          onNavigate={handleNavigate}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          onLogout={() => handleLogout()} // Pakai arrow function
          userName={currentUser.name}
          currentUser={currentUser}
        />
      )}

      <main
        className="main-content"
        // Style khusus untuk halaman login (agar full height)
        style={
          !currentUser && !isAuthLoading
            ? {
                paddingTop: '0',
                height: '100vh', // Gunakan height bukan minHeight
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }
            : {}
        }
      >
        {renderContent()}
      </main>

      {/* Chat Widget: Tampil jika login, bukan mobile, bukan halaman AI */}
      {!isAuthLoading && currentUser && !isMobile && view !== 'aiChat' && (
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
          isTtsEnabled={isTtsEnabled}
          onToggleTts={handleToggleTts}
        />
      )}
    </div>
  )
}

export default App