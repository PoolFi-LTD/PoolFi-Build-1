"use client";

import Link from "next/link";
import { useState } from "react";
import { Drip } from "@/components/Drip";
import { AuthShell } from "@/components/shells";
import { BusyButton, ErrorText } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { MIN_PASSWORD } from "@/lib/signin";
import { PasswordField } from "../signup/PasswordField";
import s from "../signup/auth.module.css";

/** Where the emailed reset link lands: choose a new password, then sign in again. */
export default function Page() {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [done, setDone] = useState(false);
  const save = useAction(api.setNewPassword);
  const mismatch = again.length > 0 && again !== password;
  const valid = password.length >= MIN_PASSWORD && again === password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (valid && (await save.run(password)).ok) setDone(true);
  }

  return (
    <AuthShell>
      <form className={s.column} onSubmit={submit}>
        {done ? (
          <div className="cs-in">
            <Drip size={64} mood="cheer" pop />
            <h1 className={s.title} style={{ marginTop: 12 }}>Password changed</h1>
            <p className={s.sub}>Sign in with your new password. For safety, every device needs a fresh code from your email.</p>
            <Link className="btn btn-primary btn-block" href="/signup?mode=login">
              Sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className={s.title}>Choose a new password</h1>
            <p className={s.sub}>At least {MIN_PASSWORD} characters. You&apos;ll sign in with it from now on.</p>
            <div style={{ display: "grid", gap: 14 }}>
              <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" />
              <PasswordField label="Type it again" value={again} onChange={setAgain} autoComplete="new-password" />
            </div>
            {mismatch && <p className="field-error" style={{ marginTop: 8 }}>The two passwords don&apos;t match.</p>}
            <ErrorText error={save.error} />
            <div className={s.footer}>
              <BusyButton type="submit" busy={save.busy} disabled={!valid} className="btn btn-primary btn-block">
                Save new password
              </BusyButton>
            </div>
          </>
        )}
      </form>
    </AuthShell>
  );
}
