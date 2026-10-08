#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{
        self, Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger,
        MockAuth, MockAuthInvoke,
    },
    token::{StellarAssetClient, TokenClient},
    Address, Env, Event as _, IntoVal, Symbol,
};

const START: u64 = 1_780_000_000;
const DAY: u64 = 86_400;
/// USDC has 7 decimals on Stellar.
const USDC: i128 = 10_000_000;

struct Setup<'a> {
    pool: PoolContractClient<'a>,
    usdc: TokenClient<'a>,
    usdc_admin: StellarAssetClient<'a>,
    contract_admin: Address,
    env: Env,
}

impl<'a> Setup<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(START);

        let issuer = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(issuer);
        let contract_admin = Address::generate(&env);
        let contract_id = env.register(PoolContract, (&contract_admin, &sac.address()));

        Setup {
            pool: PoolContractClient::new(&env, &contract_id),
            usdc: TokenClient::new(&env, &sac.address()),
            usdc_admin: StellarAssetClient::new(&env, &sac.address()),
            contract_admin,
            env,
        }
    }

    fn wallet(&self, usdc: i128) -> Address {
        let wallet = Address::generate(&self.env);
        if usdc > 0 {
            self.usdc_admin.mint(&wallet, &usdc);
        }
        wallet
    }

    fn deadline(&self) -> u64 {
        START + 7 * DAY
    }

    fn new_pool(&self, admin: &Address, goal: i128) -> u64 {
        self.pool.create_pool(admin, &goal, &self.deadline())
    }

    fn pool_events(&self) -> testutils::ContractEvents {
        self.env
            .events()
            .all()
            .filter_by_contract(&self.pool.address)
    }

    fn pass_deadline(&self) {
        self.env.ledger().set_timestamp(self.deadline());
    }
}

#[test]
fn constructor_stores_config() {
    let s = Setup::new();
    assert_eq!(s.pool.admin(), s.contract_admin);
    assert_eq!(s.pool.token(), s.usdc.address);
    assert_eq!(s.pool.pool_count(), 0);
}

