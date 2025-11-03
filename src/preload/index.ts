import { contextBridge, ipcRenderer } from 'electron'
// eslint-disable-next-line @typescript-eslint/no-require-imports

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
  listPOs: (user) => ipcRenderer.invoke('po:list', user),
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
  getActivePOsWithProgress: (user) => ipcRenderer.invoke('progress:getActivePOsWithProgress', user), // <-- PERBAIKAN 1
  getPOItemsWithDetails: (poId) => ipcRenderer.invoke('progress:getPOItemsWithDetails', poId), // <-- PERBAIKAN 2
  updateItemProgress: (data) => ipcRenderer.invoke('progress:updateItem', data),
  getRecentProgressUpdates: (user) => ipcRenderer.invoke('progress:getRecentProgressUpdates', user), // <-- PERBAIKAN 3
  getAttentionData: (user) => ipcRenderer.invoke('progress:getAttentionData', user),
  updateStageDeadline: (data) => ipcRenderer.invoke('progress:updateDeadline', data),
  getProductSalesAnalysis: (user) => ipcRenderer.invoke('analysis:getProductSales', user),
  getSalesItemData: (user) => ipcRenderer.invoke('analysis:getSalesItemData', user),

  // --- Fungsi untuk File ---
  openFileDialog: () => ipcRenderer.invoke('app:open-file-dialog'),
  readFileAsBase64: (filePath) => ipcRenderer.invoke('app:read-file-base64', filePath),
  ollamaChat: (prompt, user) => ipcRenderer.invoke('ai:ollamaChat', prompt, user)
}

try {
  console.log(' bridjinggg....')
  contextBridge.exposeInMainWorld('api', api)
  console.log('✅ --- API EXPOSED TO WINDOW SUCCESSFULLY ---')
} catch (error) {
  console.error('❌ --- FAILED TO EXPOSE API ---', error)
}
