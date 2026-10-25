"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Drip } from "@/components/Drip";
import { Icon, type IconName } from "@/components/Icon";
import { useSession, useToast } from "@/components/providers";
import { AppShell, PageHead } from "@/components/shells";
import { Avatar, Loaded, Modal, Toggle } from "@/components/ui";
import { PushSetting } from "@/components/push";
import { IS_TESTNET } from "@/components/wallet";
import { api } from "@/lib/api";
import { fullName } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import { setSoundOn, soundOn } from "@/lib/sound";
import type { Achievements, User } from "@/lib/types";
import s from "./settings.module.css";

const FAQS: [string, string][] = [
  ["Is my money safe?", "Contributions are held in the pool's smart contract until the goal is met. Money only moves when the lifeguard requests the payout and, if the pool has approvers, enough of them approve."],
  ["What if we don't reach the goal?", "When the deadline passes below the goal, the lifeguard is asked to choose: give the pool more time with a new deadline, or refund everyone who paid. The money stays safely in the pool until they decide."],
  ["What does it cost?", "Joining and paying are free. PoolFi takes a small fee from the payout, shown before anyone pays. The lifeguard can choose to have divers cover it."],
  ["Why do I get a code every time I sign in?", "Your password and a code sent to your email together prove it's really you, so nobody can get into your account with your password alone."],
];

function Row({ icon, label, detail, onClick, href, children, danger }: { icon: IconName; label: string; detail?: string; onClick?: () => void; href?: string; children?: React.ReactNode; danger?: boolean }) {
  const inner = (
    <>
      <span className={`${s.rowIcon} ${danger ? s.rowIconDanger : ""}`}>
        <Icon name={icon} />
      </span>
      <b className={s.rowLabel}>{label}</b>
      {detail && <span className={s.rowDetail}>{detail}</span>}
      {children ?? ((onClick || href) && <Icon name="chev" />)}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={s.row}>
        {inner}
      </Link>
    );
  }
  return onClick ? (
    <button type="button" className={s.row} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className={s.row}>{inner}</div>
  );
}

