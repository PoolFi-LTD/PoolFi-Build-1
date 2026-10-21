"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { RequireSession, useSession } from "@/components/providers";
import { AuthShell } from "@/components/shells";
import { BusyButton, ErrorText, ProgressBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { Avatar, User } from "@/lib/types";
import s from "../auth.module.css";

const LOOKS: { emoji: string; bg: string }[] = [
  { emoji: "🌻", bg: "#F4E8D2" },
  { emoji: "🦋", bg: "#D7F3FC" },
  { emoji: "🐬", bg: "#DDE5F9" },
  { emoji: "⚡", bg: "#FEF0C7" },
  { emoji: "🎧", bg: "#EFE4FF" },
  { emoji: "🦁", bg: "#FDE7C8" },
  { emoji: "🍩", bg: "#FFE4E1" },
  { emoji: "🌍", bg: "#E3F8EE" },
];

/** Crops a photo to a 256px square so it stays small. */
async function squarePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const side = Math.min(img.width, img.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    canvas.getContext("2d")?.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProfileForm({ user }: { user: User }) {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const { refresh } = useSession();
  const [first, setFirst] = useState(user.firstName);
  const [last, setLast] = useState(user.lastName);
  const [avatar, setAvatar] = useState<Avatar>(user.avatar ?? { kind: "emoji", ...LOOKS[0] });
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const save = useAction(api.saveProfile);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    try {
      setAvatar({ kind: "photo", url: await squarePhoto(file) });
    } catch {
      setPhotoError("That photo couldn't be opened. Try another one.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const saved = await save.run({ firstName: first, lastName: last, avatar });
    if (!saved.ok) return;
    await refresh();
    router.replace(next ?? "/home?welcome=1");
  }

  return (
    <form className={s.column} onSubmit={submit}>
      <div className={s.top}>
        <button type="button" className={s.back} onClick={() => router.back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <ProgressBar value={0.75} />
      </div>

      {/* The preview springs in again each time the look changes. */}
      <div key={avatar.kind === "photo" ? avatar.url : avatar.emoji} className={`${s.avatarBig} bounce`} style={{ background: avatar.kind === "emoji" ? avatar.bg : "var(--line-soft)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {avatar.kind === "photo" ? <img src={avatar.url} alt="Your photo" /> : avatar.emoji}
      </div>
      <h1 className={`${s.title} ${s.centered}`}>What should we call you?</h1>
      <p className={`${s.sub} ${s.centered}`}>This is how you&apos;ll show up in pools.</p>

      <label className="field">
        <span className="field-label">First name</span>
        <input className="input" autoComplete="given-name" value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
      </label>
      <label className="field" style={{ marginTop: 16 }}>
        <span className="field-label">Last name</span>
        <input className="input" autoComplete="family-name" placeholder="Eze" value={last} onChange={(e) => setLast(e.target.value)} />
      </label>

      <p className="field-label" style={{ marginTop: 20 }}>Pick your look</p>
      <div className={s.looks}>
        <button type="button" className={`${s.look} ${s.photo} ${avatar.kind === "photo" ? s.lookOn : ""}`} onClick={() => fileInput.current?.click()} aria-label="Use your own photo">
          <span style={{ display: "grid", justifyItems: "center" }}>
            <Icon name="camera2" />
            Photo
          </span>
        </button>
        {LOOKS.map((look) => (
          <button
            key={look.emoji}
            type="button"
            className={`${s.look} ${avatar.kind === "emoji" && avatar.emoji === look.emoji ? s.lookOn : ""}`}
            style={{ background: look.bg }}
            onClick={() => setAvatar({ kind: "emoji", ...look })}
            aria-label={`Use ${look.emoji}`}
          >
            {look.emoji}
          </button>
        ))}
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
      </div>
      <p className="t-caption muted" style={{ textAlign: "center" }}>
        Use your own photo so your group recognises you, or pick a fun one.
      </p>
      {photoError && <p className="field-error">{photoError}</p>}
      <ErrorText error={save.error} />

      <div className={s.footer}>
        <BusyButton type="submit" busy={save.busy} disabled={first.trim().length < 2} className="btn btn-primary btn-block">
          Continue
        </BusyButton>
      </div>
    </form>
  );
}

export default function Page() {
  return (
    <AuthShell>
      <RequireSession>
        {(user) => (
          <Suspense>
            <ProfileForm user={user} />
          </Suspense>
        )}
      </RequireSession>
    </AuthShell>
  );
}
