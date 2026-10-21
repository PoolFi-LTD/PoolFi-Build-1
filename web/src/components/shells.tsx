"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { fullName } from "@/lib/format";
import type { User } from "@/lib/types";
import { Drip } from "./Drip";
import { Icon, Logo, type IconName } from "./Icon";
import { Sea } from "./motion";
import { RequireSession, useSession } from "./providers";
import s from "./shells.module.css";
import { Avatar, LoadingState, ProgressBar } from "./ui";

const MAIN: { href: string; label: string; icon: IconName; match?: string[] }[] = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/create", label: "Create a pool", icon: "plus2" },
  { href: "/pools", label: "My pools", icon: "drop" },
  { href: "/activity", label: "Activity", icon: "activity" },
  { href: "/wallet", label: "My wallet", icon: "wallet" },
];
const ACCOUNT: { href: string; label: string; icon: IconName }[] = [
  { href: "/notifications", label: "Notifications", icon: "bell" },
  { href: "/settings", label: "Settings", icon: "gear" },
];

function NavLink({ href, label, icon }: { href: string; label: string; icon: IconName }) {
  const path = usePathname();
  const active = path === href || (href !== "/home" && path.startsWith(`${href}/`));
  return (
    <Link href={href} className={`${s.nav} ${active ? s.navActive : ""}`} aria-current={active ? "page" : undefined}>
      <Icon name={icon} />
      {label}
    </Link>
  );
}

function Sidebar({ user }: { user: User }) {
  const { signOut } = useSession();
  const router = useRouter();
  return (
    <nav className={s.sidebar} aria-label="Main">
      <Link href="/home" className={s.sidebarLogo} aria-label="PoolFi home">
        <Logo />
      </Link>
      <div className={s.sectionLabel}>Main</div>
      {MAIN.map((item) => (
        <NavLink key={item.href} {...item} />
      ))}
      <div className={s.sectionLabel}>Account</div>
      {ACCOUNT.map((item) => (
        <NavLink key={item.href} {...item} />
      ))}
      <div className={s.userCard}>
        <div className={s.userRow}>
          <Avatar name={fullName(user)} avatar={user.avatar} />
          <div style={{ minWidth: 0 }}>
            <div className={s.userName}>{fullName(user)}</div>
            <div className={s.userEmail}>{user.email ?? user.phone}</div>
          </div>
        </div>
        <button
          className="btn btn-signout btn-block"
          onClick={async () => {
            await signOut();
            router.replace("/");
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}

let lastPath: string | null = null;

/** How a page comes in: deeper pages slide in from the right, going back slides
 *  in from the left, creating rises from the bottom, and top-level pages fade. */
function enterFrom(path: string): "fwd" | "back" | "up" | "fade" {
  const prev = lastPath;
  if (!prev || prev === path) return "fade";
  if (path === "/create") return "up";
  if (path.startsWith(`${prev}/`)) return "fwd";
  if (prev.startsWith(`${path}/`)) return "back";
  const depth = (p: string) => p.split("/").filter(Boolean).length;
  if (depth(path) <= 1 && depth(prev) <= 1) return "fade";
  return depth(path) >= depth(prev) ? "fwd" : "back";
}

/** The animation class for the page now showing. */
export function useEnter() {
  const path = usePathname();
  const [dir] = useState(() => enterFrom(path));
  useEffect(() => {
    lastPath = path;
  }, [path]);
  return `enter-${dir}`;
}

function Screen({ children }: { children: ReactNode }) {
  return <div className={`${s.screen} ${useEnter()}`}>{children}</div>;
}

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/pools", label: "Pools", icon: "drop" },
  { href: "/wallet", label: "Wallet", icon: "wallet" },
  { href: "/settings", label: "Me", icon: "users" },
];
/** Pages that show the tab bar on phones; the rest are pushed screens with a back button. */
const TAB_PAGES = ["/home", "/pools", "/wallet", "/settings", "/activity", "/notifications"];

/** The phone's bottom tab bar, with the big + for creating a pool in the middle. */
function TabBar() {
  const path = usePathname();
  const tab = (t: (typeof TABS)[number]) => {
    const on = path === t.href || path.startsWith(`${t.href}/`);
    return (
      <Link key={t.href} href={t.href} className={`${s.tab} ${on ? s.tabOn : ""}`} aria-current={on ? "page" : undefined}>
        <Icon name={t.icon} />
        {t.label}
      </Link>
    );
  };
  return (
    <nav className={s.tabBar} aria-label="Main">
      {tab(TABS[0])}
      {tab(TABS[1])}
      <Link href="/create" className={s.fab} aria-label="Create a pool">
        <Icon name="plus" />
      </Link>
      {tab(TABS[2])}
      {tab(TABS[3])}
    </nav>
  );
}

/** Signed-in screens: the sidebar and the white main panel; on phones, a tab bar instead of the sidebar. */
export function AppShell({ children }: { children: (user: User) => ReactNode }) {
  // The sidebar and the sign-in check read the URL, which needs a Suspense boundary.
  return (
    <Suspense fallback={<LoadingState />}>
      <RequireSession>
        {(user) => (
          <div className={s.app}>
            <Sidebar user={user} />
            <Main>{children(user)}</Main>
          </div>
        )}
      </RequireSession>
    </Suspense>
  );
}

function Main({ children }: { children: ReactNode }) {
  const tabbed = TAB_PAGES.includes(usePathname());
  return (
    <main className={`${s.main} ${tabbed ? s.tabbed : ""}`}>
      <Screen>{children}</Screen>
      {tabbed && <TabBar />}
    </main>
  );
}

/** A back button and title at the top of the main panel. */
export function PageHead({ title, subtitle, back, aside, emoji, backOnPhone }: { title: ReactNode; subtitle?: ReactNode; back?: string | true; aside?: ReactNode; emoji?: string; backOnPhone?: string }) {
  const router = useRouter();
  const to = back ?? backOnPhone;
  return (
    <header className={s.pageHead}>
      {to && (
        <button
          className={`icon-btn ${s.backBtn}${back ? "" : " hide-d"}`}
          aria-label="Back"
          onClick={() => (to === true ? router.back() : router.push(to))}
        >
          <Icon name="back" />
        </button>
      )}
      {emoji && (
        <span className={s.headEmoji} aria-hidden="true">
          {emoji}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 className={`t-h1 ${s.headTitle}`}>{title}</h1>
        {subtitle && <p className={`muted ${s.headSub}`}>{subtitle}</p>}
      </div>
      {aside}
    </header>
  );
}

/** Waves drifting along the bottom of the blue panels. */
export function Waves() {
  return <Sea height={120} />;
}

const STORY: [string, string, string][] = [
  ["Group money.", "Finally fixed.", "Collect class dues, birthday money and office welfare with one link."],
  ["Everyone sees", "the pool fill.", "Who's paid, who hasn't and what's left. No more \"please who hasn't paid?\""],
  ["Held safely.", "Or sent back.", "Money moves only when your approvers approve. Miss the goal and everyone is refunded."],
];

const COINS: { style: React.CSSProperties; size: number }[] = [
  { style: { left: "4%", top: "10%" }, size: 70 },
  { style: { right: "6%", top: "18%", animationDelay: "-1.2s" }, size: 60 },
  { style: { left: "12%", bottom: "10%", animationDelay: "-2.4s" }, size: 52 },
  { style: { right: "14%", bottom: "16%", animationDelay: "-0.7s" }, size: 48 },
];

/** The blue story panel: coins bob around Drip and the story changes every few seconds.
 *  On phones it is the whole welcome screen, with `footer` under the story. */
function StoryPanel({ footer }: { footer?: ReactNode }) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLine((n) => (n + 1) % STORY.length), 4500);
    return () => clearInterval(t);
  }, []);
  return (
    <aside className={s.bluePanel}>
      <div className="grain" />
      <div style={{ position: "relative", zIndex: 2 }}>
        <Logo tone="white" />
      </div>
      <div className={s.blueMiddle}>
        {COINS.map((c, i) => (
          <Image key={i} src="/usdc.webp" alt="" width={c.size} height={c.size} className="coin-bob" style={c.style} />
        ))}
        <div style={{ position: "relative", zIndex: 2 }}>
          <Drip size={150} onBlue pop />
        </div>
      </div>
      <div className={s.blueStory}>
        <div className={`story ${s.story}`}>
          {STORY.map(([a, b, text], i) => (
            <div key={a} className={`story-line${i === line ? " on" : ""}`} aria-hidden={i !== line}>
              <p className="t-serif" style={{ fontSize: 64, margin: 0, maxWidth: "none", opacity: 1 }}>
                {a}
                <span className={s.serifCyan}>{b}</span>
              </p>
              <p>{text}</p>
            </div>
          ))}
        </div>
        {footer && (
          <>
            <div className={s.dots} aria-hidden="true">
              {STORY.map(([a], i) => (
                <i key={a} className={i === line ? s.dotOn : undefined} />
              ))}
            </div>
            <div className={s.storyFoot}>{footer}</div>
          </>
        )}
      </div>
      <Waves />
    </aside>
  );
}

