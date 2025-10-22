// file: src/renderer/src/components/Chatbot.tsx
import React, { useState, useEffect, useRef } from 'react'
import { POHeader, POItem } from '../types'
import { LuSend, LuBrainCircuit, LuBot, LuX, LuMaximize2, LuChevronDown } from 'react-icons/lu'
import { Card } from './Card'
import { Button } from './Button'
import './Chatbot.css'

// Helper date formatting function
const formatDate = (dateString?: string | null) => {
  if (!dateString) return '-'
  try {
    return new Date(dateString).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  } catch (e) {
    return '-'
  }
}

interface Message {
  sender: 'user' | 'bot'
  text: string
}

// Updated props for maximize and minimize functionality
interface ChatbotProps {
  allPOs: POHeader[]
  mode: 'page' | 'widget'
  onMaximize?: () => void // Function to maximize (for widget)
  onMinimize?: () => void // Function to minimize (for page)
}

const Chatbot: React.FC<ChatbotProps> = ({ allPOs, mode, onMaximize, onMinimize }) => {
  // State for widget visibility
  const [isOpen, setIsOpen] = useState(false)
  // Core chat state (shared by both modes)
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'bot',
      text: 'Halo! Saya Asisten AI Ubinkayu. Ada yang bisa saya bantu analisis atau cek data PO?'
    }
  ])
  const [inputText, setInputText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const messagesEndRef = useRef<null | HTMLDivElement>(null)

  // Function to scroll to the latest message
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Effect to scroll down on new messages or when the widget opens
  useEffect(() => {
    if (mode === 'page' || (mode === 'widget' && isOpen)) {
      scrollToBottom()
    }
  }, [messages, isOpen, mode])

  // --- CORE CHATBOT LOGIC (Simple Keyword Matching) ---
  const processUserQuery = (query: string): string => {
    const lowerQuery = query.toLowerCase()

    // Safety check for data availability
    if (!allPOs || allPOs.length === 0) {
      return 'Maaf, data PO belum tersedia untuk dianalisis saat ini.'
    }

    // Keyword Matching Examples:
    if (lowerQuery.includes('produk terlaris') || lowerQuery.includes('paling laku')) {
      const completedPOs = allPOs.filter((po) => po.status === 'Completed')
      if (completedPOs.length === 0)
        return 'Belum ada data PO Selesai untuk dianalisis produk terlaris.'

      const salesData: Record<string, number> = {}
      completedPOs
        .flatMap((po) => po.items || [])
        .forEach((item) => {
          if (item.product_name) {
            salesData[item.product_name] =
              (salesData[item.product_name] || 0) + Number(item.quantity || 0)
          }
        })
      const topProduct =
        Object.keys(salesData).length > 0
          ? Object.keys(salesData).reduce((a, b) => (salesData[a] > salesData[b] ? a : b))
          : 'N/A'
      return topProduct !== 'N/A'
        ? `Produk terlaris dari PO Selesai adalah: ${topProduct} (${salesData[topProduct]} unit).`
        : 'Tidak dapat menemukan produk terlaris dari PO Selesai.'
    } else if (lowerQuery.includes('customer terbesar') || lowerQuery.includes('top customer')) {
      const completedPOs = allPOs.filter((po) => po.status === 'Completed')
      if (completedPOs.length === 0)
        return 'Belum ada data PO Selesai untuk analisis customer terbesar.'

      const customerData: Record<string, number> = {}
      completedPOs.forEach((po) => {
        if (po.project_name) {
          customerData[po.project_name] =
            (customerData[po.project_name] || 0) + Number(po.kubikasi_total || 0)
        }
      })
      const topCustomer =
        Object.keys(customerData).length > 0
          ? Object.keys(customerData).reduce((a, b) => (customerData[a] > customerData[b] ? a : b))
          : 'N/A'
      return topCustomer !== 'N/A'
        ? `Customer terbesar berdasarkan volume (m³) dari PO Selesai adalah: ${topCustomer} (${customerData[topCustomer].toFixed(3)} m³).`
        : 'Tidak dapat menemukan customer terbesar dari PO Selesai.'
    } else if (lowerQuery.startsWith('status po')) {
      const poNumber = query.substring(9).trim()
      if (!poNumber)
        return 'Mohon sebutkan nomor PO yang ingin dicek statusnya (contoh: status po 123).'

      const latestPO = allPOs
        .filter((po) => po.po_number === poNumber)
        .sort((a, b) => Number(b.revision_number || 0) - Number(a.revision_number || 0))[0]
      return latestPO
        ? `Status terakhir untuk PO ${poNumber} (${latestPO.project_name}) adalah: ${latestPO.status || 'Open'}. Progress: ${latestPO.progress?.toFixed(0) || 0}%.`
        : `PO dengan nomor ${poNumber} tidak ditemukan.`
    } else if (lowerQuery.includes('po urgent')) {
      const urgentPOs = allPOs.filter(
        (po) => po.priority === 'Urgent' && po.status !== 'Completed' && po.status !== 'Cancelled'
      )
      if (urgentPOs.length > 0) {
        const poNumbers = urgentPOs.map((po) => `- ${po.po_number} (${po.project_name})`).join('\n')
        return `Ada ${urgentPOs.length} PO aktif dengan prioritas Urgent:\n${poNumbers}`
      }
      return 'Saat ini tidak ada PO aktif dengan prioritas Urgent.'
    } else if (lowerQuery.includes('deadline dekat')) {
      const today = new Date()
      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
      const nearingPOs = allPOs
        .filter((po) => {
          if (!po.deadline || po.status === 'Completed' || po.status === 'Cancelled') return false
          try {
            return new Date(po.deadline) >= today && new Date(po.deadline) <= nextWeek
          } catch (e) {
            return false
          }
        })
        .sort((a, b) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime())

      if (nearingPOs.length > 0) {
        const poDetails = nearingPOs
          .map((po) => `- ${po.po_number} (${po.project_name}): ${formatDate(po.deadline)}`)
          .join('\n')
        return `Ada ${nearingPOs.length} PO aktif yang mendekati deadline (7 hari):\n${poDetails}`
      }
      return 'Tidak ada PO aktif yang mendekati deadline dalam 7 hari ke depan.'
    } else if (lowerQuery.includes('bantuan') || lowerQuery.includes('help')) {
      return 'Anda bisa bertanya tentang:\n- Produk terlaris\n- Customer terbesar\n- Status PO [nomor PO]\n- PO Urgent\n- PO Deadline Dekat'
    }

    return "Maaf, saya belum mengerti pertanyaan itu. Coba tanya 'bantuan'."
  }
  // --- END CHATBOT LOGIC ---

  const handleSendMessage = () => {
    if (!inputText.trim() || isProcessing) return
    const userMessage: Message = { sender: 'user', text: inputText }
    setMessages((prev) => [...prev, userMessage])

    setIsProcessing(true) // Start processing
    const botText = processUserQuery(inputText)
    const botMessage: Message = { sender: 'bot', text: botText }

    setTimeout(() => {
      setMessages((prev) => [...prev, botMessage])
      setIsProcessing(false) // End processing
    }, 500)

    setInputText('')
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const toggleChat = () => {
    setIsOpen(!isOpen)
  }

  // --- Core Chat UI (Shared between modes) ---
  const ChatInterface = (
    <>
      <div className="chat-messages">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.sender}`}>
            {msg.text.split('\n').map((line, i) => (
              <React.Fragment key={i}>
                {line}
                <br />
              </React.Fragment>
            ))}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input">
        <textarea
          placeholder={isProcessing ? 'Memproses...' : 'Ketik pertanyaan Anda...'}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          rows={mode === 'page' ? 3 : 2}
          disabled={isProcessing}
        />
        <Button
          onClick={handleSendMessage}
          disabled={!inputText.trim() || isProcessing}
          aria-label="Kirim Pesan"
        >
          <LuSend />
        </Button>
      </div>
    </>
  )

  // --- RENDER LOGIC BASED ON MODE PROP ---
  if (mode === 'page') {
    return (
      <div className="page-container ai-chat-page-container">
        <div className="page-header ai-chat-page-header">
          <div className="ai-chat-title">
            <h1>
              <LuBrainCircuit /> Asisten AI Ubinkayu
            </h1>
            <p>Tanyakan apapun tentang data Purchase Order Anda.</p>
          </div>
          {onMinimize && (
            <Button
              variant="secondary"
              onClick={onMinimize}
              aria-label="Minimalkan Chat"
              className="ai-chat-minimize-btn"
            >
              <LuChevronDown />
              <span>Kembali</span>
            </Button>
          )}
        </div>
        <Card className="ai-chat-card">{ChatInterface}</Card>
      </div>
    )
  }

  // mode === 'widget'
  return (
    <div className="chatbot-widget-container">
      <button
        className="chatbot-fab"
        onClick={toggleChat}
        aria-label={isOpen ? 'Tutup Chatbot' : 'Buka Chatbot'}
      >
        {isOpen ? <LuX /> : <LuBot />}
      </button>

      {isOpen && (
        <div className="chatbot-window">
          <div className="chatbot-header">
            <h4>Asisten AI</h4>
            <div className="chatbot-header-actions">
              {onMaximize && (
                <button
                  onClick={onMaximize}
                  aria-label="Maksimalkan Chat"
                  className="chatbot-header-btn"
                >
                  <LuMaximize2 />
                </button>
              )}
              <button
                onClick={toggleChat}
                aria-label="Tutup Chatbot"
                className="chatbot-header-btn"
              >
                <LuX />
              </button>
            </div>
          </div>
          {ChatInterface}
        </div>
      )}
    </div>
  )
}

export default Chatbot
