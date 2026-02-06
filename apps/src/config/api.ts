/**
 * API Configuration for Matching Engine
 */

// Base URL for the matching engine API
// In development, this is localhost:3001
// In production, this would be configured via environment variables
export const API_BASE_URL =
  import.meta.env.VITE_MATCHING_ENGINE_URL || "http://localhost:3001";

// WebSocket URL for real-time updates
// Uses the same host/port as the HTTP API
export const WS_URL =
  import.meta.env.VITE_MATCHING_ENGINE_WS_URL || "ws://localhost:3001";

// API endpoints
export const API_ENDPOINTS = {
  // Commitment generation
  generateCommitment: `${API_BASE_URL}/api/commitment/generate`,
  hashAsset: `${API_BASE_URL}/api/commitment/hash-asset`,

  // Order management
  submitOrder: `${API_BASE_URL}/api/orders/submit`,
  getOrderBook: (assetAddress: string) =>
    `${API_BASE_URL}/api/orders/${encodeURIComponent(assetAddress)}`,

  // Match queries
  getMatches: `${API_BASE_URL}/api/matches`,
  getPendingMatches: `${API_BASE_URL}/api/matches/pending`,
  getSettlements: `${API_BASE_URL}/api/matches/settlements`,
  processMatches: `${API_BASE_URL}/api/matches/process`,

  // Settlement management
  getPendingSettlements: `${API_BASE_URL}/api/settlement/pending`,
  getSettlementStats: `${API_BASE_URL}/api/settlement/stats/summary`,
  getSettlement: (matchId: string) =>
    `${API_BASE_URL}/api/settlement/${matchId}`,
  prepareSettlement: (matchId: string) =>
    `${API_BASE_URL}/api/settlement/${matchId}/prepare`,
  buildSettlementTx: (matchId: string) =>
    `${API_BASE_URL}/api/settlement/${matchId}/build-tx`,
  submitSettlement: (matchId: string) =>
    `${API_BASE_URL}/api/settlement/${matchId}/submit`,
  confirmSettlement: (matchId: string) =>
    `${API_BASE_URL}/api/settlement/${matchId}/confirm`,

  // Multi-party signing
  getSettlementsForTrader: (address: string) =>
    `${API_BASE_URL}/api/settlement/for-trader/${address}`,
  getSigningStatus: (matchId: string) =>
    `${API_BASE_URL}/api/settlement/${matchId}/signing-status`,
  addSignature: (matchId: string) =>
    `${API_BASE_URL}/api/settlement/${matchId}/sign`,

  // Health check
  health: `${API_BASE_URL}/health`,
};

// API request helper
export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Request failed",
      details: response.statusText,
    }));
    throw new Error(error.details || error.error || "API request failed");
  }

  return response.json();
}
