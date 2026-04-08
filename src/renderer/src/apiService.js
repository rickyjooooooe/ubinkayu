// file: src/renderer/src/apiService.js

/**
 * File ini berfungsi sebagai lapisan abstraksi untuk semua panggilan ke backend.
 * Ia secara otomatis mendeteksi apakah aplikasi berjalan di Electron atau di web/mobile (Capacitor).
 * - Jika di Electron, ia akan menggunakan `window.api` (IPC).
 * - Jika di web/mobile, ia akan menggunakan `fetch` untuk memanggil endpoint API Vercel.
 */

// PENTING: Ganti dengan URL Vercel Anda setelah deploy berhasil.
// Untuk development lokal, biarkan kosong.
const API_BASE_URL = window.api
  ? 'https://ubinkayu.vercel.app'
  : 'https://ubinkayu.vercel.app'

/**
 * Helper untuk menangani panggilan fetch API secara konsisten.
 * @param {string} endpoint - Path endpoint yang sudah diformat dengan query params.
 * @param {object} options - Opsi untuk fetch (method, body, dll.)
 */
async function fetchAPI(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options)
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Network response was not ok' }))
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
    }
    return response.json()
  } catch (error) {
    console.error(`Fetch API error for endpoint ${endpoint}:`, error)
    throw error
  }
}

/**
 * Helper untuk membuat endpoint API dengan format ?action=...
 * @param {string} action - Nama fungsi yang akan dipanggil di backend.
 * @param {object} params - Parameter tambahan untuk query URL.
 */
function createApiEndpoint(action, params = {}) {
  const query = new URLSearchParams({ action, ...params }).toString()
  return `/api?${query}`
}
// Kirim request project (marketing)
export function requestProject(data) {
  if (window.api) return window.api.requestProject(data)
  return fetchAPI('/api/request-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

// Admin konfirmasi request dengan items
export function confirmRequest(data) {
  if (window.api) return window.api.confirmRequest(data)
  return fetchAPI('/api/confirm-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}
export async function loginUser(username, password) {
  const loginData = { username, password }

  // 1. Cek jalur Electron
  if (window.api && window.api.loginUser) {
    console.log('Using Electron login path (window.api)')
    return await window.api.loginUser(loginData)
  }

  // 2. Jalur Web/Vercel (dengan perbaikan di 'catch')
  try {
    console.log('Using Web/Vercel API login path (fetch)')
    const endpoint = createApiEndpoint('loginUser')

    // fetchAPI akan mengembalikan JSON jika status 200 (OK)
    const result = await fetchAPI(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginData)
    })

    // Jika sukses (status 200), 'result' adalah { success: true, ... }
    return result
  } catch (err) {
    // Jika fetchAPI melempar error (status 401, 500, atau network fail)
    // 'err.message' akan berisi pesan error dari JSON server,
    // contoh: "Username atau password salah."

    console.error('Login error caught in apiService:', err.message)

    // ✅ PERBAIKAN:
    // Kembalikan objek error dengan pesan yang ASLI dari 'err.message',
    // bukan pesan "Koneksi gagal" yang di-hardcode.
    return {
      success: false,
      error: err.message || 'Koneksi ke server login gagal.'
    }
  }
}

// --- Fungsi CRUD untuk Purchase Order (PO) ---


export function listOrders(user) {
  if (window.api) {
    console.log(
      '%cELECTRON MODE: Using window.api (IPC) for listOrders',
      'color: green; font-weight: bold;'
    ) // <-- TAMBAHKAN INI
    return window.api.listOrders(user)
  }
  console.log('%cWEB MODE: Using fetch() for listOrders', 'color: orange; font-weight: bold;') // <-- TAMBAHKAN INI
  return fetchAPI(createApiEndpoint('listOrders'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user }) // <-- Kirim user di body
  })
}

