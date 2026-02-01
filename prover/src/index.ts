/**
 * RWA Dark Pool - ZK Proof Generation Library
 * Uses snarkjs + circomlibjs for BN254 Groth16 proofs
 * Compatible with Stellar X-Ray Protocol
 */

import * as snarkjs from "snarkjs";
// @ts-ignore - circomlibjs has no type declarations
import { buildPoseidon } from "circomlibjs";
import * as fs from "fs";
import * as path from "path";

/** Circuit tree depth - must match settlement_proof.circom */
const TREE_DEPTH = 20;

/** Poseidon instance (lazy initialized) */
let poseidon: any = null;
let F: any = null;

/** Initialize Poseidon hash function */
async function initPoseidon() {
  if (!poseidon) {
    poseidon = await buildPoseidon();
    F = poseidon.F;
  }
  return { poseidon, F };
}

/** Order side enum */
export enum OrderSide {
  Buy = 0,
  Sell = 1,
}

/** Order commitment parameters */
export interface OrderParams {
  assetHash: bigint;
  side: OrderSide;
  quantity: bigint;
  price: bigint;
}

/** Generated order commitment */
export interface OrderCommitment {
  commitment: string;
  secret: bigint;
  nonce: bigint;
}

/** Merkle proof for whitelist membership */
export interface MerkleProof {
  idHash: string;
  pathElements: string[];
  pathIndices: number[];
}

/** Trade settlement parameters */
export interface TradeParams {
  buyerIdHash: string;
  buyerMerkleProof: MerkleProof;
  sellerIdHash: string;
  sellerMerkleProof: MerkleProof;
  buyOrderSecret: bigint;
  buyOrderNonce: bigint;
  sellOrderSecret: bigint;
  sellOrderNonce: bigint;
  buyCommitment: string;
  sellCommitment: string;
  assetHash: string;
  matchedQuantity: bigint;
  executionPrice: bigint;
  whitelistRoot: string;
}

/** Generated settlement proof */
export interface SettlementProof {
  proof: any;
  publicSignals: string[];
  nullifierHash: string;
  proofBytes: Buffer;
  signalsBytes: Buffer;
}

/**
 * Generate order commitment using Poseidon hash
 * commitment = Poseidon(assetHash, side, quantity, price, nonce, secret)
 */
export async function generateOrderCommitment(params: OrderParams): Promise<OrderCommitment> {
  const { poseidon, F } = await initPoseidon();

  const secret = BigInt("0x" + randomBytes(32));
  const nonce = BigInt("0x" + randomBytes(32));

  const commitment = poseidon([
    F.e(params.assetHash),
    F.e(params.side),
    F.e(params.quantity),
    F.e(params.price),
    F.e(nonce),
    F.e(secret),
  ]);

  return {
    commitment: F.toString(commitment),
    secret,
    nonce,
  };
}

/**
 * Compute Poseidon hash of asset address
 */
export async function hashAsset(assetAddress: string): Promise<string> {
  const { poseidon, F } = await initPoseidon();
  const hash = poseidon([F.e(BigInt("0x" + Buffer.from(assetAddress).toString("hex")))]);
  return F.toString(hash);
}

/**
 * Build whitelist Merkle tree and generate proofs
 * Uses binary Merkle tree with Poseidon hash to match circuit
 * Efficiently handles small participant lists by extending with zeros
 */
export async function buildWhitelistTree(participants: string[]): Promise<{
  root: string;
  proofs: Map<number, MerkleProof>;
}> {
  const { poseidon, F } = await initPoseidon();

  /** Compute leaf hashes (idHash for each participant) */
  const leaves: bigint[] = [];
  for (let i = 0; i < participants.length; i++) {
    const idHash = poseidon([F.e(BigInt(participants[i]))]);
    leaves.push(F.toObject(idHash));
  }

  /** Compute actual tree depth needed */
  const actualDepth = Math.max(1, Math.ceil(Math.log2(Math.max(2, leaves.length))));

  /** Pad leaves to next power of 2 */
  const numLeaves = Math.pow(2, actualDepth);
  while (leaves.length < numLeaves) {
    leaves.push(0n);
  }

  /** Precompute zeros: zeros[i] = Poseidon(zeros[i-1], zeros[i-1]) */
  const zeros: bigint[] = [0n];
  for (let i = 1; i <= TREE_DEPTH; i++) {
    const zeroHash = poseidon([F.e(zeros[i - 1]), F.e(zeros[i - 1])]);
    zeros.push(F.toObject(zeroHash));
  }

  /** Build the actual tree bottom-up */
  const treeLevels: bigint[][] = [leaves];
  let currentLevel = leaves;

  for (let level = 0; level < actualDepth; level++) {
    const nextLevel: bigint[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1];
      const parent = poseidon([F.e(left), F.e(right)]);
      nextLevel.push(F.toObject(parent));
    }
    treeLevels.push(nextLevel);
    currentLevel = nextLevel;
  }

  /** Extend root to TREE_DEPTH by hashing with zero subtrees */
  let extendedRoot = currentLevel[0];
  for (let level = actualDepth; level < TREE_DEPTH; level++) {
    extendedRoot = F.toObject(poseidon([F.e(extendedRoot), F.e(zeros[level])]));
  }

  /** Generate proofs for each participant */
  const proofs = new Map<number, MerkleProof>();

  for (let i = 0; i < participants.length; i++) {
    const pathElements: string[] = [];
    const pathIndices: number[] = [];
    let index = i;

    /** Walk up the actual tree */
    for (let level = 0; level < actualDepth; level++) {
      const isRight = index % 2 === 1;
      const siblingIndex = isRight ? index - 1 : index + 1;
      const sibling = treeLevels[level][siblingIndex];

      pathElements.push(sibling.toString());
      pathIndices.push(isRight ? 1 : 0);

      index = Math.floor(index / 2);
    }

    /** Extend with zero subtrees (always on the right, so pathIndices = 0) */
    for (let level = actualDepth; level < TREE_DEPTH; level++) {
      pathElements.push(zeros[level].toString());
      pathIndices.push(0);
    }

    proofs.set(i, {
      idHash: leaves[i].toString(),
      pathElements,
      pathIndices,
    });
  }

  return {
    root: extendedRoot.toString(),
    proofs,
  };
}

