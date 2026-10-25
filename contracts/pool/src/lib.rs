#![no_std]

//! PoolFi pool contract.
//!
//! One deployment holds any number of USDC contribution pools. Each pool has
//! its own admin wallet, goal, deadline and optional approvers. Members join
//! and contribute USDC into the contract. Once the goal is met the pool admin is
//! paid out (after a majority of approvers agree, if the pool has any), less the
//! platform fee. If the deadline passes first, the pool admin decides: extend the
//! deadline (as often as they like) or cancel so members claim refunds. See
//! `docs/contract-plan.md`.

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

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PoolStatus {
    /// Accepting joins and contributions until the deadline.
    Open,
    /// Goal reached. Still accepting until the deadline; the pool admin can settle.
    Funded,
    /// The pool balance was paid to the pool admin.
    Settled,
    /// Members can claim back what they contributed.
    Refunded,
    /// The deadline passed before the goal was reached. Never stored: `get_pool`
    /// reports it for an Open pool past its deadline. The pool admin either
    /// extends the deadline or cancels the pool; until then nothing moves.
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pool {
    pub id: u64,
    pub admin: Address,
    pub goal_amount: i128,
    /// Unix timestamp (seconds) after which the pool stops accepting joins and contributions.
    pub deadline: u64,
    pub total_contributed: i128,
    pub total_refunded: i128,
    pub member_count: u32,
    pub status: PoolStatus,
    pub created_at: u64,
    /// Wallets that approve the payout; a majority must agree. Empty means the
    /// pool admin is paid out alone. None on pools stored before approvers existed.
    pub approvers: Option<Vec<Address>>,
    /// Approvals of the pending payout request; None when no payout is requested.
    pub payout_approvals: Option<Vec<Address>>,
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
        if approvers.len() > MAX_APPROVERS {
            return Err(Error::InvalidApprovers);
        }
        for (i, approver) in approvers.iter().enumerate() {
            let repeated = approvers.iter().skip(i + 1).any(|other| other == approver);
            if approver == admin || repeated {
                return Err(Error::InvalidApprovers);
            }
        }
        if goal_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let now = env.ledger().timestamp();
        if deadline <= now {
            return Err(Error::InvalidDeadline);
        }

        let id = Self::pool_count(env.clone());
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
            created_at: now,
            approvers: Some(approvers.clone()),
            payout_approvals: None,
        };
        save_pool(&env, &pool);
        PoolCreated {
            pool_id: id,
            admin,
            goal_amount,
            deadline,
            approvers,
        }
        .publish(&env);
        Ok(id)
    }

    pub fn join_pool(env: Env, pool_id: u64, member: Address) -> Result<(), Error> {
        member.require_auth();
        let mut pool = load_pool(&env, pool_id)?;
        ensure_accepting(&env, &pool)?;
        if load_member(&env, pool_id, &member).is_some() {
            return Err(Error::AlreadyMember);
        }
        add_member(&env, &mut pool, &member);
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
        let mut pool = load_pool(&env, pool_id)?;
        ensure_accepting(&env, &pool)?;
        if pool.payout_approvals.is_some() {
            return Err(Error::PayoutPending);
        }

        let mut record = match load_member(&env, pool_id, &member) {
            Some(record) => record,
            None => add_member(&env, &mut pool, &member),
        };
        record.contributed += amount;
        pool.total_contributed += amount;
        let reached_goal =
            pool.status == PoolStatus::Open && pool.total_contributed >= pool.goal_amount;
        if reached_goal {
            pool.status = PoolStatus::Funded;
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

    /// Pays a Funded pool without approvers to its admin, less the fee.
    /// Returns what the admin received.
    pub fn settle(env: Env, pool_id: u64) -> Result<i128, Error> {
        let mut pool = load_pool(&env, pool_id)?;
        pool.admin.require_auth();
        ensure_funded(&env, &pool)?;
        if !approvers_of(&env, &pool).is_empty() {
            return Err(Error::ApprovalRequired);
        }
        Ok(pay_out(&env, &mut pool))
    }

    /// The pool admin asks the approvers to release a Funded pool's payout.
    pub fn request_payout(env: Env, pool_id: u64) -> Result<(), Error> {
        let mut pool = load_pool(&env, pool_id)?;
        pool.admin.require_auth();
        ensure_funded(&env, &pool)?;
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
            needed: needed_approvals(&approvers),
        }
        .publish(&env);
        Ok(())
    }

    /// An approver agrees to the pending payout. Once a majority has, the pool
    /// admin is paid out straight away. Returns whether that happened.
    pub fn approve_payout(env: Env, pool_id: u64, approver: Address) -> Result<bool, Error> {
        approver.require_auth();
        let mut pool = load_pool(&env, pool_id)?;
        ensure_funded(&env, &pool)?;
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
        let needed = needed_approvals(&approvers);
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
        let mut pool = load_pool(&env, pool_id)?;
        ensure_funded(&env, &pool)?;
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
        let mut pool = load_pool(&env, pool_id)?;
        pool.admin.require_auth();
        ensure_not_closed(&env, &pool)?;

        pool.status = PoolStatus::Refunded;
        pool.payout_approvals = None;
        save_pool(&env, &pool);
        PoolCancelled { pool_id }.publish(&env);
        Ok(())
    }

    /// Moves the deadline of an Open, Expired or Funded pool later, so it accepts
    /// joins and contributions again until then. Only the pool admin can, as
    /// often as they like; the deadline never moves earlier.
    pub fn extend_deadline(env: Env, pool_id: u64, new_deadline: u64) -> Result<(), Error> {
        let mut pool = load_pool(&env, pool_id)?;
        pool.admin.require_auth();
        ensure_not_closed(&env, &pool)?;
        if new_deadline <= env.ledger().timestamp() || new_deadline <= pool.deadline {
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

    /// Returns a member's contribution from a Refunded pool (one its admin
    /// cancelled). Anyone can call it; the funds always go to the member.
    pub fn claim_refund(env: Env, pool_id: u64, member: Address) -> Result<i128, Error> {
        let mut pool = load_pool(&env, pool_id)?;
        if pool.status != PoolStatus::Refunded {
            return Err(Error::NotRefundable);
        }
        let mut record = load_member(&env, pool_id, &member).ok_or(Error::NotMember)?;
        if record.refunded || record.contributed == 0 {
            return Err(Error::NothingToRefund);
        }

        let amount = record.contributed;
        record.refunded = true;
        pool.total_refunded += amount;
        save_member(&env, pool_id, &member, &record);
        save_pool(&env, &pool);

        token_client(&env).transfer(&env.current_contract_address(), &member, &amount);

        Refunded {
            pool_id,
            member,
            amount,
        }
        .publish(&env);
        Ok(amount)
    }

    /// The pool, with `status` reflecting an expired deadline.
    pub fn get_pool(env: Env, pool_id: u64) -> Result<Pool, Error> {
        let mut pool = load_pool(&env, pool_id)?;
        pool.status = effective_status(&env, &pool);
        Ok(pool)
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

    pub fn pool_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextPoolId)
            .unwrap_or(0)
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

/// A majority: 1 of 1, 2 of 2, 2 of 3, 3 of 4, ...
fn needed_approvals(approvers: &Vec<Address>) -> u32 {
    approvers.len() / 2 + 1
}

fn ensure_funded(env: &Env, pool: &Pool) -> Result<(), Error> {
    match effective_status(env, pool) {
        PoolStatus::Funded => Ok(()),
        PoolStatus::Open | PoolStatus::Expired => Err(Error::GoalNotReached),
        PoolStatus::Settled | PoolStatus::Refunded => Err(Error::PoolClosed),
    }
}

/// The pool admin can still extend or cancel: it hasn't paid out or been cancelled.
fn ensure_not_closed(env: &Env, pool: &Pool) -> Result<(), Error> {
    match effective_status(env, pool) {
        PoolStatus::Open | PoolStatus::Expired | PoolStatus::Funded => Ok(()),
        PoolStatus::Settled | PoolStatus::Refunded => Err(Error::PoolClosed),
    }
}

/// Sends a Funded pool's balance to its admin, less the platform fee, and
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

/// An Open pool past its deadline never reached its goal: it waits for its admin
/// to extend the deadline or cancel.
fn effective_status(env: &Env, pool: &Pool) -> PoolStatus {
    if pool.status == PoolStatus::Open && env.ledger().timestamp() >= pool.deadline {
        PoolStatus::Expired
    } else {
        pool.status
    }
}

fn ensure_accepting(env: &Env, pool: &Pool) -> Result<(), Error> {
    match pool.status {
        PoolStatus::Settled | PoolStatus::Refunded => Err(Error::PoolClosed),
        PoolStatus::Expired => Err(Error::DeadlinePassed),
        PoolStatus::Open | PoolStatus::Funded if env.ledger().timestamp() >= pool.deadline => {
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

/// Every pool write also keeps the contract instance alive.
fn save_pool(env: &Env, pool: &Pool) {
    let key = DataKey::Pool(pool.id);
    env.storage().persistent().set(&key, pool);
    extend_persistent(env, &key);
    extend_instance(env);
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

/// Records a new member and bumps the pool's member count. The caller saves the pool.
fn add_member(env: &Env, pool: &mut Pool, member: &Address) -> Member {
    let record = Member {
        index: pool.member_count,
        joined_at: env.ledger().timestamp(),
        contributed: 0,
        refunded: false,
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
