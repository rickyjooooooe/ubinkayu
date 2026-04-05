// File: src/renderer/src/global.d.ts

// Deklarasikan tipe untuk objek API kita
interface ICustomAPI {
  saveNewOrder: (data: any) => Promise<{ success: boolean; orderId?: string; error?: string }>;
  listOrders: () => Promise<any[]>;
}

// Perluas tipe 'Window' global
declare global {
  interface Window {
    api: ICustomAPI
  }
}