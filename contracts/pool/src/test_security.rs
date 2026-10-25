#![cfg(test)]
//! Security tests: unauthorized wallets can't withdraw, a pool can't be settled
//! twice, there are no duplicate refunds, and actions are rejected when the pool
//! state or deadline doesn't allow them.

extern crate std;

use super::*;
use crate::test::{Setup, DAY, START, USDC};
use soroban_sdk::{
    testutils::{Ledger, MockAuth, MockAuthInvoke},
    Address, BytesN, IntoVal, Val, Vec,
};

impl<'a> Setup<'a> {
    /// From here on the only signature is `signer`'s, for `fn_name(args)` on `contract`.
    pub(crate) fn only_signed_by(
        &self,
        signer: &Address,
        contract: &Address,
        fn_name: &str,
        args: Vec<Val>,
    ) {
        self.env.mock_auths(&[MockAuth {
            address: signer,
            invoke: &MockAuthInvoke {
                contract,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    /// A new pool with one member who has contributed `contributed` USDC.
    pub(crate) fn pool_with_contribution(
        &self,
        admin: &Address,
        goal: i128,
        contributed: i128,
    ) -> (u64, Address) {
        let pool_id = self.new_pool(admin, goal);
        let member = self.wallet(contributed);
        self.pool.contribute(&pool_id, &member, &contributed);
        (pool_id, member)
    }

    /// Puts USDC from an unrelated pool in the contract, so a payout that should
    /// be refused would go through instead of failing for lack of funds.
    pub(crate) fn hold_unrelated_funds(&self) -> i128 {
        let amount = 500 * USDC;
        self.pool_with_contribution(&self.wallet(0), 1_000 * USDC, amount);
        amount
    }
}

// Unauthorized wallets can't withdraw

#[test]
fn stranger_cannot_withdraw() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, _) = s.pool_with_contribution(&admin, 10 * USDC, 10 * USDC);
    let stranger = s.wallet(0);
    let pool = s.pool.address.clone();

    s.only_signed_by(&stranger, &pool, "settle", (pool_id,).into_val(&s.env));
    assert!(s.pool.try_settle(&pool_id).is_err());
    assert_eq!(s.usdc.balance(&stranger), 0);
    assert_eq!(s.usdc.balance(&pool), 10 * USDC);
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Funded);

    // The same call succeeds once the pool admin signs it.
    s.only_signed_by(&admin, &pool, "settle", (pool_id,).into_val(&s.env));
    assert_eq!(s.pool.settle(&pool_id), 10 * USDC);
    assert_eq!(s.usdc.balance(&admin), 10 * USDC);
}

#[test]
fn contributor_cannot_withdraw() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, member) = s.pool_with_contribution(&admin, 10 * USDC, 10 * USDC);
    let pool = s.pool.address.clone();

    s.only_signed_by(&member, &pool, "settle", (pool_id,).into_val(&s.env));
    assert!(s.pool.try_settle(&pool_id).is_err());
    assert_eq!(s.usdc.balance(&member), 0);
    assert_eq!(s.usdc.balance(&pool), 10 * USDC);
}

#[test]
fn contract_admin_cannot_withdraw_a_users_pool() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, _) = s.pool_with_contribution(&admin, 10 * USDC, 10 * USDC);
    let pool = s.pool.address.clone();
    let contract_admin = s.contract_admin.clone();

    s.only_signed_by(
        &contract_admin,
        &pool,
        "settle",
        (pool_id,).into_val(&s.env),
    );
    assert!(s.pool.try_settle(&pool_id).is_err());
    assert_eq!(s.usdc.balance(&contract_admin), 0);
    assert_eq!(s.usdc.balance(&pool), 10 * USDC);
}

