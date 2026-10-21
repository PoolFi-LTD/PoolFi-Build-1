#![cfg(test)]
//! Payout approvals and the platform fee: a pool with approvers pays out only
//! once a majority agrees, any approver can decline, and every payout (never a
//! refund) gives the fee to the fee recipient.

extern crate std;

use super::*;
use crate::test::{Setup, START, USDC};
use soroban_sdk::{vec, Address, Event as _, IntoVal};

impl<'a> Setup<'a> {
    fn approvers(&self, n: usize) -> Vec<Address> {
        let mut list = Vec::new(&self.env);
        for _ in 0..n {
            list.push_back(self.wallet(0));
        }
        list
    }

    fn pool_with_approvers(&self, admin: &Address, goal: i128, approvers: &Vec<Address>) -> u64 {
        self.pool
            .create_pool_with_approvers(admin, &goal, &self.deadline(), approvers)
    }

    /// A pool with `n` approvers that has reached its 10 USDC goal.
    fn funded_pool_with_approvers(&self, admin: &Address, n: usize) -> (u64, Vec<Address>) {
        let approvers = self.approvers(n);
        let pool_id = self.pool_with_approvers(admin, 10 * USDC, &approvers);
        self.pool
            .contribute(&pool_id, &self.wallet(10 * USDC), &(10 * USDC));
        (pool_id, approvers)
    }

    fn approver(list: &Vec<Address>, i: u32) -> Address {
        list.get(i).unwrap()
    }
}

// Creating pools with approvers

#[test]
fn approvers_are_stored_and_announced() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let approvers = s.approvers(3);

    let pool_id = s.pool_with_approvers(&admin, 10 * USDC, &approvers);

    assert_eq!(
        s.pool_events(),
        [PoolCreated {
            pool_id,
            admin: admin.clone(),
            goal_amount: 10 * USDC,
            deadline: s.deadline(),
            approvers: approvers.clone(),
        }
        .to_xdr(&s.env, &s.pool.address)]
    );
    let pool = s.pool.get_pool(&pool_id);
    assert_eq!(pool.approvers, Some(approvers));
    assert_eq!(pool.payout_approvals, None);
}

#[test]
fn approver_lists_are_validated() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let other = s.wallet(0);
    let deadline = s.deadline();

    let with_admin = vec![&s.env, other.clone(), admin.clone()];
    let duplicated = vec![&s.env, other.clone(), other.clone()];
    let too_many = s.approvers(11);
    for list in [with_admin, duplicated, too_many] {
        assert_eq!(
            s.pool
                .try_create_pool_with_approvers(&admin, &USDC, &deadline, &list),
            Err(Ok(Error::InvalidApprovers))
        );
    }
    assert_eq!(s.pool.pool_count(), 0);
    s.pool_with_approvers(&admin, USDC, &s.approvers(10));
}

// The approval flow

#[test]
fn majority_of_three_approvers_releases_the_payout() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.funded_pool_with_approvers(&admin, 3);

    assert_eq!(
        s.pool.try_settle(&pool_id),
        Err(Ok(Error::ApprovalRequired))
    );
    assert_eq!(
        s.pool
            .try_approve_payout(&pool_id, &Setup::approver(&approvers, 0)),
        Err(Ok(Error::NoPayoutRequest))
    );

    s.pool.request_payout(&pool_id);
    assert_eq!(s.env.auths()[0].0, admin);
    assert_eq!(
        s.pool_events(),
        [PayoutRequested {
            pool_id,
            admin: admin.clone(),
            amount: 10 * USDC,
            needed: 2,
        }
        .to_xdr(&s.env, &s.pool.address)]
    );
    assert_eq!(
        s.pool.try_request_payout(&pool_id),
        Err(Ok(Error::PayoutAlreadyRequested))
    );

    let first = Setup::approver(&approvers, 0);
    assert!(!s.pool.approve_payout(&pool_id, &first));
    assert_eq!(s.env.auths()[0].0, first);
    assert_eq!(s.usdc.balance(&admin), 0);
    assert_eq!(
        s.pool.get_pool(&pool_id).payout_approvals,
        Some(vec![&s.env, first.clone()])
    );
    assert_eq!(
        s.pool.try_approve_payout(&pool_id, &first),
        Err(Ok(Error::AlreadyApproved))
    );

    assert!(s
        .pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 2)));
    assert_eq!(s.usdc.balance(&admin), 10 * USDC);
    let pool = s.pool.get_pool(&pool_id);
    assert_eq!(pool.status, PoolStatus::Settled);
    assert_eq!(pool.payout_approvals, None);

    // The third approver is too late: the pool is closed.
    assert_eq!(
        s.pool
            .try_approve_payout(&pool_id, &Setup::approver(&approvers, 1)),
        Err(Ok(Error::PoolClosed))
    );
}

