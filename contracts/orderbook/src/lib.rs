#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, vec,
    Address, Bytes, BytesN, Env, Symbol, Vec,
};

#[cfg(test)]
mod test;

// Storage keys
const ADMIN_KEY: Symbol = symbol_short!("admin");
const REGISTRY_KEY: Symbol = symbol_short!("registry");
const SETTLEMENT_KEY: Symbol = symbol_short!("settl");
const ORDERS_KEY: Symbol = symbol_short!("orders");
const MATCHES_KEY: Symbol = symbol_short!("matches");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum OrderbookError {
    OnlyAdmin = 1,
    OrderNotFound = 2,
    OrderExpired = 3,
    OrderAlreadyMatched = 4,
    OrderAlreadyCancelled = 5,
    InvalidProof = 6,
    UnauthorizedCancellation = 7,
    MatchNotFound = 8,
    InvalidOrderSide = 9,
    AssetMismatch = 10,
}

/// Order side (buy or sell)
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
#[repr(u32)]
pub enum OrderSide {
    Buy = 0,
    Sell = 1,
}

/// Order status
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
#[repr(u32)]
pub enum OrderStatus {
    Active = 0,
    Matched = 1,
    Settled = 2,
    Cancelled = 3,
    Expired = 4,
}

/// Order commitment stored in the orderbook
/// The actual order details (quantity, price) are hidden in the commitment
#[derive(Clone)]
#[contracttype]
pub struct OrderCommitment {
    pub commitment: BytesN<32>,
    pub trader: Address,
    pub asset_address: Address,
    pub side: OrderSide,
    pub timestamp: u64,
    pub expiry: u64,
    pub status: OrderStatus,
    pub tree_index: u32,
}

/// Matched trade record
#[derive(Clone)]
#[contracttype]
pub struct MatchRecord {
    pub match_id: BytesN<32>,
    pub buy_commitment: BytesN<32>,
    pub sell_commitment: BytesN<32>,
    pub asset_address: Address,
    pub buyer: Address,
    pub seller: Address,
    pub quantity: i128,
    pub price: i128,
    pub timestamp: u64,
    pub is_settled: bool,
}

#[contract]
pub struct DarkPoolOrderbook;

#[contractimpl]
impl DarkPoolOrderbook {
    /// Initialize the orderbook contract
    ///
    /// # Arguments
    /// * `admin` - Admin address
    /// * `registry_address` - Address of the registry contract
    /// * `settlement_address` - Address of the settlement contract
    pub fn __constructor(
        env: Env,
        admin: Address,
        registry_address: Address,
        settlement_address: Address,
    ) {
        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage().instance().set(&REGISTRY_KEY, &registry_address);
        env.storage().instance().set(&SETTLEMENT_KEY, &settlement_address);

        // Initialize empty orders and matches
        let orders: Vec<OrderCommitment> = vec![&env];
        let matches: Vec<MatchRecord> = vec![&env];
        env.storage().instance().set(&ORDERS_KEY, &orders);
        env.storage().instance().set(&MATCHES_KEY, &matches);
    }

    /// Submit a new order commitment
    ///
    /// # Arguments
    /// * `trader` - Address of the trader (must authenticate)
    /// * `commitment` - Hash commitment of the order (Poseidon(asset, side, qty, price, nonce, secret))
    /// * `asset_address` - The RWA token address (public for matching)
    /// * `side` - Buy or Sell (public for matching)
    /// * `expiry_seconds` - How many seconds until order expires
    ///
    /// # Returns
    /// * The index of the order in the orderbook
    pub fn submit_order(
        env: Env,
        trader: Address,
        commitment: BytesN<32>,
        asset_address: Address,
        side: OrderSide,
        expiry_seconds: u64,
    ) -> Result<u32, OrderbookError> {
        trader.require_auth();

        let current_time = env.ledger().timestamp();
        let expiry = current_time + expiry_seconds;

        let mut orders: Vec<OrderCommitment> = env
            .storage()
            .instance()
            .get(&ORDERS_KEY)
            .unwrap_or(vec![&env]);

        let tree_index = orders.len() as u32;

        let order = OrderCommitment {
            commitment: commitment.clone(),
            trader: trader.clone(),
            asset_address: asset_address.clone(),
            side,
            timestamp: current_time,
            expiry,
            status: OrderStatus::Active,
            tree_index,
        };

        orders.push_back(order);
        env.storage().instance().set(&ORDERS_KEY, &orders);

        Ok(tree_index)
    }

