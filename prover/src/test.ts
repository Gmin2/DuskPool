/**
 * Test script for RWA Dark Pool prover
 * Run: npx ts-node src/test.ts
 */

import {
  generateOrderCommitment,
  buildWhitelistTree,
  generateSettlementProof,
  verifyProof,
  computeNullifier,
  OrderSide,
} from "./index";
import * as path from "path";

const WASM_PATH = path.join(__dirname, "../../circuits/build/settlement_proof_js/settlement_proof.wasm");
const ZKEY_PATH = path.join(__dirname, "../../circuits/build/settlement_proof_final.zkey");
const VK_PATH = path.join(__dirname, "../../circuits/build/verification_key.json");

async function testOrderCommitment() {
  console.log("\n=== Testing Order Commitment ===");

  const assetHash = BigInt("0x1234567890abcdef");

  const buyOrder = await generateOrderCommitment({
    assetHash,
    side: OrderSide.Buy,
    quantity: BigInt(100_000_000),
    price: BigInt(50_000_000),
  });

  console.log("Buy Order Commitment:", buyOrder.commitment);
  console.log("Buy Order Secret:", buyOrder.secret.toString(16).slice(0, 16) + "...");

  const sellOrder = await generateOrderCommitment({
    assetHash,
    side: OrderSide.Sell,
    quantity: BigInt(100_000_000),
    price: BigInt(50_000_000),
  });

  console.log("Sell Order Commitment:", sellOrder.commitment);
  console.log("Sell Order Secret:", sellOrder.secret.toString(16).slice(0, 16) + "...");

  return { buyOrder, sellOrder, assetHash };
}

async function testWhitelistTree() {
  console.log("\n=== Testing Whitelist Tree ===");

  /** Mock participant ID hashes */
  const participants = [
    "0x0000000000000000000000000000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000000000000000000000000000003",
  ];

  const { root, proofs } = await buildWhitelistTree(participants);

  console.log("Whitelist Root:", root);
  console.log("Number of proofs:", proofs.size);

  const proof0 = proofs.get(0);
  console.log("Proof for participant 0:");
  console.log("  ID Hash:", proof0?.idHash.slice(0, 20) + "...");
  console.log("  Path Elements:", proof0?.pathElements.length);

  return { root, proofs, participants };
}

async function testSettlementProof() {
  console.log("\n=== Testing Settlement Proof ===");

  /** Generate orders */
  const assetHash = BigInt("0x1234567890abcdef");

  const buyOrder = await generateOrderCommitment({
    assetHash,
    side: OrderSide.Buy,
    quantity: BigInt(100_000_000),
    price: BigInt(50_000_000),
  });

  const sellOrder = await generateOrderCommitment({
    assetHash,
    side: OrderSide.Sell,
    quantity: BigInt(100_000_000),
    price: BigInt(50_000_000),
  });

  /** Build whitelist */
  const participants = [
    "0x0000000000000000000000000000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000000000000000000000000000002",
  ];

  const { root, proofs } = await buildWhitelistTree(participants);

  const buyerProof = proofs.get(0)!;
  const sellerProof = proofs.get(1)!;

  /** Generate settlement proof */
  console.log("Generating settlement proof...");
  console.log("(This may take a while on first run)");

  try {
    const settlementProof = await generateSettlementProof(
      {
        buyerIdHash: buyerProof.idHash,
        buyerMerkleProof: buyerProof,
        sellerIdHash: sellerProof.idHash,
        sellerMerkleProof: sellerProof,
        buyOrderSecret: buyOrder.secret,
        buyOrderNonce: buyOrder.nonce,
        sellOrderSecret: sellOrder.secret,
        sellOrderNonce: sellOrder.nonce,
        buyCommitment: buyOrder.commitment,
        sellCommitment: sellOrder.commitment,
        assetHash: assetHash.toString(),
        matchedQuantity: BigInt(100_000_000),
        executionPrice: BigInt(50_000_000),
        whitelistRoot: root,
      },
      WASM_PATH,
      ZKEY_PATH
    );

    console.log("Proof generated!");
    console.log("Nullifier Hash:", settlementProof.nullifierHash);
    console.log("Proof bytes size:", settlementProof.proofBytes.length);
    console.log("Signals bytes size:", settlementProof.signalsBytes.length);

    /** Verify proof */
    console.log("\nVerifying proof...");
    const valid = await verifyProof(settlementProof.proof, settlementProof.publicSignals, VK_PATH);
    console.log("Proof valid:", valid);

    return settlementProof;
  } catch (error: any) {
    console.error("Proof generation failed:", error.message);
    console.log("\nMake sure circuits are built. See circuits/README.md for instructions.");
    return null;
  }
}

async function testNullifier() {
  console.log("\n=== Testing Nullifier Computation ===");

  const buyCommitment = "12345678901234567890";
  const sellCommitment = "98765432109876543210";
  const quantity = BigInt(100_000_000);
  const buyerSecret = BigInt("0x1111111111111111");
  const sellerSecret = BigInt("0x2222222222222222");

  const nullifier = await computeNullifier(
    buyCommitment,
    sellCommitment,
    quantity,
    buyerSecret,
    sellerSecret
  );

  console.log("Nullifier:", nullifier);

  /** Same inputs should produce same nullifier */
  const nullifier2 = await computeNullifier(
    buyCommitment,
    sellCommitment,
    quantity,
    buyerSecret,
    sellerSecret
  );

  console.log("Deterministic:", nullifier === nullifier2);
}

async function main() {
  console.log("RWA Dark Pool - Prover Tests");
  console.log("============================");

  await testOrderCommitment();
  await testWhitelistTree();
  await testNullifier();

  /** Only run if circuits are built */
  const fs = await import("fs");
  if (fs.existsSync(WASM_PATH) && fs.existsSync(ZKEY_PATH)) {
    await testSettlementProof();
  } else {
    console.log("\n=== Skipping Settlement Proof Test ===");
    console.log("Circuits not built. See circuits/README.md for build instructions.");
  }

  console.log("\n=== All tests complete ===");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
