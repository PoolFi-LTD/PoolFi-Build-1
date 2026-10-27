"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import s from "@/components/admin/admin.module.css";
import { Card, Hero, PoolCard, Search, Seg } from "@/components/admin/parts";
import { Loaded } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { useNow, useResource } from "@/lib/hooks";
import type { AdminPoolFilter } from "@/lib/types";

const FILTERS: { value: AdminPoolFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Open" },
  { value: "met", label: "Goal met" },
  { value: "approval", label: "Awaiting approval" },
  { value: "missed", label: "Deadline passed" },
  { value: "paidout", label: "Paid out" },
  { value: "refunded", label: "Refunded" },
];

function Pools() {
  const router = useRouter();
  const params = useSearchParams();
  const status = (FILTERS.find((f) => f.value === params.get("status"))?.value ?? "all") as AdminPoolFilter;
  const q = params.get("q") ?? "";
  const pools = useResource(() => adminApi.pools(status, q), [status, q]);
  const go = (next: { status?: AdminPoolFilter; q?: string }) => {
    const query = new URLSearchParams({ status: next.status ?? status, q: next.q ?? q });
    if (query.get("status") === "all") query.delete("status");
    if (!query.get("q")) query.delete("q");
    router.replace(`/admin/pools${query.size ? `?${query}` : ""}`);
  };
  const now = useNow();

  return (
    <>
      <Hero title="Pools" sub="Every pool, how full it is, and where its payout stands. Open one to give it more time, or to close it and refund everyone who paid." />
      <main className={s.main}>
        <Card
          title={pools.data ? `${pools.data.total.toLocaleString("en-US")} ${pools.data.total === 1 ? "pool" : "pools"}` : "Pools"}
          sub={pools.data && pools.data.total > pools.data.pools.length ? `Showing the newest ${pools.data.pools.length}. Search to find the rest.` : "Newest first"}
          tools={
            <>
              <Search value={q} onChange={(text) => go({ q: text })} placeholder="Search by name, code or lifeguard" />
              <Seg label="Filter pools" value={status} options={FILTERS} onChange={(value) => go({ status: value })} />
            </>
          }
        >
          <Loaded resource={pools}>
            {({ pools: rows }) =>
              rows.length ? (
                <div className={s.pools}>
                  {rows.map((p) => (
                    <PoolCard key={p.id} pool={p} now={now} />
                  ))}
                </div>
              ) : (
                <p className={s.empty}>No pools match.</p>
              )
            }
          </Loaded>
        </Card>
      </main>
    </>
  );
}

export default function Page() {
  return <AdminShell>{() => <Pools />}</AdminShell>;
}
