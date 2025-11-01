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
  saveNewPO: (data: any) => Promise<{ success: boolean; poId?: string; error?: string }>;
  listPOs: () => Promise<any[]>;
  deletePO: (poId: string) => Promise<any>;
  updatePO: (data: any) => Promise<{ success: boolean; error?: string }>;
  listPOItems: (poId: string) => Promise<any[]>;
  previewPO: (data: any) => Promise<any>;
  addNewProduct: (data: any) => Promise<{ success: boolean; newId?: string; error?: string }>;

  // Fungsi Revisi
  listPORevisions: (poId: string) => Promise<any[]>;
  listPOItemsByRevision: (revisionId: string) => Promise<any[]>;
  getRevisionHistory: (poId: string) => Promise<any[]>;

  // Fungsi Progress & Analisis
  getActivePOsWithProgress: () => Promise<any[]>;
  getPOItemsWithDetails: (poId: string) => Promise<any[]>;
  updateItemProgress: (data: any) => Promise<{ success: boolean; error?: string }>;
  getRecentProgressUpdates: () => Promise<any[]>;
  getAttentionData: () => Promise<any>;
  getProductSalesAnalysis: () => Promise<any>;
  getSalesItemData: () => Promise<any[]>;
  updateStageDeadline: (data: any) => Promise<{ success: boolean; error?: string }>;

  // Fungsi Utilitas & File (Electron)
  ping: () => Promise<string>;
  openExternalLink: (url: string) => Promise<{ success: boolean; error?: string }>;
  openFileDialog: () => Promise<string | null>;
  readFileAsBase64: (filePath: string) => Promise<string | null>;

  // --- [TAMBAHKAN INI] Fungsi AI Chat ---
  ollamaChat: (prompt: string) => Promise<string>;
}

declare global {
  interface Window {
    api: ICustomAPI
    electron: any
  }
}

export {}