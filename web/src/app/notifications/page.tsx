"use client";

import Link from "next/link";
import { AppShell, PageHead } from "@/components/shells";
import { EmptyState, Loaded } from "@/components/ui";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";

function Notifications() {
  const home = useResource(() => api.getHome(), []);
  return (
    <>
      <PageHead title="Notifications" subtitle="Things that need you." />
      <Loaded resource={home}>
        {(h) =>
          h.alerts.length ? (
            <div style={{ display: "grid", gap: 10, maxWidth: 760 }}>
              {h.alerts.map((a) =>
                a.kind === "goal_met" ? (
                  <Link key={`m-${a.poolId}`} href={`/pools/${a.poolId}/payout`} className="banner banner-green attn">
                    <span aria-hidden="true">🎉</span>
                    <strong>{a.poolName} is full.</strong>
                    <span className="banner-rest">Request your payout</span>
                  </Link>
                ) : (
                  <Link key={`a-${a.poolId}`} href={`/pools/${a.poolId}/approve`} className="banner banner-blue attn">
                    <span aria-hidden="true">🔑</span>
                    <strong>{a.requester} needs your approval</strong>
                    <span className="banner-rest">{a.poolName}</span>
                  </Link>
                ),
              )}
            </div>
          ) : (
            <EmptyState title="You're all caught up">We&apos;ll let you know when a pool needs you.</EmptyState>
          )
        }
      </Loaded>
    </>
  );
}

export default function Page() {
  return <AppShell>{() => <Notifications />}</AppShell>;
}