#[test]
fn majority_means_one_of_one_and_two_of_two() {
    for (n, needed) in [(1usize, 1u32), (2, 2)] {
        let s = Setup::new();
        let admin = s.wallet(0);
        let (pool_id, approvers) = s.funded_pool_with_approvers(&admin, n);
        s.pool.request_payout(&pool_id);
        for i in 0..needed {
            let paid = s
                .pool
                .approve_payout(&pool_id, &Setup::approver(&approvers, i));
            assert_eq!(paid, i + 1 == needed, "{n} approvers, approval {}", i + 1);
        }
        assert_eq!(s.usdc.balance(&admin), 10 * USDC);
    }
}

#[test]
fn a_decline_cancels_the_request_and_approvals_start_over() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.funded_pool_with_approvers(&admin, 3);
    let (a, b, c) = (
        Setup::approver(&approvers, 0),
        Setup::approver(&approvers, 1),
        Setup::approver(&approvers, 2),
    );

    s.pool.request_payout(&pool_id);
    s.pool.approve_payout(&pool_id, &a);
    s.pool.decline_payout(&pool_id, &b);
    assert_eq!(
        s.pool_events(),
        [PayoutDeclined {
            pool_id,
            approver: b.clone(),
        }
        .to_xdr(&s.env, &s.pool.address)]
    );
    assert_eq!(s.pool.get_pool(&pool_id).payout_approvals, None);
    assert_eq!(s.usdc.balance(&s.pool.address), 10 * USDC);
    assert_eq!(
        s.pool.try_decline_payout(&pool_id, &c),
        Err(Ok(Error::NoPayoutRequest))
    );

    // A new request needs a fresh majority; the earlier approval doesn't count.
    s.pool.request_payout(&pool_id);
    assert!(!s.pool.approve_payout(&pool_id, &c));
    assert_eq!(s.usdc.balance(&admin), 0);
    assert!(s.pool.approve_payout(&pool_id, &a));
    assert_eq!(s.usdc.balance(&admin), 10 * USDC);
}

#[test]
fn contributions_pause_while_a_payout_waits_for_approval() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.funded_pool_with_approvers(&admin, 3);
    let late = s.wallet(5 * USDC);

    s.pool.request_payout(&pool_id);
    assert_eq!(
        s.pool.try_contribute(&pool_id, &late, &USDC),
        Err(Ok(Error::PayoutPending))
    );

    s.pool
        .decline_payout(&pool_id, &Setup::approver(&approvers, 0));
    s.pool.contribute(&pool_id, &late, &USDC);
    assert_eq!(s.pool.get_pool(&pool_id).total_contributed, 11 * USDC);
}

#[test]
fn cancelling_drops_the_request_and_refunds_everyone() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let approvers = s.approvers(3);
    let pool_id = s.pool_with_approvers(&admin, 10 * USDC, &approvers);
    let member = s.wallet(10 * USDC);
    s.pool.contribute(&pool_id, &member, &(10 * USDC));
    s.pool.request_payout(&pool_id);
    s.pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 0));

    s.pool.cancel_pool(&pool_id);

    assert_eq!(
        s.pool
            .try_approve_payout(&pool_id, &Setup::approver(&approvers, 1)),
        Err(Ok(Error::PoolClosed))
    );
    assert_eq!(s.pool.claim_refund(&pool_id, &member), 10 * USDC);
    assert_eq!(s.usdc.balance(&admin), 0);
}