#[test]
fn nobody_can_move_pool_funds_directly() {
    let s = Setup::new();
    let (_, _) = s.pool_with_contribution(&s.wallet(0), 10 * USDC, 10 * USDC);
    let stranger = s.wallet(0);
    let pool = s.pool.address.clone();
    let usdc = s.usdc.address.clone();

    // The stranger signs a USDC transfer out of the pool contract's balance.
    s.only_signed_by(
        &stranger,
        &usdc,
        "transfer",
        (pool.clone(), stranger.clone(), 10 * USDC).into_val(&s.env),
    );
    assert!(s.usdc.try_transfer(&pool, &stranger, &(10 * USDC)).is_err());
    assert_eq!(s.usdc.balance(&stranger), 0);
    assert_eq!(s.usdc.balance(&pool), 10 * USDC);
}

#[test]
fn nobody_can_contribute_from_someone_elses_wallet() {
    let s = Setup::new();
    let pool_id = s.new_pool(&s.wallet(0), 100 * USDC);
    let victim = s.wallet(50 * USDC);
    let attacker = s.wallet(0);
    let pool = s.pool.address.clone();

    s.only_signed_by(
        &attacker,
        &pool,
        "contribute",
        (pool_id, victim.clone(), 50 * USDC).into_val(&s.env),
    );
    assert!(s
        .pool
        .try_contribute(&pool_id, &victim, &(50 * USDC))
        .is_err());
    assert_eq!(s.usdc.balance(&victim), 50 * USDC);
    assert!(!s.pool.is_member(&pool_id, &victim));
    assert_eq!(s.pool.get_pool(&pool_id).total_contributed, 0);
}

#[test]
fn stranger_cannot_cancel_a_pool() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, _) = s.pool_with_contribution(&admin, 100 * USDC, 10 * USDC);
    let stranger = s.wallet(0);
    let pool = s.pool.address.clone();

    s.only_signed_by(&stranger, &pool, "cancel_pool", (pool_id,).into_val(&s.env));
    assert!(s.pool.try_cancel_pool(&pool_id).is_err());
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Open);
}

#[test]
fn only_the_pool_admin_decides_on_an_expired_pool() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, member) = s.pool_with_contribution(&admin, 100 * USDC, 10 * USDC);
    let pool = s.pool.address.clone();
    s.pass_deadline();
    let later = s.deadline() + DAY;

    // Neither a contributor nor the contract admin can extend or cancel someone's pool.
    for signer in [&member, &s.contract_admin] {
        s.only_signed_by(
            signer,
            &pool,
            "extend_deadline",
            (pool_id, later).into_val(&s.env),
        );
        assert!(s.pool.try_extend_deadline(&pool_id, &later).is_err());
        s.only_signed_by(signer, &pool, "cancel_pool", (pool_id,).into_val(&s.env));
        assert!(s.pool.try_cancel_pool(&pool_id).is_err());
    }
    let state = s.pool.get_pool(&pool_id);
    assert_eq!(state.status, PoolStatus::Expired);
    assert_eq!(state.deadline, s.deadline());
    assert_eq!(s.usdc.balance(&pool), 10 * USDC);
}

#[test]
fn refunds_only_ever_go_to_the_member() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, member) = s.pool_with_contribution(&admin, 100 * USDC, 30 * USDC);
    s.pool.cancel_pool(&pool_id);
    let stranger = s.wallet(0);

    // Anyone may trigger a member's refund, but the USDC goes to the member.
    s.env.set_auths(&[]);
    assert_eq!(s.pool.claim_refund(&pool_id, &member), 30 * USDC);
    assert_eq!(s.usdc.balance(&member), 30 * USDC);
    assert_eq!(s.usdc.balance(&stranger), 0);

    // Someone who never contributed can't claim anything.
    assert_eq!(
        s.pool.try_claim_refund(&pool_id, &stranger),
        Err(Ok(Error::NotMember))
    );
}

#[test]
fn only_contract_admin_can_hand_over_or_upgrade() {
    let s = Setup::new();
    let stranger = s.wallet(0);
    let pool = s.pool.address.clone();

    s.only_signed_by(
        &stranger,
        &pool,
        "set_admin",
        (stranger.clone(),).into_val(&s.env),
    );
    assert!(s.pool.try_set_admin(&stranger).is_err());
    assert_eq!(s.pool.admin(), s.contract_admin);

    let wasm_hash = BytesN::from_array(&s.env, &[7; 32]);
    s.only_signed_by(
        &stranger,
        &pool,
        "upgrade",
        (wasm_hash.clone(),).into_val(&s.env),
    );
    assert!(s.pool.try_upgrade(&wasm_hash).is_err());
}

