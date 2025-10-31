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
  LuEraser
} from 'react-icons/lu'
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
  onChatReset
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const messagesEndRef = useRef<null | HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (mode === 'page' || (mode === 'widget' && isOpen)) {
      scrollToBottom()
    }
  }, [messages, isOpen, mode])

  const toggleChat = () => {
    setIsOpen(!isOpen)
  }

  // --- Core Chat UI (Shared between modes) ---
  const ChatInterface = (
    <>
      <div className="chat-messages">
        {messages.map((msg, index) => (
          // BARU: Kita tambahkan render timestamp di sini
          <div key={index} className={`message ${msg.sender}`}>
            {/* Teks pesan */}
            {msg.text.split('\n').map((line, i) => (
              <React.Fragment key={i}>
                {line}
                <br />
              </React.Fragment>
            ))}
            {/* BARU: Tampilkan timestamp di bawah teks */}
            <div className="message-timestamp">{formatTime(msg.timestamp)}</div>
          </div>
        ))}
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
