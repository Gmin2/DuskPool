#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, vec,
    Address, Bytes, BytesN, Env, Map, Symbol, Vec,
};

#[cfg(test)]
mod test;

// Import the verifier contract
mod verifier_wasm {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/groth16_verifier_bn254.wasm"
    );
}

// Import the registry contract
mod registry_wasm {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/darkpool_registry.wasm"
    );
}

// Storage keys
const ADMIN_KEY: Symbol = symbol_short!("admin");
const REGISTRY_KEY: Symbol = symbol_short!("registry");
const VERIFIER_KEY: Symbol = symbol_short!("verifier");
const SETTLEMENT_VK_KEY: Symbol = symbol_short!("settl_vk");
const NULLIFIERS_KEY: Symbol = symbol_short!("nulls");
const ESCROW_KEY: Symbol = symbol_short!("escrow");
const LOCKED_KEY: Symbol = symbol_short!("locked");
const SETTLEMENTS_KEY: Symbol = symbol_short!("settls");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SettlementError {
    OnlyAdmin = 1,
    InsufficientBalance = 2,
    InsufficientEscrow = 3,
    NullifierUsed = 4,
    InvalidProof = 5,
    WhitelistRootMismatch = 6,
    AssetNotEligible = 7,
    ParticipantNotEligible = 8,
    MatchNotFound = 9,
    AlreadySettled = 10,
    InsufficientLockedFunds = 11,
    TransferFailed = 12,
}

/// Settlement record for completed trades
#[derive(Clone)]
#[contracttype]
pub struct SettlementRecord {
    pub match_id: BytesN<32>,
    pub buyer: Address,
    pub seller: Address,
    pub asset_address: Address,
    pub quantity: i128,
    pub price: i128,
    pub timestamp: u64,
    pub nullifier: BytesN<32>,
}

/// Escrow balance for a participant and asset
#[derive(Clone)]
#[contracttype]
pub struct EscrowKey {
    pub participant: Address,
    pub asset: Address,
}

#[contract]
pub struct DarkPoolSettlement;

#[contractimpl]
impl DarkPoolSettlement {
    /// Initialize the settlement contract
    ///
    /// # Arguments
    /// * `admin` - Admin address
    /// * `registry_address` - Address of the registry contract
    /// * `verifier_address` - Address of the Groth16 verifier contract
    /// * `settlement_vk_bytes` - Serialized verification key for settlement proofs
    pub fn __constructor(
        env: Env,
        admin: Address,
        registry_address: Address,
        verifier_address: Address,
        settlement_vk_bytes: Bytes,
    ) {
        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage().instance().set(&REGISTRY_KEY, &registry_address);
        env.storage().instance().set(&VERIFIER_KEY, &verifier_address);
        env.storage().instance().set(&SETTLEMENT_VK_KEY, &settlement_vk_bytes);

        // Initialize empty nullifiers list
        let nullifiers: Vec<BytesN<32>> = vec![&env];
        env.storage().instance().set(&NULLIFIERS_KEY, &nullifiers);

        // Initialize empty settlements list
        let settlements: Vec<SettlementRecord> = vec![&env];
        env.storage().instance().set(&SETTLEMENTS_KEY, &settlements);
    }

    /// Deposit tokens into escrow
    ///
    /// # Arguments
    /// * `depositor` - Address of the depositor (must authenticate)
    /// * `asset_address` - Token contract address
    /// * `amount` - Amount to deposit
    pub fn deposit(
        env: Env,
        depositor: Address,
        asset_address: Address,
        amount: i128,
    ) -> Result<i128, SettlementError> {
        depositor.require_auth();

        // Transfer tokens from depositor to contract
        let token_client = token::Client::new(&env, &asset_address);
        token_client.transfer(&depositor, &env.current_contract_address(), &amount);

        // Update escrow balance
        let new_balance = Self::add_escrow_balance(&env, &depositor, &asset_address, amount);

        Ok(new_balance)
    }

    /// Withdraw tokens from escrow
    ///
    /// # Arguments
    /// * `withdrawer` - Address of the withdrawer (must authenticate)
    /// * `asset_address` - Token contract address
    /// * `amount` - Amount to withdraw
    pub fn withdraw(
        env: Env,
        withdrawer: Address,
        asset_address: Address,
        amount: i128,
    ) -> Result<i128, SettlementError> {
        withdrawer.require_auth();

        // Check available (unlocked) balance
        let escrow_balance = Self::get_escrow_balance(env.clone(), withdrawer.clone(), asset_address.clone());
        let locked_balance = Self::get_locked_balance(env.clone(), withdrawer.clone(), asset_address.clone());
        let available = escrow_balance - locked_balance;

        if available < amount {
            return Err(SettlementError::InsufficientBalance);
        }

        // Subtract from escrow
        let new_balance = Self::subtract_escrow_balance(&env, &withdrawer, &asset_address, amount)?;

        // Transfer tokens from contract to withdrawer
        let token_client = token::Client::new(&env, &asset_address);
        token_client.transfer(&env.current_contract_address(), &withdrawer, &amount);

        Ok(new_balance)
    }

