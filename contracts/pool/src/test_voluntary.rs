#![cfg(test)]
//! Voluntary pools (any amount from a minimum, an optional goal and deadline,
//! and a resolution rule), and fixed pools' shares: what each member owes and
//! whether they've paid, on-chain. Each security rule has its own test.

extern crate std;

use super::*;
use crate::test::{Setup, DAY, START, USDC};
use soroban_sdk::{testutils::Ledger, Address, IntoVal, Vec};

impl<'a> Setup<'a> {
    fn voluntary_terms(
        &self,
        goal: i128,
        minimum: i128,
        deadline: Option<u64>,
        resolution: Resolution,
    ) -> PoolTerms {
        PoolTerms {
            kind: PoolKind::Voluntary,
            goal_amount: goal,
            deadline,
            share_amount: None,
            min_contribution: Some(minimum),
            resolution,
            approvers: Vec::new(&self.env),
            threshold: None,
            approval_window: None,
        }
    }

    fn voluntary_pool(
        &self,
        admin: &Address,
        goal: i128,
        deadline: Option<u64>,
        resolution: Resolution,
    ) -> u64 {
        let terms = self.voluntary_terms(goal, 2 * USDC, deadline, resolution);
        self.pool.create_pool_with_terms(admin, &terms)
    }

    /// Three wallets put in 3, 7.50 and 12 USDC.
    fn three_amounts(&self, pool_id: u64) -> [(Address, i128); 3] {
        let amounts = [3 * USDC, 75 * USDC / 10, 12 * USDC];
        amounts.map(|amount| {
            let wallet = self.wallet(amount);
            self.pool.contribute(&pool_id, &wallet, &amount);
            (wallet, amount)
        })
    }
}

// Voluntary pools

#[test]
fn a_voluntary_pool_takes_different_amounts_from_its_minimum() {
    let s = Setup::new();
    let pool_id = s.voluntary_pool(
        &s.wallet(0),
        0,
        Some(s.deadline()),
        Resolution::KeepWhatsRaised,
    );

    let paid = s.three_amounts(pool_id);

    let pool = s.pool.get_pool(&pool_id);
    assert_eq!(
        (pool.total_contributed, pool.member_count),
        (225 * USDC / 10, 3)
    );
    let statuses = s.pool.get_member_statuses(&pool_id, &0, &10);
    for (i, (wallet, amount)) in paid.iter().enumerate() {
        let status = statuses.get(i as u32).unwrap();
        assert_eq!(
            (
                &status.member,
                status.contributed,
                status.paid,
                status.expected
            ),
            (wallet, *amount, true, None)
        );
    }
    assert_eq!(s.usdc.balance(&s.pool.address), 225 * USDC / 10);
}

// Security rule: contributions below the minimum are rejected

#[test]
fn contributions_below_the_minimum_are_rejected() {
    let s = Setup::new();
    let pool_id = s.voluntary_pool(&s.wallet(0), 0, None, Resolution::KeepWhatsRaised);
    let wallet = s.wallet(10 * USDC);

    for amount in [1, USDC, 2 * USDC - 1] {
        assert_eq!(
            s.pool.try_contribute(&pool_id, &wallet, &amount),
            Err(Ok(Error::BelowMinimum))
        );
    }
    assert_eq!(s.usdc.balance(&wallet), 10 * USDC);
    assert_eq!(s.pool.get_pool(&pool_id).member_count, 0);
    // Exactly the minimum is fine.
    s.pool.contribute(&pool_id, &wallet, &(2 * USDC));
    assert_eq!(s.pool.get_pool(&pool_id).total_contributed, 2 * USDC);
}

#[test]
fn all_or_nothing_needs_a_goal() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let terms = s.voluntary_terms(0, USDC, Some(s.deadline()), Resolution::AllOrNothing);
    assert_eq!(
        s.pool.try_create_pool_with_terms(&admin, &terms),
        Err(Ok(Error::InvalidTerms))
    );
    let no_goal = s.voluntary_pool(&admin, 0, Some(s.deadline()), Resolution::KeepWhatsRaised);
    assert_eq!(
        s.pool
            .try_set_resolution(&no_goal, &Resolution::AllOrNothing),
        Err(Ok(Error::InvalidTerms))
    );
}

