"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import s from "@/components/admin/admin.module.css";
import { Card, Hero } from "@/components/admin/parts";
import { LogTable } from "@/components/admin/tables";
import { Loaded } from "@/components/ui";
import { adminApi } from "@/lib/admin-api";
import { useResource } from "@/lib/hooks";

function Log() {
  const log = useResource(() => adminApi.log(), []);
  return (
    <>
      <Hero title="Admin log" sub="Everything the team has done from this dashboard: who, to what, and why. It can't be edited." />
      <main className={s.main}>
        <Card title="Latest first">
          <Loaded resource={log}>{(rows) => <LogTable rows={rows} />}</Loaded>
        </Card>
      </main>
    </>
  );
}

export default function Page() {
  return <AdminShell>{() => <Log />}</AdminShell>;
}
