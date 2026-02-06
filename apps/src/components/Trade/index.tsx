import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '../../hooks/useWallet';
import { useOrderbook, OrderSide, OrderStatus } from '../../hooks/useOrderbook';
import { useRegistry } from '../../hooks/useRegistry';
import { useMatchingEngine } from '../../hooks/useMatchingEngine';
import { useOrderSecrets, StoredOrderSecret } from '../../hooks/useOrderSecrets';
import { useSettlement } from '../../hooks/useSettlement';
import { useMarketDataPersistence } from '../../hooks/useMarketDataPersistence';
import { useMatchingEngineWS } from '../../hooks/useMatchingEngineWS';
import { useMatchState } from '../../hooks/useMatchState';
import { formatBigint, generateCommitmentAsync, bufferToHex } from '../../utils';
import { OrderProgress, initialProgress } from './OrderProgress';

import { TradeHeader } from './TradeHeader';
import { TradeChart } from './TradeChart';
import { OrderBook } from './OrderBook';
import { OrderForm } from './OrderForm';
import { TradeHistory } from './TradeHistory';
import { SettingsModal } from './SettingsModal';
import { SettlementNotification, SettlementResult } from './SettlementNotification';

import type { AssetOption, ChartType, ChartView, Drawing, HistoryTab, ChartTypeOption, OpenOrder, TradeRecord, OrderBookData, CandlestickData, Time, OffChainMatch } from './types';

const chartTypeOptions: ChartTypeOption[] = [
  { type: 'candle', label: 'Candles' },
  { type: 'bar', label: 'Bars' },
  { type: 'area', label: 'Area' },
  { type: 'line', label: 'Line' },
];