    /// Cancel an order with ownership proof
    ///
    /// # Arguments
    /// * `trader` - Address of the trader (must authenticate)
    /// * `commitment` - The order commitment to cancel
    /// * `proof_bytes` - ZK proof of order ownership
    /// * `pub_signals_bytes` - Public signals for the proof
    pub fn cancel_order(
        env: Env,
        trader: Address,
        commitment: BytesN<32>,
        _proof_bytes: Bytes,
        _pub_signals_bytes: Bytes,
    ) -> Result<(), OrderbookError> {
        trader.require_auth();

        let orders: Vec<OrderCommitment> = env
            .storage()
            .instance()
            .get(&ORDERS_KEY)
            .unwrap_or(vec![&env]);

        let mut found = false;
        let mut updated_orders: Vec<OrderCommitment> = vec![&env];

        for order in orders.iter() {
            if order.commitment == commitment {
                // Verify trader owns the order
                if order.trader != trader {
                    return Err(OrderbookError::UnauthorizedCancellation);
                }

                // Check order is still active
                match order.status {
                    OrderStatus::Matched | OrderStatus::Settled => {
                        return Err(OrderbookError::OrderAlreadyMatched);
                    }
                    OrderStatus::Cancelled => {
                        return Err(OrderbookError::OrderAlreadyCancelled);
                    }
                    _ => {}
                }

                // TODO: In production, verify the ZK proof of ownership
                // For now, we just check the trader address matches

                let mut cancelled_order = order.clone();
                cancelled_order.status = OrderStatus::Cancelled;
                updated_orders.push_back(cancelled_order);
                found = true;
            } else {
                updated_orders.push_back(order);
            }
        }

        if !found {
            return Err(OrderbookError::OrderNotFound);
        }

        env.storage().instance().set(&ORDERS_KEY, &updated_orders);
        Ok(())
    }

    /// Record a matched trade (called by matching engine)
    ///
    /// # Arguments
    /// * `admin` - Must be admin
    /// * `match_id` - Unique identifier for the match
    /// * `buy_commitment` - The buy order commitment
    /// * `sell_commitment` - The sell order commitment
    /// * `asset_address` - The RWA token being traded
    /// * `buyer` - Buyer address
    /// * `seller` - Seller address
    /// * `quantity` - Matched quantity
    /// * `price` - Execution price
    pub fn record_match(
        env: Env,
        admin: Address,
        match_id: BytesN<32>,
        buy_commitment: BytesN<32>,
        sell_commitment: BytesN<32>,
        asset_address: Address,
        buyer: Address,
        seller: Address,
        quantity: i128,
        price: i128,
    ) -> Result<(), OrderbookError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        // Update order statuses
        let orders: Vec<OrderCommitment> = env
            .storage()
            .instance()
            .get(&ORDERS_KEY)
            .unwrap_or(vec![&env]);

        let mut updated_orders: Vec<OrderCommitment> = vec![&env];
        let mut buy_found = false;
        let mut sell_found = false;

        for order in orders.iter() {
            if order.commitment == buy_commitment {
                if order.asset_address != asset_address {
                    return Err(OrderbookError::AssetMismatch);
                }
                let mut matched_order = order.clone();
                matched_order.status = OrderStatus::Matched;
                updated_orders.push_back(matched_order);
                buy_found = true;
            } else if order.commitment == sell_commitment {
                if order.asset_address != asset_address {
                    return Err(OrderbookError::AssetMismatch);
                }
                let mut matched_order = order.clone();
                matched_order.status = OrderStatus::Matched;
                updated_orders.push_back(matched_order);
                sell_found = true;
            } else {
                updated_orders.push_back(order);
            }
        }

        if !buy_found || !sell_found {
            return Err(OrderbookError::OrderNotFound);
        }

        env.storage().instance().set(&ORDERS_KEY, &updated_orders);

        // Create match record
        let match_record = MatchRecord {
            match_id: match_id.clone(),
            buy_commitment,
            sell_commitment,
            asset_address,
            buyer,
            seller,
            quantity,
            price,
            timestamp: env.ledger().timestamp(),
            is_settled: false,
        };

        let mut matches: Vec<MatchRecord> = env
            .storage()
            .instance()
            .get(&MATCHES_KEY)
            .unwrap_or(vec![&env]);
        matches.push_back(match_record);
        env.storage().instance().set(&MATCHES_KEY, &matches);