#[test]
fn pool_terms_must_fit_together() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let deadline = Some(s.deadline());
    let mut no_minimum = s.voluntary_terms(10 * USDC, USDC, deadline, Resolution::KeepWhatsRaised);
    no_minimum.min_contribution = None;
    let mut with_share = s.voluntary_terms(10 * USDC, USDC, deadline, Resolution::KeepWhatsRaised);
    with_share.share_amount = Some(USDC);
    let admin_decides = s.voluntary_terms(10 * USDC, USDC, deadline, Resolution::AdminDecides);
    let none = Vec::new(&s.env);
    let mut fixed_all_or_nothing = s.fixed_terms(10 * USDC, 5 * USDC, &none, None, None);
    fixed_all_or_nothing.resolution = Resolution::AllOrNothing;
    let mut fixed_no_share = s.fixed_terms(10 * USDC, 5 * USDC, &none, None, None);
    fixed_no_share.share_amount = None;
    for terms in [
        no_minimum,
        with_share,
        admin_decides,
        fixed_all_or_nothing,
        fixed_no_share,
    ] {
        assert_eq!(
            s.pool.try_create_pool_with_terms(&admin, &terms),
            Err(Ok(Error::InvalidTerms))
        );
    }

    let zero_minimum = s.voluntary_terms(10 * USDC, 0, deadline, Resolution::KeepWhatsRaised);
    assert_eq!(
        s.pool.try_create_pool_with_terms(&admin, &zero_minimum),
        Err(Ok(Error::InvalidAmount))
    );
    let mut fixed_no_deadline = s.fixed_terms(10 * USDC, 5 * USDC, &none, None, None);
    fixed_no_deadline.deadline = None;
    assert_eq!(
        s.pool
            .try_create_pool_with_terms(&admin, &fixed_no_deadline),
        Err(Ok(Error::InvalidDeadline))
    );
    assert_eq!(s.pool.pool_count(), 0);
}

// Security rule: the resolution rule is locked after the first contribution

#[test]
fn the_resolution_rule_is_locked_after_the_first_contribution() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let pool_id = s.voluntary_pool(
        &admin,
        20 * USDC,
        Some(s.deadline()),
        Resolution::KeepWhatsRaised,
    );

    // Before anyone contributes, the pool admin can change it.
    s.pool.set_resolution(&pool_id, &Resolution::AllOrNothing);
    assert_eq!(
        s.pool.get_pool_settings(&pool_id).resolution,
        Resolution::AllOrNothing
    );

    s.pool
        .contribute(&pool_id, &s.wallet(5 * USDC), &(5 * USDC));

    assert_eq!(
        s.pool
            .try_set_resolution(&pool_id, &Resolution::KeepWhatsRaised),
        Err(Ok(Error::TermsLocked))
    );
    assert_eq!(
        s.pool.get_pool_settings(&pool_id).resolution,
        Resolution::AllOrNothing
    );
    // And it still decides: below the goal at the deadline, everyone is refunded.
    s.pass_deadline();
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Refunded);
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::PoolClosed)));
}

#[test]
fn only_the_pool_admin_can_change_the_resolution_rule() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let pool_id = s.voluntary_pool(
        &admin,
        20 * USDC,
        Some(s.deadline()),
        Resolution::AllOrNothing,
    );
    let stranger = s.wallet(0);
    s.only_signed_by(
        &stranger,
        &s.pool.address,
        "set_resolution",
        (pool_id, Resolution::KeepWhatsRaised).into_val(&s.env),
    );
    assert!(s
        .pool
        .try_set_resolution(&pool_id, &Resolution::KeepWhatsRaised)
        .is_err());
    s.env.mock_all_auths();
    assert_eq!(
        s.pool.get_pool_settings(&pool_id).resolution,
        Resolution::AllOrNothing
    );
}

// All-or-nothing

#[test]
fn all_or_nothing_pays_out_once_the_goal_is_met() {
    let s = Setup::with_fee(500);
    let admin = s.wallet(0);
    let pool_id = s.voluntary_pool(
        &admin,
        20 * USDC,
        Some(s.deadline()),
        Resolution::AllOrNothing,
    );
    s.three_amounts(pool_id);

    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Funded);
    assert_eq!(s.pool.settle(&pool_id), 225 * USDC * 95 / 1000);
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Settled);
}

