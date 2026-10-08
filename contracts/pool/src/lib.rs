#![no_std]

//! PoolFi pool contract.
//!
//! One deployment holds any number of USDC contribution pools. Each pool has
//! its own admin wallet, goal and deadline. Members join and contribute USDC
//! into the contract; the pool admin settles once the goal is met, otherwise
//! members claim refunds. See `docs/contract-plan.md` for the design.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, BytesN,
    ContractExecutable, Env, Vec,
};

const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const PERSISTENT_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;
/// Largest page `get_members` returns, to stay within per-transaction read limits.
const MAX_PAGE_SIZE: u32 = 50;

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
    NextPoolId,
    Pool(u64),
    Member(u64, Address),
    MemberAt(u64, u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    PoolNotFound = 1,
    InvalidAmount = 2,
    InvalidDeadline = 3,
    DeadlinePassed = 4,
    PoolClosed = 5,
    AlreadyMember = 6,
    GoalNotReached = 7,
    NotRefundable = 8,
    NotMember = 9,
    NothingToRefund = 10,
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
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolCancelled {
    #[topic]
    pub pool_id: u64,
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
    /// Runs once, atomically with the deploy. `token` is the USDC Stellar Asset Contract.
    pub fn __constructor(env: Env, admin: Address, token: Address) {
        let storage = env.storage().instance();
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::NextPoolId, &0u64);
        extend_instance(&env);
    }

    pub fn create_pool(
        env: Env,
        admin: Address,
        goal_amount: i128,
        deadline: u64,
    ) -> Result<u64, Error> {
        admin.require_auth();
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
        };
        save_pool(&env, &pool);
        PoolCreated {
            pool_id: id,
            admin,
            goal_amount,
            deadline,
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

    /// Pays the full pool balance to the pool admin. The pool must be Funded.
    pub fn settle(env: Env, pool_id: u64) -> Result<i128, Error> {
        let mut pool = load_pool(&env, pool_id)?;
        pool.admin.require_auth();
        match effective_status(&env, &pool) {
            PoolStatus::Funded => {}
            PoolStatus::Open => return Err(Error::GoalNotReached),
            PoolStatus::Settled | PoolStatus::Refunded => return Err(Error::PoolClosed),
        }

        let amount = pool.total_contributed;
        pool.status = PoolStatus::Settled;
        save_pool(&env, &pool);

        token_client(&env).transfer(&env.current_contract_address(), &pool.admin, &amount);

        PoolSettled {
            pool_id,
            admin: pool.admin,
            amount,
        }
        .publish(&env);
        Ok(amount)
    }

    /// Closes an Open or Funded pool so members can claim refunds.
    pub fn cancel_pool(env: Env, pool_id: u64) -> Result<(), Error> {
        let mut pool = load_pool(&env, pool_id)?;
        pool.admin.require_auth();
        match effective_status(&env, &pool) {
            PoolStatus::Open | PoolStatus::Funded => {}
            PoolStatus::Settled | PoolStatus::Refunded => return Err(Error::PoolClosed),
        }

        pool.status = PoolStatus::Refunded;
        save_pool(&env, &pool);
        PoolCancelled { pool_id }.publish(&env);
        Ok(())
    }

    /// Returns a member's contribution from a Refunded pool. Anyone can call it;
    /// the funds always go to the member.
    pub fn claim_refund(env: Env, pool_id: u64, member: Address) -> Result<i128, Error> {
        let mut pool = load_pool(&env, pool_id)?;
        if effective_status(&env, &pool) != PoolStatus::Refunded {
            return Err(Error::NotRefundable);
        }
        let mut record = load_member(&env, pool_id, &member).ok_or(Error::NotMember)?;
        if record.refunded || record.contributed == 0 {
            return Err(Error::NothingToRefund);
        }

        let amount = record.contributed;
        record.refunded = true;
        pool.status = PoolStatus::Refunded;
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

fn token_client(env: &Env) -> token::TokenClient<'_> {
    let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
    token::TokenClient::new(env, &token)
}

/// An Open pool past its deadline never reached its goal, so it is refundable.
fn effective_status(env: &Env, pool: &Pool) -> PoolStatus {
    if pool.status == PoolStatus::Open && env.ledger().timestamp() >= pool.deadline {
        PoolStatus::Refunded
    } else {
        pool.status
    }
}

fn ensure_accepting(env: &Env, pool: &Pool) -> Result<(), Error> {
    match pool.status {
        PoolStatus::Settled | PoolStatus::Refunded => Err(Error::PoolClosed),
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