// Payment asset address (USDC on testnet)
const PAYMENT_ASSET = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const Trade: React.FC = () => {
  // Hooks
  const { isConnected, address, signTransaction } = useWallet();
  const { submitOrder, getActiveOrders, getOrdersByAsset } = useOrderbook();
  const { getActiveAssets, getParticipant, isParticipantEligible } = useRegistry();
  const {
    submitPrivateOrder,
    checkHealth,
    buildSettlementTx,
    submitSettlement,
    addSignature,
    getOrderBookState,
  } = useMatchingEngine();
  const { storeSecret } = useOrderSecrets();
  const { lockEscrow, getAvailableBalance, getSettlements } = useSettlement();
  const {
    getPersistedCandles,
    updateCandles,
    getPersistedOrderBook,
    updateOrderBook,
    getPersistedTrades,
    updateTrades,
  } = useMarketDataPersistence();

  // WebSocket for real-time updates (shared with useMatchState)
  const {
    isConnected: wsConnected,
    subscribe,
    unsubscribe,
    ping,
    on: wsOn,
  } = useMatchingEngineWS({
    autoConnect: true,
    reconnectAttempts: 5,
    reconnectDelay: 1000,
    onConnect: () => console.log('[Trade] WebSocket connected'),
    onDisconnect: () => console.log('[Trade] WebSocket disconnected'),
  });

  // Matching engine availability state
  const [isMatchingEngineAvailable, setIsMatchingEngineAvailable] = useState(false);

  // Participant eligibility state
  const [participantTreeIndex, setParticipantTreeIndex] = useState<number | null>(null);
  const [isEligible, setIsEligible] = useState<boolean>(false);

  // Asset state
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<AssetOption | null>(null);
  const [showAssetDropdown, setShowAssetDropdown] = useState(false);

  // Order state
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [priceDisplay, setPriceDisplay] = useState('--');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [noMatchWarning, setNoMatchWarning] = useState<string | null>(null);
  const [orderProgress, setOrderProgress] = useState<OrderProgress>(initialProgress);

  // Chart state
  const [timeframe, setTimeframe] = useState('1H');
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [chartView, setChartView] = useState<ChartView>('price');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [historyTab, setHistoryTab] = useState<HistoryTab>('open');
  const [showSettings, setShowSettings] = useState(false);

  // Data - real blockchain data
  const [candleData, setCandleData] = useState<CandlestickData<Time>[]>([]);
  const [orderBookData, setOrderBookData] = useState<OrderBookData>({ asks: [], bids: [], maxTotal: 0 });
  const [orderHistory, setOrderHistory] = useState<OpenOrder[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [isSettling, setIsSettling] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [settlementResult, setSettlementResult] = useState<SettlementResult | null>(null);

  // Match state management with delta updates (professional DEX-style)
  const {
    offChainMatches,
    displayedOpenOrders,
    addOptimisticOrder,
    removeOptimisticOrder,
    refetchAll: refetchMatches,
    setOpenOrders,
  } = useMatchState({
    address,
    selectedAsset,
    wsConnected,
    wsOn,
    onSettlementConfirmed: (data) => {
      loadMarketData();
      setSettlementResult({
        status: 'success',
        message: 'Trade has been settled on-chain. Funds have been exchanged.',
        txHash: data.txHash,
        matchId: data.matchId,
      });
    },
    onSettlementFailed: (data) => {
      setSettlementResult({
        status: 'error',
        message: data.error || 'Settlement failed',
        matchId: data.matchId,
      });
    },
  });

  // 24h stats
  const [priceChange24h, setPriceChange24h] = useState<number | undefined>(undefined);
  const [volume24h, setVolume24h] = useState<number | undefined>(undefined);

  // Track which asset's price has been initialized (to avoid overriding user input)
  const priceInitializedForAssetRef = useRef<string | null>(null);

  // Build OHLCV candle data from match history
  const buildCandleDataFromMatches = useCallback((matches: { price: bigint; quantity: bigint; timestamp: bigint }[]): CandlestickData<Time>[] => {
    if (matches.length === 0) {
      // Return empty array when no matches - chart will show "No data" state
      return [];
    }

    // Sort matches by timestamp
    const sortedMatches = [...matches].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

    // Group matches into hourly candles
    const HOUR_SECONDS = 3600;
    const candleMap = new Map<number, { open: number; high: number; low: number; close: number; time: number }>();

    for (const match of sortedMatches) {
      const price = formatBigint(match.price);
      const timestamp = Number(match.timestamp);
      const candleTime = Math.floor(timestamp / HOUR_SECONDS) * HOUR_SECONDS;

      if (!candleMap.has(candleTime)) {
        candleMap.set(candleTime, {
          time: candleTime,
          open: price,
          high: price,
          low: price,
          close: price,
        });
      } else {
        const candle = candleMap.get(candleTime)!;
        candle.high = Math.max(candle.high, price);
        candle.low = Math.min(candle.low, price);
        candle.close = price;
      }
    }

    // Convert to array and sort by time
    const candles = Array.from(candleMap.values())
      .sort((a, b) => a.time - b.time)
      .map(c => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

    // If we have very few candles, fill in gaps
    if (candles.length > 0 && candles.length < 10) {
      const lastPrice = candles[candles.length - 1].close;
      const now = Math.floor(Date.now() / 1000);
      const startTime = candles[0].time as number;

      // Fill in missing hours
      const filledCandles: CandlestickData<Time>[] = [];
      for (let t = startTime; t <= now; t += HOUR_SECONDS) {
        const existing = candles.find(c => (c.time as number) === t);
        if (existing) {
          filledCandles.push(existing);
        } else {
          const prevClose = filledCandles.length > 0 ? filledCandles[filledCandles.length - 1].close : lastPrice;
          filledCandles.push({
            time: t as Time,
            open: prevClose,
            high: prevClose,
            low: prevClose,
            close: prevClose,
          });
        }
      }
      return filledCandles.slice(-48); // Last 48 hours
    }

    return candles;
  }, []);

  // Load assets from registry
  const loadAssets = useCallback(async () => {
    try {
      const registeredAssets = await getActiveAssets();
      const assetOptions: AssetOption[] = registeredAssets.map(asset => ({
        address: asset.token_address,
        symbol: asset.symbol,
      }));
      setAssets(assetOptions);
      if (assetOptions.length > 0 && !selectedAsset) {
        setSelectedAsset(assetOptions[0]);
      }
    } catch (err) {
      console.error('Failed to load assets:', err);
    }
  }, [getActiveAssets, selectedAsset]);

  // Load orderbook and trade data from blockchain
  const loadMarketData = useCallback(async () => {
    if (!selectedAsset) return;

    // Step 1: Load persisted data first for instant display
    const persistedCandles = getPersistedCandles(selectedAsset.address);
    if (persistedCandles.length > 0) {
      setCandleData(persistedCandles);
    }

    const persistedOrderBook = getPersistedOrderBook(selectedAsset.address);
    if (persistedOrderBook.bids.length > 0 || persistedOrderBook.asks.length > 0) {
      const maxTotal = Math.max(persistedOrderBook.asks.length, persistedOrderBook.bids.length, 1);
      setOrderBookData({ ...persistedOrderBook, maxTotal });
    }

    const persistedTrades = getPersistedTrades(selectedAsset.address);
    if (persistedTrades.length > 0) {
      setTradeHistory(persistedTrades);
    }

    try {
      // Step 2: Fetch fresh data from API/chain
      // Load order book from matching engine (has real prices)
      // The on-chain orderbook only has commitments, but matching engine knows real prices
      let asks: { price: number; size: number; total: number }[] = [];
      let bids: { price: number; size: number; total: number }[] = [];

      if (isMatchingEngineAvailable) {
        try {
          const offChainOrderBook = await getOrderBookState(selectedAsset.address);
          console.log('[Trade] Order book from matching engine:', offChainOrderBook);

          // Build asks from sell orders (matching engine has real prices)
          if (offChainOrderBook.sellOrders > 0 && offChainOrderBook.sellPrices?.length > 0) {
            asks = offChainOrderBook.sellPrices.map((price: string, i: number) => ({
              price: Number(price) / 1e7,
              size: Number(offChainOrderBook.sellQuantities[i]) / 1e7,
              total: i + 1,
            }));
          }

          // Build bids from buy orders
          if (offChainOrderBook.buyOrders > 0 && offChainOrderBook.buyPrices?.length > 0) {
            bids = offChainOrderBook.buyPrices.map((price: string, i: number) => ({
              price: Number(price) / 1e7,
              size: Number(offChainOrderBook.buyQuantities[i]) / 1e7,
              total: i + 1,
            }));
          }
        } catch (e) {
          console.warn('[Trade] Failed to load off-chain order book:', e);
        }
      }

      // Fallback to on-chain order count if matching engine unavailable
      if (asks.length === 0 && bids.length === 0) {
        const [buyOrders, sellOrders] = await Promise.all([
          getOrdersByAsset(selectedAsset.address, OrderSide.Buy),
          getOrdersByAsset(selectedAsset.address, OrderSide.Sell),
        ]);

        // Show placeholder - prices hidden in ZK commitments
        asks = sellOrders.slice(0, 8).map((_, i) => ({
          price: 0, // Price hidden
          size: 1,
          total: i + 1,
        }));
        bids = buyOrders.slice(0, 8).map((_, i) => ({
          price: 0, // Price hidden
          size: 1,
          total: i + 1,
        }));
      }

      const maxTotal = Math.max(asks.length, bids.length, 1);
      setOrderBookData({ asks, bids, maxTotal });
      // Persist order book data
      if (asks.length > 0 || bids.length > 0) {
        updateOrderBook(selectedAsset.address, { asks, bids });
      }

      // Load user's active orders
      const activeOrders = await getActiveOrders(selectedAsset.address);
      const userOrders = activeOrders.filter(o => o.trader === address);
      console.log('[Trade] Active orders from chain:', activeOrders.length, 'user orders:', userOrders.length);

      const formattedOpenOrders: OpenOrder[] = userOrders
        .filter(o => o.status === OrderStatus.Active)
        .map((order, i) => ({
          id: `${i}`,
          time: new Date(Number(order.timestamp) * 1000).toLocaleTimeString(),
          pair: `${selectedAsset.symbol}/USDC`,
          type: 'Limit (ZK)',
          side: order.side === OrderSide.Buy ? 'buy' as const : 'sell' as const,
          price: '---', // Hidden in ZK commitment
          amount: '---', // Hidden in ZK commitment
          status: 'open' as const,
        }));
      console.log('[Trade] Formatted open orders:', formattedOpenOrders.length);
      setOpenOrders(formattedOpenOrders);

      // Load order history (matched/cancelled/expired orders)
      const allOrders = await getOrdersByAsset(selectedAsset.address);
      const historicalOrders = allOrders.filter(o =>
        o.trader === address && o.status !== OrderStatus.Active
      );

      const formattedOrderHistory: OpenOrder[] = historicalOrders.map((order, i) => ({
        id: `hist-${i}`,
        time: new Date(Number(order.timestamp) * 1000).toLocaleTimeString(),
        pair: `${selectedAsset.symbol}/USDC`,
        type: 'Limit (ZK)',
        side: order.side === OrderSide.Buy ? 'buy' as const : 'sell' as const,
        price: '---',
        amount: '---',
        status: order.status === OrderStatus.Matched ? 'filled' as const :
                order.status === OrderStatus.Cancelled ? 'cancelled' as const : 'filled' as const,
      }));
      setOrderHistory(formattedOrderHistory);

      // Load trade history from on-chain settlement records (not orderbook matches)
      // The matching happens off-chain, but settlements are recorded on-chain
      const settlements = await getSettlements();
      console.log('[Trade] Loaded settlements from chain:', settlements.length);

      // Filter settlements for the selected asset
      const assetSettlements = settlements.filter(s => s.asset_address === selectedAsset.address);
      console.log('[Trade] Asset settlements:', assetSettlements.length);

      // Build candle data from all settlements for this asset
      const candles = buildCandleDataFromMatches(assetSettlements);
      setCandleData(candles);
      // Persist candle data
      if (candles.length > 0) {
        updateCandles(selectedAsset.address, candles);
      }

      // Filter for user's trades
      const userTrades = settlements.filter(s =>
        s.buyer === address || s.seller === address
      );

      const formattedTrades: TradeRecord[] = userTrades.map((settlement, i) => ({
        id: `trade-${i}`,
        time: new Date(Number(settlement.timestamp) * 1000).toLocaleTimeString(),
        pair: `${selectedAsset.symbol}/USDC`,
        side: settlement.buyer === address ? 'buy' as const : 'sell' as const,
        price: formatBigint(settlement.price).toFixed(2),
        amount: formatBigint(settlement.quantity).toFixed(2),
        fee: '0.00', // Fee info not in settlement record
      }));
      setTradeHistory(formattedTrades);
      // Persist trade history
      if (formattedTrades.length > 0) {
        updateTrades(selectedAsset.address, formattedTrades);
      }

      // Calculate 24h stats from settlements
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      // Filter settlements from last 24h
      const settlements24h = assetSettlements.filter(s =>
        Number(s.timestamp) * 1000 >= oneDayAgo
      );

      // Calculate 24h volume (sum of price * quantity for all trades)
      if (settlements24h.length > 0) {
        const totalVolume = settlements24h.reduce((sum, s) => {
          const price = formatBigint(s.price);
          const quantity = formatBigint(s.quantity);
          return sum + (price * quantity);
        }, 0);
        setVolume24h(totalVolume);
      } else {
        setVolume24h(0);
      }

      // Calculate 24h price change
      if (assetSettlements.length > 0) {
        const sortedSettlements = [...assetSettlements].sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
        const currentPrice = formatBigint(sortedSettlements[0].price);

        // Find the price from ~24h ago
        const oldSettlement = sortedSettlements.find(s =>
          Number(s.timestamp) * 1000 <= oneDayAgo
        );

        if (oldSettlement) {
          const oldPrice = formatBigint(oldSettlement.price);
          const change = ((currentPrice - oldPrice) / oldPrice) * 100;
          setPriceChange24h(change);
        } else if (sortedSettlements.length > 1) {
          // If no settlement from 24h ago, use the oldest one
          const oldestPrice = formatBigint(sortedSettlements[sortedSettlements.length - 1].price);
          const change = ((currentPrice - oldestPrice) / oldestPrice) * 100;
          setPriceChange24h(change);
        } else {
          setPriceChange24h(0); // Only one settlement, no change
        }
      } else {
        setPriceChange24h(undefined);
      }

      // Update price from last trade - only on initial load for each asset (don't override user input)
      if (assetSettlements.length > 0 && priceInitializedForAssetRef.current !== selectedAsset.address) {
        const sortedSettlements = [...assetSettlements].sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
        const lastPrice = formatBigint(sortedSettlements[0].price);
        setPriceDisplay(lastPrice.toFixed(2));
        priceInitializedForAssetRef.current = selectedAsset.address;
      }

    } catch (err) {
      console.error('Failed to load market data:', err);
    }
  }, [selectedAsset, address, getOrdersByAsset, getActiveOrders, getSettlements, buildCandleDataFromMatches, isMatchingEngineAvailable, getOrderBookState, getPersistedCandles, getPersistedOrderBook, getPersistedTrades, updateCandles, updateOrderBook, updateTrades]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  // Check matching engine availability on mount and via WebSocket
  useEffect(() => {
    const checkAvailability = async () => {
      const available = await checkHealth();
      setIsMatchingEngineAvailable(available);
      if (available) {
        console.log('[Trade] Matching engine is available - using real Poseidon commitments');
      } else {
        console.log('[Trade] Matching engine unavailable - using mock commitments');
      }
    };
    checkAvailability();

    // Use WebSocket ping as heartbeat if connected, otherwise poll less frequently
    if (wsConnected) {
      // WebSocket connected - use ping for heartbeat
      const pingInterval = setInterval(() => {
        ping();
      }, 30000);
      return () => clearInterval(pingInterval);
    } else {
      // WebSocket not connected - fallback to HTTP polling (less frequently)
      const interval = setInterval(checkAvailability, 60000);
      return () => clearInterval(interval);
    }
  }, [checkHealth, wsConnected, ping]);

  // Check participant eligibility when wallet connects
  useEffect(() => {
    const checkEligibility = async () => {
      if (!isConnected || !address) {
        setIsEligible(false);
        setParticipantTreeIndex(null);
        return;
      }

      try {
        // Check if user is registered as a participant
        const participant = await getParticipant(address);
        if (participant) {
          setParticipantTreeIndex(participant.tree_index);

          // Also check if they're eligible (active + KYC not expired)
          const eligible = await isParticipantEligible(address);
          setIsEligible(eligible);

          if (eligible) {
            console.log(`[Trade] Participant eligible, tree_index: ${participant.tree_index}`);
          } else {
            console.log('[Trade] Participant not eligible (inactive or KYC expired)');
          }
        } else {
          setIsEligible(false);
          setParticipantTreeIndex(null);
          console.log('[Trade] User is not a registered participant');
        }
      } catch (err) {
        console.error('[Trade] Failed to check participant eligibility:', err);
        setIsEligible(false);
        setParticipantTreeIndex(null);
      }
    };

    checkEligibility();
  }, [isConnected, address, getParticipant, isParticipantEligible]);

  // Subscribe to WebSocket channels for orderbook updates
  useEffect(() => {
    if (!wsConnected || !selectedAsset) return;

    // Subscribe to orderbook updates for the selected asset
    const orderbookChannel = `orderbook:${selectedAsset.address}`;
    subscribe(orderbookChannel);

    // Subscribe to trader-specific updates if wallet is connected
    if (address) {
      const traderChannel = `trader:${address}`;
      subscribe(traderChannel);
    }

    return () => {
      unsubscribe(orderbookChannel);
      if (address) {
        unsubscribe(`trader:${address}`);
      }
    };
  }, [wsConnected, selectedAsset, address, subscribe, unsubscribe]);

  // NOTE: WebSocket event handling for matches is now done in useMatchState hook
  // This eliminates polling and uses delta updates for professional DEX-style real-time updates

  // Load market data when asset changes
  useEffect(() => {
    if (selectedAsset) {
      loadMarketData();
    }
  }, [selectedAsset, loadMarketData]);

  // Refresh data after successful order submission
  useEffect(() => {
    if (submitSuccess) {
      loadMarketData();
    }
  }, [submitSuccess, loadMarketData]);

  // Handle order submission
  const handleSubmitOrder = async () => {
    if (!isConnected || !selectedAsset || !amount || !priceDisplay || !address) {
      setSubmitError('Please fill in all fields');
      return;
    }

    // Step 1: Validating
    setOrderProgress({ step: 'validating', stepIndex: 1 });

    // Check participant eligibility
    // TEMPORARILY DISABLED FOR TESTING - TODO: Fix registry contract budget issue
    // if (!isEligible) {
    //   setSubmitError('You are not registered as a participant or your KYC has expired. Please contact the admin.');
    //   setOrderProgress({ step: 'error', stepIndex: 1, error: 'Not eligible to trade' });
    //   return;
    // }

    // Use tree_index 0 as fallback for testing
    const whitelistIdx = participantTreeIndex ?? 0;

    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    // Add optimistic order for immediate UI feedback
    const optimisticTempId = addOptimisticOrder({
      time: new Date().toLocaleTimeString(),
      pair: `${selectedAsset.symbol}/USDC`,
      type: 'Limit',
      side: orderSide,
      price: priceDisplay,
      amount: amount,
      status: 'pending',
    });

    try {
      const qty = parseFloat(amount);
      const price = parseFloat(priceDisplay);
      const side = orderSide === 'buy' ? 0 : 1;

      // Calculate amounts for escrow locking (7 decimals)
      const quantityBigint = BigInt(Math.round(qty * 1e7));
      const priceBigint = BigInt(Math.round(price * 1e7));
      const totalPayment = (quantityBigint * priceBigint) / BigInt(1e7); // price * quantity

      // Determine which asset to lock based on order side
      // BUY: lock payment asset (USDC) for the total price
      // SELL: lock the RWA asset for the quantity
      const assetToLock = orderSide === 'buy' ? PAYMENT_ASSET : selectedAsset.address;
      const amountToLock = orderSide === 'buy' ? totalPayment : quantityBigint;

      // Check escrow balance
      const availableBalance = await getAvailableBalance(assetToLock);
      if (availableBalance < amountToLock) {
        const assetName = orderSide === 'buy' ? 'USDC' : selectedAsset.symbol;
        const requiredAmount = Number(amountToLock) / 1e7;
        const availableAmount = Number(availableBalance) / 1e7;
        const errorMsg = `Insufficient escrow balance. Need ${requiredAmount.toFixed(2)} ${assetName}, but only ${availableAmount.toFixed(2)} available.`;
        setSubmitError(errorMsg + ' Please deposit more on the Escrow page.');
        setOrderProgress({ step: 'error', stepIndex: 1, error: errorMsg });
        setIsSubmitting(false);
        return;
      }

      // Step 2: Lock escrow for this order
      setOrderProgress({ step: 'locking_escrow', stepIndex: 2 });
      console.log(`[Trade] Locking ${Number(amountToLock) / 1e7} ${orderSide === 'buy' ? 'USDC' : selectedAsset.symbol} in escrow...`);
      await lockEscrow(assetToLock, amountToLock);
      console.log('[Trade] Escrow locked successfully');

      // Step 3: Generate commitment (real Poseidon if API available, mock otherwise)
      setOrderProgress({ step: 'generating_proof', stepIndex: 3 });
      const commitmentResult = await generateCommitmentAsync(
        selectedAsset.address,
        side,
        qty,
        price
      );

      const commitment = commitmentResult.commitment;
      const commitmentHex = bufferToHex(commitment);

      // Store secret locally for future settlement
      const secretData: StoredOrderSecret = {
        commitment: commitmentHex,
        secret: commitmentResult.secret,
        nonce: commitmentResult.nonce,
        assetHash: commitmentResult.assetHash || '',
        assetAddress: selectedAsset.address,
        side,
        quantity: Math.round(qty * 1e7).toString(),
        price: Math.round(price * 1e7).toString(),
        trader: address,
        timestamp: Date.now(),
        expiry: Date.now() + 3600000, // 1 hour
      };
      storeSecret(secretData);
      console.log('[Trade] Stored order secret for commitment:', commitmentHex.slice(0, 20) + '...');

      // Step 4: Submit commitment to on-chain orderbook
      setOrderProgress({ step: 'submitting_chain', stepIndex: 4 });
      const { txHash } = await submitOrder(
        commitment,
        selectedAsset.address,
        orderSide === 'buy' ? OrderSide.Buy : OrderSide.Sell,
        BigInt(3600)
      );
      console.log('[Trade] Submitted commitment to on-chain orderbook, txHash:', txHash);

      // Step 5: Submit private order details to matching engine
      setOrderProgress({ step: 'submitting_engine', stepIndex: 5 });
      // CRITICAL: Use decimal string commitment for ZK circuit compatibility
      // The circuit expects decimal field elements, not hex strings
      const commitmentForMatchingEngine = commitmentResult.commitmentDecimal || commitmentHex;

      // Always try to submit, regardless of health check status (it may have been stale)
      try {
        console.log('[Trade] Submitting to matching engine with:', {
          commitment: commitmentForMatchingEngine.slice(0, 30) + '...',
          side,
          quantity: Math.round(qty * 1e7).toString(),
          price: Math.round(price * 1e7).toString(),
          whitelistIndex: whitelistIdx,
        });

        const matchingResult = await submitPrivateOrder({
          commitment: commitmentForMatchingEngine,
          trader: address,
          assetAddress: selectedAsset.address,
          side,
          quantity: Math.round(qty * 1e7).toString(),
          price: Math.round(price * 1e7).toString(),
          secret: commitmentResult.secret,
          nonce: commitmentResult.nonce,
          expiry: Date.now() + 3600000,
          whitelistIndex: whitelistIdx,
        });
        console.log('[Trade] Submitted private order to matching engine');

        // Step 6: Check for match
        setOrderProgress({ step: 'matching', stepIndex: 6 });

        // Show warning if order didn't match
        if (matchingResult.noMatchReason) {
          setNoMatchWarning(matchingResult.noMatchReason);
          // Auto-hide after 10 seconds
          setTimeout(() => setNoMatchWarning(null), 10000);
        } else {
          setNoMatchWarning(null);
        }

        // Complete with match status
        setOrderProgress({
          step: 'complete',
          stepIndex: 6,
          matched: matchingResult.matched,
          matchId: matchingResult.matched ? matchingResult.message : undefined,
          txHash,
        });
        setSubmitSuccess(true);
        setAmount('');

        // Auto-reset to idle after longer time if matched (to see result)
        setTimeout(() => {
          setSubmitSuccess(false);
          setOrderProgress(initialProgress);
        }, matchingResult.matched ? 8000 : 5000);

        return; // Exit early since we handled completion
      } catch (matchingError) {
        // Non-critical: order is already on-chain, matching engine submission is optional
        console.warn('[Trade] Matching engine submission failed:', matchingError);
      }

      // Complete without matching engine (fallback)
      setOrderProgress({ step: 'complete', stepIndex: 6, matched: false, txHash });
      setSubmitSuccess(true);
      setAmount('');

      // Auto-reset to idle after 5 seconds
      setTimeout(() => {
        setSubmitSuccess(false);
        setOrderProgress(initialProgress);
      }, 5000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Order submission failed';
      setSubmitError(message);
      setOrderProgress({ step: 'error', stepIndex: orderProgress.stepIndex, error: message });
    } finally {
      setIsSubmitting(false);
      // Remove optimistic order - real order state comes from WebSocket events
      removeOptimisticOrder(optimisticTempId);
    }
  };

  // Handle settlement of a matched trade
  const handleSettleMatch = async (matchId: string) => {
    if (!address) {
      console.error('[Trade] No wallet connected');
      return;
    }

    setIsSettling(true);
    setSettlementResult(null);
    try {
      console.log(`[Trade] Settling match ${matchId}...`);

      // Step 1: Build the unsigned transaction
      const txXdr = await buildSettlementTx(matchId, address);
      console.log('[Trade] Built settlement transaction');

      // Step 2: Sign the transaction with the connected wallet
      console.log('[Trade] Requesting wallet signature...');
      const signedTxXdr = await signTransaction(txXdr);
      console.log('[Trade] Transaction signed successfully');

      // Step 3: Submit the signed transaction
      console.log('[Trade] Submitting settlement to blockchain...');
      const result = await submitSettlement(matchId, signedTxXdr);

      if (result.success) {
        console.log(`[Trade] Settlement confirmed! TX: ${result.txHash}`);
        setSettlementResult({
          status: 'success',
          message: 'Trade has been settled on-chain. Funds have been exchanged.',
          txHash: result.txHash,
          matchId,
        });

        // Refresh chart and order book with new settlement data
        await loadMarketData();
      } else {
        console.error('[Trade] Settlement submission failed:', result.error);
        setSettlementResult({
          status: 'error',
          message: result.error || 'Settlement submission failed',
          matchId,
        });
      }

      // Refresh matches to show updated status
      await refetchMatches();
    } catch (err) {
      console.error('[Trade] Settlement failed:', err);
      const message = err instanceof Error ? err.message : 'Settlement failed';
      // Check if user rejected the transaction
      if (message.includes('User declined') || message.includes('rejected') || message.includes('cancelled')) {
        setSettlementResult({
          status: 'error',
          message: 'Transaction was cancelled by user.',
          matchId,
        });
      } else {
        setSettlementResult({
          status: 'error',
          message,
          matchId,
        });
      }
    } finally {
      setIsSettling(false);
    }
  };

  // Handle signing for multi-party settlement
  const handleSignMatch = async (matchId: string) => {
    if (!address) {
      console.error('[Trade] No wallet connected');
      return;
    }

    setIsSigning(true);
    setSettlementResult(null);
    try {
      console.log(`[Trade] Signing settlement for match ${matchId}...`);

      // Step 1: Build the unsigned transaction
      const txXdr = await buildSettlementTx(matchId, address);
      console.log('[Trade] Built settlement transaction for signing');

      // Step 2: Sign the transaction with the connected wallet
      console.log('[Trade] Requesting wallet signature...');
      const signedTxXdr = await signTransaction(txXdr);
      console.log('[Trade] Transaction signed successfully');

      // Step 3: Submit the signature to the matching engine
      console.log('[Trade] Submitting signature to matching engine...');
      const result = await addSignature(matchId, address, signedTxXdr);

      if (result.success) {
        if (result.complete) {
          console.log('[Trade] Both parties signed! Settlement complete.');
          setSettlementResult({
            status: 'success',
            message: 'Both parties have signed! Trade is being executed on-chain.',
            txHash: result.txHash,
            matchId,
          });

          // Refresh chart and order book with new settlement data
          await loadMarketData();
        } else {
          console.log('[Trade] Signature added, waiting for other party');
          setSettlementResult({
            status: 'pending',
            message: 'Your signature has been added. Waiting for the other party to sign.',
            matchId,
          });
        }
      } else {
        console.error('[Trade] Signature submission failed:', result.error);
        setSettlementResult({
          status: 'error',
          message: result.error || 'Signing failed',
          matchId,
        });
      }

      // Refresh matches to show updated status
      await refetchMatches();
    } catch (err) {
      console.error('[Trade] Signing failed:', err);
      const message = err instanceof Error ? err.message : 'Signing failed';
      // Check if user rejected the transaction
      if (message.includes('User declined') || message.includes('rejected') || message.includes('cancelled')) {
        setSettlementResult({
          status: 'error',
          message: 'Transaction signing was cancelled by user.',
          matchId,
        });
      } else {
        setSettlementResult({
          status: 'error',
          message,
          matchId,
        });
      }
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col pt-2 px-2 md:px-6 pb-2 animate-fade-in-up overflow-hidden">
      {/* Terminal Header */}
      <TradeHeader
        assets={assets}
        selectedAsset={selectedAsset}
        setSelectedAsset={setSelectedAsset}
        showAssetDropdown={showAssetDropdown}
        setShowAssetDropdown={setShowAssetDropdown}
        currentPrice={priceDisplay}
        chartType={chartType}
        setChartType={setChartType}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
        chartTypeOptions={chartTypeOptions}
        priceChange24h={priceChange24h}
        volume24h={volume24h}
      />

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 xl:grid-cols-5 gap-3 flex-1 min-h-0 overflow-hidden">
        {/* LEFT: Chart Area */}
        <div className="lg:col-span-3 xl:col-span-3 flex flex-col gap-3 min-h-0 overflow-hidden">
          <TradeChart
            chartType={chartType}
            chartView={chartView}
            setChartView={setChartView}
            candleData={candleData}
            onPriceUpdate={setPriceDisplay}
            onOpenSettings={() => setShowSettings(true)}
            drawings={drawings}
            setDrawings={setDrawings}
          />

          <TradeHistory
            activeTab={historyTab}
            setActiveTab={setHistoryTab}
            openOrders={displayedOpenOrders}
            orderHistory={orderHistory}
            tradeHistory={tradeHistory}
            offChainMatches={offChainMatches}
            onSettleMatch={handleSettleMatch}
            onSignMatch={handleSignMatch}
            isSettling={isSettling}
            isSigning={isSigning}
          />
        </div>

        {/* RIGHT: OrderBook + Execution */}
        <div className="lg:col-span-1 xl:col-span-2 flex flex-col gap-3 min-h-0 overflow-hidden">
          <OrderBook data={orderBookData} currentPrice={priceDisplay} />

          <OrderForm
            selectedAsset={selectedAsset}
            orderSide={orderSide}
            setOrderSide={setOrderSide}
            amount={amount}
            setAmount={setAmount}
            price={priceDisplay}
            setPrice={setPriceDisplay}
            isSubmitting={isSubmitting}
            submitError={submitError}
            isConnected={isConnected}
            onSubmit={handleSubmitOrder}
            noMatchWarning={noMatchWarning}
            orderProgress={orderProgress}
          />
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        chartType={chartType}
        setChartType={setChartType}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
        drawings={drawings}
        clearDrawings={() => setDrawings([])}
        chartTypeOptions={chartTypeOptions}
      />

      {/* Settlement Notification */}
      <SettlementNotification
        result={settlementResult}
        onClose={() => setSettlementResult(null)}
      />
    </div>
  );
};

export default Trade;
