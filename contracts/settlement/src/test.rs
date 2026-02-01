#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Bytes, BytesN, Env};

// Note: Full integration tests require deploying the verifier and registry contracts first.
// These are basic unit tests for escrow functionality.

#[test]
fn test_escrow_balance_tracking() {
    let env = Env::default();

    let participant = Address::generate(&env);
    let asset = Address::generate(&env);

    // Initially zero
    let balance = DarkPoolSettlement::get_escrow_balance(env.clone(), participant.clone(), asset.clone());
    assert_eq!(balance, 0);

    // Add balance
    DarkPoolSettlement::add_escrow_balance(&env, &participant, &asset, 1000);
    let balance = DarkPoolSettlement::get_escrow_balance(env.clone(), participant.clone(), asset.clone());
    assert_eq!(balance, 1000);

    // Add more
    DarkPoolSettlement::add_escrow_balance(&env, &participant, &asset, 500);
    let balance = DarkPoolSettlement::get_escrow_balance(env.clone(), participant.clone(), asset.clone());
    assert_eq!(balance, 1500);
}

#[test]
fn test_locked_balance_tracking() {
    let env = Env::default();

    let participant = Address::generate(&env);
    let asset = Address::generate(&env);

    // Add escrow first
    DarkPoolSettlement::add_escrow_balance(&env, &participant, &asset, 1000);

    // Lock some
    DarkPoolSettlement::add_locked_balance(&env, &participant, &asset, 400);
    let locked = DarkPoolSettlement::get_locked_balance(env.clone(), participant.clone(), asset.clone());
    assert_eq!(locked, 400);

    // Available should be escrow - locked
    let available = DarkPoolSettlement::get_available_balance(env.clone(), participant.clone(), asset.clone());
    assert_eq!(available, 600);
}

#[test]
fn test_nullifier_tracking() {
    let env = Env::default();

    let nullifier = BytesN::from_array(&env, &[1u8; 32]);

    // Initialize nullifiers storage
    let nullifiers: Vec<BytesN<32>> = vec![&env];
    env.storage().instance().set(&symbol_short!("nulls"), &nullifiers);

    // Should not be used initially
    assert!(!DarkPoolSettlement::is_nullifier_used(env.clone(), nullifier.clone()));

    // Mark as used
    DarkPoolSettlement::mark_nullifier_used(&env, &nullifier);

    // Should be used now
    assert!(DarkPoolSettlement::is_nullifier_used(env.clone(), nullifier.clone()));
}

#[test]
fn test_escrow_transfer() {
    let env = Env::default();

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let asset = Address::generate(&env);

    // Give Alice some balance and lock it
    DarkPoolSettlement::add_escrow_balance(&env, &alice, &asset, 1000);
    DarkPoolSettlement::add_locked_balance(&env, &alice, &asset, 1000);

    // Transfer from Alice to Bob
    let result = DarkPoolSettlement::transfer_from_escrow(&env, &alice, &bob, &asset, 500);
    assert!(result.is_ok());

    // Check balances
    let alice_balance = DarkPoolSettlement::get_escrow_balance(env.clone(), alice.clone(), asset.clone());
    let bob_balance = DarkPoolSettlement::get_escrow_balance(env.clone(), bob.clone(), asset.clone());

    assert_eq!(alice_balance, 500);
    assert_eq!(bob_balance, 500);

    // Alice's locked balance should also decrease
    let alice_locked = DarkPoolSettlement::get_locked_balance(env.clone(), alice.clone(), asset.clone());
    assert_eq!(alice_locked, 500);
}
