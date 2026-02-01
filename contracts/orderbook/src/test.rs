#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, BytesN, Env};

#[test]
fn test_constructor() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let registry = Address::generate(&env);
    let settlement = Address::generate(&env);

    let contract_id = env.register(DarkPoolOrderbook, (&admin, &registry, &settlement));
    let client = DarkPoolOrderbookClient::new(&env, &contract_id);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_registry(), registry);
    assert_eq!(client.get_settlement(), settlement);
}

#[test]
fn test_submit_order() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let registry = Address::generate(&env);
    let settlement = Address::generate(&env);

    let contract_id = env.register(DarkPoolOrderbook, (&admin, &registry, &settlement));
    let client = DarkPoolOrderbookClient::new(&env, &contract_id);

    let trader = Address::generate(&env);
    let asset = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[1u8; 32]);

    let index = client.submit_order(&trader, &commitment, &asset, &OrderSide::Buy, &3600);
    assert_eq!(index, 0);

    let order = client.get_order(&commitment);
    assert!(order.is_some());
    let order = order.unwrap();
    assert_eq!(order.trader, trader);
    assert_eq!(order.side, OrderSide::Buy);
    assert_eq!(order.status, OrderStatus::Active);
}

#[test]
fn test_cancel_order() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let registry = Address::generate(&env);
    let settlement = Address::generate(&env);

    let contract_id = env.register(DarkPoolOrderbook, (&admin, &registry, &settlement));
    let client = DarkPoolOrderbookClient::new(&env, &contract_id);

    let trader = Address::generate(&env);
    let asset = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &[1u8; 32]);

    client.submit_order(&trader, &commitment, &asset, &OrderSide::Buy, &3600);

    // Cancel the order
    let proof = Bytes::from_slice(&env, &[0u8; 100]);
    let signals = Bytes::from_slice(&env, &[0u8; 100]);
    client.cancel_order(&trader, &commitment, &proof, &signals);

    let order = client.get_order(&commitment).unwrap();
    assert_eq!(order.status, OrderStatus::Cancelled);
}

#[test]
fn test_record_match() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let registry = Address::generate(&env);
    let settlement = Address::generate(&env);

    let contract_id = env.register(DarkPoolOrderbook, (&admin, &registry, &settlement));
    let client = DarkPoolOrderbookClient::new(&env, &contract_id);

    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let asset = Address::generate(&env);
    let buy_commitment = BytesN::from_array(&env, &[1u8; 32]);
    let sell_commitment = BytesN::from_array(&env, &[2u8; 32]);
    let match_id = BytesN::from_array(&env, &[3u8; 32]);

    // Submit both orders
    client.submit_order(&buyer, &buy_commitment, &asset, &OrderSide::Buy, &3600);
    client.submit_order(&seller, &sell_commitment, &asset, &OrderSide::Sell, &3600);

    // Record match
    client.record_match(
        &admin,
        &match_id,
        &buy_commitment,
        &sell_commitment,
        &asset,
        &buyer,
        &seller,
        &1000,
        &50000,
    );

    // Check orders are marked as matched
    let buy_order = client.get_order(&buy_commitment).unwrap();
    let sell_order = client.get_order(&sell_commitment).unwrap();
    assert_eq!(buy_order.status, OrderStatus::Matched);
    assert_eq!(sell_order.status, OrderStatus::Matched);

    // Check match record exists
    let match_record = client.get_match(&match_id);
    assert!(match_record.is_some());
    assert!(!match_record.unwrap().is_settled);
}

#[test]
fn test_get_active_orders() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let registry = Address::generate(&env);
    let settlement = Address::generate(&env);

    let contract_id = env.register(DarkPoolOrderbook, (&admin, &registry, &settlement));
    let client = DarkPoolOrderbookClient::new(&env, &contract_id);

    let trader = Address::generate(&env);
    let asset = Address::generate(&env);

    // Submit multiple orders
    for i in 0..5 {
        let mut commitment_arr = [0u8; 32];
        commitment_arr[0] = i;
        let commitment = BytesN::from_array(&env, &commitment_arr);
        client.submit_order(&trader, &commitment, &asset, &OrderSide::Buy, &3600);
    }

    let active_orders = client.get_active_orders(&asset);
    assert_eq!(active_orders.len(), 5);
}

#[test]
fn test_get_orders_by_side() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let registry = Address::generate(&env);
    let settlement = Address::generate(&env);

    let contract_id = env.register(DarkPoolOrderbook, (&admin, &registry, &settlement));
    let client = DarkPoolOrderbookClient::new(&env, &contract_id);

    let trader = Address::generate(&env);
    let asset = Address::generate(&env);

    // Submit buy orders
    for i in 0..3 {
        let mut commitment_arr = [0u8; 32];
        commitment_arr[0] = i;
        let commitment = BytesN::from_array(&env, &commitment_arr);
        client.submit_order(&trader, &commitment, &asset, &OrderSide::Buy, &3600);
    }

    // Submit sell orders
    for i in 3..5 {
        let mut commitment_arr = [0u8; 32];
        commitment_arr[0] = i;
        let commitment = BytesN::from_array(&env, &commitment_arr);
        client.submit_order(&trader, &commitment, &asset, &OrderSide::Sell, &3600);
    }

    let buy_orders = client.get_orders_by_asset(&asset, &Some(OrderSide::Buy));
    let sell_orders = client.get_orders_by_asset(&asset, &Some(OrderSide::Sell));

    assert_eq!(buy_orders.len(), 3);
    assert_eq!(sell_orders.len(), 2);
}
