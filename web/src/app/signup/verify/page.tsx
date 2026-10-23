"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CodeScreen } from "../CodeScreen";

/** After the right password: the code we emailed finishes signing in. */
function VerifyRoute() {
  const to = useSearchParams().get("to") ?? "";
  // A code and its state belong to one address; remounting keeps back/forward from mixing them.
  return <CodeScreen key={to} to={to} purpose="sign_in" />;
}

export default function Page() {
  return (
    <Suspense>
      <VerifyRoute />
    </Suspense>
  );
}