/** Sign-in screens: Drip and the tagline on blue, the form on the right. On phones the
 *  form fills the screen; with `welcome`, the blue story is the whole screen instead. */
export function AuthShell({ children, welcome }: { children: ReactNode; welcome?: ReactNode }) {
  return (
    <div className={`${s.split} ${welcome ? s.welcomeSplit : s.authSplit}`}>
      <StoryPanel footer={welcome} />
      <section className={`${s.splitRight} ${useEnter()}`}>{children}</section>
    </div>
  );
}

/** The public invite: the pool on blue, paying on the right. */
export function InviteShell({ left, children }: { left: ReactNode; children: ReactNode }) {
  return (
    <div className={`${s.split} ${s.splitGrey} ${s.inviteSplit}`}>
      <aside className={`${s.bluePanel} ${s.inviteHero}`}>
        <div className="grain" />
        <div style={{ position: "relative", zIndex: 2 }}>
          <Logo tone="white" />
        </div>
        <div style={{ position: "relative", zIndex: 2, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>{left}</div>
        <div className={s.waveRoom} />
        <div className="hide-m">
          <Waves />
        </div>
      </aside>
      <section className={`${s.splitRight} ${useEnter()}`}>{children}</section>
    </div>
  );
}

/** Focused flows (create a pool): a progress bar and a fixed bottom action. */
export function FocusShell({ progress, onClose, onBack, children, footer }: { progress: number; onClose: () => void; onBack?: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className={s.focus}>
      <div className={s.focusTop}>
        <button className={s.plainIcon} onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        {onBack && (
          <button className={s.plainIcon} onClick={onBack} aria-label="Back">
            <Icon name="back" />
          </button>
        )}
        <ProgressBar value={progress} />
      </div>
      <div className={`${s.focusBody} ${useEnter()}`}>{children}</div>
      <div className={s.focusFooter}>{footer}</div>
    </div>
  );
}

export { s as shellStyles };
