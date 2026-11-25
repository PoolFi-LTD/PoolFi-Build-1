#![no_std]

//! PoolFi pool contract.
//!
//! One deployment holds any number of USDC contribution pools. Each pool has
//! its own admin wallet, goal, deadline and optional approvers. Members join
//! and contribute USDC into the contract. Once the goal is met the pool admin is
//! paid out (after enough approvers agree, if the pool has any), less the
//! platform fee. If the deadline passes first, the pool admin decides: extend the
//! deadline (as often as they like) or cancel so members claim refunds.
//!
//! A pool is fixed (everyone owes a set share) or voluntary (any amount from a
//! minimum, an optional goal and deadline, and a resolution rule chosen at
//! creation). Approvers can come with a threshold and an approval window: if
//! the threshold isn't reached within the window, contributors reclaim their
//! USDC. See `docs/contract-plan.md`.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, BytesN,
    ContractExecutable, Env, Vec,
};

const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const PERSISTENT_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;
/// Largest page `get_members` returns, to stay within per-transaction read limits.
const MAX_PAGE_SIZE: u32 = 50;
/// Most approvers a pool can have.
const MAX_APPROVERS: u32 = 10;
/// Highest platform fee, in basis points (10%).
const MAX_FEE_BPS: u32 = 1_000;
/// Longest approval window: a year, in seconds.
const MAX_APPROVAL_WINDOW: u64 = 365 * 86_400;
/// The `deadline` of a voluntary pool that has none: it never passes.
pub const NO_DEADLINE: u64 = u64::MAX;
/// This code's version, for callers that work with several (`version` is missing before 3).
const VERSION: u32 = 3;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PoolStatus {
    /// Accepting joins and contributions until the deadline.
    Open,
    /// The pool can be paid out: its goal is reached (a keep-what's-raised pool:
    /// its deadline has come, or it has no deadline, and it has raised something).
    /// A pool with a deadline still accepts contributions until then.
    Funded,
    /// The pool balance was paid to the pool admin.
    Settled,
    /// Members can claim back what they contributed: the pool admin cancelled, an
    /// all-or-nothing pool missed its goal, or the approvers missed their window.
    /// The last two are reported by `get_pool` before anyone has claimed.
    Refunded,
    /// The deadline passed before the goal was reached. Never stored: `get_pool`
    /// reports it for an Open pool past its deadline. The pool admin either
    /// extends the deadline or cancels the pool; until then nothing moves.
    Expired,
}

/// Fixed: every member owes a set share. Voluntary: any amount from a minimum.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PoolKind {
    Fixed,
    Voluntary,
}

/// What happens to a pool's money when it doesn't simply reach its goal.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Resolution {
    /// Fixed pools: at a missed deadline the pool admin extends it or cancels.
    AdminDecides,
    /// Voluntary: everyone is refunded if the goal isn't met by the deadline.
    AllOrNothing,
    /// Voluntary: whatever was raised goes to the pool admin at the deadline (any
    /// time without one), through the approvers if the pool has any.
    KeepWhatsRaised,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pool {
    pub id: u64,
    pub admin: Address,
    /// 0 for a voluntary pool without a goal.
    pub goal_amount: i128,
    /// Unix timestamp (seconds) after which the pool stops accepting joins and
    /// contributions. `NO_DEADLINE` for a voluntary pool without one.
    pub deadline: u64,
    pub total_contributed: i128,
    pub total_refunded: i128,
    pub member_count: u32,
    pub status: PoolStatus,
    pub created_at: u64,
    /// Wallets that approve the payout; the pool's threshold (a majority if it
    /// has none) must agree. Empty means the pool admin is paid out alone. None
    /// on pools stored before approvers existed.
    pub approvers: Option<Vec<Address>>,
    /// Approvals of the pending payout request; None when no payout is requested.
    pub payout_approvals: Option<Vec<Address>>,
}

/// A pool's settings beyond `Pool`, stored under their own key so pools stored
/// before they existed decode as before. Those pools have none stored and get
/// the defaults (`get_pool_settings`), which keep their old behaviour: fixed, a
/// majority of approvers, no approval window, the admin decides at a missed deadline.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolSettings {
    pub kind: PoolKind,
    pub resolution: Resolution,
    /// Approvals the payout needs. None: a majority of the approvers.
    pub threshold: Option<u32>,
    /// Seconds the approvers have once the pool is payable, before contributors
    /// can reclaim their USDC. None: no limit.
    pub approval_window: Option<u64>,
    /// Fixed pools made with `create_pool_with_terms`: what each member owes.
    pub share_amount: Option<i128>,
    /// Voluntary pools: the smallest contribution accepted.
    pub min_contribution: Option<i128>,
    /// When the pool first became payable: the approval window counts from here.
    /// `get_pool_settings` fills it in for a keep-what's-raised pool past its deadline.
    pub settleable_since: Option<u64>,
}

impl PoolSettings {
    /// What a pool made before settings existed (or with `create_pool`) behaves as.
    fn default() -> Self {
        PoolSettings {
            kind: PoolKind::Fixed,
            resolution: Resolution::AdminDecides,
            threshold: None,
            approval_window: None,
            share_amount: None,
            min_contribution: None,
            settleable_since: None,
        }
    }
}

