/**
 * Settlement API routes
 * Handles on-chain settlement of matched trades
 */

import { Router, Request, Response } from "express";
import { SettlementService, PendingSettlement } from "../services/settlement";
import { logger } from "../lib/logger";

const router: Router = Router();
const log = logger.settlement;

// Settlement service instance (set from server.ts)
let settlementService: SettlementService;

export function setSettlementService(service: SettlementService) {
  settlementService = service;
}

/**
 * GET /api/settlement/pending
 * Get all pending settlements
 */
router.get("/pending", async (_req: Request, res: Response) => {
  try {
    const settlements = settlementService.getPendingSettlements();

    // Format for JSON response
    const formatted = settlements.map((s) => ({
      matchId: s.matchId,
      status: s.status,
      buyer: s.match.buyOrder.trader,
      seller: s.match.sellOrder.trader,
      assetAddress: s.match.buyOrder.assetAddress,
      quantity: s.match.executionQuantity.toString(),
      price: s.match.executionPrice.toString(),
      nullifierHash: s.proof.nullifierHash,
      txHash: s.txHash,
      error: s.error,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    res.json({ settlements: formatted });
  } catch (error: any) {
    log.error({ err: error }, "Failed to get pending");
    res.status(500).json({
      error: "Failed to get pending settlements",
      details: error.message,
    });
  }
});

/**
 * GET /api/settlement/:matchId
 * Get settlement details by match ID
 */
router.get("/:matchId", async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const settlement = settlementService.getSettlement(matchId);

    if (!settlement) {
      res.status(404).json({ error: "Settlement not found" });
      return;
    }

    res.json({
      matchId: settlement.matchId,
      status: settlement.status,
      buyer: settlement.match.buyOrder.trader,
      seller: settlement.match.sellOrder.trader,
      assetAddress: settlement.match.buyOrder.assetAddress,
      quantity: settlement.match.executionQuantity.toString(),
      price: settlement.match.executionPrice.toString(),
      nullifierHash: settlement.proof.nullifierHash,
      proofHex: settlement.proof.proof.toString("hex"),
      signalsHex: settlement.proof.publicSignals.toString("hex"),
      txHash: settlement.txHash,
      error: settlement.error,
      createdAt: settlement.createdAt,
      updatedAt: settlement.updatedAt,
    });
  } catch (error: any) {
    log.error({ err: error }, "Failed to get settlement");
    res.status(500).json({
      error: "Failed to get settlement",
      details: error.message,
    });
  }
});

/**
 * POST /api/settlement/:matchId/prepare
 * Prepare settlement data for signing
 */
router.post("/:matchId/prepare", async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const data = await settlementService.prepareSettlementData(matchId);

    if (!data) {
      res.status(404).json({ error: "Settlement not found" });
      return;
    }

    log.info({ matchId }, "Prepared data");
    res.json(data);
  } catch (error: any) {
    log.error({ err: error }, "Failed to prepare");
    res.status(500).json({
      error: "Failed to prepare settlement",
      details: error.message,
    });
  }
});

/**
 * POST /api/settlement/:matchId/build-tx
 * Build unsigned settlement transaction
 */
router.post("/:matchId/build-tx", async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const { sourceAccount } = req.body;

    if (!sourceAccount) {
      res.status(400).json({ error: "Missing sourceAccount in request body" });
      return;
    }

    const txXdr = await settlementService.buildSettlementTransaction(
      matchId,
      sourceAccount
    );

    if (!txXdr) {
      res.status(404).json({ error: "Settlement not found or build failed" });
      return;
    }

    log.info({ matchId }, "Built transaction");
    res.json({ txXdr });
  } catch (error: any) {
    log.error({ err: error }, "Failed to build tx");
    res.status(500).json({
      error: "Failed to build settlement transaction",
      details: error.message,
    });
  }
});

/**
 * POST /api/settlement/:matchId/submit
 * Submit signed settlement transaction
 */
