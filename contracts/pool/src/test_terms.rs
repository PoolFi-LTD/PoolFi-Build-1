#![cfg(test)]
//! Approval thresholds and windows: a payout needs the pool's threshold of
//! approvals; if the approvers don't reach it within the window, contributors
//! reclaim their USDC. Approvers, threshold and window are fixed once anyone
//! has contributed. Each security rule has its own test.

extern crate std;

use super::*;
use crate::test::{Setup, DAY, START, USDC};
use soroban_sdk::{testutils::Ledger, Address, Event as _, IntoVal, Vec};

/// The approval window the tests use.
const WINDOW: u64 = 2 * DAY;

impl<'a> Setup<'a> {
    pub(crate) fn fixed_terms(
        &self,
        goal: i128,
        share: i128,
        approvers: &Vec<Address>,
        threshold: Option<u32>,
        approval_window: Option<u64>,
    ) -> PoolTerms {
        PoolTerms {
            kind: PoolKind::Fixed,
            goal_amount: goal,
            deadline: Some(self.deadline()),
            share_amount: Some(share),
            min_contribution: None,
            resolution: Resolution::AdminDecides,
            approvers: approvers.clone(),
            threshold,
            approval_window,
        }
    }

    /// A fixed 10 USDC pool (two shares of 5) with three approvers, needing two.
    fn two_of_three(&self, admin: &Address, window: Option<u64>) -> (u64, Vec<Address>) {
        let approvers = self.approvers(3);
        let terms = self.fixed_terms(10 * USDC, 5 * USDC, &approvers, Some(2), window);
        (self.pool.create_pool_with_terms(admin, &terms), approvers)
    }

    /// Two members pay their 5 USDC shares; returns them.
    fn fund(&self, pool_id: u64) -> (Address, Address) {
        let (a, b) = (self.wallet(5 * USDC), self.wallet(5 * USDC));
        self.pool.contribute(&pool_id, &a, &(5 * USDC));
        self.pool.contribute(&pool_id, &b, &(5 * USDC));
        (a, b)
    }

    fn at(&self, timestamp: u64) {
        self.env.ledger().set_timestamp(timestamp);
    }
}

// Thresholds

#[test]
fn a_payout_waits_for_the_threshold_then_pays_out() {
    let s = Setup::with_fee(500);
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.two_of_three(&admin, None);
    s.fund(pool_id);

    s.pool.request_payout(&pool_id);
    assert!(!s
        .pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 0)));
    // One approval of two: nothing has moved, and the admin can't settle alone.
    assert_eq!(s.usdc.balance(&admin), 0);
    assert_eq!(
        s.pool.try_settle(&pool_id),
        Err(Ok(Error::ApprovalRequired))
    );
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Funded);

    assert!(s
        .pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 2)));
    assert_eq!(s.usdc.balance(&admin), 95 * USDC / 10);
    assert_eq!(s.usdc.balance(&s.fee_recipient), 5 * USDC / 10);
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Settled);
}

#[test]
fn a_threshold_of_one_pays_out_on_the_first_approval() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let approvers = s.approvers(3);
    let terms = s.fixed_terms(10 * USDC, 5 * USDC, &approvers, Some(1), None);
    let pool_id = s.pool.create_pool_with_terms(&admin, &terms);
    s.fund(pool_id);

    s.pool.request_payout(&pool_id);
    assert!(s
        .pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 1)));
    assert_eq!(s.usdc.balance(&admin), 10 * USDC);
}

#[test]
fn without_a_threshold_a_majority_is_needed() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let approvers = s.approvers(4);
    let terms = s.fixed_terms(10 * USDC, 5 * USDC, &approvers, None, None);
    let pool_id = s.pool.create_pool_with_terms(&admin, &terms);
    s.fund(pool_id);

    s.pool.request_payout(&pool_id);
    assert!(!s
        .pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 0)));
    assert!(!s
        .pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 1)));
    assert!(s
        .pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 2)));
}

#[test]
fn the_threshold_must_fit_the_approvers() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let approvers = s.approvers(3);
    let none = Vec::new(&s.env);
    for (list, threshold) in [(&approvers, 0), (&approvers, 4), (&none, 1)] {
        let terms = s.fixed_terms(10 * USDC, 5 * USDC, list, Some(threshold), None);
        assert_eq!(
            s.pool.try_create_pool_with_terms(&admin, &terms),
            Err(Ok(Error::InvalidThreshold))
        );
    }
    for (list, window) in [(&none, DAY), (&approvers, 0), (&approvers, 366 * DAY)] {
        let terms = s.fixed_terms(10 * USDC, 5 * USDC, list, None, Some(window));
        assert_eq!(
            s.pool.try_create_pool_with_terms(&admin, &terms),
            Err(Ok(Error::InvalidApprovalWindow))
        );
    }
    assert_eq!(s.pool.pool_count(), 0);
}

