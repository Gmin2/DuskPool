/**
 * Order submission and query API routes
 */

import { Router, Request, Response } from "express";
import { OrderSide } from "@rwa-darkpool/prover";
import { DarkPoolMatchingEngine, PrivateOrder } from "../index";
import { SettlementService } from "../services/settlement";
import { addSettlementResult } from "./matches";
import { logger } from "../lib/logger";

const router: Router = Router();
const log = logger.orders;

// Reference to the matching engine and settlement service (set from server.ts)
let matchingEngine: DarkPoolMatchingEngine;
let settlementService: SettlementService;

export function setMatchingEngine(engine: DarkPoolMatchingEngine) {
  matchingEngine = engine;
}

export function setSettlementService(service: SettlementService) {
  settlementService = service;
}

interface SubmitOrderRequest {
  commitment: string;
  trader: string;
  assetAddress: string;
  side: number;
  quantity: string;
  price: string;
  secret: string;
  nonce: string;
  expiry: number;
  whitelistIndex: number;
}

// Map trader addresses to whitelist indices for testing
// Since on-chain registration has budget limits, we use local mapping
const TRADER_WHITELIST_MAP: Record<string, number> = {
  // Admin wallet
  "GAWA7FFL4ETAAHS65SBLK7GIJQSAYONUNQAG63USUUPYIK7EMHO7DQQ6": 0,
  // Trader2 wallet
  "GCI2MA57GAKNKFL34Z6BFWHPNQ42HY4CPF3LPTPH7CCQMV7FY566M7WI": 1,
};

function getWhitelistIndex(trader: string, providedIndex?: number): number {
  // First check our local mapping
  if (TRADER_WHITELIST_MAP[trader] !== undefined) {
    return TRADER_WHITELIST_MAP[trader];
  }
  // Fall back to provided index or 0
  return providedIndex || 0;
}

/**
 * POST /api/orders/submit
 * Submit a private order to the matching engine
 */
router.post("/submit", async (req: Request, res: Response) => {
  try {
    const {
      commitment,
      trader,
      assetAddress,
      side,
      quantity,
      price,
      secret,
      nonce,
      expiry,
      whitelistIndex,
    } = req.body as SubmitOrderRequest;

    // Validate required fields
    if (
      !commitment ||
      !trader ||
      !assetAddress ||
      side === undefined ||
      !quantity ||
      !price ||
      !secret ||
      !nonce
    ) {
      res.status(400).json({
        error:
          "Missing required fields: commitment, trader, assetAddress, side, quantity, price, secret, nonce",
      });
      return;
    }

    // Use local whitelist mapping to ensure different traders get different indices
    const resolvedWhitelistIndex = getWhitelistIndex(trader, whitelistIndex);

    const order: PrivateOrder = {
      commitment,
      trader,
      assetAddress,
      side: side as OrderSide,
      quantity: BigInt(quantity),
      price: BigInt(price),
      secret: BigInt(secret),
      nonce: BigInt(nonce),
      timestamp: Date.now(),
      expiry: expiry || Date.now() + 3600000, // Default 1 hour
      whitelistIndex: resolvedWhitelistIndex,
    };

    log.info({
      whitelistIndex: resolvedWhitelistIndex,
      trader: trader.slice(0, 10) + "...",
    }, "Using whitelist index");

    matchingEngine.submitOrder(order);

    log.info({
      side: side === 0 ? "BUY" : "SELL",
      quantity,
      price,
      trader: trader.slice(0, 10) + "...",
      commitment: commitment.slice(0, 20) + "...",
    }, "Order submitted");

    // Check if there are pending matches and process them automatically
    const pendingCount = matchingEngine.getPendingMatchesCount();
    if (pendingCount > 0) {
      log.info({ pendingCount }, "Found pending matches, auto-processing");

      // Process matches asynchronously (don't block the response)
      matchingEngine.processMatches().then((results) => {
        for (const result of results) {
          addSettlementResult(result);

          // Queue settlement if proof was successful
          if (result.success && settlementService) {
            const match = matchingEngine.getMatchById(result.matchId);
            if (match) {
              settlementService.queueSettlement(match, result);
              log.info({ matchId: result.matchId }, "Auto-queued settlement");
            }
          }
        }

        const successful = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        log.info({ successful, failed }, "Auto-processed matches");
      }).catch((err) => {
        log.error({ err }, "Auto-processing failed");
      });
    }

    // Get order book state to show potential match info
    const orderBookState = matchingEngine.getOrderBookState(assetAddress);

    // Check if there are counterparty orders but no match (quantity mismatch)
    let noMatchReason: string | null = null;
    const isNewOrderBuy = side === 0;

    if (pendingCount === 0) {
      if (isNewOrderBuy && orderBookState.sells > 0) {
        // There are sell orders but no match - check why
        const sellQtys = orderBookState.sellQuantities;
        const sellPrices = orderBookState.sellPrices;
        noMatchReason = `No match: Your BUY order (qty: ${Number(quantity) / 1e7}, price: ${Number(price) / 1e7}) didn't match. Available SELL orders: ${sellQtys.map((q, i) => `qty: ${Number(q) / 1e7} @ ${Number(sellPrices[i]) / 1e7}`).join(', ')}. Orders must have exact matching quantities.`;
      } else if (!isNewOrderBuy && orderBookState.buys > 0) {
        // There are buy orders but no match - check why
        const buyQtys = orderBookState.buyQuantities;
        const buyPrices = orderBookState.buyPrices;
        noMatchReason = `No match: Your SELL order (qty: ${Number(quantity) / 1e7}, price: ${Number(price) / 1e7}) didn't match. Available BUY orders: ${buyQtys.map((q, i) => `qty: ${Number(q) / 1e7} @ ${Number(buyPrices[i]) / 1e7}`).join(', ')}. Orders must have exact matching quantities.`;
      }
    }

    res.json({
      success: true,
      message: noMatchReason || "Order submitted to matching engine",
      commitment,
      pendingMatches: pendingCount,
      matched: pendingCount > 0,
      orderBook: {
        buyOrders: orderBookState.buys,
        sellOrders: orderBookState.sells,
      },
      noMatchReason,
    });
  } catch (error: any) {
    log.error({ err: error }, "Submission failed");
    res.status(500).json({
      error: "Failed to submit order",
      details: error.message,
    });
  }
});

/**
 * GET /api/orders/:assetAddress
 * Get order book state for an asset
 */
router.get("/:assetAddress", async (req: Request, res: Response) => {
  try {
    const { assetAddress } = req.params;

    if (!assetAddress) {
      res.status(400).json({
        error: "Missing required parameter: assetAddress",
      });
      return;
    }

    const state = matchingEngine.getOrderBookState(assetAddress);

    res.json({
      assetAddress,
      buyOrders: state.buys,
      sellOrders: state.sells,
      buyQuantities: state.buyQuantities,
      sellQuantities: state.sellQuantities,
      buyPrices: state.buyPrices,
      sellPrices: state.sellPrices,
    });
  } catch (error: any) {
    log.error({ err: error }, "Query failed");
    res.status(500).json({
      error: "Failed to get order book state",
      details: error.message,
    });
  }
});

export default router;