#[test]
fn request_payout_needs_a_funded_pool_with_approvers() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let plain = s.new_pool(&admin, 10 * USDC);
    s.pool
        .contribute(&plain, &s.wallet(10 * USDC), &(10 * USDC));
    assert_eq!(
        s.pool.try_request_payout(&plain),
        Err(Ok(Error::NoApprovers))
    );

    let unfunded = s.pool_with_approvers(&admin, 10 * USDC, &s.approvers(1));
    assert_eq!(
        s.pool.try_request_payout(&unfunded),
        Err(Ok(Error::GoalNotReached))
    );
    s.pass_deadline();
    assert_eq!(
        s.pool.try_request_payout(&unfunded),
        Err(Ok(Error::PoolClosed))
    );
}

// Who may approve

#[test]
fn only_listed_approvers_can_approve_or_decline() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let member = s.wallet(10 * USDC);
    let approvers = s.approvers(1);
    let pool_id = s.pool_with_approvers(&admin, 10 * USDC, &approvers);
    s.pool.contribute(&pool_id, &member, &(10 * USDC));
    s.pool.request_payout(&pool_id);

    for outsider in [
        admin.clone(),
        member.clone(),
        s.contract_admin.clone(),
        s.wallet(0),
    ] {
        assert_eq!(
            s.pool.try_approve_payout(&pool_id, &outsider),
            Err(Ok(Error::NotApprover))
        );
        assert_eq!(
            s.pool.try_decline_payout(&pool_id, &outsider),
            Err(Ok(Error::NotApprover))
        );
    }
    assert_eq!(s.usdc.balance(&admin), 0);
}

#[test]
fn approving_needs_the_approvers_own_signature() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.funded_pool_with_approvers(&admin, 1);
    let approver = Setup::approver(&approvers, 0);
    let pool = s.pool.address.clone();
    s.pool.request_payout(&pool_id);

    // The pool admin signs an approval in the approver's name.
    let args = (pool_id, approver.clone()).into_val(&s.env);
    s.only_signed_by(&admin, &pool, "approve_payout", args);
    assert!(s.pool.try_approve_payout(&pool_id, &approver).is_err());
    assert_eq!(s.usdc.balance(&admin), 0);

    let args = (pool_id, approver.clone()).into_val(&s.env);
    s.only_signed_by(&approver, &pool, "approve_payout", args);
    assert!(s.pool.approve_payout(&pool_id, &approver));
    assert_eq!(s.usdc.balance(&admin), 10 * USDC);
}

#[test]
fn requesting_a_payout_needs_the_pool_admins_signature() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.funded_pool_with_approvers(&admin, 1);
    let pool = s.pool.address.clone();

    let approver = Setup::approver(&approvers, 0);
    s.only_signed_by(
        &approver,
        &pool,
        "request_payout",
        (pool_id,).into_val(&s.env),
    );
    assert!(s.pool.try_request_payout(&pool_id).is_err());
    assert_eq!(s.pool.get_pool(&pool_id).payout_approvals, None);
}

// The platform fee

#[test]
fn payouts_send_the_fee_to_the_fee_recipient() {
    let s = Setup::with_fee(500);
    let admin = s.wallet(0);
    let pool_id = s.new_pool(&admin, 100 * USDC);
    s.pool
        .contribute(&pool_id, &s.wallet(100 * USDC), &(100 * USDC));

    assert_eq!(s.pool.settle(&pool_id), 95 * USDC);
    assert_eq!(
        s.pool_events().events().last().unwrap(),
        &PoolSettled {
            pool_id,
            admin: admin.clone(),
            amount: 95 * USDC,
            fee: 5 * USDC,
        }
        .to_xdr(&s.env, &s.pool.address)
    );
    assert_eq!(s.usdc.balance(&admin), 95 * USDC);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 5 * USDC);
    assert_eq!(s.usdc.balance(&s.pool.address), 0);
}

#[test]
fn approved_payouts_take_the_fee_too() {
    let s = Setup::with_fee(500);
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.funded_pool_with_approvers(&admin, 1);
    s.pool.request_payout(&pool_id);
    s.pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 0));

    assert_eq!(s.usdc.balance(&admin), 95 * USDC / 10);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 5 * USDC / 10);
}

