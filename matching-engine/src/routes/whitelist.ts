/**
 * Whitelist synchronization API routes
 *
 * Syncs participant whitelist from the on-chain registry contract
 */

import { Router, Request, Response } from "express";
import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";

const router: Router = Router();

// Contract addresses
const REGISTRY_CONTRACT = "CAYHF7YE6JIQYWJPXCJO6KAJVFPFYHNERIU5IYUR3VGRZQTEI4D6SQRZ";
const RPC_URL = "https://soroban-testnet.stellar.org";

// Reference to matching engine (set from server.ts)
import { DarkPoolMatchingEngine } from "../index";
let matchingEngine: DarkPoolMatchingEngine;

export function setMatchingEngine(engine: DarkPoolMatchingEngine) {
  matchingEngine = engine;
}

/**
 * POST /api/whitelist/sync
 * Sync whitelist from registry contract
 */
router.post("/sync", async (_req: Request, res: Response) => {
  try {
    console.log("[Whitelist] Syncing from registry contract...");

    const rpcServer = new rpc.Server(RPC_URL);

    // Get all active participants from registry
    const participants = await getActiveParticipants(rpcServer);

    if (participants.length === 0) {
      res.status(400).json({
        error: "No active participants found in registry",
        message: "Register participants using the admin scripts first",
      });
      return;
    }

    // Extract id_hash from each participant and initialize whitelist
    const idHashes = participants.map((p) => p.idHash);

    await matchingEngine.initializeWhitelist(idHashes);

    console.log(`[Whitelist] Synced ${participants.length} participants`);

    res.json({
      success: true,
      message: `Synced ${participants.length} participants from registry`,
      participants: participants.map((p) => ({
        tradingAddress: p.tradingAddress.slice(0, 10) + "...",
        treeIndex: p.treeIndex,
        isActive: p.isActive,
      })),
    });
  } catch (error: any) {
    console.error("[Whitelist] Sync failed:", error.message);
    res.status(500).json({
      error: "Failed to sync whitelist",
      details: error.message,
    });
  }
});

/**
 * GET /api/whitelist/status
 * Get current whitelist status
 */
router.get("/status", async (_req: Request, res: Response) => {
  try {
    const rpcServer = new rpc.Server(RPC_URL);

    // Get whitelist root from contract
    const rootHex = await getWhitelistRoot(rpcServer);
    const count = await getWhitelistCount(rpcServer);

    res.json({
      whitelistRoot: rootHex ? rootHex.slice(0, 20) + "..." : null,
      participantCount: count,
      lastSync: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[Whitelist] Status check failed:", error.message);
    res.status(500).json({
      error: "Failed to get whitelist status",
      details: error.message,
    });
  }
});

interface ParsedParticipant {
  tradingAddress: string;
  idHash: string;
  treeIndex: number;
  isActive: boolean;
  category: number;
  kycExpiry: number;
}

/**
 * Get active participants from registry contract
 */
async function getActiveParticipants(rpcServer: rpc.Server): Promise<ParsedParticipant[]> {
  try {
    // Build the contract call
    const contractAddress = Address.fromString(REGISTRY_CONTRACT);

    // Simulate calling get_active_participants
    const result = await rpcServer.simulateTransaction(
      buildSimulateRequest(contractAddress, "get_active_participants", [])
    );

    if ("error" in result) {
      throw new Error(result.error);
    }

    // Parse the result
    if (result.result?.retval) {
      const participants = scValToNative(result.result.retval) as any[];
      return participants.map(parseParticipant);
    }

    return [];
  } catch (error: any) {
    console.error("[Whitelist] Failed to get participants:", error.message);
    return [];
  }
}

/**
 * Get whitelist root from registry
 */
async function getWhitelistRoot(rpcServer: rpc.Server): Promise<string | null> {
  try {
    const contractAddress = Address.fromString(REGISTRY_CONTRACT);

    const result = await rpcServer.simulateTransaction(
      buildSimulateRequest(contractAddress, "get_whitelist_root", [])
    );

    if ("error" in result) {
      throw new Error(result.error);
    }

    if (result.result?.retval) {
      const rootBuffer = scValToNative(result.result.retval) as Buffer;
      return rootBuffer.toString("hex");
    }

    return null;
  } catch (error: any) {
    console.error("[Whitelist] Failed to get root:", error.message);
    return null;
  }
}

/**
 * Get whitelist participant count
 */
async function getWhitelistCount(rpcServer: rpc.Server): Promise<number> {
  try {
    const contractAddress = Address.fromString(REGISTRY_CONTRACT);

    const result = await rpcServer.simulateTransaction(
      buildSimulateRequest(contractAddress, "get_whitelist_count", [])
    );

    if ("error" in result) {
      throw new Error(result.error);
    }

    if (result.result?.retval) {
      return scValToNative(result.result.retval) as number;
    }

    return 0;
  } catch (error: any) {
    console.error("[Whitelist] Failed to get count:", error.message);
    return 0;
  }
}

/**
 * Build a simulate transaction request
 */
function buildSimulateRequest(
  contractAddress: Address,
  functionName: string,
  args: xdr.ScVal[]
): any {
  // Create a minimal transaction for simulation
  const invokeHostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: contractAddress.toScAddress(),
      functionName: Buffer.from(functionName),
      args,
    })
  );

  return {
    hostFunction: invokeHostFunction,
    auth: [],
  };
}

/**
 * Parse participant from contract response
 */
function parseParticipant(p: any): ParsedParticipant {
  return {
    tradingAddress: p.trading_address || p.tradingAddress || "",
    idHash: Buffer.isBuffer(p.id_hash || p.idHash)
      ? (p.id_hash || p.idHash).toString("hex")
      : typeof (p.id_hash || p.idHash) === "string"
      ? p.id_hash || p.idHash
      : "",
    treeIndex: p.tree_index || p.treeIndex || 0,
    isActive: p.is_active ?? p.isActive ?? true,
    category: p.category || 0,
    kycExpiry: Number(p.kyc_expiry || p.kycExpiry || 0),
  };
}

export default router;