// A pool can't be settled twice

#[test]
fn pool_cannot_be_settled_twice() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, _) = s.pool_with_contribution(&admin, 10 * USDC, 10 * USDC);
    let unrelated = s.hold_unrelated_funds();

    assert_eq!(s.pool.settle(&pool_id), 10 * USDC);
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::PoolClosed)));
    assert_eq!(s.usdc.balance(&admin), 10 * USDC);
    assert_eq!(s.usdc.balance(&s.pool.address), unrelated);
}

#[test]
fn second_settle_cannot_take_another_pools_funds() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (first, _) = s.pool_with_contribution(&admin, 10 * USDC, 10 * USDC);
    let (second, _) = s.pool_with_contribution(&admin, 50 * USDC, 50 * USDC);

    s.pool.settle(&first);
    assert_eq!(s.pool.try_settle(&first), Err(Ok(Error::PoolClosed)));
    assert_eq!(s.usdc.balance(&admin), 10 * USDC);
    assert_eq!(s.usdc.balance(&s.pool.address), 50 * USDC);
    assert_eq!(s.pool.get_pool(&second).status, PoolStatus::Funded);
}

#[test]
fn settled_pool_cannot_be_cancelled_or_refunded() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, member) = s.pool_with_contribution(&admin, 10 * USDC, 10 * USDC);
    s.hold_unrelated_funds();
    s.pool.settle(&pool_id);

    assert_eq!(s.pool.try_cancel_pool(&pool_id), Err(Ok(Error::PoolClosed)));
    assert_eq!(
        s.pool.try_claim_refund(&pool_id, &member),
        Err(Ok(Error::NotRefundable))
    );
    assert_eq!(s.usdc.balance(&member), 0);
}

#[test]
fn refunded_pool_cannot_be_settled() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, member) = s.pool_with_contribution(&admin, 10 * USDC, 10 * USDC);
    s.hold_unrelated_funds();
    s.pool.cancel_pool(&pool_id);
    s.pool.claim_refund(&pool_id, &member);

    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::PoolClosed)));
    assert_eq!(s.usdc.balance(&admin), 0);
}

// No duplicate refunds

#[test]
fn member_cannot_be_refunded_twice() {
    let s = Setup::new();
    let (pool_id, member) = s.pool_with_contribution(&s.wallet(0), 100 * USDC, 30 * USDC);
    let unrelated = s.hold_unrelated_funds();
    s.pool.cancel_pool(&pool_id);

    assert_eq!(s.pool.claim_refund(&pool_id, &member), 30 * USDC);
    assert_eq!(
        s.pool.try_claim_refund(&pool_id, &member),
        Err(Ok(Error::NothingToRefund))
    );
    assert_eq!(s.usdc.balance(&member), 30 * USDC);
    assert_eq!(s.usdc.balance(&s.pool.address), unrelated);
    assert_eq!(s.pool.get_pool(&pool_id).total_refunded, 30 * USDC);
}

#[test]
fn every_contributor_is_refunded_exactly_once() {
    let s = Setup::new();
    let pool_id = s.new_pool(&s.wallet(0), 1_000 * USDC);
    let amounts = [10 * USDC, 25 * USDC, 40 * USDC];
    let members: std::vec::Vec<Address> = amounts
        .iter()
        .map(|amount| {
            let member = s.wallet(*amount);
            s.pool.contribute(&pool_id, &member, amount);
            member
        })
        .collect();
    let unrelated = s.hold_unrelated_funds();
    s.pass_deadline();
    s.pool.cancel_pool(&pool_id);

    for (member, amount) in members.iter().zip(amounts) {
        assert_eq!(s.pool.claim_refund(&pool_id, member), amount);
    }
    for member in &members {
        assert_eq!(
            s.pool.try_claim_refund(&pool_id, member),
            Err(Ok(Error::NothingToRefund))
        );
    }
    for (member, amount) in members.iter().zip(amounts) {
        assert_eq!(s.usdc.balance(member), amount);
    }
    let pool = s.pool.get_pool(&pool_id);
    assert_eq!(pool.total_refunded, pool.total_contributed);
    assert_eq!(s.usdc.balance(&s.pool.address), unrelated);
}

