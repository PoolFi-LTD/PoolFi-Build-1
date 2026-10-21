"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { PoolRow } from "@/components/pool";
import { AppShell, PageHead } from "@/components/shells";
import { EmptyState, Loaded, Segmented } from "@/components/ui";
import { api } from "@/lib/api";
import { useNow, useResource } from "@/lib/hooks";

type Show = "open" | "closed";

function MyPools() {
  const now = useNow();
  const pools = useResource(() => api.listPools(), []);
  const [show, setShow] = useState<Show>("open");
  return (
    <>
      <PageHead
        title="My pools"
        subtitle="Pools you run, pay into or approve."
        aside={
          <Link href="/create" className="btn btn-primary hide-m">
            <Icon name="plus" /> New pool
          </Link>
        }
      />
      <Segmented<Show> value={show} onChange={setShow} options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }]} />
      <Loaded resource={pools}>
        {(list) => {
          const shown = list.filter((p) => (show === "open" ? ["active", "met", "approval"] : ["paidout", "refunded"]).includes(p.status));
          return shown.length ? (
            <div className="grid-cards" style={{ padding: 18, borderRadius: 24, background: "var(--bg)" }}>
              {shown.map((p, i) => (
                <PoolRow key={`${show}-${p.id}`} pool={p} now={now} index={i} />
              ))}
            </div>
          ) : (
            <EmptyState
              title={show === "open" ? "No open pools" : "No closed pools yet"}
              action={
                show === "open" ? (
                  <Link href="/create" className="btn btn-primary btn-sm">
                    Create a pool
                  </Link>
                ) : undefined
              }
            >
              {show === "open" ? "Pools you start or join show up here." : "Pools that paid out or refunded everyone end up here."}
            </EmptyState>
          );
        }}
      </Loaded>
    </>
  );
}

export default function Page() {
  return <AppShell>{() => <MyPools />}</AppShell>;
}
