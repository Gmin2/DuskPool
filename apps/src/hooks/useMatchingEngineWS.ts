/**
 * WebSocket Hook for Matching Engine Real-time Updates
 *
 * Provides connection management, subscription handling, and event listeners
 * for real-time order book, match, and settlement updates.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { WS_URL } from "../config/api";

// Event types from the matching engine
export type WSEventName =
  | "order:submitted"
  | "order:matched"
  | "proof:generating"
  | "proof:generated"
  | "proof:failed"
  | "settlement:queued"
  | "settlement:txBuilt"
  | "settlement:confirmed"
  | "settlement:failed"
  | "signature:added"
  | "signature:complete";

// Message types
export interface WSMessage {
  type: "subscribe" | "unsubscribe" | "event" | "subscribed" | "unsubscribed" | "pong" | "error";
  channel?: string;
  event?: WSEventName;
  data?: unknown;
  message?: string;
  timestamp?: number;
}

// Event data types
export interface OrderSubmittedData {
  orderId: string;
  trader: string;
  asset: string;
  side: "buy" | "sell";
  timestamp: number;
}

export interface OrderMatchedData {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  asset: string;
  executionPrice: number;
  executionQuantity: number;
  timestamp: number;
}

export interface ProofGeneratingData {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  timestamp: number;
}

export interface ProofGeneratedData {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  proofHash: string;
  timestamp: number;
}

export interface ProofFailedData {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  error: string;
  timestamp: number;
}

export interface SettlementQueuedData {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  asset: string;
  timestamp: number;
}

export interface SettlementTxBuiltData {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  txHash: string;
  timestamp: number;
}

export interface SettlementConfirmedData {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  txHash: string;
  timestamp: number;
}

export interface SettlementFailedData {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  error: string;
  timestamp: number;
}

export interface SignatureAddedData {
  matchId: string;
  signer: string;
  role: "buyer" | "seller";
  buyerSigned: boolean;
  sellerSigned: boolean;
  timestamp: number;
}

export interface SignatureCompleteData {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  timestamp: number;
}

// Event listener type
export type WSEventListener<T = unknown> = (data: T) => void;

// Connection state
export type WSConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

// Hook options
export interface UseMatchingEngineWSOptions {
  autoConnect?: boolean;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

// Hook return type
export interface UseMatchingEngineWSReturn {
  // Connection state
  connectionState: WSConnectionState;
  isConnected: boolean;

  // Connection management
  connect: () => void;
  disconnect: () => void;

  // Subscription management
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  subscribedChannels: string[];

  // Event listeners
  on: <T = unknown>(event: WSEventName, listener: WSEventListener<T>) => () => void;
  off: <T = unknown>(event: WSEventName, listener: WSEventListener<T>) => void;

  // Send ping
  ping: () => void;

  // Last received event (for debugging)
  lastEvent: WSMessage | null;
}

/**
 * Custom hook for WebSocket connection to the matching engine
 */
