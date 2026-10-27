import type { FastifyInstance, FastifyRequest } from "fastify";
import { requestAppUrl } from "./app-routes.ts";
import type { AuthUser } from "./auth.ts";
import type { Config } from "./config.ts";
import { parse } from "./parse.ts";
import { AdminExtendInput, AdminPoolQuery, AdminUserQuery, ReasonInput, type Admin } from "./services/admin.ts";

type Params = { Params: { id: string } };

/**
 * The PoolFi team's dashboard: people, pools and USDC across PoolFi, and fixing what's
 * stuck. Every route needs a signed-in person on ADMIN_EMAILS. Mounted at /v1/admin.
 */
export function adminRoutes(admin: Admin, adminOnly: (request: FastifyRequest) => Promise<AuthUser>, config: Config) {
  return async (app: FastifyInstance) => {
    app.get("/overview", async (request) => {
      await adminOnly(request);
      return admin.overview();
    });

    // People
    app.get("/users", async (request) => {
      await adminOnly(request);
      return admin.users(parse(AdminUserQuery, request.query));
    });
    app.get<Params>("/users/:id", async (request) => {
      await adminOnly(request);
      return admin.user(request.params.id);
    });
    app.post<Params>("/users/:id/suspend", async (request) =>
      admin.suspend(await adminOnly(request), request.params.id, parse(ReasonInput, request.body).reason),
    );
    app.post<Params>("/users/:id/unsuspend", async (request) => admin.unsuspend(await adminOnly(request), request.params.id));
    app.post<Params>("/users/:id/unlock", async (request) => admin.unlock(await adminOnly(request), request.params.id));
    app.post<Params>("/users/:id/sign-out", async (request) => admin.signOut(await adminOnly(request), request.params.id));
    app.post<Params>("/users/:id/wallet/activate", async (request) => admin.activateWallet(await adminOnly(request), request.params.id));

    // Pools: moving a deadline or closing one is signed with the lifeguard's wallet.
    app.get("/pools", async (request) => {
      await adminOnly(request);
      return admin.poolList(parse(AdminPoolQuery, request.query));
    });
    app.get<Params>("/pools/:id", async (request) => {
      await adminOnly(request);
      return admin.pool(request.params.id);
    });
    app.post<Params>("/pools/:id/extend", async (request) =>
      admin.extendPool(await adminOnly(request), request.params.id, parse(AdminExtendInput, request.body), requestAppUrl(config, request)),
    );
    app.post<Params>("/pools/:id/close", async (request) =>
      admin.closePool(await adminOnly(request), request.params.id, parse(ReasonInput, request.body).reason),
    );
    app.post<Params>("/pools/:id/refunds/retry", async (request) => admin.retryRefunds(await adminOnly(request), request.params.id));

    // USDC: pools being refunded, wallets not on Stellar yet, payouts, refunds, payments, deposits.
    app.get("/money", async (request) => {
      await adminOnly(request);
      return admin.money();
    });
    app.post("/jobs/refunds", async (request) => admin.runRefundJob(await adminOnly(request)));

    app.get("/log", async (request) => {
      await adminOnly(request);
      return admin.log();
    });
  };
}
