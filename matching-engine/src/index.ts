/**
 * RWA Dark Pool - Off-chain Matching Engine
 *
 * Responsibilities:
 * 1. Receive encrypted orders from traders
 * 2. Match buy/sell orders by price-time priority
 * 3. Generate ZK settlement proofs
 * 4. Coordinate settlement on-chain
 */

import { rpc } from "@stellar/stellar-sdk";
import {
  generateSettlementProof,
  buildWhitelistTree,
  computeNullifier,
  OrderSide,
  MerkleProof,
} from "@rwa-darkpool/prover";
import * as path from "path";

/** Contract addresses (testnet) - synced with apps/src/contracts/index.ts */
const CONTRACTS = {
  verifier: "CBSNZSSJ6EEJAEGMGVJHS3JCHQMQMA4COKJ7KE7U6MZGIKVNKOQJFNSJ",
  registry: "CAYHF7YE6JIQYWJPXCJO6KAJVFPFYHNERIU5IYUR3VGRZQTEI4D6SQRZ",
  settlement: "CBD24SR5QAAQOBZ3D56V3NKDHRRGRHO4PZONQ3VNOJF3IDAYEUBC45TJ",
  orderbook: "CA2KQFACY34RAIQTJAKBOGB3UPKPKDSLL2LFVZVQQZC4DPFDFDBW5FIP",
};

/** Circuit paths */
const WASM_PATH = path.join(__dirname, "../../circuits/build/settlement_proof_js/settlement_proof.wasm");
const ZKEY_PATH = path.join(__dirname, "../../circuits/build/settlement_proof_final.zkey");

/** Order with private details (received via encrypted channel) */
export interface PrivateOrder {
  commitment: string;
  trader: string;
  assetAddress: string;
  side: OrderSide;
  quantity: bigint;
  price: bigint;
  secret: bigint;
  nonce: bigint;
  timestamp: number;
  expiry: number;
  whitelistIndex: number;
}

/** Match record */
export interface Match {
  matchId: string;
  buyOrder: PrivateOrder;
  sellOrder: PrivateOrder;
  executionPrice: bigint;
  executionQuantity: bigint;
  timestamp: number;
}

/** Settlement result */
export interface SettlementResult {
  matchId: string;
  proof: Buffer;
  publicSignals: Buffer;
  nullifierHash: string;
  success: boolean;
  error?: string;
}

/**
 * Dark Pool Matching Engine
 */
export class DarkPoolMatchingEngine {
  private rpcServer: rpc.Server;
  private buyOrders: Map<string, PrivateOrder[]> = new Map();
  private sellOrders: Map<string, PrivateOrder[]> = new Map();
  private matchQueue: Match[] = [];
  private completedMatches: Match[] = [];
  private whitelistRoot: string = "";
  private whitelistProofs: Map<number, MerkleProof> = new Map();

  constructor(rpcUrl: string = "https://soroban-testnet.stellar.org") {
    this.rpcServer = new rpc.Server(rpcUrl);
  }

  /**
   * Initialize whitelist from registry contract
   */
  async initializeWhitelist(participantIdHashes: string[]): Promise<void> {
    console.log("Building whitelist tree...");
    const { root, proofs } = await buildWhitelistTree(participantIdHashes);
    this.whitelistRoot = root;
    this.whitelistProofs = proofs;
    console.log("Whitelist root:", root.slice(0, 20) + "...");
    console.log("Participants:", participantIdHashes.length);
  }

  /**
   * Submit a new private order
   */
  submitOrder(order: PrivateOrder): void {
    const orders = order.side === OrderSide.Buy ? this.buyOrders : this.sellOrders;

    if (!orders.has(order.assetAddress)) {
      orders.set(order.assetAddress, []);
    }

    orders.get(order.assetAddress)!.push(order);
    console.log(`Order submitted: ${order.side === OrderSide.Buy ? "BUY" : "SELL"} ${order.quantity} @ ${order.price}`);

    /** Try to match */
    this.matchOrders(order.assetAddress);
  }

