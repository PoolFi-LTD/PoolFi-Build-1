import type { AdminAction } from "./types";

/** The admin log line after the admin's email: "suspended Ada Eze". */
export function actionSentence(action: AdminAction["action"], label: string | null): string {
  const what = label ?? "something that no longer exists";
  switch (action) {
    case "suspend_user":
      return `suspended ${what}`;
    case "unsuspend_user":
      return `lifted ${what}'s suspension`;
    case "unlock_user":
      return `unlocked ${what}'s account`;
    case "sign_out_user":
      return `signed ${what} out everywhere`;
    case "activate_wallet":
      return `put ${what}'s wallet on Stellar`;
    case "extend_pool":
      return `extended the deadline for ${what}`;
    case "close_pool":
      return `closed ${what} and refunded its divers`;
    case "retry_refunds":
      return `sent the refunds left in ${what}`;
    case "run_refund_job":
      return "ran the refund job";
  }
}
