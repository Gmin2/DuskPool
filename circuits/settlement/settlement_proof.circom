/**
 * Settlement Proof Circuit for RWA Dark Pool
 *
 * Verifies:
 * 1. Buyer and seller are on the whitelist (Merkle proofs)
 * 2. Order commitments are valid
 * 3. Trade details match commitments
 * 4. Nullifier is correctly computed
 *
 * Compatible with Stellar X-Ray Protocol (BN254)
 */
pragma circom 2.1.0;

include "circomlib/circuits/poseidon.circom";
include "../merkle/merkle_proof.circom";

/**
 * Settlement Proof Template
 * @param TREE_DEPTH - Whitelist Merkle tree depth (matches registry)
 */
template SettlementProof(TREE_DEPTH) {
    /** PRIVATE INPUTS (known only to prover) */

    /** Buyer's whitelist proof */
    signal input buyerIdHash;
    signal input buyerMerkleProof[TREE_DEPTH];
    signal input buyerMerkleIndices[TREE_DEPTH];

    /** Seller's whitelist proof */
    signal input sellerIdHash;
    signal input sellerMerkleProof[TREE_DEPTH];
    signal input sellerMerkleIndices[TREE_DEPTH];

    /** Order secrets for commitment verification */
    signal input buyOrderSecret;
    signal input buyOrderNonce;
    signal input sellOrderSecret;
    signal input sellOrderNonce;

    /** PUBLIC INPUTS (visible on-chain) */
    signal input buyCommitment;
    signal input sellCommitment;
    signal input assetHash;
    signal input matchedQuantity;
    signal input executionPrice;
    signal input whitelistRoot;

    /** PUBLIC OUTPUT */
    signal output nullifierHash;

    /** 1. Verify buyer is on whitelist */
    component buyerMerkle = MerkleTreeVerifier(TREE_DEPTH);
    buyerMerkle.leaf <== buyerIdHash;
    for (var i = 0; i < TREE_DEPTH; i++) {
        buyerMerkle.pathElements[i] <== buyerMerkleProof[i];
        buyerMerkle.pathIndices[i] <== buyerMerkleIndices[i];
    }
    buyerMerkle.expectedRoot <== whitelistRoot;

    /** 2. Verify seller is on whitelist */
    component sellerMerkle = MerkleTreeVerifier(TREE_DEPTH);
    sellerMerkle.leaf <== sellerIdHash;
    for (var i = 0; i < TREE_DEPTH; i++) {
        sellerMerkle.pathElements[i] <== sellerMerkleProof[i];
        sellerMerkle.pathIndices[i] <== sellerMerkleIndices[i];
    }
    sellerMerkle.expectedRoot <== whitelistRoot;

    /** 3. Verify buy order commitment: Poseidon(asset, side=0, qty, price, nonce, secret) */
    component buyCommitHasher = Poseidon(6);
    buyCommitHasher.inputs[0] <== assetHash;
    buyCommitHasher.inputs[1] <== 0;
    buyCommitHasher.inputs[2] <== matchedQuantity;
    buyCommitHasher.inputs[3] <== executionPrice;
    buyCommitHasher.inputs[4] <== buyOrderNonce;
    buyCommitHasher.inputs[5] <== buyOrderSecret;
    buyCommitHasher.out === buyCommitment;

    /** 4. Verify sell order commitment: Poseidon(asset, side=1, qty, price, nonce, secret) */
    component sellCommitHasher = Poseidon(6);
    sellCommitHasher.inputs[0] <== assetHash;
    sellCommitHasher.inputs[1] <== 1;
    sellCommitHasher.inputs[2] <== matchedQuantity;
    sellCommitHasher.inputs[3] <== executionPrice;
    sellCommitHasher.inputs[4] <== sellOrderNonce;
    sellCommitHasher.inputs[5] <== sellOrderSecret;
    sellCommitHasher.out === sellCommitment;

    /** 5. Compute nullifier: Poseidon(buyCommit, sellCommit, qty, combinedSecret) */
    component nullifierHasher = Poseidon(4);
    nullifierHasher.inputs[0] <== buyCommitment;
    nullifierHasher.inputs[1] <== sellCommitment;
    nullifierHasher.inputs[2] <== matchedQuantity;
    nullifierHasher.inputs[3] <== buyOrderSecret + sellOrderSecret;
    nullifierHash <== nullifierHasher.out;
}

/** Tree depth = 20 (supports up to 2^20 = 1M participants) */
component main {public [
    buyCommitment,
    sellCommitment,
    assetHash,
    matchedQuantity,
    executionPrice,
    whitelistRoot
]} = SettlementProof(20);
