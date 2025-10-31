// file: src/renderer/src/components/Chatbot.tsx
import React, { useState, useEffect, useRef } from 'react'
import { Message } from '../types'
import {
  LuSend,
  LuBrainCircuit,
  LuBot,
  LuX,
  LuMaximize2,
  LuChevronDown,
  LuEraser,
  LuMic,
  LuMicOff,
  LuVolume2,
  LuVolumeX
} from 'react-icons/lu'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts'

import { Card } from './Card'
import { Button } from './Button'
import './Chatbot.css'

// BARU: Helper function untuk memformat waktu menjadi HH:MM
const formatTime = (date: Date) => {
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

interface ChatbotProps {
  mode: 'page' | 'widget'
  onMaximize?: () => void
  onMinimize?: () => void
  onChatReset: () => void
  messages: Message[]
  inputText: string
  isProcessing: boolean
  onSendMessage: () => void
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  isTtsEnabled: boolean
  onToggleTts: () => void
}

const Chatbot: React.FC<ChatbotProps> = ({
  mode,
  onMaximize,
  onMinimize,
  messages,
  inputText,
  isProcessing,
  onSendMessage,
  onInputChange,
  onKeyDown,
  onChatReset,
  isTtsEnabled,
  onToggleTts
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [isListening, setIsListening] = useState(false) // <-- BARU
  const recognitionRef = useRef<SpeechRecognition | null>(null) // <-- BARU
  const messagesEndRef = useRef<null | HTMLDivElement>(null)

  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (mode === 'page' || (mode === 'widget' && isOpen)) {
      scrollToBottom()
    }
  }, [messages, isOpen, mode])

  const toggleChat = (): void => {
    setIsOpen(!isOpen)
  }

  const handleMicClick = () => {
    // Cek apakah SpeechRecognition API ada (prefik webkit untuk Chrome/Electron)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Maaf, browser Anda tidak mendukung Speech-to-Text.')
      return
    }

    if (isListening) {
      // Jika sedang merekam, hentikan
      recognitionRef.current?.stop()
      setIsListening(false)
    } else {
      // Jika tidak merekam, mulai
      const recognition = new SpeechRecognition()
      recognition.lang = 'id-ID' // Set bahasa ke Indonesia
      recognition.interimResults = true // Tampilkan hasil sementara saat berbicara
      recognitionRef.current = recognition

      recognition.onstart = () => {
        setIsListening(true)
      }

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0])
          .map((result) => result.transcript)
          .join('')

        onInputChange({
          target: { value: transcript }
        } as React.ChangeEvent<HTMLTextAreaElement>)
      }

      recognition.onend = () => {
        setIsListening(false)
        recognitionRef.current = null
        // Setelah selesai berbicara, otomatis kirim pesan
        onSendMessage()
      }

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error)
        setIsListening(false)
      }

      recognition.start()
    }
  }

  // Efek untuk membersihkan jika komponen unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  // --- Core Chat UI (Shared between modes) ---
  const ChatInterface = (
    <>
      <div className="chat-messages">
        {messages.map((msg, index) => {
          // --- Logika Baru Dimulai ---
          let messageText = msg.text
          let chartPayload = null

          // Cek apakah ini pesan bot dan berisi payload chart
          if (msg.sender === 'bot' && msg.text.includes('CHART_JSON::')) {
            const parts = msg.text.split('CHART_JSON::')
            messageText = parts[0] // Ambil teks pengantar sebelum delimiter
            try {
              chartPayload = JSON.parse(parts[1]) // Parse data JSON chart
            } catch (e) {
              console.error('Gagal parse JSON chart:', e)
              messageText = msg.text // Jika JSON rusak, tampilkan teks aslinya
            }
          }
          // --- Logika Baru Selesai ---

          return (
            <div key={index} className={`message ${msg.sender}`}>
              {/* Render Teks Pesan (teks pengantar atau teks utuh) */}
              {messageText.split('\n').map((line, i) => (
                <React.Fragment key={i}>
                  {line}
                  <br />
                </React.Fragment>
              ))}

              {/* Render Timestamp (tetap ada) */}
              <div className="message-timestamp">{formatTime(msg.timestamp)}</div>

              {/* --- BARU: Render Chart jika ada payload --- */}
              {chartPayload && chartPayload.type === 'bar' && (
                <div
                  style={{
                    width: '100%',
                    height: '250px', // Beri tinggi tetap untuk chart
                    marginTop: '1rem',
                    color: '#333' // Set warna teks fallback untuk tooltip/legend
                  }}
                >
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart
                      data={chartPayload.data}
                      margin={{ top: 5, right: 5, left: 0, bottom: 20 }} // Beri margin bawah untuk label
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey={chartPayload.nameKey}
                        fontSize="10px"
                        interval={0} // Tampilkan semua label
                        angle={-30} // Miringkan label
                        textAnchor="end" // Ratakan label miring
                      />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey={chartPayload.dataKey} fill="#F7931E" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {/* --- Akhir Render Chart --- */}
            </div>
          )
        })}

        {isProcessing && (
          <div className="message bot loading-indicator">
            <div className="dot-flashing"></div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input">
        <textarea
          placeholder={isProcessing ? 'Memproses...' : 'Ketik pertanyaan Anda...'}
          value={inputText}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          rows={mode === 'page' ? 3 : 2}
          disabled={isProcessing}
        />
        <Button
          onClick={handleMicClick}
          variant={isListening ? 'danger' : 'secondary'} // Ganti warna saat merekam
          aria-label={isListening ? 'Berhenti Merekam' : 'Mulai Merekam'}
          disabled={isProcessing} // Nonaktifkan jika bot sedang memproses
        >
          {isListening ? <LuMicOff /> : <LuMic />}
        </Button>
        <Button
          onClick={onSendMessage}
          disabled={!inputText.trim() || isProcessing}
          aria-label="Kirim Pesan"
        >
          <LuSend />
        </Button>
      </div>
    </>
  )

  // --- RENDER LOGIC BASED ON MODE PROP (Tidak ada perubahan di bawah ini) ---
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
          <div className="ai-chat-page-header-actions">
            <Button
              variant="secondary"
              onClick={onToggleTts}
              aria-label={isTtsEnabled ? 'Matikan Suara' : 'Nyalakan Suara'}
              className="ai-chat-tts-btn" // Anda bisa tambahkan style khusus jika perlu
            >
              {isTtsEnabled ? <LuVolume2 /> : <LuVolumeX />}
              {/* Tampilkan teks berbeda berdasarkan state */}
              <span>{isTtsEnabled ? 'Suara Aktif' : 'Suara Mati'}</span>
            </Button>
            <Button
              variant="secondary"
              onClick={onChatReset}
              disabled={isProcessing}
              aria-label="Reset Chat"
              className="ai-chat-reset-btn"
            >
              <LuEraser />
              <span>Reset</span>
            </Button>
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
              <button
                onClick={onToggleTts}
                aria-label={isTtsEnabled ? 'Matikan Suara' : 'Nyalakan Suara'}
                className="chatbot-header-btn"
              >
                {isTtsEnabled ? <LuVolume2 /> : <LuVolumeX />}
              </button>
              <button
                onClick={onChatReset}
                disabled={isProcessing}
                aria-label="Reset Chat"
                className="chatbot-header-btn"
              >
                <LuEraser />
              </button>
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
