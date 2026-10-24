/**
 * Device notifications (Web Push) in the browser: whether this device can get them,
 * turning them on (permission, then a subscription the server sends to) and off.
 */
import { api } from "./api";
import { ApiError } from "./errors";

export type PushState =
  /** This browser can't receive web notifications. */
  | "unsupported"
  /** iPhone or iPad: only works once PoolFi is added to the Home Screen and opened from there. */
  | "needs-install"
  /** The person said no; only the browser's settings can undo that. */
  | "blocked"
  | "off"
  | "on";

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isInstalled() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

/** Asks for permission (call it straight from a tap), then subscribes this device. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return pushState();
  // Safari only shows the permission prompt if it's asked for in the tap itself, before anything else waits.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const key = await api.getPushKey();
  if (!key) throw new ApiError("push_unavailable", "Device notifications aren't set up yet.");
  const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(key) }));
  await api.savePushSubscription(subscription.toJSON());
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await api.deletePushSubscription(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe();
  }
  return pushState();
}

/**
 * On each sign-in: a device with notifications on is (re)linked to whoever is signed in,
 * so a shared phone notifies its current owner.
 */
export async function syncPush(): Promise<void> {
  if (!supported() || Notification.permission !== "granted") return;
  const registration = await registerServiceWorker();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await api.savePushSubscription(subscription.toJSON()).catch(() => {});
}

/** VAPID keys are base64url; the browser wants raw bytes. */
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
