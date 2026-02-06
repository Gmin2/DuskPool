/**
 * Match State Reducer
 *
 * Pure reducer for managing match/order state with delta updates.
 * Handles optimistic updates, WebSocket events, and state reconciliation.
 */

import type { SettlementStatus, OpenOrder } from '../components/Trade/types';

// Re-export OpenOrder for consumers
export type { OpenOrder };

// Extended match type with signing status and user role
export interface ExtendedOffChainMatch {
  matchId: string;
  time: string;
  pair: string;
  buyTrader: string;
  sellTrader: string;
  price: string;
  quantity: string;
  status: SettlementStatus;
  txHash?: string;
  error?: string;
  buyerSigned?: boolean;
  sellerSigned?: boolean;
  role?: 'buyer' | 'seller';
}

// State shape
export interface MatchState {
  offChainMatches: ExtendedOffChainMatch[];
  openOrders: OpenOrder[];
  optimisticOrders: Map<string, OpenOrder>;
  lastSyncTimestamp: number;
}

// Action types
export type MatchAction =
  | { type: 'ADD_OPTIMISTIC_ORDER'; payload: { tempId: string; order: OpenOrder } }
  | { type: 'REMOVE_OPTIMISTIC_ORDER'; payload: string }
  | { type: 'ADD_MATCH'; payload: ExtendedOffChainMatch }
  | { type: 'UPDATE_MATCH_STATUS'; payload: { matchId: string; status: SettlementStatus; txHash?: string; error?: string } }
  | { type: 'UPDATE_SIGNATURE_STATUS'; payload: { matchId: string; buyerSigned: boolean; sellerSigned: boolean } }
  | { type: 'SET_MATCHES'; payload: { matches: ExtendedOffChainMatch[]; openOrders?: OpenOrder[] } }
  | { type: 'MOVE_TO_CONFIRMED'; payload: string }
  | { type: 'SET_OPEN_ORDERS'; payload: OpenOrder[] };

// Initial state
export const initialMatchState: MatchState = {
  offChainMatches: [],
  openOrders: [],
  optimisticOrders: new Map(),
  lastSyncTimestamp: 0,
};

/**
 * Pure reducer function for match state transformations
 */
export function matchReducer(state: MatchState, action: MatchAction): MatchState {
  switch (action.type) {
    case 'ADD_OPTIMISTIC_ORDER': {
      const { tempId, order } = action.payload;
      const newOptimistic = new Map(state.optimisticOrders);
      newOptimistic.set(tempId, { ...order, isOptimistic: true });
      return {
        ...state,
        optimisticOrders: newOptimistic,
      };
    }

    case 'REMOVE_OPTIMISTIC_ORDER': {
      const newOptimistic = new Map(state.optimisticOrders);
      newOptimistic.delete(action.payload);
      return {
        ...state,
        optimisticOrders: newOptimistic,
      };
    }

    case 'ADD_MATCH': {
      // Avoid duplicates
      if (state.offChainMatches.some(m => m.matchId === action.payload.matchId)) {
        return state;
      }
      return {
        ...state,
        offChainMatches: [action.payload, ...state.offChainMatches],
      };
    }

    case 'UPDATE_MATCH_STATUS': {
      const { matchId, status, txHash, error } = action.payload;
      return {
        ...state,
        offChainMatches: state.offChainMatches.map(match =>
          match.matchId === matchId
            ? { ...match, status, ...(txHash && { txHash }), ...(error && { error }) }
            : match
        ),
      };
    }

    case 'UPDATE_SIGNATURE_STATUS': {
      const { matchId, buyerSigned, sellerSigned } = action.payload;
      return {
        ...state,
        offChainMatches: state.offChainMatches.map(match =>
          match.matchId === matchId
            ? { ...match, buyerSigned, sellerSigned }
            : match
        ),
      };
    }

    case 'SET_MATCHES': {
      const { matches, openOrders } = action.payload;
      return {
        ...state,
        offChainMatches: matches,
        // Preserve existing openOrders if not provided
        openOrders: openOrders !== undefined ? openOrders : state.openOrders,
        lastSyncTimestamp: Date.now(),
      };
    }

    case 'MOVE_TO_CONFIRMED': {
      // Remove match from offChainMatches (it will appear in trade history)
      return {
        ...state,
        offChainMatches: state.offChainMatches.filter(m => m.matchId !== action.payload),
      };
    }

    case 'SET_OPEN_ORDERS': {
      return {
        ...state,
        openOrders: action.payload,
      };
    }

    default:
      return state;
  }
}

/**
 * Selector to get merged open orders (real + optimistic)
 */
export function selectDisplayedOpenOrders(state: MatchState): OpenOrder[] {
  const optimisticArray = Array.from(state.optimisticOrders.values());
  return [...optimisticArray, ...state.openOrders];
}
