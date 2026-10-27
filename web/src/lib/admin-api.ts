import { httpAdminApi } from "./api-http";
import { sampleAdminApi } from "./sample";
import type {
  AdminAction,
  AdminJobRun,
  AdminMoney,
  AdminOverview,
  AdminPoolDetail,
  AdminPoolFilter,
  AdminPoolList,
  AdminUserDetail,
  AdminUserFilter,
  AdminUserList,
} from "./types";

/** What the admin dashboard asks of the backend (/api/v1/admin). Only the PoolFi team gets answers. */
export interface AdminApi {
  overview(): Promise<AdminOverview>;

  users(filter: AdminUserFilter, q: string): Promise<AdminUserList>;
  user(id: string): Promise<AdminUserDetail>;
  /** No signing in or using the app until it's lifted; signed out everywhere at once. */
  suspend(id: string, reason: string): Promise<AdminUserDetail>;
  unsuspend(id: string): Promise<AdminUserDetail>;
  /** Clears a lock from too many wrong passwords. */
  unlock(id: string): Promise<AdminUserDetail>;
  signOut(id: string): Promise<AdminUserDetail>;
  /** Puts a wallet on Stellar (account and USDC trustline) when the first try didn't finish. */
  activateWallet(id: string): Promise<AdminUserDetail>;

  pools(status: AdminPoolFilter, q: string): Promise<AdminPoolList>;
  pool(id: string): Promise<AdminPoolDetail>;
  /** A later deadline (ISO), signed with the lifeguard's wallet. */
  extendPool(id: string, deadline: string, reason: string): Promise<AdminPoolDetail>;
  /** Closes a pool that hasn't paid out and refunds everyone who paid. */
  closePool(id: string, reason: string): Promise<AdminPoolDetail>;
  /** Sends the refunds a cancelled pool still owes, now. */
  retryRefunds(id: string): Promise<AdminPoolDetail>;

  money(): Promise<AdminMoney>;
  runRefundJob(): Promise<AdminJobRun>;

  log(): Promise<AdminAction[]>;
}

/** The real backend once sign-in is set up; the sample data until then, as for the rest of the app. */
export const adminApi: AdminApi = process.env.NEXT_PUBLIC_SUPABASE_URL ? httpAdminApi : sampleAdminApi;