/// Everything `create_pool_with_terms` needs to set a pool up.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolTerms {
    pub kind: PoolKind,
    /// Fixed: the goal. Voluntary: 0 for no goal (all-or-nothing needs one).
    pub goal_amount: i128,
    /// None: no deadline (voluntary pools only).
    pub deadline: Option<u64>,
    /// Fixed: what each member owes.
    pub share_amount: Option<i128>,
    /// Voluntary: the smallest contribution accepted.
    pub min_contribution: Option<i128>,
    /// Fixed: AdminDecides. Voluntary: AllOrNothing or KeepWhatsRaised.
    pub resolution: Resolution,
    pub approvers: Vec<Address>,
    /// Approvals the payout needs, 1 to the number of approvers. None: a majority.
    pub threshold: Option<u32>,
    /// Seconds the approvers have, from when the pool becomes payable, before
    /// contributors can reclaim their USDC. None: no limit.
    pub approval_window: Option<u64>,
}

/// The platform fee taken from every payout (never from refunds).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    /// Basis points: 500 = 5%.
    pub bps: u32,
    pub recipient: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Member {
    /// Position in the pool's member list, used by `get_members`.
    pub index: u32,
    pub joined_at: u64,
    pub contributed: i128,
    pub refunded: bool,
    /// Pools with a share: what this member owes. None on other pools, and on
    /// members stored before shares existed.
    pub expected: Option<i128>,
    /// Pools with a share: whether `contributed` has reached `expected`. Only a
    /// contribution changes it; no function sets it.
    pub paid: Option<bool>,
}

/// A member's standing, as `get_member_statuses` lists it.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberStatus {
    pub member: Address,
    pub expected: Option<i128>,
    pub contributed: i128,
    /// Owing a share: paid it in full. Otherwise: contributed anything.
    pub paid: bool,
    pub refunded: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Token,
    Fee,
    NextPoolId,
    Pool(u64),
    Member(u64, Address),
    MemberAt(u64, u32),
    Settings(u64),
}

/// Codes start at 100 so they can't be mistaken for the USDC token's own error
/// codes (1–15), which surface through the same calls.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    PoolNotFound = 100,
    InvalidAmount = 101,
    InvalidDeadline = 102,
    DeadlinePassed = 103,
    PoolClosed = 104,
    AlreadyMember = 105,
    GoalNotReached = 106,
    NotRefundable = 107,
    NotMember = 108,
    NothingToRefund = 109,
    /// The pool has approvers, so the payout must be requested and approved.
    ApprovalRequired = 110,
    /// The pool has no approvers; its admin settles directly.
    NoApprovers = 111,
    /// Too many approvers, a duplicate, or the pool admin among them.
    InvalidApprovers = 112,
    NotApprover = 113,
    PayoutAlreadyRequested = 114,
    NoPayoutRequest = 115,
    AlreadyApproved = 116,
    /// Contributions are paused while a payout waits for approval.
    PayoutPending = 117,
    InvalidFee = 118,
    /// A threshold of 0, more than the approvers, or without approvers.
    InvalidThreshold = 119,
    /// An approval window of 0, over a year, or without approvers.
    InvalidApprovalWindow = 120,
    /// Approvers, threshold, window and resolution rule are fixed once anyone has contributed.
    TermsLocked = 121,
    /// The approvers didn't reach the threshold in time: contributors reclaim instead.
    ApprovalWindowExpired = 122,
    BelowMinimum = 123,
    /// Pool terms that don't fit together, e.g. all-or-nothing without a goal.
    InvalidTerms = 124,
    /// A keep-what's-raised pool pays out at its deadline, once it has raised something.
    NotSettleable = 125,
    /// Reclaiming waits for the approval window to run out.
    ApprovalWindowOpen = 126,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolCreated {
    #[topic]
    pub pool_id: u64,
    #[topic]
    pub admin: Address,
    pub goal_amount: i128,
    pub deadline: u64,
    pub approvers: Vec<Address>,
}

/// A pool's settings: published after `PoolCreated` by `create_pool_with_terms`,
/// and whenever the pool admin changes them before the first contribution.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettingsChanged {
    #[topic]
    pub pool_id: u64,
    pub kind: PoolKind,
    pub resolution: Resolution,
    pub approvers: Vec<Address>,
    pub threshold: Option<u32>,
    pub approval_window: Option<u64>,
    pub share_amount: Option<i128>,
    pub min_contribution: Option<i128>,
}

