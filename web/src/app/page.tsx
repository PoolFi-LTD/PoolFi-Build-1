"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Logo } from "@/components/Icon";
import { useSession } from "@/components/providers";
import { AuthShell } from "@/components/shells";
import s from "./signup/auth.module.css";

function Welcome() {
  const { user } = useSession();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";

  // Signed in (also by an emailed sign-in link): new accounts set up their profile first.
  useEffect(() => {
    if (!user) return;
    if (!user.firstName) router.replace(`/signup/profile${next ? `?next=${encodeURIComponent(next)}` : ""}`);
    else router.replace(next ?? "/home");
  }, [user, next, router]);

  return (
    <AuthShell
      welcome={
        <>
          <Link href={`/signup?mode=signup${nextQuery}`} className="btn btn-white btn-block">
            Get started
          </Link>
          <Link href={`/signup?mode=login${nextQuery}`} className="btn btn-ghost btn-block" style={{ height: 52, color: "var(--white)", fontWeight: 500 }}>
            I already have an account
          </Link>
        </>
      }
    >
      <div className={s.welcome}>
        <div className="rise">
          <Logo size={56} />
        </div>
        <p className="muted rise" style={{ animationDelay: "80ms" }}>
          Group money. Finally fixed.
        </p>
        <div className="rise" style={{ display: "grid", gap: 16, width: "100%", marginTop: 20, animationDelay: "160ms" }}>
          <Link href={`/signup?mode=signup${nextQuery}`} className="btn btn-primary btn-block">
            Get started
          </Link>
          <Link href={`/signup?mode=login${nextQuery}`} className="btn btn-ghost" style={{ fontWeight: 500 }}>
            I already have an account
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Welcome />
    </Suspense>
  );
}
