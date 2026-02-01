/**
 * Merkle tree inclusion proof using Poseidon hash
 * For RWA Dark Pool whitelist verification
 */
pragma circom 2.1.0;

include "circomlib/circuits/poseidon.circom";

/** Swaps inputs based on selector (sel=0: L,R | sel=1: R,L) */
template DualMux() {
    signal input L;
    signal input R;
    signal input sel;
    signal output outL;
    signal output outR;

    sel * (sel - 1) === 0;  // sel must be binary

    outL <== L + (R - L) * sel;
    outR <== R + (L - R) * sel;
}

/** Single level Merkle hash */
template MerkleLevel() {
    signal input left;
    signal input right;
    signal output parent;

    component h = Poseidon(2);
    h.inputs[0] <== left;
    h.inputs[1] <== right;
    parent <== h.out;
}

/** Full Merkle proof: computes root from leaf and path */
template MerkleTreeProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    component mux[levels];
    component hashers[levels];
    signal hashes[levels + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        mux[i] = DualMux();
        mux[i].L <== hashes[i];
        mux[i].R <== pathElements[i];
        mux[i].sel <== pathIndices[i];

        hashers[i] = MerkleLevel();
        hashers[i].left <== mux[i].outL;
        hashers[i].right <== mux[i].outR;

        hashes[i + 1] <== hashers[i].parent;
    }

    root <== hashes[levels];
}

/** Merkle verifier: constrains computed root to match expected */
template MerkleTreeVerifier(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input expectedRoot;

    component proof = MerkleTreeProof(levels);
    proof.leaf <== leaf;
    for (var i = 0; i < levels; i++) {
        proof.pathElements[i] <== pathElements[i];
        proof.pathIndices[i] <== pathIndices[i];
    }

    proof.root === expectedRoot;
}