#[test]
fn a_pool_without_approvers_settles_as_before() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let terms = s.fixed_terms(10 * USDC, 5 * USDC, &Vec::new(&s.env), None, None);
    let pool_id = s.pool.create_pool_with_terms(&admin, &terms);
    s.fund(pool_id);

    assert_eq!(
        s.pool.try_request_payout(&pool_id),
        Err(Ok(Error::NoApprovers))
    );
    assert_eq!(s.pool.settle(&pool_id), 10 * USDC);
    assert_eq!(s.usdc.balance(&admin), 10 * USDC);
}

#[test]
fn the_settings_are_stored_and_announced() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.two_of_three(&admin, Some(WINDOW));

    assert_eq!(
        s.pool_events(),
        [
            PoolCreated {
                pool_id,
                admin,
                goal_amount: 10 * USDC,
                deadline: s.deadline(),
                approvers: approvers.clone(),
            }
            .to_xdr(&s.env, &s.pool.address),
            SettingsChanged {
                pool_id,
                kind: PoolKind::Fixed,
                resolution: Resolution::AdminDecides,
                approvers: approvers.clone(),
                threshold: Some(2),
                approval_window: Some(WINDOW),
                share_amount: Some(5 * USDC),
                min_contribution: None,
            }
            .to_xdr(&s.env, &s.pool.address),
        ]
    );
    assert_eq!(
        s.pool.get_pool_settings(&pool_id),
        PoolSettings {
            kind: PoolKind::Fixed,
            resolution: Resolution::AdminDecides,
            threshold: Some(2),
            approval_window: Some(WINDOW),
            share_amount: Some(5 * USDC),
            min_contribution: None,
            settleable_since: None,
        }
    );
    assert_eq!(s.pool.get_pool(&pool_id).approvers, Some(approvers.clone()));
}

#[test]
fn a_pool_made_without_settings_gets_the_old_defaults() {
    let s = Setup::new();
    let pool_id = s.new_pool(&s.wallet(0), 10 * USDC);
    let settings = s.pool.get_pool_settings(&pool_id);
    assert_eq!(
        (
            settings.kind,
            settings.resolution,
            settings.threshold,
            settings.approval_window
        ),
        (PoolKind::Fixed, Resolution::AdminDecides, None, None)
    );
}

// Security rule: only assigned approvers can approve

#[test]
fn only_assigned_approvers_can_approve() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, _) = s.two_of_three(&admin, None);
    let (other_pool, other_approvers) = s.two_of_three(&s.wallet(0), None);
    let (member, _) = s.fund(pool_id);
    s.pool.request_payout(&pool_id);

    let outsiders = [
        s.wallet(0),
        member,
        admin.clone(),
        Setup::approver(&other_approvers, 0),
    ];
    for outsider in outsiders.iter() {
        assert_eq!(
            s.pool.try_approve_payout(&pool_id, outsider),
            Err(Ok(Error::NotApprover))
        );
    }
    assert_eq!(
        s.pool.get_pool(&pool_id).payout_approvals,
        Some(Vec::new(&s.env))
    );
    assert_eq!(s.usdc.balance(&admin), 0);
    assert_eq!(s.pool.get_pool(&other_pool).status, PoolStatus::Open);
}

#[test]
fn an_approval_must_be_signed_by_the_approver() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.two_of_three(&admin, None);
    s.fund(pool_id);
    s.pool.request_payout(&pool_id);
    let approver = Setup::approver(&approvers, 0);

    // The pool admin signs an approval naming an approver.
    s.only_signed_by(
        &admin,
        &s.pool.address,
        "approve_payout",
        (pool_id, approver.clone()).into_val(&s.env),
    );
    assert!(s.pool.try_approve_payout(&pool_id, &approver).is_err());
    s.env.mock_all_auths();
    assert_eq!(
        s.pool.get_pool(&pool_id).payout_approvals,
        Some(Vec::new(&s.env))
    );
}

// Security rule: each approver approves once per pool

