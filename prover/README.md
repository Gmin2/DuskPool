# Prover

TypeScript library for generating ZK proofs compatible with the settlement contract.

## Installation

```bash
pnpm install
```

## Usage

The library provides functions for order commitment generation, whitelist tree building, and settlement proof generation.

### Generate Order Commitment

```typescript
import { generateOrderCommitment, OrderSide } from "./src/index";

const order = await generateOrderCommitment({
  assetHash: BigInt("0x..."),
  side: OrderSide.Buy,
  quantity: BigInt(100_000_000),
  price: BigInt(50_000_000),
});
// Returns: { commitment, secret, nonce }
```

### Build Whitelist Tree

```typescript
import { buildWhitelistTree } from "./src/index";

const participants = [
  "0x0000...0001",  // participant ID hash
  "0x0000...0002",
];

const { root, proofs } = await buildWhitelistTree(participants);
// proofs.get(0) returns Merkle proof for first participant
```

### Generate Settlement Proof

```typescript
import { generateSettlementProof, verifyProof } from "./src/index";

const proof = await generateSettlementProof(
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
  "path/to/settlement_proof.wasm",
  "path/to/settlement_proof_final.zkey"
);

// Verify locally
const valid = await verifyProof(proof.proof, proof.publicSignals, "path/to/verification_key.json");
```

## Testing

Run the test script:
```bash
pnpm test
```

This tests order commitment generation, whitelist tree building, and optionally settlement proof generation if circuits are built.

## Output Format

The `generateSettlementProof` function returns proof and signals in Soroban-compatible format:
- `proofBytes`: 256 bytes (A + B + C points)
- `signalsBytes`: 4-byte length prefix + 32 bytes per signal

These can be passed directly to the settlement contract's `settle_trade` function.