#[test]
fn pool_is_created() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let goal = 100 * USDC;

    let pool_id = s.new_pool(&admin, goal);

    assert_eq!(pool_id, 0);
    assert_eq!(
        s.env.auths(),
        std::vec![(
            admin.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    s.pool.address.clone(),
                    Symbol::new(&s.env, "create_pool"),
                    (admin.clone(), goal, s.deadline()).into_val(&s.env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
    assert_eq!(
        s.pool_events(),
        [PoolCreated {
            pool_id,
            admin: admin.clone(),
            goal_amount: goal,
            deadline: s.deadline(),
        }
        .to_xdr(&s.env, &s.pool.address)]
    );
    assert_eq!(s.pool.pool_count(), 1);
    assert_eq!(
        s.pool.get_pool(&pool_id),
        Pool {
            id: 0,
            admin,
            goal_amount: goal,
            deadline: s.deadline(),
            total_contributed: 0,
            total_refunded: 0,
            member_count: 0,
            status: PoolStatus::Open,
            created_at: START,
        }
    );
    assert_eq!(s.new_pool(&s.wallet(0), goal), 1);
}

#[test]
fn second_wallet_joins() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let pool_id = s.new_pool(&admin, 100 * USDC);
    let member = s.wallet(0);

    s.pool.join_pool(&pool_id, &member);

    assert_eq!(s.env.auths()[0].0, member);
    assert_eq!(
        s.pool_events(),
        [MemberJoined {
            pool_id,
            member: member.clone(),
        }
        .to_xdr(&s.env, &s.pool.address)]
    );
    assert!(s.pool.is_member(&pool_id, &member));
    assert_eq!(
        s.pool.get_member(&pool_id, &member),
        Some(Member {
            index: 0,
            joined_at: START,
            contributed: 0,
            refunded: false,
        })
    );
    assert_eq!(s.pool.get_pool(&pool_id).member_count, 1);
    assert_eq!(
        s.pool.get_members(&pool_id, &0, &10),
        soroban_sdk::vec![&s.env, member.clone()]
    );
    assert_eq!(
        s.pool.try_join_pool(&pool_id, &member),
        Err(Ok(Error::AlreadyMember))
    );
}

#[test]
fn usdc_contribution_is_recorded() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let pool_id = s.new_pool(&admin, 100 * USDC);
    let member = s.wallet(50 * USDC);
    s.pool.join_pool(&pool_id, &member);
    let amount = 20 * USDC;

    s.pool.contribute(&pool_id, &member, &amount);

    // The member signed both the contribution and the USDC transfer inside it.
    assert_eq!(
        s.env.auths(),
        std::vec![(
            member.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    s.pool.address.clone(),
                    Symbol::new(&s.env, "contribute"),
                    (pool_id, member.clone(), amount).into_val(&s.env),
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        s.usdc.address.clone(),
                        Symbol::new(&s.env, "transfer"),
                        (member.clone(), s.pool.address.clone(), amount).into_val(&s.env),
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )]
    );
    assert_eq!(
        s.pool_events(),
        [Contributed {
            pool_id,
            member: member.clone(),
            amount,
            member_total: amount,
            pool_total: amount,
        }
        .to_xdr(&s.env, &s.pool.address)]
    );
    assert_eq!(s.usdc.balance(&member), 30 * USDC);
    assert_eq!(s.usdc.balance(&s.pool.address), amount);
    assert_eq!(
        s.pool.get_member(&pool_id, &member).unwrap().contributed,
        amount
    );
    let pool = s.pool.get_pool(&pool_id);
    assert_eq!(pool.total_contributed, amount);
    assert_eq!(pool.status, PoolStatus::Open);

    s.pool.contribute(&pool_id, &member, &(5 * USDC));
    assert_eq!(
        s.pool.get_member(&pool_id, &member).unwrap().contributed,
        25 * USDC
    );
}

#[test]
fn contributing_without_joining_joins_first() {
    let s = Setup::new();
    let pool_id = s.new_pool(&s.wallet(0), 100 * USDC);
    let member = s.wallet(10 * USDC);

    s.pool.contribute(&pool_id, &member, &(10 * USDC));

    assert_eq!(
        s.pool_events(),
        [
            MemberJoined {
                pool_id,
                member: member.clone(),
            }
            .to_xdr(&s.env, &s.pool.address),
            Contributed {
                pool_id,
                member: member.clone(),
                amount: 10 * USDC,
                member_total: 10 * USDC,
                pool_total: 10 * USDC,
            }
            .to_xdr(&s.env, &s.pool.address),
        ]
    );
    assert!(s.pool.is_member(&pool_id, &member));
    assert_eq!(s.pool.get_pool(&pool_id).member_count, 1);
}

#[test]
fn reaching_goal_funds_pool_and_admin_settles() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let pool_id = s.new_pool(&admin, 100 * USDC);
    let alice = s.wallet(100 * USDC);
    let bob = s.wallet(100 * USDC);

    s.pool.contribute(&pool_id, &alice, &(60 * USDC));
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::GoalNotReached)));

    s.pool.contribute(&pool_id, &bob, &(40 * USDC));
    assert_eq!(
        s.pool_events().events().last().unwrap(),
        &PoolFunded {
            pool_id,
            total: 100 * USDC,
        }
        .to_xdr(&s.env, &s.pool.address)
    );
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Funded);

    // A funded pool keeps accepting until the deadline.
    s.pool.contribute(&pool_id, &alice, &(5 * USDC));

    assert_eq!(s.pool.settle(&pool_id), 105 * USDC);
    assert_eq!(s.env.auths()[0].0, admin);
    assert_eq!(s.usdc.balance(&admin), 105 * USDC);
    assert_eq!(s.usdc.balance(&s.pool.address), 0);
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Settled);

    assert_eq!(
        s.pool.try_contribute(&pool_id, &bob, &USDC),
        Err(Ok(Error::PoolClosed))
    );
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::PoolClosed)));
    assert_eq!(s.pool.try_cancel_pool(&pool_id), Err(Ok(Error::PoolClosed)));
}

#[test]
fn funded_pool_can_settle_after_deadline() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let pool_id = s.new_pool(&admin, 10 * USDC);
    s.pool
        .contribute(&pool_id, &s.wallet(10 * USDC), &(10 * USDC));

    s.pass_deadline();

    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Funded);
    assert_eq!(s.pool.settle(&pool_id), 10 * USDC);
}

#[test]
fn pools_keep_separate_balances() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let first = s.new_pool(&admin, 10 * USDC);
    let second = s.new_pool(&admin, 50 * USDC);
    let member = s.wallet(100 * USDC);

    s.pool.contribute(&first, &member, &(10 * USDC));
    s.pool.contribute(&second, &member, &(20 * USDC));

    assert_eq!(s.pool.settle(&first), 10 * USDC);
    assert_eq!(s.usdc.balance(&s.pool.address), 20 * USDC);
    assert_eq!(s.pool.get_pool(&second).total_contributed, 20 * USDC);
}

#[test]
fn cancelled_pool_refunds_members() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let pool_id = s.new_pool(&admin, 100 * USDC);
    let member = s.wallet(30 * USDC);
    s.pool.contribute(&pool_id, &member, &(30 * USDC));

    s.pool.cancel_pool(&pool_id);
    assert_eq!(s.env.auths()[0].0, admin);
    assert_eq!(
        s.pool_events(),
        [PoolCancelled { pool_id }.to_xdr(&s.env, &s.pool.address)]
    );
    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Refunded);
    assert_eq!(
        s.pool.try_join_pool(&pool_id, &s.wallet(0)),
        Err(Ok(Error::PoolClosed))
    );

    assert_eq!(s.pool.claim_refund(&pool_id, &member), 30 * USDC);
    assert_eq!(
        s.pool_events(),
        [Refunded {
            pool_id,
            member: member.clone(),
            amount: 30 * USDC,
        }
        .to_xdr(&s.env, &s.pool.address)]
    );
    assert_eq!(s.usdc.balance(&member), 30 * USDC);
    assert_eq!(s.pool.get_pool(&pool_id).total_refunded, 30 * USDC);
    assert!(s.pool.get_member(&pool_id, &member).unwrap().refunded);
    assert_eq!(
        s.pool.try_claim_refund(&pool_id, &member),
        Err(Ok(Error::NothingToRefund))
    );
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::PoolClosed)));
}