#[test]
fn the_fee_rounds_down_and_never_takes_more_than_the_pool() {
    let s = Setup::with_fee(500);
    let admin = s.wallet(0);
    // 19 base units: 5% is 0.95, which rounds down to 0.
    let pool_id = s.new_pool(&admin, 19);
    s.pool.contribute(&pool_id, &s.wallet(19), &19);

    assert_eq!(s.pool.settle(&pool_id), 19);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 0);
}

#[test]
fn refunds_are_never_charged_the_fee() {
    let s = Setup::with_fee(500);
    let (pool_id, member) = s.pool_with_contribution(&s.wallet(0), 100 * USDC, 40 * USDC);
    s.pass_deadline();

    assert_eq!(s.pool.claim_refund(&pool_id, &member), 40 * USDC);
    assert_eq!(s.usdc.balance(&member), 40 * USDC);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 0);
}

#[test]
fn only_the_contract_admin_sets_the_fee_within_the_cap() {
    let s = Setup::new();
    let recipient = s.wallet(0);
    let pool = s.pool.address.clone();

    s.pool.set_fee(&500, &recipient);
    assert_eq!(s.env.auths()[0].0, s.contract_admin);
    assert_eq!(
        s.pool.fee(),
        Some(FeeConfig {
            bps: 500,
            recipient: recipient.clone()
        })
    );
    assert_eq!(
        s.pool.try_set_fee(&1_001, &recipient),
        Err(Ok(Error::InvalidFee))
    );

    let stranger = s.wallet(0);
    s.only_signed_by(
        &stranger,
        &pool,
        "set_fee",
        (0u32, stranger.clone()).into_val(&s.env),
    );
    assert!(s.pool.try_set_fee(&0, &stranger).is_err());
    assert_eq!(s.pool.fee().map(|f| f.bps), Some(500));
}

#[test]
#[should_panic]
fn a_fee_over_the_cap_cannot_be_deployed() {
    Setup::with_fee(1_001);
}

// Upgrading from the first release

/// The pool layout stored by the first release, before approvers existed.
#[contracttype]
struct PoolV1 {
    id: u64,
    admin: Address,
    goal_amount: i128,
    deadline: u64,
    total_contributed: i128,
    total_refunded: i128,
    member_count: u32,
    status: PoolStatus,
    created_at: u64,
}

#[test]
fn pools_stored_by_the_first_release_still_work() {
    let s = Setup::with_fee(500);
    let admin = s.wallet(0);
    let member = s.wallet(10 * USDC);
    let old = PoolV1 {
        id: 0,
        admin: admin.clone(),
        goal_amount: 10 * USDC,
        deadline: START + 3600,
        total_contributed: 0,
        total_refunded: 0,
        member_count: 0,
        status: PoolStatus::Open,
        created_at: START,
    };
    s.env.as_contract(&s.pool.address, || {
        s.env.storage().persistent().set(&DataKey::Pool(0), &old);
        s.env.storage().instance().set(&DataKey::NextPoolId, &1u64);
    });

    let pool = s.pool.get_pool(&0);
    assert_eq!((pool.approvers, pool.payout_approvals), (None, None));

    // It behaves as a pool without approvers.
    s.pool.contribute(&0, &member, &(10 * USDC));
    assert_eq!(s.pool.try_request_payout(&0), Err(Ok(Error::NoApprovers)));
    assert_eq!(s.pool.settle(&0), 95 * USDC / 10);
    assert_eq!(s.usdc.balance(&admin), 95 * USDC / 10);
}

#[test]
fn a_contract_upgraded_from_the_first_release_has_no_fee_until_one_is_set() {
    let s = Setup::with_fee(500);
    s.env.as_contract(&s.pool.address, || {
        s.env.storage().instance().remove(&DataKey::Fee);
    });
    assert_eq!(s.pool.fee(), None);

    let admin = s.wallet(0);
    let (pool_id, _) = s.pool_with_contribution(&admin, 10 * USDC, 10 * USDC);
    assert_eq!(s.pool.settle(&pool_id), 10 * USDC);
}