  /**
   * Match orders using price-time priority
   */
  private matchOrders(assetAddress: string): void {
    const buys = this.buyOrders.get(assetAddress) || [];
    const sells = this.sellOrders.get(assetAddress) || [];

    if (buys.length === 0 || sells.length === 0) return;

    /** Sort by price (best first) then time */
    buys.sort((a, b) => {
      if (a.price !== b.price) return Number(b.price - a.price);
      return a.timestamp - b.timestamp;
    });

    sells.sort((a, b) => {
      if (a.price !== b.price) return Number(a.price - b.price);
      return a.timestamp - b.timestamp;
    });

    /** Find matches where buy price >= sell price AND quantities match exactly
     *  NOTE: We require exact quantity matches because ZK commitments include the quantity.
     *  Partial fills would require the execution quantity to differ from the committed quantity,
     *  which would cause the ZK proof to fail.
     */
    const matchedBuys = new Set<number>();
    const matchedSells = new Set<number>();

    for (let i = 0; i < buys.length; i++) {
      if (matchedBuys.has(i)) continue;
      const buyOrder = buys[i];

      for (let j = 0; j < sells.length; j++) {
        if (matchedSells.has(j)) continue;
        const sellOrder = sells[j];

        // Check price compatibility
        if (buyOrder.price < sellOrder.price) continue;

        // Check quantity match - must be exact for ZK proof to work
        if (buyOrder.quantity !== sellOrder.quantity) {
          console.log(`  Skipping potential match: quantities differ (buy: ${buyOrder.quantity}, sell: ${sellOrder.quantity})`);
          console.log(`  ZK proofs require exact quantity matches - no partial fills supported yet`);
          continue;
        }

        /** Match found! */
        const executionPrice = (buyOrder.price + sellOrder.price) / 2n;
        const executionQuantity = buyOrder.quantity; // Same as sellOrder.quantity

        const match: Match = {
          matchId: generateMatchId(),
          buyOrder,
          sellOrder,
          executionPrice,
          executionQuantity,
          timestamp: Date.now(),
        };

        this.matchQueue.push(match);
        this.completedMatches.push(match);
        matchedBuys.add(i);
        matchedSells.add(j);

        console.log(`Match found: ${match.matchId}`);
        console.log(`  Quantity: ${executionQuantity}, Price: ${executionPrice}`);

        break;
      }
    }

    /** Remove matched orders */
    this.buyOrders.set(
      assetAddress,
      buys.filter((_, i) => !matchedBuys.has(i))
    );
    this.sellOrders.set(
      assetAddress,
      sells.filter((_, i) => !matchedSells.has(i))
    );
  }

  /**
   * Process pending matches and generate proofs
   */
  async processMatches(): Promise<SettlementResult[]> {
    const results: SettlementResult[] = [];

    while (this.matchQueue.length > 0) {
      const match = this.matchQueue.shift()!;
      const result = await this.settleMatch(match);
      results.push(result);
    }

    return results;
  }

