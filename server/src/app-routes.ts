import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthUser } from "./auth.ts";
import type { Config } from "./config.ts";
import { parse } from "./parse.ts";
import { DepositInput, PreferencesInput, ProfileInput } from "./services/app/account.ts";
import { AddDiversInput, CreatePoolInput, DeclineInput, PayInput, PayoutInput, PoolSettingsInput } from "./services/app/pools.ts";
import type { Services } from "./services/index.ts";

/** Room for a profile photo or a long member list; everything else keeps the app's 64 KB limit. */
const LARGE_BODY = 512 * 1024;

type Params = { Params: { id: string } };

/** Where links in messages point: the configured address, else the address this request came to. */
export function requestAppUrl(config: Config, request: FastifyRequest): string {
  if (config.appUrl) return config.appUrl;
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  const proto = request.headers["x-forwarded-proto"] ?? "https";
  return `${String(proto).split(",")[0]}://${String(host).split(",")[0]}`;
}

/**
 * The web app's API: one endpoint per thing a screen asks for, shaped as
 * `api-types.ts` describes. Mounted at /v1/app.
 */
export function appRoutes(
  { account, pools }: Services["app"],
  signedIn: (request: FastifyRequest) => Promise<AuthUser>,
  config: Config,
) {
  const appUrl = (request: FastifyRequest) => requestAppUrl(config, request);

  return async (app: FastifyInstance) => {
    // You
    app.get("/me", async (request) => account.me(await signedIn(request)));
    app.put("/me/profile", { bodyLimit: LARGE_BODY }, async (request) =>
      account.saveProfile(await signedIn(request), parse(ProfileInput, request.body)),
    );
    app.get("/me/achievements", async (request) => account.achievements(await signedIn(request)));
    app.put("/me/preferences", async (request) =>
      account.savePreferences(await signedIn(request), parse(PreferencesInput, request.body)),
    );
    app.get("/home", async (request) => account.home(await signedIn(request)));
    app.get("/activity", async (request) => account.activity(await signedIn(request)));
    app.get("/notifications", async (request) => account.notifications(await signedIn(request)));
    app.post("/notifications/read", async (request) => {
      await account.markNotificationsRead(await signedIn(request));
      return { read: true };
    });
    app.get("/contacts", async (request) => account.contacts(await signedIn(request)));

    // Pools
    app.get("/fee", async () => ({ bps: await pools.feeBps() }));
    app.get("/pools", async (request) => pools.list(await signedIn(request)));
    app.post("/pools", { bodyLimit: LARGE_BODY }, async (request, reply) => {
      const pool = await pools.create(await signedIn(request), parse(CreatePoolInput, request.body));
      return reply.status(201).send(pool);
    });
    app.get<Params>("/pools/:id", async (request) => pools.get(await signedIn(request), request.params.id));
    app.patch<Params>("/pools/:id/settings", async (request) =>
      pools.updateSettings(await signedIn(request), request.params.id, parse(PoolSettingsInput, request.body)),
    );
    app.post<Params>("/pools/:id/divers", { bodyLimit: LARGE_BODY }, async (request) =>
      pools.addDivers(await signedIn(request), request.params.id, parse(AddDiversInput, request.body)),
    );
    app.post<Params>("/pools/:id/reminders", async (request) =>
      pools.remindUnpaid(await signedIn(request), request.params.id, appUrl(request)),
    );
    app.get<Params>("/pools/:id/record", async (request) => pools.record(await signedIn(request), request.params.id));

    // Payouts
    app.post<Params>("/pools/:id/payout", async (request) =>
      pools.requestPayout(await signedIn(request), request.params.id, parse(PayoutInput, request.body).destination, appUrl(request)),
    );
    app.post<Params>("/pools/:id/payout/approve", async (request) =>
      pools.approvePayout(await signedIn(request), request.params.id, appUrl(request)),
    );
    app.post<Params>("/pools/:id/payout/decline", async (request) =>
      pools.declinePayout(await signedIn(request), request.params.id, parse(DeclineInput, request.body).reason, appUrl(request)),
    );

    // The invite link: anyone can look; paying needs signing in.
    app.get<{ Params: { code: string } }>("/invites/:code", async (request) => pools.invite(request.params.code));
    app.post<{ Params: { code: string } }>("/invites/:code/pay", async (request, reply) => {
      const result = await pools.payShare(await signedIn(request), request.params.code, parse(PayInput, request.body), appUrl(request));
      return reply.status(201).send(result);
    });

    // Wallet
    app.get("/wallet", async (request) => account.wallet(await signedIn(request)));
    app.post("/wallet/deposits", async (request, reply) => {
      const wallet = await account.deposit(await signedIn(request), parse(DepositInput, request.body));
      return reply.status(201).send(wallet);
    });

    // Receipts are public: anyone given the reference can check it.
    app.get<{ Params: { ref: string } }>("/receipts/:ref", async (request) => account.receipt(request.params.ref));
  };
}
