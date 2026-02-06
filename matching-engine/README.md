# Matching Engine

Off-chain order matching engine for the dark pool.

## Installation

```bash
pnpm install
```

## Overview

The matching engine runs off-chain to find matching buy and sell orders. It maintains an in-memory order book and matches orders based on asset and price compatibility. See [diagrams/06-data-flow.excalidraw.json](../diagrams/06-data-flow.excalidraw.json) for where it fits in the system.

Since order details are hidden in commitments, the matching engine works with the order parameters provided during submission. In a production system, traders would submit encrypted order details to the matching engine while only the commitment goes on-chain.

## Usage

```typescript
import { MatchingEngine, Order, OrderSide } from "./src/index";

const engine = new MatchingEngine();

// Add buy order
const buyOrder: Order = {
  id: "order-1",
  commitment: "0x...",
  trader: "GBUYER...",
  assetAddress: "CASSET...",
  side: OrderSide.Buy,
  quantity: BigInt(100_000_000),
  price: BigInt(50_000_000),
  timestamp: Date.now(),
  expiry: Date.now() + 3600000,
};
engine.addOrder(buyOrder);

// Add sell order
const sellOrder: Order = {
  id: "order-2",
  commitment: "0x...",
  trader: "GSELLER...",
  assetAddress: "CASSET...",
  side: OrderSide.Sell,
  quantity: BigInt(100_000_000),
  price: BigInt(50_000_000),
  timestamp: Date.now(),
  expiry: Date.now() + 3600000,
};
engine.addOrder(sellOrder);

// Find matches
const matches = engine.findMatches();
// Returns array of { buyOrder, sellOrder, matchedQuantity, executionPrice }
```

## Matching Logic

Orders match when they have the same asset, compatible prices (buy price >= sell price), and are not expired. The execution price is the average of the two prices. Partial fills are supported.

## Integration

After finding a match, the matching engine coordinates with the prover to generate a settlement proof, then submits the settlement transaction to the orderbook and settlement contracts.

## Testing

```bash
pnpm test
```
