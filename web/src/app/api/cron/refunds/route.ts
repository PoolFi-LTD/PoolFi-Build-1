import { getRuntime } from "@server/runtime";

// Refunds contributors of pools that missed their goal. Vercel's scheduled job calls it
// (see vercel.json), and so can any scheduler that sends the secret, e.g. GitHub Actions.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: { code: "unauthenticated", message: "Not allowed." } }, { status: 401 });
  }
  const { services } = await getRuntime();
  // Null means another run is already going; that run does the work.
  const run = await services.refunds.runOnce();
  return Response.json({ run: run ?? "already running" });
}