// Security rule: all-or-nothing refunds return exactly what each person paid, once

#[test]
fn all_or_nothing_refunds_exactly_what_each_paid_once() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let pool_id = s.voluntary_pool(
        &admin,
        50 * USDC,
        Some(s.deadline()),
        Resolution::AllOrNothing,
    );
    let paid = s.three_amounts(pool_id);
    let late = s.wallet(5 * USDC);

    // Below the goal at the deadline: refundable, without the pool admin cancelling.
    s.pass_deadline();
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Refunded);
    assert_eq!(
        s.pool.try_contribute(&pool_id, &late, &(5 * USDC)),
        Err(Ok(Error::PoolClosed))
    );
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::PoolClosed)));
    assert_eq!(
        s.pool.try_extend_deadline(&pool_id, &(s.deadline() + DAY)),
        Err(Ok(Error::PoolClosed))
    );

    for (wallet, amount) in paid.iter() {
        assert_eq!(s.pool.claim_refund(&pool_id, wallet), *amount);
        assert_eq!(s.usdc.balance(wallet), *amount);
        assert_eq!(
            s.pool.try_claim_refund(&pool_id, wallet),
            Err(Ok(Error::NothingToRefund))
        );
    }
    let pool = s.pool.get_pool(&pool_id);
    assert_eq!(
        (pool.total_refunded, pool.status),
        (225 * USDC / 10, PoolStatus::Refunded)
    );
    assert_eq!(s.usdc.balance(&s.pool.address), 0);
    assert_eq!(s.usdc.balance(&admin), 0);
}

#[test]
fn all_or_nothing_refunds_cannot_start_before_the_deadline() {
    let s = Setup::new();
    let pool_id = s.voluntary_pool(
        &s.wallet(0),
        50 * USDC,
        Some(s.deadline()),
        Resolution::AllOrNothing,
    );
    let [(wallet, _), ..] = s.three_amounts(pool_id);
    assert_eq!(
        s.pool.try_claim_refund(&pool_id, &wallet),
        Err(Ok(Error::NotRefundable))
    );
}

// Keep-what's-raised

#[test]
fn keep_whats_raised_releases_what_was_raised_at_the_deadline() {
    let s = Setup::new();
    let admin = s.wallet(0);
    // A goal it never reaches: the money still goes to the pool admin.
    let pool_id = s.voluntary_pool(
        &admin,
        100 * USDC,
        Some(s.deadline()),
        Resolution::KeepWhatsRaised,
    );
    s.three_amounts(pool_id);

    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Open);
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::NotSettleable)));

    s.pass_deadline();
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Funded);
    assert_eq!(
        s.pool.get_pool_settings(&pool_id).settleable_since,
        Some(s.deadline())
    );
    assert_eq!(
        s.pool.try_extend_deadline(&pool_id, &(s.deadline() + DAY)),
        Err(Ok(Error::DeadlinePassed))
    );
    assert_eq!(s.pool.settle(&pool_id), 225 * USDC / 10);
    assert_eq!(s.usdc.balance(&admin), 225 * USDC / 10);
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::PoolClosed)));
}

#[test]
fn keep_whats_raised_without_a_deadline_releases_any_time() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let pool_id = s.voluntary_pool(&admin, 0, None, Resolution::KeepWhatsRaised);
    assert_eq!(s.pool.get_pool(&pool_id).deadline, NO_DEADLINE);
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::NotSettleable)));

    s.env.ledger().set_timestamp(START + 400 * DAY);
    s.three_amounts(pool_id);
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Funded);
    assert_eq!(s.pool.settle(&pool_id), 225 * USDC / 10);
}

