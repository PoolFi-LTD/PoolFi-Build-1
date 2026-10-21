import { getRuntime } from "@server/runtime";

// The PoolFi API (server/), served from /api by the web app: /api/v1/pools reaches the
// server's /v1/pools. Stellar transactions take a few seconds, well inside the limit.
export const maxDuration = 300;

/** Headers that describe the connection, not the response, so they aren't passed on. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-length"]);

async function handle(request: Request): Promise<Response> {
  let app;
  try {
    ({ app } = await getRuntime());
  } catch (error) {
    console.error("PoolFi API failed to start", error);
    return Response.json(
      { error: { code: "api_unavailable", message: "The PoolFi API isn't available right now. Try again soon." } },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const reply = await app.inject({
    method: request.method as "GET",
    url: url.pathname.replace(/^\/api/, "") + url.search,
    headers: Object.fromEntries(request.headers),
    payload: hasBody ? Buffer.from(await request.arrayBuffer()) : undefined,
  });

  const headers = new Headers();
  for (const [name, value] of Object.entries(reply.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name)) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, String(v));
  }
  return new Response(reply.statusCode === 204 ? null : new Uint8Array(reply.rawPayload), { status: reply.statusCode, headers });
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