router.post("/:matchId/submit", async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const { signedTxXdr } = req.body;

    if (!signedTxXdr) {
      res.status(400).json({ error: "Missing signedTxXdr in request body" });
      return;
    }

    const result = await settlementService.submitSettlement(matchId, signedTxXdr);

    if (result.success) {
      log.info({ matchId, txHash: result.txHash }, "Submitted");
      res.json({
        success: true,
        txHash: result.txHash,
        message: "Settlement submitted successfully",
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error: any) {
    log.error({ err: error }, "Failed to submit");
    res.status(500).json({
      error: "Failed to submit settlement",
      details: error.message,
    });
  }
});

/**
 * POST /api/settlement/:matchId/confirm
 * Mark settlement as confirmed (manual confirmation)
 */
router.post("/:matchId/confirm", async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const { txHash } = req.body;

    if (!txHash) {
      res.status(400).json({ error: "Missing txHash in request body" });
      return;
    }

    settlementService.markConfirmed(matchId, txHash);
    log.info({ matchId, txHash }, "Confirmed");

    res.json({
      success: true,
      message: "Settlement marked as confirmed",
    });
  } catch (error: any) {
    log.error({ err: error }, "Failed to confirm");
    res.status(500).json({
      error: "Failed to confirm settlement",
      details: error.message,
    });
  }
});

/**
 * GET /api/settlement/stats
 * Get settlement statistics
 */
router.get("/stats/summary", async (_req: Request, res: Response) => {
  try {
    const stats = settlementService.getStats();
    res.json(stats);
  } catch (error: any) {
    log.error({ err: error }, "Failed to get stats");
    res.status(500).json({
      error: "Failed to get settlement stats",
      details: error.message,
    });
  }
});

/**
 * GET /api/settlement/for-trader/:address
 * Get all settlements for a specific trader (as buyer or seller)
 */
router.get("/for-trader/:address", async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const settlements = settlementService.getSettlementsForTrader(address);

    const formatted = settlements.map((s) => ({
      matchId: s.matchId,
      status: s.status,
      buyer: s.match.buyOrder.trader,
      seller: s.match.sellOrder.trader,
      assetAddress: s.match.buyOrder.assetAddress,
      quantity: s.match.executionQuantity.toString(),
      price: s.match.executionPrice.toString(),
      nullifierHash: s.proof.nullifierHash,
      buyerSigned: s.buyerSigned || false,
      sellerSigned: s.sellerSigned || false,
      txHash: s.txHash,
      error: s.error,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      // Include role for this trader
      role: s.match.buyOrder.trader === address ? "buyer" : "seller",
    }));

    res.json({ settlements: formatted });
  } catch (error: any) {
    log.error({ err: error }, "Failed to get trader settlements");
    res.status(500).json({
      error: "Failed to get trader settlements",
      details: error.message,
    });
  }
});

/**
 * GET /api/settlement/:matchId/signing-status
 * Get signing status for a settlement
 */
router.get("/:matchId/signing-status", async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const status = settlementService.getSigningStatus(matchId);

    if (!status) {
      res.status(404).json({ error: "Settlement not found" });
      return;
    }

    res.json(status);
  } catch (error: any) {
    log.error({ err: error }, "Failed to get signing status");
    res.status(500).json({
      error: "Failed to get signing status",
      details: error.message,
    });
  }
});

/**
 * POST /api/settlement/:matchId/sign
 * Add a signature from a party (buyer or seller)
 */
router.post("/:matchId/sign", async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const { signerAddress, signedTxXdr } = req.body;

    if (!signerAddress || !signedTxXdr) {
      res.status(400).json({
        error: "Missing signerAddress or signedTxXdr in request body",
      });
      return;
    }

    const result = await settlementService.addSignature(
      matchId,
      signerAddress,
      signedTxXdr
    );

    if (result.error) {
      res.status(400).json({
        success: false,
        complete: false,
        error: result.error,
      });
      return;
    }

    if (result.complete) {
      log.info({ matchId }, "Both parties signed, settlement complete");
      res.json({
        success: true,
        complete: true,
        message: "Settlement completed - both parties have signed",
      });
    } else {
      log.info({ matchId }, "Signature added, waiting for other party");
      res.json({
        success: true,
        complete: false,
        message: "Signature added, waiting for other party to sign",
      });
    }
  } catch (error: any) {
    log.error({ err: error }, "Failed to add signature");
    res.status(500).json({
      error: "Failed to add signature",
      details: error.message,
    });
  }
});

export default router;
