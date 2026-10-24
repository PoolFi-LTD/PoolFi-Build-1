// PoolFi's service worker: shows device notifications (Web Push) and opens the right
// screen when one is tapped. It caches nothing, so the app always loads fresh.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let message = { title: "PoolFi", body: "Something happened in your pools.", url: "/notifications" };
  try {
    if (event.data) message = { ...message, ...event.data.json() };
  } catch {
    if (event.data) message.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: message.tag,
      renotify: Boolean(message.tag),
      data: { url: message.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse a PoolFi tab or the installed app if one is open; otherwise open one.
      for (const client of open) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) return client.navigate(target);
          return undefined;
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
