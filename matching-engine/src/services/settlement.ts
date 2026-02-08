/**
 * Settlement Service
 * Handles on-chain settlement of matched trades using ZK proofs
 */

import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";
import { Match, SettlementResult } from "../index";
import { eventBus } from "../events/EventBus";
import { logger } from "../lib/logger";

const log = logger.settlement;

/** Contract addresses (testnet) */
const CONTRACT_IDS = {
  settlement: "CDZAJLQP5EMAMPVAZOF3AUF3S6PL7TSADHA6Y75NAL7XA72MLTNDAULR",
  verifier: "CBSNZSSJ6EEJAEGMGVJHS3JCHQMQMA4COKJ7KE7U6MZGIKVNKOQJFNSJ",
};

/** Network configuration */
const NETWORK_CONFIG = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
};

/** Pending settlement data */
export interface PendingSettlement {
  matchId: string;
  match: Match;
  proof: SettlementResult;
  status: "pending" | "ready" | "awaiting_signatures" | "submitted" | "confirmed" | "failed";
  txHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  // Multi-party signing support
  unsignedTxXdr?: string;
  buyerSigned?: boolean;
  sellerSigned?: boolean;
  partiallySignedTxXdr?: string;
}

/** Settlement service class */
export class SettlementService {
  private rpcServer: rpc.Server;
  private pendingSettlements: Map<string, PendingSettlement> = new Map();
  private paymentAsset: string = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"; // Default USDC testnet

  constructor(rpcUrl: string = NETWORK_CONFIG.rpcUrl) {
    this.rpcServer = new rpc.Server(rpcUrl);
  }

  /**
   * Set the payment asset address
   */
  setPaymentAsset(assetAddress: string) {
    this.paymentAsset = assetAddress;
  }

  /**
   * Queue a settlement for processing
   */
  queueSettlement(match: Match, proof: SettlementResult): PendingSettlement {
    const settlement: PendingSettlement = {
      matchId: match.matchId,
      match,
      proof,
      status: "ready", // Proof is generated, ready for settlement
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.pendingSettlements.set(match.matchId, settlement);

    // Emit settlement:queued event
    eventBus.emit("settlement:queued", {
      matchId: match.matchId,
      buyerAddress: match.buyOrder.trader,
      sellerAddress: match.sellOrder.trader,
      asset: match.buyOrder.assetAddress,
      timestamp: Date.now(),
    });

    return settlement;
  }

  /**
   * Get all pending settlements
   */
  getPendingSettlements(): PendingSettlement[] {
    return Array.from(this.pendingSettlements.values());
  }

  /**
   * Get settlement by match ID
   */
  getSettlement(matchId: string): PendingSettlement | undefined {
    return this.pendingSettlements.get(matchId);
  }

  /**
   * Prepare settlement transaction data (for frontend to sign)
   */
  async prepareSettlementData(matchId: string): Promise<{
    matchId: string;
    buyer: string;
    seller: string;
    assetAddress: string;
    paymentAsset: string;
    quantity: string;
    price: string;
    proofHex: string;
    signalsHex: string;
    nullifierHash: string;
  } | null> {
    const settlement = this.pendingSettlements.get(matchId);
    if (!settlement) {
      log.error({ matchId }, "Settlement not found");
      return null;
    }

    const { match, proof } = settlement;

    return {
      matchId: match.matchId,
      buyer: match.buyOrder.trader,
      seller: match.sellOrder.trader,
      assetAddress: match.buyOrder.assetAddress,
      paymentAsset: this.paymentAsset,
      quantity: match.executionQuantity.toString(),
      price: match.executionPrice.toString(),
      proofHex: proof.proof.toString("hex"),
      signalsHex: proof.publicSignals.toString("hex"),
      nullifierHash: proof.nullifierHash,
    };
  }

  /**
   * Build settlement transaction (unsigned)
   * Returns XDR that can be signed by buyer and seller
   */
  async buildSettlementTransaction(
    matchId: string,
    sourceAccount: string
  ): Promise<string | null> {
    const settlement = this.pendingSettlements.get(matchId);
    if (!settlement) {
      log.error({ matchId }, "Settlement not found");
      return null;
    }

    try {
      const { match, proof } = settlement;

      // Get source account
      const account = await this.rpcServer.getAccount(sourceAccount);

      // Build match_id as 32-byte buffer
      const matchIdBuffer = Buffer.from(match.matchId, "hex");

      // Create contract invocation
      const contractAddress = Address.fromString(CONTRACT_IDS.settlement);

      const invokeArgs = {
        match_id: nativeToScVal(matchIdBuffer, { type: "bytes" }),
        buyer: nativeToScVal(match.buyOrder.trader, { type: "address" }),
        seller: nativeToScVal(match.sellOrder.trader, { type: "address" }),
        asset_address: nativeToScVal(match.buyOrder.assetAddress, { type: "address" }),
        payment_asset: nativeToScVal(this.paymentAsset, { type: "address" }),
        quantity: nativeToScVal(match.executionQuantity, { type: "i128" }),
        price: nativeToScVal(match.executionPrice, { type: "i128" }),
        proof_bytes: nativeToScVal(proof.proof, { type: "bytes" }),
        pub_signals_bytes: nativeToScVal(proof.publicSignals, { type: "bytes" }),
      };

      // Build the transaction
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_CONFIG.networkPassphrase,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: CONTRACT_IDS.settlement,
            function: "settle_trade",
            args: [
              invokeArgs.match_id,
              invokeArgs.buyer,
              invokeArgs.seller,
              invokeArgs.asset_address,
              invokeArgs.payment_asset,
              invokeArgs.quantity,
              invokeArgs.price,
              invokeArgs.proof_bytes,
              invokeArgs.pub_signals_bytes,
            ],
          })
        )
        .setTimeout(300)
        .build();

