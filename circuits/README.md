# Circuits

Circom ZK circuits for settlement proof generation.

## Overview

The settlement circuit proves that a trade is valid without revealing order details. It verifies that both buyer and seller are in the whitelist Merkle tree, their order commitments match the claimed parameters, and the trade terms (asset, quantity, price) are consistent between both orders.

The circuit outputs a nullifier hash to prevent the same orders from being settled twice.

## Prerequisites

Install circom 2.x and snarkjs:
```bash
npm install -g snarkjs
```

For circom installation, see https://docs.circom.io/getting-started/installation/

## Powers of Tau

The powers of tau file is required for the trusted setup but not included in the repo due to its size (1.1 GB). Download it before building:

```bash
cd circuits
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau -O pot20_final.ptau
```

Alternatively, use a smaller ptau file for testing (pot15 or pot16), but pot20 is required for the full circuit with 23k constraints.

## Building

### Manual Build Steps

Compile the circuit:
```bash
cd settlement
circom settlement_proof.circom --r1cs --wasm --sym -o ../build
```

Generate the proving key:
```bash
cd ../build
snarkjs groth16 setup settlement_proof.r1cs ../pot20_final.ptau settlement_proof_0000.zkey
```

Contribute to the ceremony:
```bash
snarkjs zkey contribute settlement_proof_0000.zkey settlement_proof_final.zkey --name="contributor"
```

Export the verification key:
```bash
snarkjs zkey export verificationkey settlement_proof_final.zkey verification_key.json
```

## Circuit Details

The settlement circuit has a tree depth of 20, supporting up to 1 million whitelisted participants.

Public inputs: buyCommitment, sellCommitment, assetHash, matchedQuantity, executionPrice, whitelistRoot

Public output: nullifierHash

Private inputs: buyer/seller ID hashes, Merkle proofs, order secrets and nonces

## Output Files

After building, the `build/` directory contains:
- `settlement_proof.r1cs` - constraint system
- `settlement_proof_js/` - WASM witness generator
- `settlement_proof_final.zkey` - proving key
- `verification_key.json` - verification key for on-chain verifier

## Exporting VK for Soroban

Use the export script to convert the verification key to hex bytes:
```bash
cd ../scripts
npx ts-node export-vk.ts
```

This creates `circuits/build/vk_bytes.hex` for use with the settlement contract.
