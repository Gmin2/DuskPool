# Contracts

Soroban smart contracts for the RWA Dark Pool.

## Building

From the project root:
```bash
stellar contract build
```

This produces WASM files in `target/wasm32v1-none/release/`.

## Contracts

### Verifier

Generic BN254 Groth16 proof verifier using Stellar X-Ray Protocol primitives. Takes a verification key, proof, and public signals, returns true if the proof is valid.

Address: `CBSNZSSJ6EEJAEGMGVJHS3JCHQMQMA4COKJ7KE7U6MZGIKVNKOQJFNSJ`

### Registry

Manages whitelisted participants and registered RWA assets. Stores participant KYC data with a Merkle tree root for ZK proofs. Admin can register/deactivate participants and assets.

Address: `CAYHF7YE6JIQYWJPXCJO6KAJVFPFYHNERIU5IYUR3VGRZQTEI4D6SQRZ`

### Orderbook

Stores hidden order commitments. Traders submit Poseidon hash commitments of their orders without revealing price or quantity. The matching engine records matches which are then settled with ZK proofs.

Address: `CA2KQFACY34RAIQTJAKBOGB3UPKPKDSLL2LFVZVQQZC4DPFDFDBW5FIP`

### Settlement

Handles deposits, escrow, and ZK-verified trade settlement. Users deposit tokens to escrow, lock funds for orders, and settle trades by providing a valid ZK proof. Uses nullifiers to prevent double-settlement.

Address: `CBD24SR5QAAQOBZ3D56V3NKDHRRGRHO4PZONQ3VNOJF3IDAYEUBC45TJ`

## Deployment

Deploy to testnet:
```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/groth16_verifier_bn254.wasm \
  --source-account admin \
  --network testnet
```

Initialize settlement with verification key:
```bash
stellar contract invoke --id <settlement_id> --source-account admin --network testnet -- \
  __constructor \
  --admin <admin_address> \
  --verifier_address <verifier_id> \
  --registry_address <registry_id> \
  --settlement_vk_bytes <vk_hex>
```

## Network

All addresses above are on Stellar testnet.
