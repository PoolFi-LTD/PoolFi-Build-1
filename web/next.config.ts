import path from "node:path";
import type { NextConfig } from "next";

// The repo root: the API's code lives in ../server, and packages are installed at the root.
const root = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: { root },
  outputFileTracingRoot: root,
  // Loaded from node_modules at run time rather than bundled.
  serverExternalPackages: ["@stellar/stellar-sdk", "fastify", "@fastify/cors", "pg", "web-push"],
  // The service worker must never be cached, so a fix reaches everyone on their next visit.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