/**
 * Generate settlement proof
 */
export async function generateSettlementProof(
  params: TradeParams,
  wasmPath: string,
  zkeyPath: string
): Promise<SettlementProof> {
  const { F } = await initPoseidon();

  /** Prepare circuit input */
  const input = {
    /** Private inputs - Buyer whitelist proof */
    buyerIdHash: params.buyerIdHash,
    buyerMerkleProof: params.buyerMerkleProof.pathElements,
    buyerMerkleIndices: params.buyerMerkleProof.pathIndices,

    /** Private inputs - Seller whitelist proof */
    sellerIdHash: params.sellerIdHash,
    sellerMerkleProof: params.sellerMerkleProof.pathElements,
    sellerMerkleIndices: params.sellerMerkleProof.pathIndices,

    /** Private inputs - Order secrets */
    buyOrderSecret: params.buyOrderSecret.toString(),
    buyOrderNonce: params.buyOrderNonce.toString(),
    sellOrderSecret: params.sellOrderSecret.toString(),
    sellOrderNonce: params.sellOrderNonce.toString(),

    /** Public inputs */
    buyCommitment: params.buyCommitment,
    sellCommitment: params.sellCommitment,
    assetHash: params.assetHash,
    matchedQuantity: params.matchedQuantity.toString(),
    executionPrice: params.executionPrice.toString(),
    whitelistRoot: params.whitelistRoot,
  };

  /** Generate proof */
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);

  /** Convert for Soroban */
  const { proofBytes, signalsBytes } = convertProofForSoroban(proof, publicSignals);

  /** Nullifier is the last public signal (output) */
  const nullifierHash = publicSignals[publicSignals.length - 1];

  return {
    proof,
    publicSignals,
    nullifierHash,
    proofBytes,
    signalsBytes,
  };
}

/**
 * Verify proof locally
 */
export async function verifyProof(
  proof: any,
  publicSignals: string[],
  vkPath: string
): Promise<boolean> {
  const vKey = JSON.parse(fs.readFileSync(vkPath, "utf-8"));
  return await snarkjs.groth16.verify(vKey, publicSignals, proof);
}

/**
 * Convert proof to Soroban-compatible format
 */
export function convertProofForSoroban(
  proof: any,
  publicSignals: string[]
): { proofBytes: Buffer; signalsBytes: Buffer } {
  /** Helper to convert field element to 32-byte hex */
  function toBytes32(value: string): string {
    return BigInt(value).toString(16).padStart(64, "0");
  }

  /** Helper to convert G1 point to bytes (64 bytes) */
  function g1ToBytes(point: string[]): string {
    const x = toBytes32(point[0]);
    const y = toBytes32(point[1]);
    return x + y;
  }

  /** Helper to convert G2 point to bytes (128 bytes) */
  function g2ToBytes(point: string[][]): string {
    /** G2 points have Fp2 coordinates: [[x0, x1], [y0, y1]] */
    /** Soroban expects: x1 || x0 || y1 || y0 */
    const x1 = toBytes32(point[0][1]);
    const x0 = toBytes32(point[0][0]);
    const y1 = toBytes32(point[1][1]);
    const y0 = toBytes32(point[1][0]);
    return x1 + x0 + y1 + y0;
  }

  /** Build proof bytes: A (64) + B (128) + C (64) = 256 bytes */
  const proofHex = g1ToBytes(proof.pi_a) + g2ToBytes(proof.pi_b) + g1ToBytes(proof.pi_c);

  /** Build public signals bytes: 4-byte length + each 32 bytes */
  const numSignals = publicSignals.length;
  const lengthHex = numSignals.toString(16).padStart(8, "0");
  const signalsHex = lengthHex + publicSignals.map((s) => toBytes32(s)).join("");

  return {
    proofBytes: Buffer.from(proofHex, "hex"),
    signalsBytes: Buffer.from(signalsHex, "hex"),
  };
}

/**
 * Compute nullifier hash
 */
export async function computeNullifier(
  buyCommitment: string,
  sellCommitment: string,
  quantity: bigint,
  buyerSecret: bigint,
  sellerSecret: bigint
): Promise<string> {
  const { poseidon, F } = await initPoseidon();

  const nullifier = poseidon([
    F.e(BigInt(buyCommitment)),
    F.e(BigInt(sellCommitment)),
    F.e(quantity),
    F.e(buyerSecret + sellerSecret),
  ]);

  return F.toString(nullifier);
}

/**
 * Get path indices from leaf index
 */
function getPathIndices(index: bigint, levels: number): number[] {
  const indices: number[] = [];
  let k = index;
  for (let i = 0; i < levels; i++) {
    indices.push(Number(k & 1n));
    k = k >> 1n;
  }
  return indices;
}

/**
 * Generate random bytes as hex string
 */
function randomBytes(length: number): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    /** Node.js fallback */
    const nodeCrypto = require("crypto");
    const buf = nodeCrypto.randomBytes(length);
    bytes.set(buf);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

