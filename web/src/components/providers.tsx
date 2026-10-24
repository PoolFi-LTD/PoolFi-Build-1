"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { registerServiceWorker, syncPush } from "@/lib/push";
import type { User } from "@/lib/types";
import { sound } from "@/lib/sound";
import { playSplash, reducedMotion, Splash } from "./motion";
import { LoadingState } from "./ui";

interface Session {
  user: User | null;
  loading: boolean;
  /** New notifications since the inbox was last read. */
  unread: number;
  setUnread: (n: number) => void;
  /** Asks the server again; each signed-in page does when it opens. */
  refreshUnread: () => void;
  refresh: () => Promise<User | null>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);
const ToastContext = createContext<(message: string, icon?: string) => void>(() => {});

export function Providers({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<{ message: string; icon: string; id: number; leaving?: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const u = await api.getSession().catch(() => null);
    setUser(u);
    setLoading(false);
    return u;
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .getSession()
      .catch(() => null)
      .then((u) => {
        if (!alive) return;
        setUser(u);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut();
    setUser(null);
    playSplash();
  }, []);

  const showToast = useCallback((message: string, icon = "✅") => {
    const id = Date.now();
    setToast({ message, icon, id });
    // It slides back down before it goes.
    setTimeout(() => setToast((t) => (t?.id === id ? { ...t, leaving: true } : t)), 2600);
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 2920);
  }, []);

  // Every button ripples out from where it's pressed.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const b = (e.target as Element | null)?.closest?.(".btn");
      if (!b || reducedMotion() || (b as HTMLButtonElement).disabled) return;
      const r = b.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.4;
      const ripple = document.createElement("span");
      ripple.className = "brip";
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - r.left - size / 2}px`;
      ripple.style.top = `${e.clientY - r.top - size / 2}px`;
      b.appendChild(ripple);
      setTimeout(() => ripple.remove(), 650);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  // Buttons and links tap; choosing something (a chip, tile, option, toggle or tab) picks.
  // An element can ask for another sound, or none, with data-sound.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("button, a[href], [data-sound]");
      if (!el || (el as HTMLButtonElement).disabled) return;
      const asked = el.closest("[data-sound]")?.getAttribute("data-sound");
      if (asked === "none") return;
      if (asked && asked in sound) return sound[asked as keyof typeof sound]();
      const picks = el.matches("[aria-pressed], [role=switch], [role=tab], [role=radio]");
      (picks ? sound.pick : sound.tap)();
    };
    // Capture runs before React handles the click, while the button still looks as it did.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const signedIn = Boolean(user);
  // The service worker shows device notifications; a device with them on follows whoever signs in.
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  useEffect(() => {
    if (signedIn) void syncPush();
  }, [signedIn]);
  const refreshUnread = useCallback(() => {
    if (!signedIn) return;
    api.getNotifications().then(
      (n) => setUnread(n.unread),
      () => {},
    );
  }, [signedIn]);

  return (
    <SessionContext.Provider value={{ user, loading, refresh, signOut, unread: user ? unread : 0, setUnread, refreshUnread }}>
      <ToastContext.Provider value={showToast}>
        {children}
        <Splash />
        {toast && (
          <div key={toast.id} className={`toast${toast.leaving ? " is-leaving" : ""}`} role="status">
            <span aria-hidden="true">{toast.icon}</span>
            {toast.message}
          </div>
        )}
      </ToastContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside Providers");
  return s;
}

export function useToast() {
  return useContext(ToastContext);
}

/** Shows `children` only to signed-in users; everyone else goes to the welcome screen. */
export function RequireSession({ children }: { children: (user: User) => ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!loading && !user) router.replace(`/?next=${encodeURIComponent(path)}`);
  }, [loading, user, router, path]);
  if (!user) return <LoadingState />;
  return <>{children(user)}</>;
}
