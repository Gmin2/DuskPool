/**
 * Match query and settlement API routes
 */

import { Router, Request, Response } from "express";
import { DarkPoolMatchingEngine, Match, SettlementResult } from "../index";
import { SettlementService } from "../services/settlement";

const router: Router = Router();

// Reference to the matching engine instance (set from server.ts)
let matchingEngine: DarkPoolMatchingEngine;
let settlementService: SettlementService;

// Store settlement results
let settlementResults: SettlementResult[] = [];

export function setMatchingEngine(engine: DarkPoolMatchingEngine) {
  matchingEngine = engine;
}

export function setSettlementServiceRef(service: SettlementService) {
  settlementService = service;
}

export function addSettlementResult(result: SettlementResult) {
  settlementResults.push(result);
}

/**
 * GET /api/matches
 * Get all completed matches
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    // Get matches from the matching engine
    const allMatches = matchingEngine.getMatches();

    // Convert bigints to strings for JSON serialization
    const matches = allMatches.map((match) => ({
      matchId: match.matchId,
      buyOrder: {
        commitment: match.buyOrder.commitment,
        trader: match.buyOrder.trader,
        assetAddress: match.buyOrder.assetAddress,
        side: match.buyOrder.side,
        timestamp: match.buyOrder.timestamp,
      },
      sellOrder: {
        commitment: match.sellOrder.commitment,
        trader: match.sellOrder.trader,
        assetAddress: match.sellOrder.assetAddress,
        side: match.sellOrder.side,
        timestamp: match.sellOrder.timestamp,
      },
      executionPrice: match.executionPrice.toString(),
      executionQuantity: match.executionQuantity.toString(),
      timestamp: match.timestamp,
    }));

    res.json({ matches });
  } catch (error: any) {
    console.error("[Matches] Query failed:", error.message);
    res.status(500).json({
      error: "Failed to get matches",
      details: error.message,
    });
  }
});

/**
 * GET /api/matches/pending
 * Get count of pending matches awaiting settlement
 */
router.get("/pending", async (_req: Request, res: Response) => {
  try {
    const pendingCount = matchingEngine.getPendingMatchesCount();

    res.json({
      pendingCount,
    });
  } catch (error: any) {
    console.error("[Matches] Pending query failed:", error.message);
    res.status(500).json({
      error: "Failed to get pending matches",
      details: error.message,
    });
  }
});

/**
 * GET /api/matches/settlements
 * Get all settlement results
 */
router.get("/settlements", async (_req: Request, res: Response) => {
  try {
    // Convert buffers to hex strings for JSON serialization
    const settlements = settlementResults.map((result) => ({
      matchId: result.matchId,
      success: result.success,
      nullifierHash: result.nullifierHash,
      proofHex: result.proof.toString("hex"),
      signalsHex: result.publicSignals.toString("hex"),
      error: result.error,
    }));

    res.json({ settlements });
  } catch (error: any) {
    console.error("[Matches] Settlements query failed:", error.message);
    res.status(500).json({
      error: "Failed to get settlements",
      details: error.message,
    });
  }
});

/**
 * POST /api/matches/process
 * Trigger processing of pending matches (generates proofs)
 */
router.post("/process", async (_req: Request, res: Response) => {
  try {
    const pendingCount = matchingEngine.getPendingMatchesCount();

    if (pendingCount === 0) {
      res.json({
        message: "No pending matches to process",
        processed: 0,
      });
      return;
    }

    console.log(`[Matches] Processing ${pendingCount} pending matches...`);

    const results = await matchingEngine.processMatches();

    // Store results and queue settlements
    for (const result of results) {
      addSettlementResult(result);

      // Queue settlement if proof was successful
      if (result.success && settlementService) {
        const match = matchingEngine.getMatchById(result.matchId);
        if (match) {
          settlementService.queueSettlement(match, result);
          console.log(`[Matches] Queued settlement for match ${result.matchId}`);
        }
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(`[Matches] Processed: ${successful} successful, ${failed} failed`);

    res.json({
      message: `Processed ${results.length} matches`,
      processed: results.length,
      successful,
      failed,
      results: results.map((r) => ({
        matchId: r.matchId,
        success: r.success,
        nullifierHash: r.nullifierHash,
        error: r.error,
      })),
    });
  } catch (error: any) {
    console.error("[Matches] Processing failed:", error.message);
    res.status(500).json({
      error: "Failed to process matches",
      details: error.message,
    });
  }
});

export default router;
