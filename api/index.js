// file: api/index.js

// Impor semua fungsi controller
import * as Controller from './_controller.js'

export default async function handler(req, res) {
  // --- TAMBAHKAN LOG INI ---
  console.log(`🚀 [Vercel Index] Request received for URL: ${req.url}`)
  // --- AKHIR TAMBAHAN ---

  const { action } = req.query
  // --- TAMBAHKAN LOG INI ---
  console.log(`⚡️ [Vercel Index] Action extracted: ${action}`)

  try {
    switch (action) {
      // Rute untuk PO
      case 'loginUser':
        console.log('🚦 [Vercel API Router] Routing to handleLoginUser...')
        console.log('  -> Calling Controller.handleLoginUser now...')
        return Controller.handleLoginUser(req, res)
      case 'listOrders':
        return await Controller.handleListOrders(req, res)
      case 'saveNewOrder':
        return await Controller.handleSaveNewOrder(req, res)
      case 'updateOrder':
        return await Controller.handleUpdateOrder(req, res)
      case 'deleteOrder':
        return await Controller.handleDeleteOrder(req, res)

      // Rute untuk Produk
      case 'getProducts':
        return await Controller.handleGetProducts(req, res)

      // Rute untuk Detail & Revisi
      case 'listOrderItems':
        return await Controller.handleListOrderItems(req, res)
      case 'getRevisionHistory':
        return await Controller.handleGetRevisionHistory(req, res)
      case 'listOrderRevisions':
        return await Controller.handleListOrderRevisions(req, res)
      case 'listOrderItemsByRevision':
        return await Controller.handleListOrderItemsByRevision(req, res)

      // Rute untuk Preview
      case 'previewOrder':
        return await Controller.handlePreviewOrder(req, res)

      // Rute untuk Progress
      case 'updateItemProgress':
        return await Controller.handleUpdateItemProgress(req, res)
      case 'getActiveOrdersWithProgress':
        return await Controller.handleGetActiveOrdersWithProgress(req, res)
      case 'getOrderItemsWithDetails':
        return await Controller.handleGetOrderItemsWithDetails(req, res)
      case 'getRecentProgressUpdates':
        return await Controller.handleGetRecentProgressUpdates(req, res)
      case 'updateStageDeadline':
        return await Controller.handleUpdateStageDeadline(req, res)

      // Rute untuk Analisis
      case 'getAttentionData':
        return await Controller.handleGetAttentionData(req, res)
      case 'getProductSalesAnalysis':
        return await Controller.handleGetProductSalesAnalysis(req, res)
      case 'getSalesItemData':
        return await Controller.handleGetSalesItemData(req, res)

      
      case 'getCommissionData':
        return await Controller.handleGetCommissionData(req, res)

      case 'requestProject':
        return await Controller.handleRequestProject(req, res)
      case 'confirmRequest':
        return await Controller.handleConfirmRequest(req, res)

      case 'addNewProduct':
        return await Controller.handleAddNewProduct(req, res)
      case 'ollamaChat': // Nama action tetap sama (sesuai apiService.js)
        console.log('🚦 [Vercel Index] Routing to handleAiChat (Hugging Face)...')
        return await Controller.handleAiChat(req, res)

      default:
        return res.status(404).json({ error: 'Action not found' })
    }
  } catch (err) {
    console.error(`Error executing action: ${action}`, err)
    return res.status(500).json({ success: false, error: err.message })
  }
}