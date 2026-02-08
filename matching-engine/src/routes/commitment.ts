/**
 * Commitment generation API routes
 * Generates Poseidon-based order commitments
 */

import { Router, Request, Response } from "express";
import {
  generateOrderCommitment,
  hashAsset,
  OrderSide,
} from "@rwa-darkpool/prover";
import { logger } from "../lib/logger";

const router: Router = Router();
const log = logger.commitment;

interface GenerateCommitmentRequest {
  assetAddress: string;
  side: number; // 0 = Buy, 1 = Sell
  quantity: string;
  price: string;
}

interface GenerateCommitmentResponse {
  commitment: string;
  secret: string;
  nonce: string;
  assetHash: string;
}

/**
 * POST /api/commitment/generate
 * Generate a Poseidon commitment for an order
 */
router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { assetAddress, side, quantity, price } =
      req.body as GenerateCommitmentRequest;

    // Validate input
    if (!assetAddress || side === undefined || !quantity || !price) {
      res.status(400).json({
        error: "Missing required fields: assetAddress, side, quantity, price",
      });
      return;
    }

    if (side !== 0 && side !== 1) {
      res.status(400).json({
        error: "Invalid side: must be 0 (Buy) or 1 (Sell)",
      });
      return;
    }

    // Hash the asset address
    const assetHash = await hashAsset(assetAddress);

    // Generate the commitment using real Poseidon hash
    const result = await generateOrderCommitment({
      assetHash: BigInt(assetHash),
      side: side as OrderSide,
      quantity: BigInt(quantity),
      price: BigInt(price),
    });

    const response: GenerateCommitmentResponse = {
      commitment: result.commitment,
      secret: result.secret.toString(),
      nonce: result.nonce.toString(),
      assetHash,
    };

    res.json(response);
  } catch (error: any) {
    log.error({ err: error }, "Generation failed");
    res.status(500).json({
      error: "Failed to generate commitment",
      details: error.message,
    });
  }
});

/**
 * POST /api/commitment/hash-asset
 * Hash an asset address using Poseidon
 */
router.post("/hash-asset", async (req: Request, res: Response) => {
  try {
    const { assetAddress } = req.body;

    if (!assetAddress) {
      res.status(400).json({
        error: "Missing required field: assetAddress",
      });
      return;
    }

    const assetHash = await hashAsset(assetAddress);

    res.json({ assetHash });
  } catch (error: any) {
    log.error({ err: error }, "Asset hashing failed");
    res.status(500).json({
      error: "Failed to hash asset",
      details: error.message,
    });
  }
});

export default router;
