/**
 * Shared TypeScript types used by both server (API routes)
 * and client (dashboard, PDF generator) code.
 *
 * Keep this file free of any server-only or client-only imports.
 */

export interface SessionItem {
  sku: string;
  designNumber: string;
  itemType: string;
  metalPurity: string;  // KT — e.g. "18"
  metalType: string;    // Color — e.g. "Y", "W", "R"
  grossWeight: number;
  netWeight: number;
  stoneWeight: number;
  imageUrl: string;
  qty: number;
}

export interface SessionState {
  sessionId: string;
  token: string;
  scanUrl: string;
}
