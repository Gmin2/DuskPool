/**
 * useMatchState - Custom hook for match state management
 *
 * Provides:
 * - Delta updates from WebSocket events (no full refresh)
 * - Optimistic updates for order submission
 * - State reconciliation on WebSocket reconnect
 * - Clean separation of state management from UI
 */

import { useReducer, useCallback, useEffect, useRef } from 'react';
import {
  matchReducer,
  initialMatchState,
  selectDisplayedOpenOrders,
  ExtendedOffChainMatch,
  OpenOrder,
} from './matchReducer';
import { useMatchingEngine, MatchResult, PendingSettlement } from './useMatchingEngine';
import type {
  OrderMatchedData,
  SettlementQueuedData,
  SettlementConfirmedData,
  SettlementFailedData,
  SignatureAddedData,
  UseMatchingEngineWSReturn,
} from './useMatchingEngineWS';
import { API_BASE_URL, apiRequest } from '../config/api';

interface UseMatchStateOptions {
  address: string | null;
  selectedAsset: { address: string; symbol: string } | null;
  // WebSocket connection from parent (to avoid duplicate connections)
  wsConnected: boolean;
  wsOn: UseMatchingEngineWSReturn['on'];
  onSettlementConfirmed?: (data: { matchId: string; txHash: string }) => void;
  onSettlementFailed?: (data: { matchId: string; error: string }) => void;
}

interface UseMatchStateReturn {
  // State
  offChainMatches: ExtendedOffChainMatch[];
  openOrders: OpenOrder[];
  displayedOpenOrders: OpenOrder[];

  // Optimistic updates
  addOptimisticOrder: (order: Omit<OpenOrder, 'id' | 'isOptimistic'>) => string;
  removeOptimisticOrder: (tempId: string) => void;

  // Manual refresh (for reconnect or initial load)
  refetchAll: () => Promise<void>;

  // Set open orders from external source
  setOpenOrders: (orders: OpenOrder[]) => void;

  // Connection state
  wsConnected: boolean;
}

