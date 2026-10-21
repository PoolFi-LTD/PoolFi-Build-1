"use client";

import Link from "next/link";
import { ActivityRow } from "@/components/pool";
import { AppShell, PageHead } from "@/components/shells";
import { EmptyState, Loaded } from "@/components/ui";
import { api } from "@/lib/api";
import { useNow, useResource } from "@/lib/hooks";

function Activity() {
  const now = useNow();
  const activity = useResource(() => api.listActivity(), []);
  return (
    <>
      <PageHead title="Activity" subtitle="Everything that happened in your pools, newest first." />
      <Loaded resource={activity}>
        {(items) =>
          items.length ? (
            <div style={{ display: "grid", gap: 8, maxWidth: 760, padding: 18, borderRadius: 24, background: "var(--bg)" }}>
              {items.map((item, i) =>
                item.poolId ? (
                  <Link key={item.id} href={`/pools/${item.poolId}`}>
                    <ActivityRow item={item} now={now} index={i} />
                  </Link>
                ) : (
                  <ActivityRow key={item.id} item={item} now={now} index={i} />
                ),
              )}
            </div>
          ) : (
            <EmptyState title="No activity yet">Payments, reminders and payouts in your pools show up here.</EmptyState>
          )
        }
      </Loaded>
    </>
  );
}

export default function Page() {
  return <AppShell>{() => <Activity />}</AppShell>;
}