        Ok(())
    }

    /// Mark a match as settled (called after successful settlement)
    pub fn mark_settled(
        env: Env,
        admin: Address,
        match_id: BytesN<32>,
    ) -> Result<(), OrderbookError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let matches: Vec<MatchRecord> = env
            .storage()
            .instance()
            .get(&MATCHES_KEY)
            .unwrap_or(vec![&env]);

        let mut found = false;
        let mut updated_matches: Vec<MatchRecord> = vec![&env];

        for m in matches.iter() {
            if m.match_id == match_id {
                let mut settled = m.clone();
                settled.is_settled = true;
                updated_matches.push_back(settled);
                found = true;
            } else {
                updated_matches.push_back(m);
            }
        }

        if !found {
            return Err(OrderbookError::MatchNotFound);
        }

        env.storage().instance().set(&MATCHES_KEY, &updated_matches);

        // Also update order statuses to Settled
        let orders: Vec<OrderCommitment> = env
            .storage()
            .instance()
            .get(&ORDERS_KEY)
            .unwrap_or(vec![&env]);

        // Find the match to get commitments
        let match_record = Self::get_match(env.clone(), match_id.clone()).unwrap();

        let mut updated_orders: Vec<OrderCommitment> = vec![&env];
        for order in orders.iter() {
            if order.commitment == match_record.buy_commitment
                || order.commitment == match_record.sell_commitment
            {
                let mut settled_order = order.clone();
                settled_order.status = OrderStatus::Settled;
                updated_orders.push_back(settled_order);
            } else {
                updated_orders.push_back(order);
            }
        }

        env.storage().instance().set(&ORDERS_KEY, &updated_orders);

        Ok(())
    }

    /// Get all orders for an asset and side
    pub fn get_orders_by_asset(
        env: Env,
        asset_address: Address,
        side: Option<OrderSide>,
    ) -> Vec<OrderCommitment> {
        let orders: Vec<OrderCommitment> = env
            .storage()
            .instance()
            .get(&ORDERS_KEY)
            .unwrap_or(vec![&env]);

        let mut filtered: Vec<OrderCommitment> = vec![&env];
        for order in orders.iter() {
            if order.asset_address == asset_address {
                match side {
                    Some(s) if order.side == s => filtered.push_back(order),
                    None => filtered.push_back(order),
                    _ => {}
                }
            }
        }
        filtered
    }

    /// Get active orders only
    pub fn get_active_orders(env: Env, asset_address: Address) -> Vec<OrderCommitment> {
        let orders: Vec<OrderCommitment> = env
            .storage()
            .instance()
            .get(&ORDERS_KEY)
            .unwrap_or(vec![&env]);

        let current_time = env.ledger().timestamp();
        let mut active: Vec<OrderCommitment> = vec![&env];

        for order in orders.iter() {
            if order.asset_address == asset_address
                && order.status == OrderStatus::Active
                && order.expiry > current_time
            {
                active.push_back(order);
            }
        }
        active
    }

    /// Get an order by commitment
    pub fn get_order(env: Env, commitment: BytesN<32>) -> Option<OrderCommitment> {
        let orders: Vec<OrderCommitment> = env
            .storage()
            .instance()
            .get(&ORDERS_KEY)
            .unwrap_or(vec![&env]);

        for order in orders.iter() {
            if order.commitment == commitment {
                return Some(order);
            }
        }
        None
    }

    /// Get all matches
    pub fn get_matches(env: Env) -> Vec<MatchRecord> {
        env.storage()
            .instance()
            .get(&MATCHES_KEY)
            .unwrap_or(vec![&env])
    }

    /// Get a specific match
    pub fn get_match(env: Env, match_id: BytesN<32>) -> Option<MatchRecord> {
        let matches: Vec<MatchRecord> = env
            .storage()
            .instance()
            .get(&MATCHES_KEY)
            .unwrap_or(vec![&env]);

        for m in matches.iter() {
            if m.match_id == match_id {
                return Some(m);
            }
        }
        None
    }

    /// Get pending (unsettle) matches
    pub fn get_pending_matches(env: Env) -> Vec<MatchRecord> {
        let matches: Vec<MatchRecord> = env
            .storage()
            .instance()
            .get(&MATCHES_KEY)
            .unwrap_or(vec![&env]);

        let mut pending: Vec<MatchRecord> = vec![&env];
        for m in matches.iter() {
            if !m.is_settled {
                pending.push_back(m);
            }
        }
        pending
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&ADMIN_KEY).unwrap()
    }

    /// Get registry address
    pub fn get_registry(env: Env) -> Address {
        env.storage().instance().get(&REGISTRY_KEY).unwrap()
    }

    /// Get settlement address
    pub fn get_settlement(env: Env) -> Address {
        env.storage().instance().get(&SETTLEMENT_KEY).unwrap()
    }

    // Internal helper
    fn require_admin(env: &Env, caller: &Address) -> Result<(), OrderbookError> {
        let admin: Address = env.storage().instance().get(&ADMIN_KEY).unwrap();
        if *caller != admin {
            return Err(OrderbookError::OnlyAdmin);
        }
        Ok(())
    }
}
