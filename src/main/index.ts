/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import path from 'node:path'
import fs from 'fs'
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config()

import {
  testSheetConnection,
  handleLoginUser,
  saveNewPO,
  listPOs,
  deletePO,
  updatePO,
  listPOItems,
  getProducts,
  listPORevisions,
  listPOItemsByRevision,
  previewPO,
  getRevisionHistory,
  getActivePOsWithProgress,
  getPOItemsWithDetails,
  updateItemProgress,
  getRecentProgressUpdates,
  // [BARU] Impor fungsi baru
  getAttentionData,
  getProductSalesAnalysis,
  addNewProduct,
  getSalesItemData,
  updateStageDeadline,
  handleGroqChat
} from '../../electron/sheet.js'

if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disk-cache-dir', 'C:/temp/electron-cache')
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  testSheetConnection()

  // --- IPC Handlers ---
  ipcMain.handle('ping', () => 'pong')
  ipcMain.handle('po:list', async () => {
    const data = await listPOs();
    // Lakukan pembersihan objek di sini sebelum dikirim balik:
    return JSON.parse(JSON.stringify(data));
  });
  ipcMain.handle('login-user', async (_event, loginData) => {
    return await handleLoginUser(loginData)
  })
  ipcMain.handle('po:save', async (_event, data) => saveNewPO(data))
  ipcMain.handle('po:delete', async (_event, poId) => deletePO(poId))
  ipcMain.handle('po:update', async (_event, data) => updatePO(data))
  ipcMain.handle('po:preview', async (_event, data) => previewPO(data))
  ipcMain.handle('po:listItems', async (_event, poId) => listPOItems(poId))
  ipcMain.handle('po:listRevisions', async (_event, poId) => listPORevisions(poId))
  ipcMain.handle('po:listItemsByRevision', async (_event, poId, revisionNumber) => listPOItemsByRevision(poId, revisionNumber))
  ipcMain.handle('po:getRevisionHistory', async (_event, poId) => getRevisionHistory(poId))
  ipcMain.handle('product:get', () => getProducts())
  ipcMain.handle('app:open-external-link', (_event, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: 'Invalid URL' };
  });

  // --- IPC Handler untuk File Dialog ---
  ipcMain.handle('app:open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0];
  });

  // --- IPC Handlers untuk Progress Tracking ---
  ipcMain.handle('progress:getActivePOsWithProgress', () => getActivePOsWithProgress()); // <-- ✅ PERBAIKAN
  ipcMain.handle('progress:getPOItemsWithDetails', (_event, poId) => getPOItemsWithDetails(poId)); // <-- ✅ PERBAIKAN
  ipcMain.handle('progress:updateItem', (_event, data) => updateItemProgress(data));
  ipcMain.handle('progress:getRecentProgressUpdates', () => getRecentProgressUpdates()); // <-- ✅ PERBAIKAN
  // [BARU] Daftarkan handler untuk data atensi
  ipcMain.handle('progress:getAttentionData', () => getAttentionData());
  ipcMain.handle('analysis:getProductSales', () => getProductSalesAnalysis());
  ipcMain.handle('analysis:getSalesItemData', () => getSalesItemData());
  ipcMain.handle('app:read-file-base64', async (_event, filePath) => {
    try {
      const buffer = await fs.promises.readFile(filePath);
      return buffer.toString('base64');
    } catch (error) {
      console.error('Failed to read file as base64:', error);
      return null;
    }
  });

  // Handler untuk menambah produk baru (ada di kedua branch, cukup satu)
  ipcMain.handle('product:add', (_event, productData) => addNewProduct(productData));

  // Handler untuk update deadline (dari branch 'Erp1-Mobile-Vercel-2')
  ipcMain.handle('progress:updateDeadline', (_event, data) => updateStageDeadline(data));

  ipcMain.handle('ai:ollamaChat', async (_event, prompt) => {
    return await handleGroqChat(prompt);
  });

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})