"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/providers";
import { AppShell, PageHead } from "@/components/shells";
import { Avatar, Toggle } from "@/components/ui";
import { IS_TESTNET } from "@/components/wallet";
import { fullName } from "@/lib/format";
import { setSoundOn, soundOn } from "@/lib/sound";
import type { User } from "@/lib/types";

function Settings({ user }: { user: User }) {
  const { signOut } = useSession();
  const router = useRouter();
  const [sounds, setSounds] = useState(soundOn);
  return (
    <>
      <PageHead title="Settings" />
      <div style={{ display: "grid", gap: 16, maxWidth: 560 }}>
        <div className="kv rise" style={{ padding: 18, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <Avatar name={fullName(user)} avatar={user.avatar} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-h3">{fullName(user)}</div>
            <div className="muted t-small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.email ?? user.phone}
            </div>
          </div>
          <Link href="/signup/profile?next=/settings" className="btn btn-secondary btn-sm">
            Edit profile
          </Link>
        </div>
        <dl className="kv rise" style={{ animationDelay: "80ms" }}>
          <div>
            <dt>Network</dt>
            <dd>{IS_TESTNET ? "Stellar testnet" : "Stellar"}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>USDC</dd>
          </div>
        </dl>
        <div className="kv rise" style={{ padding: 18, display: "flex", alignItems: "center", gap: 14, animationDelay: "160ms" }}>
          <div style={{ flex: 1 }}>
            <div className="t-h3">Sound effects</div>
            <div className="muted t-small">Taps, coins dropping into pools and celebrations. Saved on this device.</div>
          </div>
          <Toggle
            on={sounds}
            onChange={(on) => {
              setSounds(on);
              setSoundOn(on);
            }}
            label="Sound effects"
          />
        </div>
        <button
          className="btn btn-signout"
          style={{ justifySelf: "start" }}
          onClick={async () => {
            await signOut();
            router.replace("/");
          }}
        >
          Sign out
        </button>
      </div>
    </>
  );
}

export default function Page() {
  return <AppShell>{(user) => <Settings user={user} />}</AppShell>;
}
