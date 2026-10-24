import type { MetadataRoute } from "next";

/** Lets PoolFi be installed to a phone's home screen (needed for notifications on iPhone). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PoolFi",
    short_name: "PoolFi",
    description: "Group money. Finally fixed. Collect class dues, birthday money and office welfare with one link.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1b4fd8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
