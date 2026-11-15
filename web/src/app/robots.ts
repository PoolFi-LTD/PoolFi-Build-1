import type { MetadataRoute } from "next";

/**
 * Disallow all search engine crawlers on app.thepoolfi.com.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