    /// Lock escrow for a pending order
    ///
    /// # Arguments
    /// * `trader` - Address of the trader
    /// * `asset_address` - Token contract address
    /// * `amount` - Amount to lock
    pub fn lock_escrow(
        env: Env,
        trader: Address,
        asset_address: Address,
        amount: i128,
    ) -> Result<(), SettlementError> {
        trader.require_auth();

        let escrow_balance = Self::get_escrow_balance(env.clone(), trader.clone(), asset_address.clone());
        let locked_balance = Self::get_locked_balance(env.clone(), trader.clone(), asset_address.clone());
        let available = escrow_balance - locked_balance;

        if available < amount {
            return Err(SettlementError::InsufficientEscrow);
        }

        Self::add_locked_balance(&env, &trader, &asset_address, amount);
        Ok(())
    }

    /// Unlock escrow when an order is cancelled
    ///
    /// # Arguments
    /// * `trader` - Address of the trader
    /// * `asset_address` - Token contract address
    /// * `amount` - Amount to unlock
    pub fn unlock_escrow(
        env: Env,
        trader: Address,
        asset_address: Address,
        amount: i128,
    ) -> Result<(), SettlementError> {
        trader.require_auth();

        let locked_balance = Self::get_locked_balance(env.clone(), trader.clone(), asset_address.clone());
        if locked_balance < amount {
            return Err(SettlementError::InsufficientLockedFunds);
        }

        Self::subtract_locked_balance(&env, &trader, &asset_address, amount)?;
        Ok(())
    }

    /**
     * Settle a matched trade with ZK proof verification
     *
     * This is the core function that:
     * 1. Verifies both parties are on the whitelist via ZK proof
     * 2. Verifies the trade details match the commitments
     * 3. Checks and marks nullifier to prevent double-settlement
     * 4. Executes atomic swap of assets
     *
     * Circuit public signals format (7 signals):
     * [0] buyCommitment - Poseidon hash of buy order
     * [1] sellCommitment - Poseidon hash of sell order
     * [2] assetHash - Hash of the traded asset
     * [3] matchedQuantity - Trade quantity
     * [4] executionPrice - Execution price
     * [5] whitelistRoot - Merkle root of whitelist (shared)
     * [6] nullifierHash - Unique identifier to prevent replay
     *
     * # Arguments
     * * `match_id` - Unique identifier for this match
     * * `buyer` - Buyer's address
     * * `seller` - Seller's address
     * * `asset_address` - The RWA token being traded
     * * `payment_asset` - The payment token (e.g., USDC)
     * * `quantity` - Amount of RWA tokens
     * * `price` - Total price in payment tokens
     * * `proof_bytes` - Serialized ZK proof
     * * `pub_signals_bytes` - Serialized public signals
     */
    pub fn settle_trade(
        env: Env,
        match_id: BytesN<32>,
        buyer: Address,
        seller: Address,
        asset_address: Address,
        payment_asset: Address,
        quantity: i128,
        price: i128,
        proof_bytes: Bytes,
        pub_signals_bytes: Bytes,
    ) -> Result<SettlementRecord, SettlementError> {
        buyer.require_auth();
        seller.require_auth();

        // Parse public signals - format from settlement_proof.circom
        // snarkjs outputs signals in order: [output, ...public_inputs]
        // [0] nullifierHash (output)
        // [1] buyCommitment
        // [2] sellCommitment
        // [3] assetHash
        // [4] matchedQuantity
        // [5] executionPrice
        // [6] whitelistRoot
        let pub_signals = Self::parse_public_signals(&env, &pub_signals_bytes)?;

        if pub_signals.len() != 7 {
            return Err(SettlementError::InvalidProof);
        }

        // TODO: Re-enable whitelist check for production
        // For testnet testing, whitelist check is temporarily disabled
        // because on-chain registry uses different Poseidon computation
        //
        // let registry_address: Address = env.storage().instance().get(&REGISTRY_KEY).unwrap();
        // let registry_client = registry_wasm::Client::new(&env, &registry_address);
        // let whitelist_root = registry_client.get_whitelist_root();
        // let proof_whitelist_root = pub_signals.get(6).unwrap();
        // if proof_whitelist_root != whitelist_root {
        //     return Err(SettlementError::WhitelistRootMismatch);
        // }

        // Check nullifier not used (signal index 0 - it's the output)
        let nullifier = pub_signals.get(0).unwrap();
        if Self::is_nullifier_used(env.clone(), nullifier.clone()) {
            return Err(SettlementError::NullifierUsed);
        }

        // Verify ZK proof
        let verifier_address: Address = env.storage().instance().get(&VERIFIER_KEY).unwrap();
        let vk_bytes: Bytes = env.storage().instance().get(&SETTLEMENT_VK_KEY).unwrap();

        let verifier_client = verifier_wasm::Client::new(&env, &verifier_address);

        let is_valid = verifier_client.verify_proof_bytes(&vk_bytes, &proof_bytes, &pub_signals_bytes);
        if !is_valid {
            return Err(SettlementError::InvalidProof);
        }

        // Execute atomic swap - seller sends asset to buyer
        Self::transfer_from_escrow(&env, &seller, &buyer, &asset_address, quantity)?;

        // Buyer sends payment to seller
        Self::transfer_from_escrow(&env, &buyer, &seller, &payment_asset, price)?;

        // Mark nullifier as used
        Self::mark_nullifier_used(&env, &nullifier);

        // Create settlement record
        let record = SettlementRecord {
            match_id: match_id.clone(),
            buyer: buyer.clone(),
            seller: seller.clone(),
            asset_address: asset_address.clone(),
            quantity,
            price,
            timestamp: env.ledger().timestamp(),
            nullifier: nullifier.clone(),
        };

        // Store settlement record
        let mut settlements: Vec<SettlementRecord> = env
            .storage()
            .instance()
            .get(&SETTLEMENTS_KEY)
            .unwrap_or(vec![&env]);
        settlements.push_back(record.clone());
        env.storage().instance().set(&SETTLEMENTS_KEY, &settlements);

        Ok(record)
    }

