import { contextBridge, ipcRenderer } from 'electron'
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config()

console.log('✅ --- PRELOAD SCRIPT STARTED ---')

const api = {
  // --- Fungsi Dasar & Test ---
  ping: () => ipcRenderer.invoke('ping'),

  // --- Fungsi untuk Products ---
  getProducts: () => ipcRenderer.invoke('product:get'),
  addNewProduct: (data) => ipcRenderer.invoke('product:add', data),

  loginUser: (loginData) => ipcRenderer.invoke('login-user', loginData),

  // --- Fungsi CRUD untuk Purchase Order (PO) ---
  saveNewPO: (data) => ipcRenderer.invoke('po:save', data),
  listPOs: () => ipcRenderer.invoke('po:list'),
  updatePO: (data) => ipcRenderer.invoke('po:update', data),
  deletePO: (poId) => ipcRenderer.invoke('po:delete', poId),
  listPOItems: (poId) => ipcRenderer.invoke('po:listItems', poId),

  // --- Fungsi untuk Revisi & Histori ---
  listPORevisions: (poId) => ipcRenderer.invoke('po:listRevisions', poId),
  listPOItemsByRevision: (revId) => ipcRenderer.invoke('po:listItemsByRevision', revId),
  getRevisionHistory: (poId) => ipcRenderer.invoke('po:getRevisionHistory', poId),

  // --- Fungsi untuk PDF & Link ---
  previewPO: (data) => ipcRenderer.invoke('po:preview', data),
  openExternalLink: (url) => ipcRenderer.invoke('app:open-external-link', url),

  // --- Fungsi untuk Progress, Analisis & Lainnya ---
  getActivePOsWithProgress: () => ipcRenderer.invoke('progress:getActivePOsWithProgress'), // <-- PERBAIKAN 1
  getPOItemsWithDetails: (poId) => ipcRenderer.invoke('progress:getPOItemsWithDetails', poId), // <-- PERBAIKAN 2
  updateItemProgress: (data) => ipcRenderer.invoke('progress:updateItem', data),
  getRecentProgressUpdates: () => ipcRenderer.invoke('progress:getRecentProgressUpdates'), // <-- PERBAIKAN 3
  getAttentionData: () => ipcRenderer.invoke('progress:getAttentionData'),
  updateStageDeadline: (data) => ipcRenderer.invoke('progress:updateDeadline', data),
  getProductSalesAnalysis: () => ipcRenderer.invoke('analysis:getProductSales'),
  getSalesItemData: () => ipcRenderer.invoke('analysis:getSalesItemData'),

  // --- Fungsi untuk File ---
  openFileDialog: () => ipcRenderer.invoke('app:open-file-dialog'),
  readFileAsBase64: (filePath) => ipcRenderer.invoke('app:read-file-base64', filePath),
  ollamaChat: (prompt) => ipcRenderer.invoke('ai:ollamaChat', prompt)
}

try {
  console.log(' bridjinggg....')
  contextBridge.exposeInMainWorld('api', api)
  console.log('✅ --- API EXPOSED TO WINDOW SUCCESSFULLY ---')
} catch (error) {
  console.error('❌ --- FAILED TO EXPOSE API ---', error)
}
