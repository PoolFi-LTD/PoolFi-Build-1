"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Drip } from "@/components/Drip";
import { Icon, Logo } from "@/components/Icon";
import { RequireSession } from "@/components/providers";
import { LoadingState } from "@/components/ui";
import type { Me } from "@/lib/types";
import s from "./admin.module.css";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "People" },
  { href: "/admin/pools", label: "Pools" },
  { href: "/admin/money", label: "Money" },
  { href: "/admin/log", label: "Admin log" },
];

/**
 * The admin dashboard's frame: the PoolFi team only (the server checks ADMIN_EMAILS on
 * every call; this just keeps everyone else from a page of errors).
 */
export function AdminShell({ children }: { children: (me: Me) => ReactNode }) {
  return (
    <Suspense fallback={<LoadingState />}>
      <RequireSession>{(me) => (me.admin ? <Frame me={me}>{children(me)}</Frame> : <Denied />)}</RequireSession>
    </Suspense>
  );
}

function Frame({ me, children }: { me: Me; children: ReactNode }) {
  const path = usePathname();
  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={s.topIn}>
          <Link href="/admin" className={s.brand} aria-label="PoolFi Pulse, the admin dashboard">
            <Logo size={30} tone="white" />
            <em>Pulse</em>
          </Link>
          <span className={s.chip}>Team only</span>
          <span className={s.grow} />
          <span className={s.who}>{me.email}</span>
          <Link href="/home" className={s.topBtn}>
            <Icon name="back" />
            <span>Back to the app</span>
          </Link>
          <nav className={s.tabs} aria-label="Admin">
            {TABS.map((t) => {
              const on = t.href === "/admin" ? path === "/admin" : path === t.href || path.startsWith(`${t.href}/`);
              return (
                <Link key={t.href} href={t.href} className={`${s.tab} ${on ? s.tabOn : ""}`} aria-current={on ? "page" : undefined}>
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}

function Denied() {
  return (
    <div className={s.denied}>
      <div className="state">
        <Drip size={80} mood="think" pop />
        <h3 className="t-h3">This page is for the PoolFi team</h3>
        <p>Your account isn&apos;t on the team&apos;s list. If it should be, ask whoever runs PoolFi to add your email.</p>
        <Link href="/home" className="btn btn-primary btn-sm">
          Back to PoolFi
        </Link>
      </div>
    </div>
  );
}