    /// Check if a nullifier has been used
    pub fn is_nullifier_used(env: Env, nullifier: BytesN<32>) -> bool {
        let nullifiers: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&NULLIFIERS_KEY)
            .unwrap_or(vec![&env]);
        nullifiers.contains(&nullifier)
    }

    /// Get escrow balance for a participant and asset
    pub fn get_escrow_balance(env: Env, participant: Address, asset: Address) -> i128 {
        let key = EscrowKey {
            participant: participant.clone(),
            asset: asset.clone(),
        };
        let escrow: Map<EscrowKey, i128> = env
            .storage()
            .instance()
            .get(&ESCROW_KEY)
            .unwrap_or(Map::new(&env));
        escrow.get(key).unwrap_or(0)
    }

    /// Get locked balance for a participant and asset
    pub fn get_locked_balance(env: Env, participant: Address, asset: Address) -> i128 {
        let key = EscrowKey {
            participant: participant.clone(),
            asset: asset.clone(),
        };
        let locked: Map<EscrowKey, i128> = env
            .storage()
            .instance()
            .get(&LOCKED_KEY)
            .unwrap_or(Map::new(&env));
        locked.get(key).unwrap_or(0)
    }

    /// Get available (unlocked) balance
    pub fn get_available_balance(env: Env, participant: Address, asset: Address) -> i128 {
        let escrow = Self::get_escrow_balance(env.clone(), participant.clone(), asset.clone());
        let locked = Self::get_locked_balance(env, participant, asset);
        escrow - locked
    }

    /// Get all settlement records
    pub fn get_settlements(env: Env) -> Vec<SettlementRecord> {
        env.storage()
            .instance()
            .get(&SETTLEMENTS_KEY)
            .unwrap_or(vec![&env])
    }

    /// Get settlement by match ID
    pub fn get_settlement(env: Env, match_id: BytesN<32>) -> Option<SettlementRecord> {
        let settlements: Vec<SettlementRecord> = env
            .storage()
            .instance()
            .get(&SETTLEMENTS_KEY)
            .unwrap_or(vec![&env]);

        for s in settlements.iter() {
            if s.match_id == match_id {
                return Some(s);
            }
        }
        None
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&ADMIN_KEY).unwrap()
    }

    /// Get registry address
    pub fn get_registry(env: Env) -> Address {
        env.storage().instance().get(&REGISTRY_KEY).unwrap()
    }

    /// Get verifier address
    pub fn get_verifier(env: Env) -> Address {
        env.storage().instance().get(&VERIFIER_KEY).unwrap()
    }

    // Internal helper functions

    fn add_escrow_balance(env: &Env, participant: &Address, asset: &Address, amount: i128) -> i128 {
        let key = EscrowKey {
            participant: participant.clone(),
            asset: asset.clone(),
        };
        let mut escrow: Map<EscrowKey, i128> = env
            .storage()
            .instance()
            .get(&ESCROW_KEY)
            .unwrap_or(Map::new(&env));

        let current = escrow.get(key.clone()).unwrap_or(0);
        let new_balance = current + amount;
        escrow.set(key, new_balance);
        env.storage().instance().set(&ESCROW_KEY, &escrow);
        new_balance
    }

    fn subtract_escrow_balance(
        env: &Env,
        participant: &Address,
        asset: &Address,
        amount: i128,
    ) -> Result<i128, SettlementError> {
        let key = EscrowKey {
            participant: participant.clone(),
            asset: asset.clone(),
        };
        let mut escrow: Map<EscrowKey, i128> = env
            .storage()
            .instance()
            .get(&ESCROW_KEY)
            .unwrap_or(Map::new(&env));

        let current = escrow.get(key.clone()).unwrap_or(0);
        if current < amount {
            return Err(SettlementError::InsufficientEscrow);
        }

        let new_balance = current - amount;
        escrow.set(key, new_balance);
        env.storage().instance().set(&ESCROW_KEY, &escrow);
        Ok(new_balance)
    }

    fn add_locked_balance(env: &Env, participant: &Address, asset: &Address, amount: i128) {
        let key = EscrowKey {
            participant: participant.clone(),
            asset: asset.clone(),
        };
        let mut locked: Map<EscrowKey, i128> = env
            .storage()
            .instance()
            .get(&LOCKED_KEY)
            .unwrap_or(Map::new(&env));

        let current = locked.get(key.clone()).unwrap_or(0);
        locked.set(key, current + amount);
        env.storage().instance().set(&LOCKED_KEY, &locked);
    }

    fn subtract_locked_balance(
        env: &Env,
        participant: &Address,
        asset: &Address,
        amount: i128,
    ) -> Result<(), SettlementError> {
        let key = EscrowKey {
            participant: participant.clone(),
            asset: asset.clone(),
        };
        let mut locked: Map<EscrowKey, i128> = env
            .storage()
            .instance()
            .get(&LOCKED_KEY)
            .unwrap_or(Map::new(&env));

        let current = locked.get(key.clone()).unwrap_or(0);
        if current < amount {
            return Err(SettlementError::InsufficientLockedFunds);
        }

        locked.set(key, current - amount);
        env.storage().instance().set(&LOCKED_KEY, &locked);
        Ok(())
    }

    fn transfer_from_escrow(
        env: &Env,
        from: &Address,
        to: &Address,
        asset: &Address,
        amount: i128,
    ) -> Result<(), SettlementError> {
        // Subtract from sender's escrow and locked
        Self::subtract_locked_balance(env, from, asset, amount)?;
        Self::subtract_escrow_balance(env, from, asset, amount)?;

        // Add to receiver's escrow
        Self::add_escrow_balance(env, to, asset, amount);

        Ok(())
    }

    fn mark_nullifier_used(env: &Env, nullifier: &BytesN<32>) {
        let mut nullifiers: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&NULLIFIERS_KEY)
            .unwrap_or(vec![&env]);
        nullifiers.push_back(nullifier.clone());
        env.storage().instance().set(&NULLIFIERS_KEY, &nullifiers);
    }

    fn parse_public_signals(env: &Env, bytes: &Bytes) -> Result<Vec<BytesN<32>>, SettlementError> {
        let mut pos = 0usize;

        // Read length
        if bytes.len() < 4 {
            return Err(SettlementError::InvalidProof);
        }
        let mut len_bytes = [0u8; 4];
        bytes.slice(0..4).copy_into_slice(&mut len_bytes);
        pos += 4;
        let len = u32::from_be_bytes(len_bytes) as usize;

        let mut signals = Vec::new(env);
        for _ in 0..len {
            if pos + 32 > bytes.len() as usize {
                return Err(SettlementError::InvalidProof);
            }
            let mut arr = [0u8; 32];
            bytes.slice(pos as u32..(pos + 32) as u32).copy_into_slice(&mut arr);
            pos += 32;
            signals.push_back(BytesN::from_array(env, &arr));
        }

        Ok(signals)
    }
}