  /**
   * Generate proof and prepare settlement for a match
   */
  private async settleMatch(match: Match): Promise<SettlementResult> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Settling match: ${match.matchId}`);
    console.log(`${'='.repeat(60)}`);

    try {
      /** Get Merkle proofs for buyer and seller */
      const buyerProof = this.whitelistProofs.get(match.buyOrder.whitelistIndex);
      const sellerProof = this.whitelistProofs.get(match.sellOrder.whitelistIndex);

      if (!buyerProof || !sellerProof) {
        throw new Error(`Merkle proof not found: buyer=${match.buyOrder.whitelistIndex}, seller=${match.sellOrder.whitelistIndex}`);
      }

      // Compute assetHash
      const assetHash = await hashAssetAddress(match.buyOrder.assetAddress);

      // DEBUG: Print all values that will be used for proof generation
      console.log('\n[DEBUG] Settlement Proof Inputs:');
      console.log('--- BUY ORDER ---');
      console.log(`  Commitment: ${match.buyOrder.commitment.slice(0, 40)}...`);
      console.log(`  Commitment format: ${match.buyOrder.commitment.startsWith('0x') ? 'HEX' : 'DECIMAL'}`);
      console.log(`  Quantity: ${match.buyOrder.quantity.toString()}`);
      console.log(`  Price: ${match.buyOrder.price.toString()}`);
      console.log(`  Secret (first 20 chars): ${match.buyOrder.secret.toString().slice(0, 20)}...`);
      console.log(`  Nonce (first 20 chars): ${match.buyOrder.nonce.toString().slice(0, 20)}...`);
      console.log(`  Whitelist Index: ${match.buyOrder.whitelistIndex}`);

      console.log('--- SELL ORDER ---');
      console.log(`  Commitment: ${match.sellOrder.commitment.slice(0, 40)}...`);
      console.log(`  Commitment format: ${match.sellOrder.commitment.startsWith('0x') ? 'HEX' : 'DECIMAL'}`);
      console.log(`  Quantity: ${match.sellOrder.quantity.toString()}`);
      console.log(`  Price: ${match.sellOrder.price.toString()}`);
      console.log(`  Secret (first 20 chars): ${match.sellOrder.secret.toString().slice(0, 20)}...`);
      console.log(`  Nonce (first 20 chars): ${match.sellOrder.nonce.toString().slice(0, 20)}...`);
      console.log(`  Whitelist Index: ${match.sellOrder.whitelistIndex}`);

      console.log('--- EXECUTION ---');
      console.log(`  Execution Price: ${match.executionPrice.toString()}`);
      console.log(`  Execution Quantity: ${match.executionQuantity.toString()}`);
      console.log(`  Asset Hash: ${assetHash.slice(0, 30)}...`);
      console.log(`  Whitelist Root: ${this.whitelistRoot.slice(0, 30)}...`);

      console.log('--- MERKLE PROOFS ---');
      console.log(`  Buyer ID Hash: ${buyerProof.idHash.slice(0, 30)}...`);
      console.log(`  Seller ID Hash: ${sellerProof.idHash.slice(0, 30)}...`);

      // Check for price/quantity mismatch (common cause of proof failure)
      if (match.buyOrder.price !== match.executionPrice || match.sellOrder.price !== match.executionPrice) {
        console.log('\n[WARNING] Price mismatch detected!');
        console.log(`  Buy order price: ${match.buyOrder.price} vs Execution: ${match.executionPrice}`);
        console.log(`  Sell order price: ${match.sellOrder.price} vs Execution: ${match.executionPrice}`);
        console.log('  This may cause ZK proof to fail (commitment was generated with original price)');
      }

      if (match.buyOrder.quantity !== match.executionQuantity || match.sellOrder.quantity !== match.executionQuantity) {
        console.log('\n[WARNING] Quantity mismatch detected!');
        console.log(`  Buy order qty: ${match.buyOrder.quantity} vs Execution: ${match.executionQuantity}`);
        console.log(`  Sell order qty: ${match.sellOrder.quantity} vs Execution: ${match.executionQuantity}`);
        console.log('  This may cause ZK proof to fail (commitment was generated with original quantity)');
      }

      console.log("\nGenerating ZK proof...");

      /** Generate settlement proof */
      const settlementProof = await generateSettlementProof(
        {
          buyerIdHash: buyerProof.idHash,
          buyerMerkleProof: buyerProof,
          sellerIdHash: sellerProof.idHash,
          sellerMerkleProof: sellerProof,
          buyOrderSecret: match.buyOrder.secret,
          buyOrderNonce: match.buyOrder.nonce,
          sellOrderSecret: match.sellOrder.secret,
          sellOrderNonce: match.sellOrder.nonce,
          buyCommitment: match.buyOrder.commitment,
          sellCommitment: match.sellOrder.commitment,
          assetHash,
          matchedQuantity: match.executionQuantity,
          executionPrice: match.executionPrice,
          whitelistRoot: this.whitelistRoot,
        },
        WASM_PATH,
        ZKEY_PATH
      );

      console.log("Proof generated successfully!");
      console.log("Nullifier:", settlementProof.nullifierHash.slice(0, 20) + "...");

      return {
        matchId: match.matchId,
        proof: settlementProof.proofBytes,
        publicSignals: settlementProof.signalsBytes,
        nullifierHash: settlementProof.nullifierHash,
        success: true,
      };
    } catch (error: any) {
      console.error(`\n[ERROR] Settlement failed: ${error.message}`);
      if (error.message.includes('line: 77')) {
        console.error('[HINT] Line 77 is the BUY commitment verification');
        console.error('       Check that buyCommitment = Poseidon(assetHash, 0, qty, price, nonce, secret)');
      }
      if (error.message.includes('line: 87')) {
        console.error('[HINT] Line 87 is the SELL commitment verification');
        console.error('       Check that sellCommitment = Poseidon(assetHash, 1, qty, price, nonce, secret)');
      }
      return {
        matchId: match.matchId,
        proof: Buffer.alloc(0),
        publicSignals: Buffer.alloc(0),
        nullifierHash: "",
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get pending matches count
   */
  getPendingMatchesCount(): number {
    return this.matchQueue.length;
  }

  /**
   * Get order book state with details about pending orders
   */
  getOrderBookState(assetAddress: string): {
    buys: number;
    sells: number;
    buyQuantities: string[];
    sellQuantities: string[];
    buyPrices: string[];
    sellPrices: string[];
  } {
    const buys = this.buyOrders.get(assetAddress) || [];
    const sells = this.sellOrders.get(assetAddress) || [];
    return {
      buys: buys.length,
      sells: sells.length,
      buyQuantities: buys.map(o => o.quantity.toString()),
      sellQuantities: sells.map(o => o.quantity.toString()),
      buyPrices: buys.map(o => o.price.toString()),
      sellPrices: sells.map(o => o.price.toString()),
    };
  }

  /**
   * Get all completed matches
   */
  getMatches(): Match[] {
    return this.completedMatches;
  }

  /**
   * Get a match by ID
   */
  getMatchById(matchId: string): Match | undefined {
    return this.completedMatches.find((m) => m.matchId === matchId);
  }

  /**
   * Get pending matches (not yet settled)
   */
  getPendingMatches(): Match[] {
    return this.matchQueue;
  }
}

/**
 * Generate unique match ID
 */
function generateMatchId(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    const nodeCrypto = require("crypto");
    const buf = nodeCrypto.randomBytes(32);
    bytes.set(buf);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hash asset address using Poseidon
 */
async function hashAssetAddress(assetAddress: string): Promise<string> {
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const hash = poseidon([F.e(BigInt("0x" + Buffer.from(assetAddress).toString("hex")))]);
  return F.toString(hash);
}

/** Export for testing */
export { generateMatchId, hashAssetAddress };