#[test]
fn refunds_cannot_drain_another_pools_funds() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let member = s.wallet(60 * USDC);
    let cancelled = s.new_pool(&admin, 100 * USDC);
    let active = s.new_pool(&admin, 100 * USDC);
    s.pool.contribute(&cancelled, &member, &(10 * USDC));
    s.pool.contribute(&active, &member, &(50 * USDC));
    s.pool.cancel_pool(&cancelled);

    assert_eq!(s.pool.claim_refund(&cancelled, &member), 10 * USDC);
    assert!(s.pool.try_claim_refund(&cancelled, &member).is_err());
    assert_eq!(
        s.pool.try_claim_refund(&active, &member),
        Err(Ok(Error::NotRefundable))
    );
    assert_eq!(s.usdc.balance(&member), 10 * USDC);
    assert_eq!(s.usdc.balance(&s.pool.address), 50 * USDC);
}

#[test]
fn member_who_never_paid_gets_nothing() {
    let s = Setup::new();
    let pool_id = s.new_pool(&s.wallet(0), 100 * USDC);
    let member = s.wallet(0);
    s.pool.join_pool(&pool_id, &member);
    let unrelated = s.hold_unrelated_funds();
    s.pool.cancel_pool(&pool_id);

    assert_eq!(
        s.pool.try_claim_refund(&pool_id, &member),
        Err(Ok(Error::NothingToRefund))
    );
    assert_eq!(s.usdc.balance(&member), 0);
    assert_eq!(s.usdc.balance(&s.pool.address), unrelated);
}

// Actions are rejected when the pool state or deadline doesn't allow them

#[test]
fn nothing_is_accepted_from_the_deadline_on() {
    let s = Setup::new();
    let pool_id = s.new_pool(&s.wallet(0), 100 * USDC);
    let member = s.wallet(20 * USDC);

    s.env.ledger().set_timestamp(s.deadline() - 1);
    s.pool.contribute(&pool_id, &member, &(10 * USDC));

    s.pass_deadline();
    assert_eq!(
        s.pool.try_contribute(&pool_id, &member, &(10 * USDC)),
        Err(Ok(Error::DeadlinePassed))
    );
    assert_eq!(
        s.pool.try_join_pool(&pool_id, &s.wallet(0)),
        Err(Ok(Error::DeadlinePassed))
    );
    assert_eq!(s.usdc.balance(&member), 10 * USDC);
}

#[test]
fn funded_pool_also_closes_at_the_deadline() {
    let s = Setup::new();
    let (pool_id, member) = s.pool_with_contribution(&s.wallet(0), 10 * USDC, 10 * USDC);
    s.pass_deadline();

    assert_eq!(
        s.pool.try_contribute(&pool_id, &member, &USDC),
        Err(Ok(Error::DeadlinePassed))
    );
    assert_eq!(
        s.pool.try_claim_refund(&pool_id, &member),
        Err(Ok(Error::NotRefundable))
    );
}

#[test]
fn settle_needs_the_goal_reached() {
    let s = Setup::new();
    let (pool_id, _) = s.pool_with_contribution(&s.wallet(0), 100 * USDC, 99 * USDC);

    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::GoalNotReached)));
    s.pass_deadline();
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::GoalNotReached)));
    assert_eq!(s.usdc.balance(&s.pool.address), 99 * USDC);
}

