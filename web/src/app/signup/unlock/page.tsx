"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CodeScreen } from "../CodeScreen";

/** A locked account (too many wrong passwords): the code we emailed unlocks it. */
function UnlockRoute() {
  const to = useSearchParams().get("to") ?? "";
  return <CodeScreen key={to} to={to} purpose="unlock" />;
}

export default function Page() {
  return (
    <Suspense>
      <UnlockRoute />
    </Suspense>
  );
}