export function useMatchingEngineWS(
  options: UseMatchingEngineWSOptions = {}
): UseMatchingEngineWSReturn {
  const {
    autoConnect = true,
    reconnectAttempts = 5,
    reconnectDelay = 1000,
    onConnect,
    onDisconnect,
    onError,
  } = options;

  const [connectionState, setConnectionState] = useState<WSConnectionState>("disconnected");
  const [subscribedChannels, setSubscribedChannels] = useState<string[]>([]);
  const [lastEvent, setLastEvent] = useState<WSMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const listenersRef = useRef<Map<WSEventName, Set<WSEventListener>>>(new Map());
  const pendingSubscriptionsRef = useRef<Set<string>>(new Set());

  // Emit event to listeners
  const emitEvent = useCallback((event: WSEventName, data: unknown) => {
    const listeners = listenersRef.current.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          console.error(`[WS] Error in listener for ${event}:`, error);
        }
      });
    }
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as WSMessage;
        setLastEvent(message);

        switch (message.type) {
          case "event":
            if (message.event && message.data) {
              console.log(`[WS] Received event: ${message.event}`, message.data);
              emitEvent(message.event, message.data);
            }
            break;

          case "subscribed":
            console.log(`[WS] Subscribed to: ${message.channel}`);
            if (message.channel) {
              setSubscribedChannels((prev) => [...new Set([...prev, message.channel!])]);
              pendingSubscriptionsRef.current.delete(message.channel);
            }
            break;

          case "unsubscribed":
            console.log(`[WS] Unsubscribed from: ${message.channel}`);
            if (message.channel) {
              setSubscribedChannels((prev) => prev.filter((ch) => ch !== message.channel));
            }
            break;

          case "pong":
            console.log(`[WS] Pong received, latency: ${Date.now() - (message.timestamp || 0)}ms`);
            break;

          case "error":
            console.error(`[WS] Server error: ${message.message}`);
            break;

          default:
            console.log(`[WS] Unknown message type:`, message);
        }
      } catch (error) {
        console.error("[WS] Error parsing message:", error);
      }
    },
    [emitEvent]
  );

  // Connect to WebSocket
  const connect = useCallback(() => {
    // Prevent duplicate connections
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("[WS] Already connected");
      return;
    }
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log("[WS] Connection already in progress");
      return;
    }

    setConnectionState("connecting");
    console.log(`[WS] Connecting to ${WS_URL}...`);

    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("[WS] Connected");
        setConnectionState("connected");
        reconnectAttemptsRef.current = 0;
        onConnect?.();

        // Resubscribe to channels after reconnect
        pendingSubscriptionsRef.current.forEach((channel) => {
          ws.send(JSON.stringify({ type: "subscribe", channel }));
        });
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        console.log("[WS] Disconnected");

        // Only update state if this is still the current WebSocket
        // (prevents old WebSocket's onclose from affecting new connection)
        if (wsRef.current === ws) {
          setConnectionState("disconnected");
          wsRef.current = null;
          onDisconnect?.();

          // Attempt reconnection
          if (reconnectAttemptsRef.current < reconnectAttempts) {
            const delay = reconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
            console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${reconnectAttempts})`);
            setConnectionState("reconnecting");

            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectAttemptsRef.current++;
              connect();
            }, delay);
          }
        } else {
          console.log("[WS] Ignoring onclose from old WebSocket");
        }
      };

      ws.onerror = (error) => {
        console.error("[WS] Error:", error);
        onError?.(error);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error("[WS] Failed to create WebSocket:", error);
      setConnectionState("disconnected");
    }
  }, [handleMessage, onConnect, onDisconnect, onError, reconnectAttempts, reconnectDelay]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    reconnectAttemptsRef.current = reconnectAttempts; // Prevent reconnection

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionState("disconnected");
    setSubscribedChannels([]);
  }, [reconnectAttempts]);

  // Subscribe to a channel
  const subscribe = useCallback((channel: string) => {
    pendingSubscriptionsRef.current.add(channel);

    const trySend = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        console.log(`[WS] Subscribing to: ${channel}`);
        wsRef.current.send(JSON.stringify({ type: "subscribe", channel }));
        return true;
      }
      return false;
    };

    // Try immediately
    if (!trySend()) {
      // If not ready, retry after a microtask to handle React state batching
      console.log(`[WS] Queued subscription for: ${channel} (waiting for connection)`);
      queueMicrotask(() => {
        if (!trySend()) {
          // One more retry after a short delay
          setTimeout(trySend, 100);
        }
      });
    }
  }, []);

  // Unsubscribe from a channel
  const unsubscribe = useCallback((channel: string) => {
    pendingSubscriptionsRef.current.delete(channel);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log(`[WS] Unsubscribing from: ${channel}`);
      wsRef.current.send(JSON.stringify({ type: "unsubscribe", channel }));
    }

    setSubscribedChannels((prev) => prev.filter((ch) => ch !== channel));
  }, []);

  // Add event listener
  const on = useCallback(<T = unknown>(event: WSEventName, listener: WSEventListener<T>) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(listener as WSEventListener);

    // Return cleanup function
    return () => {
      listenersRef.current.get(event)?.delete(listener as WSEventListener);
    };
  }, []);

  // Remove event listener
  const off = useCallback(<T = unknown>(event: WSEventName, listener: WSEventListener<T>) => {
    listenersRef.current.get(event)?.delete(listener as WSEventListener);
  }, []);

  // Send ping
  const ping = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "ping" }));
    }
  }, []);

  // Send pending subscriptions when connection becomes ready
  // This handles the case where subscriptions are added after onopen fires
  useEffect(() => {
    if (connectionState === "connected" && wsRef.current?.readyState === WebSocket.OPEN) {
      pendingSubscriptionsRef.current.forEach((channel) => {
        if (!subscribedChannels.includes(channel)) {
          console.log(`[WS] Sending pending subscription: ${channel}`);
          wsRef.current!.send(JSON.stringify({ type: "subscribe", channel }));
        }
      });
    }
  }, [connectionState, subscribedChannels]);

  // Auto-connect on mount (run only once)
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    connectionState,
    isConnected: connectionState === "connected",
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    subscribedChannels,
    on,
    off,
    ping,
    lastEvent,
  };
}

export default useMatchingEngineWS;