#[test]
fn refunds_need_a_failed_or_cancelled_pool() {
    let s = Setup::new();
    let (open, member) = s.pool_with_contribution(&s.wallet(0), 100 * USDC, 10 * USDC);
    let (funded, funder) = s.pool_with_contribution(&s.wallet(0), 10 * USDC, 10 * USDC);

    assert_eq!(
        s.pool.try_claim_refund(&open, &member),
        Err(Ok(Error::NotRefundable))
    );
    assert_eq!(
        s.pool.try_claim_refund(&funded, &funder),
        Err(Ok(Error::NotRefundable))
    );
}

#[test]
fn closed_pools_reject_joins_and_contributions() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (cancelled, _) = s.pool_with_contribution(&admin, 100 * USDC, 10 * USDC);
    let (settled, _) = s.pool_with_contribution(&admin, 10 * USDC, 10 * USDC);
    s.pool.cancel_pool(&cancelled);
    s.pool.settle(&settled);
    let late = s.wallet(10 * USDC);

    for pool_id in [cancelled, settled] {
        assert_eq!(
            s.pool.try_join_pool(&pool_id, &late),
            Err(Ok(Error::PoolClosed))
        );
        assert_eq!(
            s.pool.try_contribute(&pool_id, &late, &USDC),
            Err(Ok(Error::PoolClosed))
        );
    }
    assert_eq!(s.usdc.balance(&late), 10 * USDC);
}

#[test]
fn closed_pools_cannot_be_cancelled_again() {
    let s = Setup::new();
    let cancelled = s.new_pool(&s.wallet(0), 100 * USDC);
    let expired = s.new_pool(&s.wallet(0), 100 * USDC);
    s.pool.cancel_pool(&cancelled);

    assert_eq!(
        s.pool.try_cancel_pool(&cancelled),
        Err(Ok(Error::PoolClosed))
    );
    // A pool that missed its deadline is cancelled once, by its admin's choice.
    s.pass_deadline();
    s.pool.cancel_pool(&expired);
    assert_eq!(s.pool.try_cancel_pool(&expired), Err(Ok(Error::PoolClosed)));
}

#[test]
fn bad_inputs_are_rejected() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let member = s.wallet(10 * USDC);

    assert_eq!(
        s.pool.try_create_pool(&admin, &0, &s.deadline()),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.pool.try_create_pool(&admin, &-USDC, &s.deadline()),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.pool.try_create_pool(&admin, &USDC, &START),
        Err(Ok(Error::InvalidDeadline))
    );
    assert_eq!(
        s.pool.try_create_pool(&admin, &USDC, &(START - DAY)),
        Err(Ok(Error::InvalidDeadline))
    );

    let pool_id = s.new_pool(&admin, 100 * USDC);
    assert_eq!(
        s.pool.try_contribute(&pool_id, &member, &0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.pool.try_contribute(&pool_id, &member, &-USDC),
        Err(Ok(Error::InvalidAmount))
    );

    let missing = 42;
    assert_eq!(
        s.pool.try_join_pool(&missing, &member),
        Err(Ok(Error::PoolNotFound))
    );
    assert_eq!(
        s.pool.try_contribute(&missing, &member, &USDC),
        Err(Ok(Error::PoolNotFound))
    );
    assert_eq!(s.pool.try_settle(&missing), Err(Ok(Error::PoolNotFound)));
    assert_eq!(
        s.pool.try_cancel_pool(&missing),
        Err(Ok(Error::PoolNotFound))
    );
    assert_eq!(
        s.pool.try_claim_refund(&missing, &member),
        Err(Ok(Error::PoolNotFound))
    );
}

#[test]
fn contribution_beyond_wallet_balance_records_nothing() {
    let s = Setup::new();
    let pool_id = s.new_pool(&s.wallet(0), 100 * USDC);
    let member = s.wallet(5 * USDC);

    assert!(s
        .pool
        .try_contribute(&pool_id, &member, &(6 * USDC))
        .is_err());
    assert_eq!(s.usdc.balance(&member), 5 * USDC);
    assert!(!s.pool.is_member(&pool_id, &member));
    assert_eq!(s.pool.get_pool(&pool_id).total_contributed, 0);
}