#[test]
fn each_approver_approves_once() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let approvers = s.approvers(3);
    let terms = s.fixed_terms(10 * USDC, 5 * USDC, &approvers, Some(3), None);
    let pool_id = s.pool.create_pool_with_terms(&admin, &terms);
    s.fund(pool_id);
    s.pool.request_payout(&pool_id);
    let approver = Setup::approver(&approvers, 0);

    assert!(!s.pool.approve_payout(&pool_id, &approver));
    for _ in 0..3 {
        assert_eq!(
            s.pool.try_approve_payout(&pool_id, &approver),
            Err(Ok(Error::AlreadyApproved))
        );
    }
    let approvals = s.pool.get_pool(&pool_id).payout_approvals.unwrap();
    assert_eq!(approvals.len(), 1);
    assert_eq!(s.usdc.balance(&admin), 0);
}

// Security rule: approvers and threshold are locked after the first contribution

#[test]
fn approvers_and_threshold_are_locked_after_the_first_contribution() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, _) = s.two_of_three(&admin, None);

    // Before anyone contributes, the pool admin can change them.
    let replacements = s.approvers(2);
    s.pool
        .set_approvers(&pool_id, &replacements, &Some(1), &Some(WINDOW));
    assert_eq!(
        s.pool.get_pool(&pool_id).approvers,
        Some(replacements.clone())
    );
    let settings = s.pool.get_pool_settings(&pool_id);
    assert_eq!(
        (settings.threshold, settings.approval_window),
        (Some(1), Some(WINDOW))
    );

    s.pool
        .contribute(&pool_id, &s.wallet(5 * USDC), &(5 * USDC));

    let anyone_else = s.approvers(3);
    assert_eq!(
        s.pool
            .try_set_approvers(&pool_id, &anyone_else, &Some(3), &None),
        Err(Ok(Error::TermsLocked))
    );
    assert_eq!(
        s.pool
            .try_set_approvers(&pool_id, &replacements, &Some(2), &Some(WINDOW)),
        Err(Ok(Error::TermsLocked))
    );
    assert_eq!(
        s.pool
            .try_set_approvers(&pool_id, &Vec::new(&s.env), &None, &None),
        Err(Ok(Error::TermsLocked))
    );
    assert_eq!(s.pool.get_pool(&pool_id).approvers, Some(replacements));
    assert_eq!(s.pool.get_pool_settings(&pool_id).threshold, Some(1));
}

#[test]
fn only_the_pool_admin_can_change_the_approvers() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.two_of_three(&admin, None);
    let stranger = s.wallet(0);
    let mine = s.approvers(1);

    s.only_signed_by(
        &stranger,
        &s.pool.address,
        "set_approvers",
        (pool_id, mine.clone(), Some(1u32), None::<u64>).into_val(&s.env),
    );
    assert!(s
        .pool
        .try_set_approvers(&pool_id, &mine, &Some(1), &None)
        .is_err());
    s.env.mock_all_auths();
    assert_eq!(s.pool.get_pool(&pool_id).approvers, Some(approvers));
}

// Security rule: the pool admin cannot bypass approvals

#[test]
fn the_pool_admin_cannot_bypass_approvals() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, _) = s.two_of_three(&admin, None);
    s.fund(pool_id);

    // Settling alone, approving their own payout, or dropping the approvers.
    assert_eq!(
        s.pool.try_settle(&pool_id),
        Err(Ok(Error::ApprovalRequired))
    );
    s.pool.request_payout(&pool_id);
    assert_eq!(
        s.pool.try_approve_payout(&pool_id, &admin),
        Err(Ok(Error::NotApprover))
    );
    assert_eq!(
        s.pool
            .try_set_approvers(&pool_id, &Vec::new(&s.env), &None, &None),
        Err(Ok(Error::TermsLocked))
    );
    let just_me = soroban_sdk::vec![&s.env, admin.clone()];
    assert!(s
        .pool
        .try_set_approvers(&pool_id, &just_me, &Some(1), &None)
        .is_err());
    // Requesting again changes nothing either.
    assert_eq!(
        s.pool.try_request_payout(&pool_id),
        Err(Ok(Error::PayoutAlreadyRequested))
    );
    // Cancelling sends nothing to the admin: the money can only go back to members.
    s.pool.cancel_pool(&pool_id);
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::PoolClosed)));
    assert_eq!(s.usdc.balance(&admin), 0);
    assert_eq!(s.usdc.balance(&s.pool.address), 10 * USDC);
}

