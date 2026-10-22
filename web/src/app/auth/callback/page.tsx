"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useSession } from "@/components/providers";
import { AuthShell } from "@/components/shells";
import { LoadingState } from "@/components/ui";
import { safeNextPath } from "@/lib/signin";
import s from "../../signup/auth.module.css";

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const { user, loading } = useSession();
  const destination = safeNextPath(next);

  useEffect(() => {
    if (!loading && user) {
      const profile = `/signup/profile?next=${encodeURIComponent(destination)}`;
      router.replace(user.firstName ? destination : profile);
    }
  }, [destination, loading, router, user]);

  if (loading || user) {
    return <AuthShell><LoadingState label="Signing you in…" /></AuthShell>;
  }

  return (
    <AuthShell>
      <div className={s.column}>
        <h1 className={s.title}>This sign-in link didn’t work</h1>
        <p className={s.sub}>It may have expired or already been used. Request a new link and try again.</p>
        <Link className="btn btn-primary btn-block" href={`/signup?mode=login&next=${encodeURIComponent(destination)}`}>
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

export default function Page() {
  return <Suspense><Callback /></Suspense>;
}
