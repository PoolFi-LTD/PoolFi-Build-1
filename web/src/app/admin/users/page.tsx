"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import s from "@/components/admin/admin.module.css";
import { Amount, Card, Hero, Person, Search, Seg, UserPills } from "@/components/admin/parts";
import { Loaded } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { ago, shortDate } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { AdminUserFilter } from "@/lib/types";

const FILTERS: { value: AdminUserFilter; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "active", label: "Active" },
  { value: "quiet", label: "Quiet" },
  { value: "new", label: "Did nothing yet" },
  { value: "suspended", label: "Suspended" },
  { value: "locked", label: "Locked" },
];

function People() {
  const router = useRouter();
  const params = useSearchParams();
  const filter = (FILTERS.find((f) => f.value === params.get("filter"))?.value ?? "all") as AdminUserFilter;
  const q = params.get("q") ?? "";
  const users = useResource(() => adminApi.users(filter, q), [filter, q]);
  const go = (next: { filter?: AdminUserFilter; q?: string }) => {
    const query = new URLSearchParams({ filter: next.filter ?? filter, q: next.q ?? q });
    if (query.get("filter") === "all") query.delete("filter");
    if (!query.get("q")) query.delete("q");
    router.replace(`/admin/users${query.size ? `?${query}` : ""}`);
  };

  return (
    <>
      <Hero title="People" sub="Everyone who has signed up, and what they've done since. Open someone to see their pools and money, or to suspend or unlock their account." />
      <main className={s.main}>
        <Card
          title={users.data ? `${users.data.total.toLocaleString("en-US")} ${users.data.total === 1 ? "person" : "people"}` : "People"}
          sub={users.data && users.data.total > users.data.users.length ? `Showing the ${users.data.users.length} seen most recently. Search to find anyone else.` : "Seen most recently first"}
          tools={
            <>
              <Search value={q} onChange={(text) => go({ q: text })} placeholder="Search by name, email, phone or wallet" />
              <Seg label="Filter people" value={filter} options={FILTERS} onChange={(value) => go({ filter: value })} />
            </>
          }
        >
          <Loaded resource={users}>
            {({ users: rows }) =>
              rows.length ? (
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Joined</th>
                        <th className={s.r}>Pools</th>
                        <th className={s.r}>Started</th>
                        <th className={s.r}>Paid in</th>
                        <th className={s.r}>Added</th>
                        <th>Last seen</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((u) => (
                        <tr key={u.id} className={s.rowLink} onClick={(e) => !(e.target as HTMLElement).closest("a") && router.push(`/admin/users/${encodeURIComponent(u.id)}`)}>
                          <td>
                            <Person person={u} avatar={u.avatar} note={u.email ?? u.phone ?? undefined} />
                          </td>
                          <td className={s.num}>{shortDate(u.joinedAt)}</td>
                          <td className={`${s.r} ${s.num}`}>{u.pools}</td>
                          <td className={`${s.r} ${s.num}`}>{u.created}</td>
                          <td className={s.r}>
                            <b>
                              <Amount value={u.paid} />
                            </b>
                            {u.payments > 0 && <span className={s.small}>{u.payments === 1 ? "1 payment" : `${u.payments} payments`}</span>}
                          </td>
                          <td className={s.r}>
                            <Amount value={u.deposited} />
                          </td>
                          <td>{u.lastSeenAt ? ago(u.lastSeenAt) : "Never"}</td>
                          <td>
                            <UserPills u={u} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={s.empty}>Nobody matches.</p>
              )
            }
          </Loaded>
        </Card>
      </main>
    </>
  );
}

export default function Page() {
  return <AdminShell>{() => <People />}</AdminShell>;
}