function Badges({ a }: { a: Achievements }) {
  const earned = a.badges.filter((b) => b.earned).length;
  return (
    <>
      <div className={s.sectionHead}>
        <span className="t-h3">Badges</span>
        <span className="t-small muted">
          {earned} of {a.badges.length}
        </span>
      </div>
      <div className={s.badges}>
        {a.badges.map((b, i) => (
          <div key={b.id} className={`${s.badge} ${b.earned ? "" : s.locked} rise`} style={{ animationDelay: `${i * 50}ms` }} title={b.earned ? b.detail : `Locked: ${b.detail}`}>
            <div className={s.medal} aria-hidden="true">
              {b.icon}
            </div>
            <b>{b.name}</b>
            <span>{b.detail}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Me({ user }: { user: User }) {
  const { signOut } = useSession();
  const router = useRouter();
  const toast = useToast();
  const achievements = useResource(() => api.getAchievements(), []);
  const wallet = useResource(() => api.getWallet(), []);
  const [sounds, setSounds] = useState(soundOn);
  const [sheet, setSheet] = useState<"payout" | "help" | "logout" | null>(null);

  async function setReminders(on: boolean) {
    try {
      achievements.set(await api.savePreferences({ remindersOn: on }));
      toast(on ? "Reminders on" : "Reminders off", "🔔");
    } catch {
      toast("Couldn't save that. Try again.", "⚠️");
    }
  }

  return (
    <>
      <PageHead title="Settings" />
      <div className={s.layout}>
        <div>
          <div className={`${s.head} rise`}>
            <Avatar name={fullName(user)} avatar={user.avatar} size={88} />
            <h2 className="t-h2" style={{ marginTop: 10 }}>
              {fullName(user)}
            </h2>
            <p className="t-small muted">{user.email ?? user.phone}</p>
            {achievements.data && (
              <span className={`${s.pill} ${achievements.data.emailVerified ? s.pillGood : s.pillWait}`}>
                {achievements.data.emailVerified ? (
                  <>
                    <Icon name="check" /> Email verified
                  </>
                ) : (
                  "Email not verified yet"
                )}
              </span>
            )}
            <Link href="/signup/profile?next=/settings" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>
              Edit profile
            </Link>
          </div>
          <Loaded resource={achievements}>
            {(a) => (
              <>
                <div className={`${s.streak} rise`} style={{ animationDelay: "80ms" }}>
                  <span className={s.wave} aria-hidden="true">
                    🌊
                  </span>
                  <div>
                    <p className={s.streakNumber}>{a.streak}</p>
                    <p className={s.streakText}>
                      {a.streak === 1 ? "payment" : "payments"} in a row, none missed.{" "}
                      {a.streak ? "Keep it going." : "Pay into a pool to start your streak."}
                    </p>
                  </div>
                </div>
                <Badges a={a} />
              </>
            )}
          </Loaded>
        </div>

        <div>
          <div className={s.sectionHead} style={{ marginTop: 6 }}>
            <span className="t-h3">Account</span>
          </div>
          <div className={s.rows}>
            <Row icon="wallet" label="Payout accounts" onClick={() => setSheet("payout")} />
            <Row icon="mail" label="Email" detail={user.email ?? undefined} />
            <PushSetting rowClass={s.row} iconClass={s.rowIcon} labelClass={s.rowLabel} />
            <Row icon="bell" label="Deadline reminders">
              <Toggle on={achievements.data?.remindersOn ?? true} onChange={setReminders} label="Deadline reminders" />
            </Row>
            <Row icon="sound" label="Sound effects">
              <Toggle
                on={sounds}
                onChange={(on) => {
                  setSounds(on);
                  setSoundOn(on);
                }}
                label="Sound effects"
              />
            </Row>
            <Row icon="help" label="Help and FAQs" onClick={() => setSheet("help")} />
            <Row icon="out" label="Log out" onClick={() => setSheet("logout")} danger />
          </div>
          <p className="t-caption muted" style={{ textAlign: "center", marginTop: 18 }}>
            {IS_TESTNET ? "Stellar testnet" : "Stellar"} · USDC
          </p>
        </div>
      </div>

      <Modal open={sheet === "payout"} onClose={() => setSheet(null)} label="Payout accounts">
        <h2 className="t-h2">Payout accounts</h2>
        <div className={s.rows} style={{ marginTop: 14 }}>
          <Row icon="wallet" label={wallet.data ? `USDC wallet ••${wallet.data.address.slice(-4)}` : "USDC wallet"} detail="Default">
            <span className={`${s.pill} ${s.pillGood}`} style={{ marginTop: 0 }}>
              <Icon name="check" /> Default
            </span>
          </Row>
          <Row icon="bank" label="Bank account" detail="Coming soon" />
        </div>
        <p className="t-small muted" style={{ marginTop: 12 }}>
          Payouts land in your PoolFi balance as USDC. Paying out to a Nigerian bank account is on the way.
        </p>
        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={() => setSheet(null)}>
          Got it
        </button>
      </Modal>

      <Modal open={sheet === "help"} onClose={() => setSheet(null)} label="Help and FAQs">
        <h2 className="t-h2">Help and FAQs</h2>
        {FAQS.map(([q, a]) => (
          <div key={q} className="kv" style={{ marginTop: 12, padding: 14, display: "block" }}>
            <b className="t-h3">{q}</b>
            <p className="t-small muted" style={{ marginTop: 4 }}>
              {a}
            </p>
          </div>
        ))}
        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={() => setSheet(null)}>
          Got it
        </button>
      </Modal>

      <Modal open={sheet === "logout"} onClose={() => setSheet(null)} label="Log out">
        <div style={{ textAlign: "center" }}>
          <Drip size={90} mood="wow" pop />
          <h2 className="t-h2" style={{ marginTop: 10 }}>
            Log out?
          </h2>
          <p className="t-small muted">Your pools keep running while you&apos;re away.</p>
        </div>
        <button
          className="btn btn-signout btn-block"
          style={{ marginTop: 18 }}
          onClick={async () => {
            await signOut();
            router.replace("/");
          }}
        >
          Log out
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => setSheet(null)}>
          Stay
        </button>
      </Modal>
    </>
  );
}

export default function Page() {
  return <AppShell>{(user) => <Me user={user} />}</AppShell>;
}