export function saveNewOrder(data) {
  if (window.api) return window.api.saveNewOrder(data)
  return fetchAPI(createApiEndpoint('saveNewOrder'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

export function updatePO(data) {
  if (window.api) return window.api.updatePO(data)
  return fetchAPI(createApiEndpoint('updatePO'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

export function deletePO(orderId) {
  if (window.api) return window.api.deletePO(orderId)
  return fetchAPI(createApiEndpoint('deletePO', { orderId }), {
    method: 'DELETE'
  })
}

// --- Fungsi untuk Produk ---

export function getProducts() {
  if (window.api) return window.api.getProducts()
  return fetchAPI(createApiEndpoint('getProducts'))
}

// --- Fungsi Detail PO & Revisi ---

export function listorderItems(orderId) {
  if (window.api) return window.api.listorderItems(orderId)
  return fetchAPI(createApiEndpoint('listorderItems', { orderId }))
}

export function getRevisionHistory(orderId) {
  if (window.api) return window.api.getRevisionHistory(orderId)
  return fetchAPI(createApiEndpoint('getRevisionHistory', { orderId }))
}

export function listPORevisions(orderId) {
  if (window.api) return window.api.listPORevisions(orderId)
  return fetchAPI(createApiEndpoint('listPORevisions', { orderId }))
}

export function listorderItemsByRevision(orderId, revisionNumber) {
  if (window.api) return window.api.listorderItemsByRevision(orderId, revisionNumber)
  return fetchAPI(createApiEndpoint('listorderItemsByRevision', { orderId, revisionNumber }))
}

// --- Fungsi Pratinjau (Preview) ---

export function previewPO(data) {
  if (window.api) return window.api.previewPO(data)
  return fetchAPI(createApiEndpoint('previewPO'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

// --- Fungsi Progress Tracking ---

export function updateItemProgress(data) {
  if (window.api) return window.api.updateItemProgress(data)
  return fetchAPI(createApiEndpoint('updateItemProgress'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

export function getActiveOrdersWithProgress(user) {
  // <-- [UBAH]
  if (window.api) return window.api.getActiveOrdersWithProgress(user) // <-- [UBAH]
  return fetchAPI(createApiEndpoint('getActiveOrdersWithProgress'), {
    // <-- [UBAH]
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user })
  })
}

export function getorderItemsWithDetails(orderId) {
  // SEBELUMNYA: window.api.getorderItemsDetails (kurang "With")
  if (window.api) return window.api.getorderItemsWithDetails(orderId) // <-- PERBAIKI INI
  return fetchAPI(createApiEndpoint('getorderItemsWithDetails', { orderId }))
}

export function getRecentProgressUpdates(user) {
  // <-- [UBAH]
  if (window.api) return window.api.getRecentProgressUpdates(user) // <-- [UBAH]
  return fetchAPI(createApiEndpoint('getRecentProgressUpdates'), {
    // <-- [UBAH]
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user })
  })
}

// --- Fungsi Analisis & Dashboard ---

export function getAttentionData(user) {
  // <-- [UBAH]
  if (window.api) return window.api.getAttentionData(user) // <-- [UBAH]
  return fetchAPI(createApiEndpoint('getAttentionData'), {
    // <-- [UBAH]
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user })
  })
}

export function getProductSalesAnalysis(user) {
  // <-- [UBAH]
  if (window.api) return window.api.getProductSalesAnalysis(user) // <-- [UBAH]
  return fetchAPI(createApiEndpoint('getProductSalesAnalysis'), {
    // <-- [UBAH]
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user })
  })
}

export function getSalesItemData(user) {
  // <-- [UBAH]
  if (window.api) return window.api.getSalesItemData(user) // <-- [UBAH]
  return fetchAPI(createApiEndpoint('getSalesItemData'), {
    // <-- [UBAH]
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user })
  })
}

export function openExternalLink(url) {
  if (window.api) {
    return window.api.openExternalLink(url)
  }
  // Implementasi untuk web: buka di tab baru
  window.open(url, '_blank')
  return Promise.resolve({ success: true })
}

export function openFileDialog() {
  if (window.api) {
    return window.api.openFileDialog()
  }
  // Di web, kita tidak bisa melakukan ini. Beri peringatan dan kembalikan null.
  console.warn('Fungsi pilih file hanya tersedia di aplikasi desktop.')
  return Promise.resolve(null)
}

export function readFileAsBase64(filePath) {
  if (window.api) {
    return window.api.readFileAsBase64(filePath)
  }
  console.warn('Fungsi baca file hanya tersedia di aplikasi desktop.')
  return Promise.resolve(null)
}

export function addNewProduct(data) {
  if (window.api) return window.api.addNewProduct(data)
  return fetchAPI(createApiEndpoint('addNewProduct'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}
export function getCommissionData(user) {
   if (window.api) return window.api.getCommissionData(user)
   return fetchAPI(createApiEndpoint('getCommissionData'), {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ user })
   })
}
export function updateStageDeadline(data) {
  if (window.api) return window.api.updateStageDeadline(data)
  return fetchAPI(createApiEndpoint('updateStageDeadline'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

export async function ollamaChat(prompt, user, history = []) {
  if (window.api && window.api.ollamaChat) {
    // Tambahkan cek window.api.ollamaChat
    console.log('%cELECTRON MODE: Calling Ollama via IPC', 'color: cyan; font-weight: bold;')
    // Panggil fungsi IPC yang ada di preload.js -> main.js -> sheet.js
    return window.api.ollamaChat(prompt, user, history)
  }

  // SELALU PANGGIL VERCEL API untuk chat
  console.log(
    '%cAPI SERVICE: Calling Vercel API for Chat (Gemini)',
    'color: gold; font-weight: bold;'
  )
  try {
    const result = await fetchAPI(createApiEndpoint('ollamaChat'), {
      // Panggil endpoint Vercel
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, user, history })
    })
    // Vercel mengembalikan objek { response: "..." }, ambil teksnya
    if (result && typeof result.response === 'string') {
      return result.response
    } else {
      // Handle jika format respons Vercel tidak sesuai
      console.error('Respons tak terduga dari Vercel API:', result)
      return 'Maaf, terjadi kesalahan saat menerima respons dari server AI.'
    }
  } catch (error) {
    console.error('Error calling Vercel chat API:', error)
    // @ts-ignore
    return `Maaf, gagal menghubungi server AI: ${error.message}`
  }
  // --- AKHIR PERUBAHAN ---
}