#[test]
fn the_pool_admin_cannot_name_themselves_an_approver() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, _) = s.two_of_three(&admin, None);
    let with_admin = soroban_sdk::vec![&s.env, admin.clone(), s.wallet(0)];
    assert_eq!(
        s.pool
            .try_set_approvers(&pool_id, &with_admin, &Some(1), &None),
        Err(Ok(Error::InvalidApprovers))
    );
    let terms = s.fixed_terms(10 * USDC, 5 * USDC, &with_admin, Some(1), None);
    assert_eq!(
        s.pool.try_create_pool_with_terms(&admin, &terms),
        Err(Ok(Error::InvalidApprovers))
    );
}

// Security rule: approvals are rejected unless the pool is payable

#[test]
fn approvals_are_rejected_unless_the_pool_is_payable() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.two_of_three(&admin, Some(WINDOW));
    let approver = Setup::approver(&approvers, 0);

    // Below the goal.
    s.pool
        .contribute(&pool_id, &s.wallet(5 * USDC), &(5 * USDC));
    assert_eq!(
        s.pool.try_request_payout(&pool_id),
        Err(Ok(Error::GoalNotReached))
    );
    assert_eq!(
        s.pool.try_approve_payout(&pool_id, &approver),
        Err(Ok(Error::GoalNotReached))
    );
    assert_eq!(
        s.pool.try_decline_payout(&pool_id, &approver),
        Err(Ok(Error::GoalNotReached))
    );

    // Past the approval window.
    s.pool
        .contribute(&pool_id, &s.wallet(5 * USDC), &(5 * USDC));
    s.pool.request_payout(&pool_id);
    s.at(START + WINDOW);
    assert_eq!(
        s.pool.try_approve_payout(&pool_id, &approver),
        Err(Ok(Error::ApprovalWindowExpired))
    );
    assert_eq!(
        s.pool.try_request_payout(&pool_id),
        Err(Ok(Error::ApprovalWindowExpired))
    );

    // Cancelled.
    let (cancelled, cancelled_approvers) = s.two_of_three(&admin, None);
    s.fund(cancelled);
    s.pool.request_payout(&cancelled);
    s.pool.cancel_pool(&cancelled);
    assert_eq!(
        s.pool
            .try_approve_payout(&cancelled, &Setup::approver(&cancelled_approvers, 0)),
        Err(Ok(Error::PoolClosed))
    );
    assert_eq!(s.usdc.balance(&admin), 0);
}

// Security rule: a pool is settled only once

#[test]
fn a_pool_is_settled_only_once() {
    let s = Setup::new();
    let held = s.hold_unrelated_funds();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.two_of_three(&admin, None);
    s.fund(pool_id);
    s.pool.request_payout(&pool_id);
    s.pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 0));
    assert!(s
        .pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 1)));

    assert_eq!(
        s.pool
            .try_approve_payout(&pool_id, &Setup::approver(&approvers, 2)),
        Err(Ok(Error::PoolClosed))
    );
    assert_eq!(
        s.pool.try_request_payout(&pool_id),
        Err(Ok(Error::PoolClosed))
    );
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::PoolClosed)));
    assert_eq!(s.usdc.balance(&admin), 10 * USDC);
    assert_eq!(s.usdc.balance(&s.pool.address), held);
}

// The approval window and reclaiming

#[test]
fn contributors_reclaim_once_each_after_the_window_runs_out() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.two_of_three(&admin, Some(WINDOW));
    let (a, b) = s.fund(pool_id);
    s.pool.request_payout(&pool_id);
    s.pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 0));

    // The window counts from when the goal was met; until it runs out, no reclaim.
    s.at(START + WINDOW - 1);
    assert_eq!(
        s.pool.try_reclaim(&pool_id, &a),
        Err(Ok(Error::ApprovalWindowOpen))
    );
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Funded);

    s.at(START + WINDOW);
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Refunded);
    assert_eq!(s.pool.reclaim(&pool_id, &a), 5 * USDC);
    assert_eq!(
        s.pool.try_reclaim(&pool_id, &a),
        Err(Ok(Error::NothingToRefund))
    );
    assert_eq!(
        s.pool.try_claim_refund(&pool_id, &a),
        Err(Ok(Error::NothingToRefund))
    );
    assert_eq!(s.pool.reclaim(&pool_id, &b), 5 * USDC);
    assert_eq!(
        s.pool.try_reclaim(&pool_id, &s.wallet(0)),
        Err(Ok(Error::NotMember))
    );

    assert_eq!(
        (s.usdc.balance(&a), s.usdc.balance(&b)),
        (5 * USDC, 5 * USDC)
    );
    assert_eq!(s.usdc.balance(&admin), 0);
    let pool = s.pool.get_pool(&pool_id);
    assert_eq!(
        (pool.status, pool.total_refunded, pool.payout_approvals),
        (PoolStatus::Refunded, 10 * USDC, None)
    );
    // The last approval can't pay out what was reclaimed.
    assert_eq!(
        s.pool
            .try_approve_payout(&pool_id, &Setup::approver(&approvers, 1)),
        Err(Ok(Error::PoolClosed))
    );
}

