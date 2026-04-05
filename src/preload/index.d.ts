/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-require-imports

interface ICustomAPI {
  // --- [BARU] Fungsi Login & Autentikasi ---
  loginUser: (data: any) => Promise<{
    success: boolean;
    name?: string;
    role?: string;
    error?: string;
    details?: string;
  }>;

  // Fungsi PO & Produk
  getProducts: () => Promise<any[]>;
  saveNewOrder: (data: any) => Promise<{ success: boolean; orderId?: string; error?: string }>;
  listOrders: (user: any) => Promise<any[]>;
  deletePO: (orderId: string) => Promise<any>;
  updatePO: (data: any) => Promise<{ success: boolean; error?: string }>;
  listorderItems: (orderId: string) => Promise<any[]>;
  previewPO: (data: any) => Promise<any>;
  addNewProduct: (data: any) => Promise<{ success: boolean; newId?: string; error?: string }>;
  // [BARU] Request Project
requestProject: (data: any) => Promise<{ success: boolean; orderId?: string; error?: string }>;
confirmRequest: (data: any) => Promise<{ success: boolean; orderId?: string; error?: string }>;
getCommissionData: (user: any) => Promise<any[]>;
  // Fungsi Revisi
  listPORevisions: (orderId: string) => Promise<any[]>;
  listorderItemsByRevision: (revisionId: string) => Promise<any[]>;
  getRevisionHistory: (orderId: string) => Promise<any[]>;

  // Fungsi Progress & Analisis
  getActiveOrdersWithProgress: (user: any) => Promise<any[]>;
  getorderItemsWithDetails: (orderId: string) => Promise<any[]>;
  updateItemProgress: (data: any) => Promise<{ success: boolean; error?: string }>;
  getRecentProgressUpdates: (user: any) => Promise<any[]>;
  getAttentionData: (user: any) => Promise<any>;
  getProductSalesAnalysis: (user: any) => Promise<any>;
  getSalesItemData: (user: any) => Promise<any[]>;
  updateStageDeadline: (data: any) => Promise<{ success: boolean; error?: string }>;

  // Fungsi Utilitas & File (Electron)
  ping: () => Promise<string>;
  openExternalLink: (url: string) => Promise<{ success: boolean; error?: string }>;
  openFileDialog: () => Promise<string | null>;
  readFileAsBase64: (filePath: string) => Promise<string | null>;

  // --- [TAMBAHKAN INI] Fungsi AI Chat ---
  ollamaChat: (prompt: string, user: any, history: any[]) => Promise<string>;
}

declare global {
  interface Window {
    api: ICustomAPI
    electron: any
  }
}

export {}