/// Refunds opened without the pool admin cancelling: the approval window ran
/// out, or an all-or-nothing pool missed its goal. Published with the first claim.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundsOpened {
    #[topic]
    pub pool_id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberJoined {
    #[topic]
    pub pool_id: u64,
    #[topic]
    pub member: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contributed {
    #[topic]
    pub pool_id: u64,
    #[topic]
    pub member: Address,
    pub amount: i128,
    pub member_total: i128,
    pub pool_total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolFunded {
    #[topic]
    pub pool_id: u64,
    pub total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolSettled {
    #[topic]
    pub pool_id: u64,
    #[topic]
    pub admin: Address,
    /// What the pool admin received.
    pub amount: i128,
    /// What went to the fee recipient.
    pub fee: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutRequested {
    #[topic]
    pub pool_id: u64,
    #[topic]
    pub admin: Address,
    pub amount: i128,
    pub needed: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutApproved {
    #[topic]
    pub pool_id: u64,
    #[topic]
    pub approver: Address,
    pub approvals: u32,
    pub needed: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutDeclined {
    #[topic]
    pub pool_id: u64,
    #[topic]
    pub approver: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeChanged {
    pub bps: u32,
    pub recipient: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolCancelled {
    #[topic]
    pub pool_id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeadlineExtended {
    #[topic]
    pub pool_id: u64,
    pub old_deadline: u64,
    pub new_deadline: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Refunded {
    #[topic]
    pub pool_id: u64,
    #[topic]
    pub member: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contract]
pub struct PoolContract;

#[contractimpl]
impl PoolContract {
    /// Runs once, atomically with the deploy. `token` is the USDC Stellar Asset
    /// Contract; `fee_bps` of every payout goes to `fee_recipient`.
    pub fn __constructor(
        env: Env,
        admin: Address,
        token: Address,
        fee_bps: u32,
        fee_recipient: Address,
    ) -> Result<(), Error> {
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        let storage = env.storage().instance();
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Token, &token);
        storage.set(
            &DataKey::Fee,
            &FeeConfig {
                bps: fee_bps,
                recipient: fee_recipient,
            },
        );
        storage.set(&DataKey::NextPoolId, &0u64);
        extend_instance(&env);
        Ok(())
    }

    /// A pool whose admin is paid out alone once the goal is met.
    pub fn create_pool(
        env: Env,
        admin: Address,
        goal_amount: i128,
        deadline: u64,
    ) -> Result<u64, Error> {
        let approvers = Vec::new(&env);
        Self::create_pool_with_approvers(env, admin, goal_amount, deadline, approvers)
    }

    /// A pool whose payout needs a majority of `approvers` to agree.
    pub fn create_pool_with_approvers(
        env: Env,
        admin: Address,
        goal_amount: i128,
        deadline: u64,
        approvers: Vec<Address>,
    ) -> Result<u64, Error> {
        admin.require_auth();
        check_approvers(&admin, &approvers)?;
        if goal_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        check_deadline(&env, deadline)?;
        Ok(new_pool(&env, admin, goal_amount, deadline, approvers))
    }

    /// A fixed or voluntary pool, with optional approvers, threshold and
    /// approval window (see `PoolTerms`).
    pub fn create_pool_with_terms(
        env: Env,
        admin: Address,
        terms: PoolTerms,
    ) -> Result<u64, Error> {
        admin.require_auth();
        check_approvers(&admin, &terms.approvers)?;
        check_approval_rules(&terms.approvers, terms.threshold, terms.approval_window)?;
        let deadline = match terms.deadline {
            Some(deadline) => {
                check_deadline(&env, deadline)?;
                deadline
            }
            None if terms.kind == PoolKind::Voluntary => NO_DEADLINE,
            None => return Err(Error::InvalidDeadline),
        };
        match terms.kind {
            PoolKind::Fixed => {
                if terms.goal_amount <= 0 {
                    return Err(Error::InvalidAmount);
                }
                let share = terms.share_amount.ok_or(Error::InvalidTerms)?;
                if share <= 0 || share > terms.goal_amount {
                    return Err(Error::InvalidAmount);
                }
                if terms.min_contribution.is_some() {
                    return Err(Error::InvalidTerms);
                }
            }
            PoolKind::Voluntary => {
                let minimum = terms.min_contribution.ok_or(Error::InvalidTerms)?;
                if minimum <= 0 || terms.goal_amount < 0 {
                    return Err(Error::InvalidAmount);
                }
                if terms.share_amount.is_some() {
                    return Err(Error::InvalidTerms);
                }
            }
        }
        check_resolution(terms.kind, terms.resolution, terms.goal_amount)?;

        let id = new_pool(
            &env,
            admin,
            terms.goal_amount,
            deadline,
            terms.approvers.clone(),
        );
        let settings = PoolSettings {
            kind: terms.kind,
            resolution: terms.resolution,
            threshold: terms.threshold,
            approval_window: terms.approval_window,
            share_amount: terms.share_amount,
            min_contribution: terms.min_contribution,
            settleable_since: None,
        };
        save_settings(&env, id, &settings);
        announce_settings(&env, id, &settings, terms.approvers);
        Ok(id)
    }

    /// The pool admin changes the approvers, threshold and approval window.
    /// Only until the first contribution: after that they are fixed for good.
    pub fn set_approvers(
        env: Env,
        pool_id: u64,
        approvers: Vec<Address>,
        threshold: Option<u32>,
        approval_window: Option<u64>,
    ) -> Result<(), Error> {
        let (mut pool, mut settings) = load(&env, pool_id)?;
        pool.admin.require_auth();
        ensure_terms_open(&env, &pool, &settings)?;
        check_approvers(&pool.admin, &approvers)?;
        check_approval_rules(&approvers, threshold, approval_window)?;
        pool.approvers = Some(approvers.clone());
        settings.threshold = threshold;
        settings.approval_window = approval_window;
        save_pool(&env, &pool);
        save_settings(&env, pool_id, &settings);
        announce_settings(&env, pool_id, &settings, approvers);
        Ok(())
    }

    /// The pool admin changes a voluntary pool's resolution rule. Only until the
    /// first contribution: after that it is fixed for good.
    pub fn set_resolution(env: Env, pool_id: u64, resolution: Resolution) -> Result<(), Error> {
        let (pool, mut settings) = load(&env, pool_id)?;
        pool.admin.require_auth();
        ensure_terms_open(&env, &pool, &settings)?;
        check_resolution(settings.kind, resolution, pool.goal_amount)?;
        settings.resolution = resolution;
        save_settings(&env, pool_id, &settings);
        announce_settings(&env, pool_id, &settings, approvers_of(&env, &pool));
        Ok(())
    }

    pub fn join_pool(env: Env, pool_id: u64, member: Address) -> Result<(), Error> {
        member.require_auth();
        let (mut pool, settings) = load(&env, pool_id)?;
        ensure_accepting(&env, &pool, &settings)?;
        if load_member(&env, pool_id, &member).is_some() {
            return Err(Error::AlreadyMember);
        }
        add_member(&env, &mut pool, &settings, &member);
        save_pool(&env, &pool);
        Ok(())
    }

    /// Moves `amount` USDC from `member` into the contract and records it.
    /// Joins the pool on the member's behalf if they haven't joined yet.
    pub fn contribute(env: Env, pool_id: u64, member: Address, amount: i128) -> Result<(), Error> {
        member.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let (mut pool, mut settings) = load(&env, pool_id)?;
        ensure_accepting(&env, &pool, &settings)?;
        if pool.payout_approvals.is_some() {
            return Err(Error::PayoutPending);
        }
        if settings
            .min_contribution
            .is_some_and(|minimum| amount < minimum)
        {
            return Err(Error::BelowMinimum);
        }

        let mut record = match load_member(&env, pool_id, &member) {
            Some(record) => record,
            None => add_member(&env, &mut pool, &settings, &member),
        };
        record.contributed += amount;
        if let Some(expected) = record.expected {
            record.paid = Some(record.contributed >= expected);
        }
        pool.total_contributed += amount;
        // A keep-what's-raised pool pays out whatever it raised at its deadline, so
        // its goal is only a target; without a deadline it's payable from now on.
        let keeps_what_is_raised = settings.resolution == Resolution::KeepWhatsRaised;
        let reached_goal = !keeps_what_is_raised
            && pool.status == PoolStatus::Open
            && pool.goal_amount > 0
            && pool.total_contributed >= pool.goal_amount;
        if reached_goal {
            pool.status = PoolStatus::Funded;
        }
        let payable_now = reached_goal || (keeps_what_is_raised && pool.deadline == NO_DEADLINE);
        if payable_now && settings.settleable_since.is_none() {
            settings.settleable_since = Some(env.ledger().timestamp());
            save_settings(&env, pool_id, &settings);
        }
        save_member(&env, pool_id, &member, &record);
        save_pool(&env, &pool);

        token_client(&env).transfer(&member, env.current_contract_address(), &amount);

        Contributed {
            pool_id,
            member,
            amount,
            member_total: record.contributed,
            pool_total: pool.total_contributed,
        }
        .publish(&env);
        if reached_goal {
            PoolFunded {
                pool_id,
                total: pool.total_contributed,
            }
            .publish(&env);
        }
        Ok(())
    }

    /// Pays a payable pool without approvers to its admin, less the fee.
    /// Returns what the admin received.
    pub fn settle(env: Env, pool_id: u64) -> Result<i128, Error> {
        let (mut pool, settings) = load(&env, pool_id)?;
        pool.admin.require_auth();
        ensure_settleable(&env, &pool, &settings)?;
        if !approvers_of(&env, &pool).is_empty() {
            return Err(Error::ApprovalRequired);
        }
        Ok(pay_out(&env, &mut pool))
    }

    /// The pool admin asks the approvers to release a payable pool's payout.
    pub fn request_payout(env: Env, pool_id: u64) -> Result<(), Error> {
        let (mut pool, settings) = load(&env, pool_id)?;
        pool.admin.require_auth();
        ensure_settleable(&env, &pool, &settings)?;
        let approvers = approvers_of(&env, &pool);
        if approvers.is_empty() {
            return Err(Error::NoApprovers);
        }
        if pool.payout_approvals.is_some() {
            return Err(Error::PayoutAlreadyRequested);
        }
        pool.payout_approvals = Some(Vec::new(&env));
        save_pool(&env, &pool);
        PayoutRequested {
            pool_id,
            admin: pool.admin,
            amount: pool.total_contributed,
            needed: needed_approvals(&settings, &approvers),
        }
        .publish(&env);
        Ok(())
    }

    /// An approver agrees to the pending payout. Once the threshold (a majority
    /// if the pool has none) has, the pool admin is paid out straight away.
    /// Returns whether that happened.
    pub fn approve_payout(env: Env, pool_id: u64, approver: Address) -> Result<bool, Error> {
        approver.require_auth();
        let (mut pool, settings) = load(&env, pool_id)?;
        ensure_settleable(&env, &pool, &settings)?;
        let approvers = approvers_of(&env, &pool);
        if !approvers.contains(&approver) {
            return Err(Error::NotApprover);
        }
        let mut approvals = pool
            .payout_approvals
            .clone()
            .ok_or(Error::NoPayoutRequest)?;
        if approvals.contains(&approver) {
            return Err(Error::AlreadyApproved);
        }
        approvals.push_back(approver.clone());
        let needed = needed_approvals(&settings, &approvers);
        PayoutApproved {
            pool_id,
            approver,
            approvals: approvals.len(),
            needed,
        }
        .publish(&env);

        if approvals.len() >= needed {
            pay_out(&env, &mut pool);
            return Ok(true);
        }
        pool.payout_approvals = Some(approvals);
        save_pool(&env, &pool);
        Ok(false)
    }

    /// An approver turns the pending payout down. The money stays in the pool
    /// and contributions resume; the admin can request again.
    pub fn decline_payout(env: Env, pool_id: u64, approver: Address) -> Result<(), Error> {
        approver.require_auth();
        let (mut pool, settings) = load(&env, pool_id)?;
        ensure_settleable(&env, &pool, &settings)?;
        if !approvers_of(&env, &pool).contains(&approver) {
            return Err(Error::NotApprover);
        }
        if pool.payout_approvals.is_none() {
            return Err(Error::NoPayoutRequest);
        }
        pool.payout_approvals = None;
        save_pool(&env, &pool);
        PayoutDeclined { pool_id, approver }.publish(&env);
        Ok(())
    }

    /// Closes an Open, Expired or Funded pool so members can claim refunds.
    pub fn cancel_pool(env: Env, pool_id: u64) -> Result<(), Error> {
        let (mut pool, settings) = load(&env, pool_id)?;
        pool.admin.require_auth();
        ensure_not_closed(&env, &pool, &settings)?;

        pool.status = PoolStatus::Refunded;
        pool.payout_approvals = None;
        save_pool(&env, &pool);
        PoolCancelled { pool_id }.publish(&env);
        Ok(())
    }

    /// Moves the deadline of an Open, Expired or Funded pool later, so it accepts
    /// joins and contributions again until then. Only the pool admin can, as
    /// often as they like; the deadline never moves earlier. A voluntary pool's
    /// deadline can't move once it has passed: its rule has decided by then.
    pub fn extend_deadline(env: Env, pool_id: u64, new_deadline: u64) -> Result<(), Error> {
        let (mut pool, settings) = load(&env, pool_id)?;
        pool.admin.require_auth();
        ensure_not_closed(&env, &pool, &settings)?;
        if settings.kind == PoolKind::Voluntary && deadline_passed(&env, &pool) {
            return Err(Error::DeadlinePassed);
        }
        if new_deadline <= env.ledger().timestamp()
            || new_deadline <= pool.deadline
            || new_deadline == NO_DEADLINE
        {
            return Err(Error::InvalidDeadline);
        }

        let old_deadline = pool.deadline;
        pool.deadline = new_deadline;
        save_pool(&env, &pool);
        DeadlineExtended {
            pool_id,
            old_deadline,
            new_deadline,
        }
        .publish(&env);
        Ok(())
    }

    /// Returns a member's contribution from a Refunded pool: one its admin
    /// cancelled, an all-or-nothing pool that missed its goal, or one whose
    /// approval window ran out. Anyone can call it; the funds always go to the
    /// member, and each member is refunded once.
    pub fn claim_refund(env: Env, pool_id: u64, member: Address) -> Result<i128, Error> {
        let (mut pool, settings) = load(&env, pool_id)?;
        if effective_status(&env, &pool, &settings) != PoolStatus::Refunded {
            return Err(Error::NotRefundable);
        }
        refund_member(&env, &mut pool, member)
    }

    /// A contributor takes their USDC back once the approval window has run out
    /// without the threshold being reached. Anyone can call it; the funds always
    /// go to the member, and each member reclaims once.
    pub fn reclaim(env: Env, pool_id: u64, member: Address) -> Result<i128, Error> {
        let (mut pool, settings) = load(&env, pool_id)?;
        if pool.status == PoolStatus::Settled {
            return Err(Error::PoolClosed);
        }
        if !window_passed(&env, &pool, &settings) {
            return Err(Error::ApprovalWindowOpen);
        }
        refund_member(&env, &mut pool, member)
    }

    /// The pool, with `status` as it stands now (see `PoolStatus`).
    pub fn get_pool(env: Env, pool_id: u64) -> Result<Pool, Error> {
        let (mut pool, settings) = load(&env, pool_id)?;
        pool.status = effective_status(&env, &pool, &settings);
        Ok(pool)
    }

    /// The pool's settings, with `settleable_since` as it stands now. The
    /// defaults for a pool stored before settings existed.
    pub fn get_pool_settings(env: Env, pool_id: u64) -> Result<PoolSettings, Error> {
        let (pool, mut settings) = load(&env, pool_id)?;
        settings.settleable_since = settleable_since(&env, &pool, &settings);
        Ok(settings)
    }

    pub fn get_member(env: Env, pool_id: u64, member: Address) -> Option<Member> {
        load_member(&env, pool_id, &member)
    }

    pub fn is_member(env: Env, pool_id: u64, member: Address) -> bool {
        load_member(&env, pool_id, &member).is_some()
    }

    /// Members in join order, `limit` at a time (at most 50).
    pub fn get_members(
        env: Env,
        pool_id: u64,
        start: u32,
        limit: u32,
    ) -> Result<Vec<Address>, Error> {
        let pool = load_pool(&env, pool_id)?;
        let end = start
            .saturating_add(limit.min(MAX_PAGE_SIZE))
            .min(pool.member_count);
        let mut members = Vec::new(&env);
        for index in start..end {
            if let Some(member) = env
                .storage()
                .persistent()
                .get(&DataKey::MemberAt(pool_id, index))
            {
                members.push_back(member);
            }
        }
        Ok(members)
    }

    /// Members in join order, `limit` at a time (at most 50), with what each
    /// owes, has contributed, whether they've paid and whether they were refunded.
    pub fn get_member_statuses(
        env: Env,
        pool_id: u64,
        start: u32,
        limit: u32,
    ) -> Result<Vec<MemberStatus>, Error> {
        let mut statuses = Vec::new(&env);
        for member in Self::get_members(env.clone(), pool_id, start, limit)?.iter() {
            if let Some(record) = load_member(&env, pool_id, &member) {
                statuses.push_back(MemberStatus {
                    member,
                    expected: record.expected,
                    contributed: record.contributed,
                    paid: record.paid.unwrap_or(record.contributed > 0),
                    refunded: record.refunded,
                });
            }
        }
        Ok(statuses)
    }

    pub fn pool_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextPoolId)
            .unwrap_or(0)
    }

    /// The code's version: 3 adds pool types, thresholds and approval windows.
    pub fn version() -> u32 {
        VERSION
    }

    pub fn admin(env: Env) -> Address {
        read_admin(&env)
    }

    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    /// The platform fee, or None if it was never set (contracts upgraded from v1).
    pub fn fee(env: Env) -> Option<FeeConfig> {
        read_fee(&env)
    }

    pub fn set_fee(env: Env, bps: u32, recipient: Address) -> Result<(), Error> {
        read_admin(&env).require_auth();
        if bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        env.storage().instance().set(
            &DataKey::Fee,
            &FeeConfig {
                bps,
                recipient: recipient.clone(),
            },
        );
        extend_instance(&env);
        FeeChanged { bps, recipient }.publish(&env);
        Ok(())
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let old_admin = read_admin(&env);
        old_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        extend_instance(&env);
        AdminChanged {
            old_admin,
            new_admin,
        }
        .publish(&env);
    }

    /// Replaces the contract's code. Only the contract admin can. It is the one
    /// way around the rules above, including those that protect a pool's money:
    /// new code can do anything with the funds the contract holds.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        read_admin(&env).require_auth();
        env.deployer()
            .update_current_contract(ContractExecutable::Wasm(new_wasm_hash));
    }
}

fn read_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

fn read_fee(env: &Env) -> Option<FeeConfig> {
    env.storage().instance().get(&DataKey::Fee)
}

fn approvers_of(env: &Env, pool: &Pool) -> Vec<Address> {
    pool.approvers.clone().unwrap_or_else(|| Vec::new(env))
}

/// The pool's threshold, or a majority: 1 of 1, 2 of 2, 2 of 3, 3 of 4, ...
fn needed_approvals(settings: &PoolSettings, approvers: &Vec<Address>) -> u32 {
    settings.threshold.unwrap_or(approvers.len() / 2 + 1)
}

fn deadline_passed(env: &Env, pool: &Pool) -> bool {
    pool.deadline != NO_DEADLINE && env.ledger().timestamp() >= pool.deadline
}

/// When the pool first became payable, if it has: its goal was met, or for a
/// keep-what's-raised pool, its deadline came (its first contribution, without one).
fn settleable_since(env: &Env, pool: &Pool, settings: &PoolSettings) -> Option<u64> {
    if settings.resolution == Resolution::KeepWhatsRaised && pool.deadline != NO_DEADLINE {
        return (deadline_passed(env, pool) && pool.total_contributed > 0).then_some(pool.deadline);
    }
    settings.settleable_since
}

/// The approval window has run out: the pool has been payable for longer than
/// the window. Stays true once the pool has closed.
fn window_passed(env: &Env, pool: &Pool, settings: &PoolSettings) -> bool {
    match (
        settings.approval_window,
        settleable_since(env, pool, settings),
    ) {
        (Some(window), Some(since)) => env.ledger().timestamp() >= since.saturating_add(window),
        _ => false,
    }
}

/// A payable pool whose approvers missed their window: contributors reclaim.
fn window_expired(env: &Env, pool: &Pool, settings: &PoolSettings) -> bool {
    matches!(pool.status, PoolStatus::Open | PoolStatus::Funded)
        && window_passed(env, pool, settings)
}

/// The pool can be paid out now, with or without approvers.
fn ensure_settleable(env: &Env, pool: &Pool, settings: &PoolSettings) -> Result<(), Error> {
    if window_expired(env, pool, settings) {
        return Err(Error::ApprovalWindowExpired);
    }
    match effective_status(env, pool, settings) {
        PoolStatus::Funded => Ok(()),
        PoolStatus::Open | PoolStatus::Expired
            if settings.resolution == Resolution::KeepWhatsRaised =>
        {
            Err(Error::NotSettleable)
        }
        PoolStatus::Open | PoolStatus::Expired => Err(Error::GoalNotReached),
        PoolStatus::Settled | PoolStatus::Refunded => Err(Error::PoolClosed),
    }
}

/// The pool admin can still extend or cancel: it hasn't paid out or become refundable.
fn ensure_not_closed(env: &Env, pool: &Pool, settings: &PoolSettings) -> Result<(), Error> {
    match effective_status(env, pool, settings) {
        PoolStatus::Open | PoolStatus::Expired | PoolStatus::Funded => Ok(()),
        PoolStatus::Settled | PoolStatus::Refunded => Err(Error::PoolClosed),
    }
}

/// Approvers, threshold, window and resolution can change until the first contribution.
fn ensure_terms_open(env: &Env, pool: &Pool, settings: &PoolSettings) -> Result<(), Error> {
    ensure_not_closed(env, pool, settings)?;
    if pool.total_contributed > 0 {
        return Err(Error::TermsLocked);
    }
    Ok(())
}

/// At most 10 approvers, no duplicates, and not the pool admin.
fn check_approvers(admin: &Address, approvers: &Vec<Address>) -> Result<(), Error> {
    if approvers.len() > MAX_APPROVERS {
        return Err(Error::InvalidApprovers);
    }
    for (i, approver) in approvers.iter().enumerate() {
        let repeated = approvers.iter().skip(i + 1).any(|other| other == approver);
        if approver == *admin || repeated {
            return Err(Error::InvalidApprovers);
        }
    }
    Ok(())
}

/// A threshold of 1 to the number of approvers and a window of up to a year;
/// neither without approvers.
fn check_approval_rules(
    approvers: &Vec<Address>,
    threshold: Option<u32>,
    approval_window: Option<u64>,
) -> Result<(), Error> {
    if threshold.is_some_and(|t| t == 0 || t > approvers.len()) {
        return Err(Error::InvalidThreshold);
    }
    if approval_window.is_some_and(|w| approvers.is_empty() || w == 0 || w > MAX_APPROVAL_WINDOW) {
        return Err(Error::InvalidApprovalWindow);
    }
    Ok(())
}

fn check_deadline(env: &Env, deadline: u64) -> Result<(), Error> {
    if deadline <= env.ledger().timestamp() || deadline == NO_DEADLINE {
        return Err(Error::InvalidDeadline);
    }
    Ok(())
}

/// Fixed pools: the admin decides. Voluntary: all-or-nothing (which needs a goal
/// to miss) or keep-what's-raised.
fn check_resolution(
    kind: PoolKind,
    resolution: Resolution,
    goal_amount: i128,
) -> Result<(), Error> {
    let fits = match (kind, resolution) {
        (PoolKind::Fixed, Resolution::AdminDecides) => true,
        (PoolKind::Voluntary, Resolution::AllOrNothing) => goal_amount > 0,
        (PoolKind::Voluntary, Resolution::KeepWhatsRaised) => true,
        _ => false,
    };
    if fits {
        Ok(())
    } else {
        Err(Error::InvalidTerms)
    }
}

/// Stores a new Open pool under the next id and announces it.
fn new_pool(
    env: &Env,
    admin: Address,
    goal_amount: i128,
    deadline: u64,
    approvers: Vec<Address>,
) -> u64 {
    let id = PoolContract::pool_count(env.clone());
    env.storage()
        .instance()
        .set(&DataKey::NextPoolId, &(id + 1));
    let pool = Pool {
        id,
        admin: admin.clone(),
        goal_amount,
        deadline,
        total_contributed: 0,
        total_refunded: 0,
        member_count: 0,
        status: PoolStatus::Open,
        created_at: env.ledger().timestamp(),
        approvers: Some(approvers.clone()),
        payout_approvals: None,
    };
    save_pool(env, &pool);
    PoolCreated {
        pool_id: id,
        admin,
        goal_amount,
        deadline,
        approvers,
    }
    .publish(env);
    id
}

fn announce_settings(env: &Env, pool_id: u64, settings: &PoolSettings, approvers: Vec<Address>) {
    SettingsChanged {
        pool_id,
        kind: settings.kind,
        resolution: settings.resolution,
        approvers,
        threshold: settings.threshold,
        approval_window: settings.approval_window,
        share_amount: settings.share_amount,
        min_contribution: settings.min_contribution,
    }
    .publish(env);
}

/// Pays a member back everything they contributed, once. The caller has found
/// the pool refundable; the first claim also closes it for good.
fn refund_member(env: &Env, pool: &mut Pool, member: Address) -> Result<i128, Error> {
    let pool_id = pool.id;
    let mut record = load_member(env, pool_id, &member).ok_or(Error::NotMember)?;
    if record.refunded || record.contributed == 0 {
        return Err(Error::NothingToRefund);
    }

    let amount = record.contributed;
    record.refunded = true;
    pool.total_refunded += amount;
    if pool.status != PoolStatus::Refunded {
        pool.status = PoolStatus::Refunded;
        pool.payout_approvals = None;
        RefundsOpened { pool_id }.publish(env);
    }
    save_member(env, pool_id, &member, &record);
    save_pool(env, pool);

    token_client(env).transfer(&env.current_contract_address(), &member, &amount);

    Refunded {
        pool_id,
        member,
        amount,
    }
    .publish(env);
    Ok(amount)
}

/// Sends a payable pool's balance to its admin, less the platform fee, and
/// closes it. Returns what the admin received.
fn pay_out(env: &Env, pool: &mut Pool) -> i128 {
    let total = pool.total_contributed;
    let fee_config = read_fee(env).filter(|f| f.bps > 0);
    let fee = fee_config
        .as_ref()
        .map_or(0, |f| total * i128::from(f.bps) / 10_000);
    let amount = total - fee;
    pool.status = PoolStatus::Settled;
    pool.payout_approvals = None;
    save_pool(env, pool);

    let token = token_client(env);
    let contract = env.current_contract_address();
    token.transfer(&contract, &pool.admin, &amount);
    if let Some(fee_config) = fee_config.filter(|_| fee > 0) {
        token.transfer(&contract, &fee_config.recipient, &fee);
    }

    PoolSettled {
        pool_id: pool.id,
        admin: pool.admin.clone(),
        amount,
        fee,
    }
    .publish(env);
    amount
}

fn token_client(env: &Env) -> token::TokenClient<'_> {
    let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
    token::TokenClient::new(env, &token)
}

/// The status as it stands now, from the stored one:
/// - approvers who missed their window: Refunded (contributors reclaim);
/// - all-or-nothing below its goal at the deadline: Refunded;
/// - keep-what's-raised: Funded once payable;
/// - any other Open pool past its deadline: Expired, waiting for its admin to
///   extend the deadline or cancel.
fn effective_status(env: &Env, pool: &Pool, settings: &PoolSettings) -> PoolStatus {
    if matches!(pool.status, PoolStatus::Settled | PoolStatus::Refunded) {
        return pool.status;
    }
    if window_expired(env, pool, settings) {
        return PoolStatus::Refunded;
    }
    let past_deadline = pool.status == PoolStatus::Open && deadline_passed(env, pool);
    match settings.resolution {
        Resolution::KeepWhatsRaised if settleable_since(env, pool, settings).is_some() => {
            PoolStatus::Funded
        }
        Resolution::AllOrNothing if past_deadline => PoolStatus::Refunded,
        _ if past_deadline => PoolStatus::Expired,
        _ => pool.status,
    }
}

fn ensure_accepting(env: &Env, pool: &Pool, settings: &PoolSettings) -> Result<(), Error> {
    match effective_status(env, pool, settings) {
        PoolStatus::Settled | PoolStatus::Refunded => Err(Error::PoolClosed),
        PoolStatus::Expired => Err(Error::DeadlinePassed),
        PoolStatus::Open | PoolStatus::Funded if deadline_passed(env, pool) => {
            Err(Error::DeadlinePassed)
        }
        PoolStatus::Open | PoolStatus::Funded => Ok(()),
    }
}

fn load_pool(env: &Env, pool_id: u64) -> Result<Pool, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Pool(pool_id))
        .ok_or(Error::PoolNotFound)
}

/// The pool and its settings (the defaults if it has none stored).
fn load(env: &Env, pool_id: u64) -> Result<(Pool, PoolSettings), Error> {
    let pool = load_pool(env, pool_id)?;
    let settings = env
        .storage()
        .persistent()
        .get(&DataKey::Settings(pool_id))
        .unwrap_or_else(PoolSettings::default);
    Ok((pool, settings))
}

/// Every pool write also keeps the contract instance alive, and the pool's
/// settings with it.
fn save_pool(env: &Env, pool: &Pool) {
    let key = DataKey::Pool(pool.id);
    env.storage().persistent().set(&key, pool);
    extend_persistent(env, &key);
    let settings = DataKey::Settings(pool.id);
    if env.storage().persistent().has(&settings) {
        extend_persistent(env, &settings);
    }
    extend_instance(env);
}

fn save_settings(env: &Env, pool_id: u64, settings: &PoolSettings) {
    let key = DataKey::Settings(pool_id);
    env.storage().persistent().set(&key, settings);
    extend_persistent(env, &key);
}

fn load_member(env: &Env, pool_id: u64, member: &Address) -> Option<Member> {
    env.storage()
        .persistent()
        .get(&DataKey::Member(pool_id, member.clone()))
}

fn save_member(env: &Env, pool_id: u64, member: &Address, record: &Member) {
    let key = DataKey::Member(pool_id, member.clone());
    env.storage().persistent().set(&key, record);
    extend_persistent(env, &key);
    extend_persistent(env, &DataKey::MemberAt(pool_id, record.index));
}

/// Records a new member, owing the pool's share if it has one, and bumps the
/// pool's member count. The caller saves the pool.
fn add_member(env: &Env, pool: &mut Pool, settings: &PoolSettings, member: &Address) -> Member {
    let record = Member {
        index: pool.member_count,
        joined_at: env.ledger().timestamp(),
        contributed: 0,
        refunded: false,
        expected: settings.share_amount,
        paid: settings.share_amount.map(|_| false),
    };
    env.storage()
        .persistent()
        .set(&DataKey::MemberAt(pool.id, record.index), member);
    save_member(env, pool.id, member, &record);
    pool.member_count += 1;
    MemberJoined {
        pool_id: pool.id,
        member: member.clone(),
    }
    .publish(env);
    record
}

fn extend_instance(env: &Env) {
    let extend_to = INSTANCE_EXTEND_TO.min(env.storage().max_ttl());
    env.storage()
        .instance()
        .extend_ttl(extend_to.saturating_sub(DAY_IN_LEDGERS), extend_to);
}

fn extend_persistent(env: &Env, key: &DataKey) {
    let extend_to = PERSISTENT_EXTEND_TO.min(env.storage().max_ttl());
    env.storage()
        .persistent()
        .extend_ttl(key, extend_to.saturating_sub(DAY_IN_LEDGERS), extend_to);
}

mod test;
mod test_approvals;
mod test_security;
mod test_terms;
mod test_voluntary;