#[test]
fn the_window_runs_even_if_the_payout_is_never_requested() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, _) = s.two_of_three(&admin, Some(WINDOW));
    let (a, _) = s.fund(pool_id);

    s.at(START + WINDOW);
    assert_eq!(s.pool.reclaim(&pool_id, &a), 5 * USDC);
    // The money can no longer be paid out by asking now.
    assert_eq!(
        s.pool.try_request_payout(&pool_id),
        Err(Ok(Error::PoolClosed))
    );
}

#[test]
fn the_window_starts_when_the_goal_is_met() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.two_of_three(&admin, Some(WINDOW));
    let early = s.wallet(5 * USDC);
    s.pool.contribute(&pool_id, &early, &(5 * USDC));

    let goal_met = START + 3 * DAY;
    s.at(goal_met);
    s.pool
        .contribute(&pool_id, &s.wallet(5 * USDC), &(5 * USDC));
    assert_eq!(
        s.pool.get_pool_settings(&pool_id).settleable_since,
        Some(goal_met)
    );

    // Long after creation, but within the window from the goal: approvals still count.
    s.at(goal_met + WINDOW - 1);
    assert_eq!(
        s.pool.try_reclaim(&pool_id, &early),
        Err(Ok(Error::ApprovalWindowOpen))
    );
    s.pool.request_payout(&pool_id);
    s.pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 0));
    assert!(s
        .pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 1)));
}

#[test]
fn a_pool_paid_out_in_time_cannot_be_reclaimed() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let (pool_id, approvers) = s.two_of_three(&admin, Some(WINDOW));
    let (a, _) = s.fund(pool_id);
    s.pool.request_payout(&pool_id);
    s.pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 0));
    s.pool
        .approve_payout(&pool_id, &Setup::approver(&approvers, 1));

    s.at(START + WINDOW);
    assert_eq!(s.pool.try_reclaim(&pool_id, &a), Err(Ok(Error::PoolClosed)));
    assert_eq!(s.usdc.balance(&admin), 10 * USDC);
}

#[test]
fn a_pool_without_a_window_is_never_reclaimable() {
    let s = Setup::new();
    let (pool_id, _) = s.two_of_three(&s.wallet(0), None);
    let (a, _) = s.fund(pool_id);
    s.at(START + 365 * DAY);
    assert_eq!(
        s.pool.try_reclaim(&pool_id, &a),
        Err(Ok(Error::ApprovalWindowOpen))
    );
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Funded);
}

#[test]
fn reclaimed_usdc_always_goes_to_the_contributor() {
    let s = Setup::new();
    let (pool_id, _) = s.two_of_three(&s.wallet(0), Some(WINDOW));
    let (a, _) = s.fund(pool_id);
    s.at(START + WINDOW);

    // Nobody signs: a stranger sends the reclaim, and the money still goes to `a`.
    s.env.set_auths(&[]);
    assert_eq!(s.pool.reclaim(&pool_id, &a), 5 * USDC);
    assert_eq!(s.usdc.balance(&a), 5 * USDC);
}

// Upgrading: members stored before shares existed

/// The member layout stored before `expected` and `paid`.
#[contracttype]
struct MemberV2 {
    index: u32,
    joined_at: u64,
    contributed: i128,
    refunded: bool,
}

#[test]
fn members_stored_before_shares_existed_still_work() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let pool_id = s.new_pool(&admin, 10 * USDC);
    let member = s.wallet(10 * USDC);
    s.pool.contribute(&pool_id, &member, &(4 * USDC));
    s.env.as_contract(&s.pool.address, || {
        let old = MemberV2 {
            index: 0,
            joined_at: START,
            contributed: 4 * USDC,
            refunded: false,
        };
        s.env
            .storage()
            .persistent()
            .set(&DataKey::Member(pool_id, member.clone()), &old);
    });

    let record = s.pool.get_member(&pool_id, &member).unwrap();
    assert_eq!(
        (record.contributed, record.expected, record.paid),
        (4 * USDC, None, None)
    );
    s.pool.contribute(&pool_id, &member, &(6 * USDC));
    assert_eq!(
        s.pool.get_member(&pool_id, &member).unwrap().contributed,
        10 * USDC
    );
    assert_eq!(s.pool.settle(&pool_id), 10 * USDC);
}
