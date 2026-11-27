import type { MetadataRoute } from "next";

/**
 * app.thepoolfi.com is in beta and must stay out of search results. That is done by the
 * noindex rule every page sends (the X-Robots-Tag header in next.config.ts and the robots
 * meta tag in layout.tsx), not here: a crawler blocked by robots.txt never fetches a page,
 * so it never sees the noindex and can keep listing the address. Crawlers are allowed in
 * so they read the noindex and drop the site.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
  };
}