#[test]
fn expired_pool_below_goal_refunds_members() {
    let s = Setup::new();
    let pool_id = s.new_pool(&s.wallet(0), 100 * USDC);
    let member = s.wallet(40 * USDC);
    s.pool.contribute(&pool_id, &member, &(40 * USDC));
    assert_eq!(
        s.pool.try_claim_refund(&pool_id, &member),
        Err(Ok(Error::NotRefundable))
    );

    s.pass_deadline();

    assert_eq!(s.pool.get_pool(&pool_id).status, PoolStatus::Refunded);
    assert_eq!(
        s.pool.try_contribute(&pool_id, &member, &USDC),
        Err(Ok(Error::DeadlinePassed))
    );
    assert_eq!(
        s.pool.try_join_pool(&pool_id, &s.wallet(0)),
        Err(Ok(Error::DeadlinePassed))
    );
    assert_eq!(s.pool.try_settle(&pool_id), Err(Ok(Error::PoolClosed)));

    assert_eq!(s.pool.claim_refund(&pool_id, &member), 40 * USDC);
    assert_eq!(s.usdc.balance(&member), 40 * USDC);
    assert_eq!(s.usdc.balance(&s.pool.address), 0);
}

#[test]
fn invalid_inputs_are_rejected() {
    let s = Setup::new();
    let admin = s.wallet(0);

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

    let pool_id = s.new_pool(&admin, 10 * USDC);
    let member = s.wallet(10 * USDC);
    assert_eq!(
        s.pool.try_contribute(&pool_id, &member, &0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.pool.try_join_pool(&99, &member),
        Err(Ok(Error::PoolNotFound))
    );
    assert_eq!(s.pool.try_get_pool(&99), Err(Ok(Error::PoolNotFound)));

    s.pool.cancel_pool(&pool_id);
    assert_eq!(
        s.pool.try_claim_refund(&pool_id, &member),
        Err(Ok(Error::NotMember))
    );
}

#[test]
fn actions_need_the_right_signature() {
    let s = Setup::new();
    let admin = s.wallet(0);
    let pool_id = s.new_pool(&admin, 10 * USDC);
    s.pool
        .contribute(&pool_id, &s.wallet(10 * USDC), &(10 * USDC));
    let stranger = s.wallet(0);
    let member = s.wallet(10 * USDC);

    // Only the stranger has signed, for the exact call being made.
    s.env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &s.pool.address,
            fn_name: "settle",
            args: (pool_id,).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.pool.try_settle(&pool_id).is_err());

    s.env.set_auths(&[]);
    assert!(s
        .pool
        .try_create_pool(&admin, &USDC, &s.deadline())
        .is_err());
    assert!(s.pool.try_join_pool(&pool_id, &member).is_err());
    assert!(s.pool.try_contribute(&pool_id, &member, &USDC).is_err());
    assert!(s.pool.try_cancel_pool(&pool_id).is_err());
    assert!(s.pool.try_set_admin(&stranger).is_err());
    assert_eq!(s.usdc.balance(&member), 10 * USDC);
}

#[test]
fn members_are_listed_in_pages() {
    let s = Setup::new();
    let pool_id = s.new_pool(&s.wallet(0), 100 * USDC);
    let members: std::vec::Vec<Address> = (0..3).map(|_| s.wallet(0)).collect();
    for member in &members {
        s.pool.join_pool(&pool_id, member);
    }

    assert_eq!(
        s.pool.get_members(&pool_id, &1, &2),
        soroban_sdk::vec![&s.env, members[1].clone(), members[2].clone()]
    );
    assert_eq!(s.pool.get_members(&pool_id, &0, &1000).len(), 3);
    assert_eq!(s.pool.get_members(&pool_id, &5, &10).len(), 0);
}

#[test]
fn contract_admin_can_hand_over() {
    let s = Setup::new();
    let new_admin = s.wallet(0);

    s.pool.set_admin(&new_admin);

    assert_eq!(s.env.auths()[0].0, s.contract_admin);
    assert_eq!(
        s.pool_events(),
        [AdminChanged {
            old_admin: s.contract_admin.clone(),
            new_admin: new_admin.clone(),
        }
        .to_xdr(&s.env, &s.pool.address)]
    );
    assert_eq!(s.pool.admin(), new_admin);
}
