import { EventEmitter } from "events";

// Event payload types
export interface OrderSubmittedEvent {
  orderId: string;
  trader: string;
  asset: string;
  side: "buy" | "sell";
  timestamp: number;
}

export interface OrderMatchedEvent {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  asset: string;
  executionPrice: number;
  executionQuantity: number;
  timestamp: number;
}

export interface ProofGeneratingEvent {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  timestamp: number;
}

export interface ProofGeneratedEvent {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  proofHash: string;
  timestamp: number;
}

export interface ProofFailedEvent {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  error: string;
  timestamp: number;
}

export interface SettlementQueuedEvent {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  asset: string;
  timestamp: number;
}

export interface SettlementTxBuiltEvent {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  txHash: string;
  timestamp: number;
}

export interface SettlementConfirmedEvent {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  txHash: string;
  timestamp: number;
}

export interface SettlementFailedEvent {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  error: string;
  timestamp: number;
}

export interface SignatureAddedEvent {
  matchId: string;
  signer: string;
  role: "buyer" | "seller";
  buyerSigned: boolean;
  sellerSigned: boolean;
  timestamp: number;
}

export interface SignatureCompleteEvent {
  matchId: string;
  buyerAddress: string;
  sellerAddress: string;
  timestamp: number;
}

// Event map for type safety
export interface EventMap {
  "order:submitted": OrderSubmittedEvent;
  "order:matched": OrderMatchedEvent;
  "proof:generating": ProofGeneratingEvent;
  "proof:generated": ProofGeneratedEvent;
  "proof:failed": ProofFailedEvent;
  "settlement:queued": SettlementQueuedEvent;
  "settlement:txBuilt": SettlementTxBuiltEvent;
  "settlement:confirmed": SettlementConfirmedEvent;
  "settlement:failed": SettlementFailedEvent;
  "signature:added": SignatureAddedEvent;
  "signature:complete": SignatureCompleteEvent;
}

export type EventName = keyof EventMap;

// Typed EventBus class
class TypedEventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100); // Allow many subscribers
  }

  emit<K extends EventName>(event: K, data: EventMap[K]): boolean {
    console.log(`[EventBus] Emitting ${event}:`, JSON.stringify(data));
    return this.emitter.emit(event, data);
  }

  on<K extends EventName>(event: K, listener: (data: EventMap[K]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  off<K extends EventName>(event: K, listener: (data: EventMap[K]) => void): this {
    this.emitter.off(event, listener);
    return this;
  }

  once<K extends EventName>(event: K, listener: (data: EventMap[K]) => void): this {
    this.emitter.once(event, listener);
    return this;
  }

  removeAllListeners(event?: EventName): this {
    this.emitter.removeAllListeners(event);
    return this;
  }

  listenerCount(event: EventName): number {
    return this.emitter.listenerCount(event);
  }
}

// Singleton instance
export const eventBus = new TypedEventBus();

export default eventBus;