export function useMatchState({
  address,
  selectedAsset,
  wsConnected,
  wsOn,
  onSettlementConfirmed,
  onSettlementFailed,
}: UseMatchStateOptions): UseMatchStateReturn {
  const [state, dispatch] = useReducer(matchReducer, initialMatchState);
  const wasConnectedRef = useRef(false);
  const isInitializedRef = useRef(false);

  // Get API functions from useMatchingEngine
  const { getMatches, getSettlementsForTrader } = useMatchingEngine();

  /**
   * Format raw match data from API into ExtendedOffChainMatch
   */
  const formatMatch = useCallback(
    (
      match: MatchResult,
      settlement: PendingSettlement | undefined,
      userAddress: string | null,
      assetSymbol: string
    ): ExtendedOffChainMatch | null => {
      const isBuyer = match.buyOrder.trader === userAddress;
      const isSeller = match.sellOrder.trader === userAddress;

      if (!isBuyer && !isSeller) return null;

      return {
        matchId: match.matchId,
        time: new Date(match.timestamp).toLocaleTimeString(),
        pair: `${assetSymbol}/USDC`,
        buyTrader: match.buyOrder.trader,
        sellTrader: match.sellOrder.trader,
        price: (Number(match.executionPrice) / 1e7).toFixed(2),
        quantity: (Number(match.executionQuantity) / 1e7).toFixed(2),
        status: settlement?.status || 'matched',
        txHash: settlement?.txHash,
        error: settlement?.error,
        buyerSigned: settlement?.buyerSigned,
        sellerSigned: settlement?.sellerSigned,
        role: isBuyer ? 'buyer' : 'seller',
      };
    },
    []
  );

  /**
   * Fetch all matches and settlements from API (full snapshot)
   */
  const refetchAll = useCallback(async () => {
    if (!selectedAsset || !address) return;

    try {
      console.log('[useMatchState] Fetching full snapshot...');
      const [matches, userSettlements] = await Promise.all([
        getMatches(),
        getSettlementsForTrader(address).catch(() => []),
      ]);

      const settlementMap = new Map(userSettlements.map((s) => [s.matchId, s]));

      const formattedMatches: ExtendedOffChainMatch[] = [];

      matches.forEach((match) => {
        const settlement = settlementMap.get(match.matchId);
        const formatted = formatMatch(match, settlement, address, selectedAsset.symbol);

        // Only include non-confirmed matches (confirmed ones go to trade history)
        if (formatted && formatted.status !== 'confirmed') {
          formattedMatches.push(formatted);
        }
      });

      dispatch({
        type: 'SET_MATCHES',
        payload: { matches: formattedMatches },
      });

      console.log('[useMatchState] Snapshot loaded:', formattedMatches.length, 'matches');
    } catch (err) {
      console.error('[useMatchState] Failed to fetch matches:', err);
    }
  }, [selectedAsset, address, getMatches, getSettlementsForTrader, formatMatch]);

  /**
   * Fetch a single match by ID (for unknown matches from WS events)
   */
  const fetchAndAddMatch = useCallback(
    async (matchId: string) => {
      if (!selectedAsset || !address) return;

      try {
        console.log('[useMatchState] Fetching unknown match:', matchId);

        // Fetch single match - try specific endpoint first, fallback to full list
        let match: MatchResult | undefined;

        try {
          match = await apiRequest<MatchResult>(`${API_BASE_URL}/api/matches/${matchId}`);
        } catch {
          // Fallback: fetch all and find the one we need
          const allMatches = await getMatches();
          match = allMatches.find((m) => m.matchId === matchId);
        }

        if (!match) {
          console.warn('[useMatchState] Match not found:', matchId);
          return;
        }

        // Get settlement info
        const userSettlements = await getSettlementsForTrader(address).catch(() => []);
        const settlement = userSettlements.find((s) => s.matchId === matchId);

        const formatted = formatMatch(match, settlement, address, selectedAsset.symbol);

        if (formatted) {
          dispatch({ type: 'ADD_MATCH', payload: formatted });
          console.log('[useMatchState] Added match:', matchId);
        }
      } catch (err) {
        console.error('[useMatchState] Failed to fetch match:', matchId, err);
      }
    },
    [selectedAsset, address, getMatches, getSettlementsForTrader, formatMatch]
  );

  /**
   * Add optimistic order (for immediate UI feedback)
   */
  const addOptimisticOrder = useCallback(
    (order: Omit<OpenOrder, 'id' | 'isOptimistic'>): string => {
      const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const optimisticOrder: OpenOrder = {
        ...order,
        id: tempId,
        status: 'pending',
        isOptimistic: true,
      };

      dispatch({ type: 'ADD_OPTIMISTIC_ORDER', payload: { tempId, order: optimisticOrder } });
      console.log('[useMatchState] Added optimistic order:', tempId);

      return tempId;
    },
    []
  );

  /**
   * Remove optimistic order (on success or error)
   */
  const removeOptimisticOrder = useCallback((tempId: string) => {
    dispatch({ type: 'REMOVE_OPTIMISTIC_ORDER', payload: tempId });
    console.log('[useMatchState] Removed optimistic order:', tempId);
  }, []);

  /**
   * Set open orders from external source
   */
  const setOpenOrders = useCallback((orders: OpenOrder[]) => {
    dispatch({ type: 'SET_OPEN_ORDERS', payload: orders });
  }, []);

  // Initial load
  useEffect(() => {
    if (selectedAsset && address && !isInitializedRef.current) {
      isInitializedRef.current = true;
      refetchAll();
    }
  }, [selectedAsset, address, refetchAll]);

  // Reconnect handling - fetch full snapshot when WS reconnects
  useEffect(() => {
    if (wsConnected && !wasConnectedRef.current && isInitializedRef.current) {
      console.log('[useMatchState] WebSocket reconnected - fetching snapshot');
      refetchAll();
    }
    wasConnectedRef.current = wsConnected;
  }, [wsConnected, refetchAll]);

  // WebSocket event listeners for delta updates
  useEffect(() => {
    if (!wsConnected || !address) return;

    // Handle order:matched - add new match via delta
    // Note: Duplicate check is handled in the reducer (ADD_MATCH action)
    const removeMatchListener = wsOn<OrderMatchedData>('order:matched', async (data) => {
      console.log('[useMatchState] WS event: order:matched', data.matchId);

      if (data.buyerAddress === address || data.sellerAddress === address) {
        // Fetch and add the match - reducer handles duplicate prevention
        await fetchAndAddMatch(data.matchId);
      }
    });

    // Handle settlement:queued - update status to 'ready'
    const removeQueuedListener = wsOn<SettlementQueuedData>('settlement:queued', (data) => {
      console.log('[useMatchState] WS event: settlement:queued', data.matchId);

      if (data.buyerAddress === address || data.sellerAddress === address) {
        dispatch({
          type: 'UPDATE_MATCH_STATUS',
          payload: { matchId: data.matchId, status: 'ready' },
        });
      }
    });

    // Handle settlement:confirmed - update status to 'confirmed'
    const removeConfirmedListener = wsOn<SettlementConfirmedData>('settlement:confirmed', (data) => {
      console.log('[useMatchState] WS event: settlement:confirmed', data.matchId);

      if (data.buyerAddress === address || data.sellerAddress === address) {
        // Remove from matches immediately - it will appear in trade history
        dispatch({ type: 'MOVE_TO_CONFIRMED', payload: data.matchId });

        // Notify parent component
        onSettlementConfirmed?.({ matchId: data.matchId, txHash: data.txHash });
      }
    });

    // Handle settlement:failed - update status to 'failed'
    const removeFailedListener = wsOn<SettlementFailedData>('settlement:failed', (data) => {
      console.log('[useMatchState] WS event: settlement:failed', data.matchId);

      if (data.buyerAddress === address || data.sellerAddress === address) {
        dispatch({
          type: 'UPDATE_MATCH_STATUS',
          payload: { matchId: data.matchId, status: 'failed', error: data.error },
        });

        onSettlementFailed?.({ matchId: data.matchId, error: data.error });
      }
    });

    // Handle signature:added - update signing flags
    const removeSignatureListener = wsOn<SignatureAddedData>('signature:added', (data) => {
      console.log('[useMatchState] WS event: signature:added', data.matchId);

      dispatch({
        type: 'UPDATE_SIGNATURE_STATUS',
        payload: {
          matchId: data.matchId,
          buyerSigned: data.buyerSigned,
          sellerSigned: data.sellerSigned,
        },
      });

      // If both signed, update status to awaiting_signatures (or ready for final submission)
      if (data.buyerSigned && data.sellerSigned) {
        dispatch({
          type: 'UPDATE_MATCH_STATUS',
          payload: { matchId: data.matchId, status: 'submitted' },
        });
      }
    });

    return () => {
      removeMatchListener();
      removeQueuedListener();
      removeConfirmedListener();
      removeFailedListener();
      removeSignatureListener();
    };
  }, [
    wsConnected,
    address,
    wsOn,
    fetchAndAddMatch,
    onSettlementConfirmed,
    onSettlementFailed,
  ]);

  return {
    offChainMatches: state.offChainMatches,
    openOrders: state.openOrders,
    displayedOpenOrders: selectDisplayedOpenOrders(state),
    addOptimisticOrder,
    removeOptimisticOrder,
    refetchAll,
    setOpenOrders,
    wsConnected,
  };
}

export default useMatchState;
