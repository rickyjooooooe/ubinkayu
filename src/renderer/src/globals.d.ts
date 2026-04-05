// file: src/renderer/src/globals.d.ts

// Ini memberi tahu TypeScript tipe-tipe apa saja yang ada
interface SpeechRecognitionResult {
  isFinal: boolean
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}

// Ini adalah interface utama yang kita butuhkan
interface SpeechRecognition {
  new (): SpeechRecognition
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  abort(): void
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  // tambahkan event lain jika perlu
}

// Ini adalah bagian terpenting:
// Menambahkan properti baru ke 'Window' & 'webkitSpeechRecognition'
interface Window {
  SpeechRecognition: typeof SpeechRecognition
  webkitSpeechRecognition: typeof SpeechRecognition
}