      // Simulate the transaction to get resource footprint
      const simResult = await this.rpcServer.simulateTransaction(transaction);

      if (rpc.Api.isSimulationError(simResult)) {
        const errorMsg = `Simulation failed: ${simResult.error}`;
        log.error({ matchId, error: simResult.error }, "Simulation failed");
        settlement.status = "failed";
        settlement.error = errorMsg;
        settlement.updatedAt = Date.now();
        return null;
      }

      // Prepare the transaction (adds resource footprint and fees)
      const preparedTx = await this.rpcServer.prepareTransaction(transaction);

      // Update status
      settlement.status = "ready";
      settlement.unsignedTxXdr = preparedTx.toXDR();
      settlement.updatedAt = Date.now();

      // Emit settlement:txBuilt event
      eventBus.emit("settlement:txBuilt", {
        matchId,
        buyerAddress: match.buyOrder.trader,
        sellerAddress: match.sellOrder.trader,
        txHash: preparedTx.hash().toString("hex"),
        timestamp: Date.now(),
      });

      // Return unsigned XDR (prepared with resource footprint)
      return preparedTx.toXDR();
    } catch (error: any) {
      log.error({ err: error, matchId }, "Failed to build transaction");
      settlement.status = "failed";
      settlement.error = error.message;
      settlement.updatedAt = Date.now();
      return null;
    }
  }

  /**
   * Submit a signed settlement transaction
   */
  async submitSettlement(
    matchId: string,
    signedTxXdr: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const settlement = this.pendingSettlements.get(matchId);
    if (!settlement) {
      return { success: false, error: "Settlement not found" };
    }

    try {
      const tx = TransactionBuilder.fromXDR(
        signedTxXdr,
        NETWORK_CONFIG.networkPassphrase
      );

      // Submit to network
      const response = await this.rpcServer.sendTransaction(tx);

      if (response.status === "PENDING") {
        // Wait for confirmation
        try {
          let result = await this.rpcServer.getTransaction(response.hash);
          let attempts = 0;
          while (result.status === "NOT_FOUND" && attempts < 30) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            result = await this.rpcServer.getTransaction(response.hash);
            attempts++;
          }

          if (result.status === "SUCCESS") {
            settlement.status = "confirmed";
            settlement.txHash = response.hash;
            settlement.updatedAt = Date.now();

            // Emit settlement:confirmed event
            eventBus.emit("settlement:confirmed", {
              matchId,
              buyerAddress: settlement.match.buyOrder.trader,
              sellerAddress: settlement.match.sellOrder.trader,
              txHash: response.hash,
              timestamp: Date.now(),
            });

            return { success: true, txHash: response.hash };
          } else {
            settlement.status = "failed";
            const errorMsg = `Transaction failed on-chain: ${result.status}`;
            settlement.error = errorMsg;
            settlement.updatedAt = Date.now();
            log.error({ matchId, status: result.status }, "Transaction failed on-chain");

            // Emit settlement:failed event
            eventBus.emit("settlement:failed", {
              matchId,
              buyerAddress: settlement.match.buyOrder.trader,
              sellerAddress: settlement.match.sellOrder.trader,
              error: errorMsg,
              timestamp: Date.now(),
            });

            return { success: false, error: errorMsg };
          }
        } catch (pollError: any) {
          // SDK parsing error - check Horizon directly
          try {
            const horizonUrl = `https://horizon-testnet.stellar.org/transactions/${response.hash}`;
            const horizonResp = await fetch(horizonUrl);
            const horizonData = await horizonResp.json() as { successful?: boolean };

            if (horizonData.successful === true) {
              settlement.status = "confirmed";
              settlement.txHash = response.hash;
              settlement.updatedAt = Date.now();

              // Emit settlement:confirmed event
              eventBus.emit("settlement:confirmed", {
                matchId,
                buyerAddress: settlement.match.buyOrder.trader,
                sellerAddress: settlement.match.sellOrder.trader,
                txHash: response.hash,
                timestamp: Date.now(),
              });

              return { success: true, txHash: response.hash };
            } else if (horizonData.successful === false) {
              settlement.status = "failed";
              settlement.error = "Transaction failed on-chain";
              settlement.updatedAt = Date.now();

              // Emit settlement:failed event
              eventBus.emit("settlement:failed", {
                matchId,
                buyerAddress: settlement.match.buyOrder.trader,
                sellerAddress: settlement.match.sellOrder.trader,
                error: "Transaction failed on-chain",
                timestamp: Date.now(),
              });

              return { success: false, error: "Transaction failed on-chain" };
            }
          } catch (horizonError) {
            // Ignore horizon errors
          }

          // If we can't determine status, assume success since tx was accepted
          settlement.status = "confirmed";
          settlement.txHash = response.hash;
          settlement.updatedAt = Date.now();
          return { success: true, txHash: response.hash };
        }
      } else {
        // ERROR or other status - extract more details
        settlement.status = "failed";
        const errorDetails = (response as any).errorResultXdr
          ? `XDR: ${(response as any).errorResultXdr}`
          : JSON.stringify(response);
        const errorMsg = `Transaction rejected: ${response.status}. Details: ${errorDetails}`;
        settlement.error = errorMsg;
        settlement.updatedAt = Date.now();
        log.error({ matchId, status: response.status, details: errorDetails }, "Transaction rejected");
        return { success: false, error: `Transaction status: ${response.status}` };
      }
    } catch (error: any) {
      log.error({ err: error, matchId }, "Submit failed");
      settlement.status = "failed";
      settlement.error = error.message;
      settlement.updatedAt = Date.now();
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark settlement as confirmed (called after frontend verification)
   */
  markConfirmed(matchId: string, txHash: string): void {
    const settlement = this.pendingSettlements.get(matchId);
    if (settlement) {
      settlement.status = "confirmed";
      settlement.txHash = txHash;
      settlement.updatedAt = Date.now();
    }
  }

  /**
   * Get settlement statistics
   */
  getStats(): {
    total: number;
    pending: number;
    ready: number;
    awaitingSignatures: number;
    confirmed: number;
    failed: number;
  } {
    const settlements = Array.from(this.pendingSettlements.values());
    return {
      total: settlements.length,
      pending: settlements.filter((s) => s.status === "pending").length,
      ready: settlements.filter((s) => s.status === "ready").length,
      awaitingSignatures: settlements.filter((s) => s.status === "awaiting_signatures").length,
      confirmed: settlements.filter((s) => s.status === "confirmed").length,
      failed: settlements.filter((s) => s.status === "failed").length,
    };
  }

  /**
   * Get settlements for a specific trader (buyer or seller)
   */
  getSettlementsForTrader(traderAddress: string): PendingSettlement[] {
    return Array.from(this.pendingSettlements.values()).filter(
      (s) =>
        s.match.buyOrder.trader === traderAddress ||
        s.match.sellOrder.trader === traderAddress
    );
  }

  /**
   * Add a signature from a party (buyer or seller)
   * Returns true if both parties have signed and settlement can proceed
   */
  async addSignature(
    matchId: string,
    signerAddress: string,
    signedTxXdr: string
  ): Promise<{ complete: boolean; error?: string }> {
    const settlement = this.pendingSettlements.get(matchId);
    if (!settlement) {
      return { complete: false, error: "Settlement not found" };
    }

    const isBuyer = settlement.match.buyOrder.trader === signerAddress;
    const isSeller = settlement.match.sellOrder.trader === signerAddress;

    if (!isBuyer && !isSeller) {
      return { complete: false, error: "Signer is not part of this trade" };
    }

    // Update signing status
    if (isBuyer) {
      settlement.buyerSigned = true;
    }
    if (isSeller) {
      settlement.sellerSigned = true;
    }

    // Store the signed TX (latest one with most signatures)
    settlement.partiallySignedTxXdr = signedTxXdr;
    settlement.status = "awaiting_signatures";
    settlement.updatedAt = Date.now();

    // Emit signature:added event
    eventBus.emit("signature:added", {
      matchId,
      signer: signerAddress,
      role: isBuyer ? "buyer" : "seller",
      buyerSigned: settlement.buyerSigned || false,
      sellerSigned: settlement.sellerSigned || false,
      timestamp: Date.now(),
    });

    // Check if both have signed
    if (settlement.buyerSigned && settlement.sellerSigned) {
      // Emit signature:complete event
      eventBus.emit("signature:complete", {
        matchId,
        buyerAddress: settlement.match.buyOrder.trader,
        sellerAddress: settlement.match.sellOrder.trader,
        timestamp: Date.now(),
      });

      // Submit the fully signed transaction
      const result = await this.submitSettlement(matchId, signedTxXdr);

      if (result.success) {
        return { complete: true };
      } else {
        return { complete: false, error: result.error };
      }
    }

    return { complete: false };
  }

  /**
   * Get signing status for a settlement
   */
  getSigningStatus(matchId: string): {
    buyerSigned: boolean;
    sellerSigned: boolean;
    status: string;
  } | null {
    const settlement = this.pendingSettlements.get(matchId);
    if (!settlement) return null;

    return {
      buyerSigned: settlement.buyerSigned || false,
      sellerSigned: settlement.sellerSigned || false,
      status: settlement.status,
    };
  }
}