#[test]
fn keep_whats_raised_with_approvers_releases_through_them() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let approvers = s.approvers(2);
    let mut terms = s.voluntary_terms(0, 2 * USDC, Some(s.deadline()), Resolution::KeepWhatsRaised);
    terms.approvers = approvers.clone();
    terms.threshold = Some(2);
    terms.approval_window = Some(DAY);
    let pool_id = s.pool.create_pool_with_terms(&admin, &terms);
    let [(first, _), ..] = s.three_amounts(pool_id);

    s.pass_deadline();
    assert_eq!(
        s.pool.try_settle(&pool_id),
        Err(Ok(Error::ApprovalRequired))
    );
    s.pool.request_payout(&pool_id);
    assert!(!s
        .pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 0)));
    // The window counts from the deadline.
    s.env.ledger().set_timestamp(s.deadline() + DAY);
    assert_eq!(
        s.pool
            .try_approve_payout(&pool_id, &Setup::approver(&approvers, 1)),
        Err(Ok(Error::ApprovalWindowExpired))
    );
    assert_eq!(s.pool.reclaim(&pool_id, &first), 3 * USDC);
}

// Fixed pools: shares on-chain

#[test]
fn fixed_pool_members_owe_their_share_on_chain() {
    let s = Setup::new();
    let none = Vec::new(&s.env);
    let terms = s.fixed_terms(20 * USDC, 10 * USDC, &none, None, None);
    let pool_id = s.pool.create_pool_with_terms(&s.wallet(0), &terms);
    let (ada, tobi) = (s.wallet(10 * USDC), s.wallet(10 * USDC));

    s.pool.join_pool(&pool_id, &ada);
    s.pool.contribute(&pool_id, &tobi, &(4 * USDC));
    let statuses = s.pool.get_member_statuses(&pool_id, &0, &10);
    assert_eq!(
        statuses,
        soroban_sdk::vec![
            &s.env,
            MemberStatus {
                member: ada.clone(),
                expected: Some(10 * USDC),
                contributed: 0,
                paid: false,
                refunded: false
            },
            MemberStatus {
                member: tobi.clone(),
                expected: Some(10 * USDC),
                contributed: 4 * USDC,
                paid: false,
                refunded: false
            },
        ]
    );

    s.pool.contribute(&pool_id, &tobi, &(6 * USDC));
    s.pool.contribute(&pool_id, &ada, &(10 * USDC));
    let tobi_record = s.pool.get_member(&pool_id, &tobi).unwrap();
    assert_eq!(
        (tobi_record.expected, tobi_record.paid),
        (Some(10 * USDC), Some(true))
    );
    assert!(s
        .pool
        .get_member_statuses(&pool_id, &0, &10)
        .iter()
        .all(|m| m.paid));
}

// Security rule: paid status only changes through a real contribution

#[test]
fn paid_status_only_changes_through_a_real_contribution() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let none = Vec::new(&s.env);
    let terms = s.fixed_terms(20 * USDC, 10 * USDC, &none, None, None);
    let pool_id = s.pool.create_pool_with_terms(&admin, &terms);
    let member = s.wallet(10 * USDC);
    let paid = |s: &Setup| s.pool.get_member(&pool_id, &member).unwrap().paid;

    // Joining owes the share; it doesn't pay it.
    s.pool.join_pool(&pool_id, &member);
    assert_eq!(paid(&s), Some(false));

    // The pool admin can't pay from the member's wallet (nor name them paid: no function does).
    s.only_signed_by(
        &admin,
        &s.pool.address,
        "contribute",
        (pool_id, member.clone(), 10 * USDC).into_val(&s.env),
    );
    assert!(s
        .pool
        .try_contribute(&pool_id, &member, &(10 * USDC))
        .is_err());
    s.env.mock_all_auths();
    assert_eq!(paid(&s), Some(false));

    // A contribution that can't be paid (more than the wallet holds) changes nothing.
    assert!(s
        .pool
        .try_contribute(&pool_id, &member, &(11 * USDC))
        .is_err());
    assert_eq!(paid(&s), Some(false));

    // Someone else paying their own share leaves this member unpaid.
    s.pool
        .contribute(&pool_id, &s.wallet(10 * USDC), &(10 * USDC));
    assert_eq!(paid(&s), Some(false));

    // Only the member's own contribution of the share marks them paid.
    s.pool.contribute(&pool_id, &member, &(10 * USDC));
    assert_eq!(paid(&s), Some(true));
    assert_eq!(s.usdc.balance(&member), 0);
}
