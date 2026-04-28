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
  saveNewOrder: (data) => ipcRenderer.invoke('order:save', data),
  listOrders: (user) => ipcRenderer.invoke('order:list', user),
  updatePO: (data) => ipcRenderer.invoke('order:update', data),
  deletePO: (orderId) => ipcRenderer.invoke('order:delete', orderId),
  ListOrderItems: (orderId) => ipcRenderer.invoke('order:listItems', orderId),
// [BARU] Request Project
requestProject: (data) => ipcRenderer.invoke('order:requestProject', data),
confirmRequest: (data) => ipcRenderer.invoke('order:confirmRequest', data),
getCommissionData: (user) => ipcRenderer.invoke('commission:getData', user),
  // --- Fungsi untuk Revisi & Histori ---
  listPORevisions: (orderId) => ipcRenderer.invoke('order:listRevisions', orderId),
  ListOrderItemsByRevision: (revId) => ipcRenderer.invoke('order:listItemsByRevision', revId),
  getRevisionHistory: (orderId) => ipcRenderer.invoke('order:getRevisionHistory', orderId),

  // --- Fungsi untuk PDF & Link ---
  previewPO: (data) => ipcRenderer.invoke('order:preview', data),
  openExternalLink: (url) => ipcRenderer.invoke('app:open-external-link', url),

  // --- Fungsi untuk Progress, Analisis & Lainnya ---
  getActiveOrdersWithProgress: (user) => ipcRenderer.invoke('progress:getActiveOrdersWithProgress', user), // <-- PERBAIKAN 1
  GetOrderItemsWithDetails: (orderId) => ipcRenderer.invoke('progress:GetOrderItemsWithDetails', orderId), // <-- PERBAIKAN 2
  updateItemProgress: (data) => ipcRenderer.invoke('progress:updateItem', data),
  getRecentProgressUpdates: (user) => ipcRenderer.invoke('progress:getRecentProgressUpdates', user), // <-- PERBAIKAN 3
  getAttentionData: (user) => ipcRenderer.invoke('progress:getAttentionData', user),
  updateStageDeadline: (data) => ipcRenderer.invoke('progress:updateDeadline', data),
  getProductSalesAnalysis: (user) => ipcRenderer.invoke('analysis:getProductSales', user),
  getSalesItemData: (user) => ipcRenderer.invoke('analysis:getSalesItemData', user),

  // --- Fungsi untuk File ---
  openFileDialog: () => ipcRenderer.invoke('app:open-file-dialog'),
  readFileAsBase64: (filePath) => ipcRenderer.invoke('app:read-file-base64', filePath),
  ollamaChat: (prompt, user, history) => ipcRenderer.invoke('ai:ollamaChat', prompt, user, history)
}

try {
  console.log(' bridjinggg....')
  contextBridge.exposeInMainWorld('api', api)
  console.log('✅ --- API EXPOSED TO WINDOW SUCCESSFULLY ---')
} catch (error) {
  console.error('❌ --- FAILED TO EXPOSE API ---', error)
}
