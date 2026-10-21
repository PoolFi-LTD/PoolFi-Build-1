"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Drip } from "@/components/Drip";
import { Icon } from "@/components/Icon";
import { Celebration, CountUp, replay, shake } from "@/components/motion";
import { EntryList, ImportOptions, usable } from "@/components/people";
import { FeeTip } from "@/components/pool";
import { RequireSession, useToast } from "@/components/providers";
import { FocusShell } from "@/components/shells";
import { Avatar, BusyButton, ErrorText, StatusPill, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { dayDate } from "@/lib/format";
import { useAction, useNow, useResource } from "@/lib/hooks";
import { feeOf, formatAmount, formatUsdc, fromNaira, grossShare, roundUsdc } from "@/lib/money";
import type { Entry } from "@/lib/people";
import { sound } from "@/lib/sound";
import type { PoolDetail, PoolType } from "@/lib/types";
import s from "./create.module.css";

const FEE_BPS = Number(process.env.NEXT_PUBLIC_FEE_BPS ?? 500);
const STEPS = 8;
const MAX_APPROVERS = 3;
/** The design's ₦100 minimum and quick amounts, in USDC. */
const MIN_AMOUNT = fromNaira(100);
const PRESETS = [1000, 2000, 5000, 10000, 50000].map(fromNaira);

const TYPES: { emoji: string; type: PoolType; tip: string; ideas: string[] }[] = [
  { emoji: "🎓", type: "Class dues", tip: "No more chasing coursemates one by one.", ideas: ["300L Class Dues", "Departmental dues", "Excursion fund"] },
  { emoji: "🎂", type: "Birthday", tip: "A surprise? Your secret is safe with me.", ideas: ["Ada's surprise birthday", "Birthday gift fund"] },
  { emoji: "💼", type: "Office welfare", tip: "Sorted. No awkward follow-ups with colleagues.", ideas: ["October welfare", "Team send-off"] },
  { emoji: "🤝", type: "Cooperative levy", tip: "Clean records for every member. Love that.", ideas: ["Monthly contribution", "Special welfare levy"] },
  { emoji: "✈️", type: "Group trip", tip: "Trip energy! Let's make it happen.", ideas: ["Squad trip to Obudu", "Beach day"] },
  { emoji: "💍", type: "Wedding gift", tip: "Aww. Let's get the gift sorted.", ideas: ["Kemi & Dayo's gift", "Wedding gift"] },
  { emoji: "🕊️", type: "Faith group", tip: "Projects and levies, all in one place.", ideas: ["Building project", "Harvest levy"] },
  { emoji: "✨", type: "Something else", tip: "Anything goes. Let's set it up.", ideas: ["Group fund", "Team kitty"] },
];
const EMOJIS = ["🎓", "🎂", "💼", "🤝", "✈️", "💍", "🕊️", "✨", "⚽", "🎉", "👕", "🍲", "📚", "💐"];
const CHEERS = ["Great pick!", "Love it!", "Nice one!"];
const MAKING = ["Setting up the pool", "Locking in your approvers", "Making your link"];
/** The "Filling your pool…" screen shows at least this long, so its steps can be read. */
const MAKING_MS = 2100;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 0, 0);
  return x;
}
function plusDays(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return endOfDay(d);
}
function nextFriday(): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return endOfDay(d);
}

interface Draft {
  typeIndex: number;
  emoji: string;
  name: string;
  amountText: string;
  feeCovered: boolean;
  count: number;
  deadline: Date | null;
  deadlineChoice: number;
  approverIds: string[];
  members: Entry[];
  membersSource: string;
  pickYourName: boolean;
  allowNotOnList: boolean;
  diversCanShare: boolean;
}

function Option({ icon, title, sub, on, onClick }: { icon: React.ReactNode; title: string; sub: string; on: boolean; onClick: (button: HTMLButtonElement) => void }) {
  return (
    <button type="button" className={`${s.option} ${on ? s.optionOn : ""}`} onClick={(e) => onClick(e.currentTarget)} aria-pressed={on}>
      <span className={s.optionIcon}>{icon}</span>
      <span className={s.optionText}>
        <span className={s.optionTitle} style={{ display: "block" }}>{title}</span>
        <span className={s.optionSub}>{sub}</span>
      </span>
      <span className={`${s.radio}${on ? " okpop" : ""}`}>{on && <Icon name="check" />}</span>
    </button>
  );
}

/** "Filling your pool…": a small tank fills while each step ticks off. */
function Making() {
  const [done, setDone] = useState(0);
  useEffect(() => {
    const timers = MAKING.map((_, i) =>
      setTimeout(() => {
        setDone(i + 1);
        sound.tap();
      }, 450 + i * 520),
    );
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div className={s.creating} role="status">
      <div className="mini-tank">
        <i />
      </div>
      <h1 className="t-h2">Filling your pool…</h1>
      <div className="timeline">
        {MAKING.map((t, i) => (
          <div key={t} className={`tl${i < done ? " done" : ""}`}>
            <b>{t}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Your pool is live.": the pool card, then share it or add people. */
function Made({ pool }: { pool: PoolDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Celebration
      l1="Your pool"
      l2="is live."
      buttons={[
        { label: "Share the invite link", onClick: () => router.replace(`/pools/${pool.id}?share=1`) },
        { label: "Add divers from a list", ghost: true, onClick: () => router.replace(`/pools/${pool.id}/divers`) },
        { label: "Go to my pool", ghost: true, onClick: () => router.replace(`/pools/${pool.id}`) },
      ]}
    >
      <div className="say-in" style={{ width: "min(440px, 100%)", marginTop: 20, padding: 16, borderRadius: 20, background: "var(--white)", color: "var(--ink)", textAlign: "left", animationDelay: "300ms" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 12, background: "var(--cyan-100)", fontSize: 22 }}>{pool.emoji}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="t-h3" style={{ fontWeight: 700 }}>{pool.name}</div>
            <div className="t-small muted">
              {formatUsdc(pool.share)} each, goal {formatUsdc(pool.goal)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <span className="t-small muted">Pool ID</span>
          <button
            type="button"
            className={`pill pill-blue${copied ? " okpop" : ""}`}
            style={{ height: 30, fontSize: 14, border: 0, cursor: "pointer" }}
            onClick={async () => {
              await navigator.clipboard.writeText(pool.code).catch(() => {});
              setCopied(true);
              toast("Pool ID copied", "📋");
            }}
          >
            {pool.code} <Icon name="copy" size={14} />
          </button>
        </div>
      </div>
    </Celebration>
  );
}

function Create() {
  const router = useRouter();
  const toast = useToast();
  const now = useNow();
  const contacts = useResource(() => api.listContacts(), []);
  const create = useAction(api.createPool);
  const [step, setStepNow] = useState(0);
  // Steps slide in from the side you're heading to.
  const [dir, setDir] = useState(1);
  const setStep = (n: number) => {
    setDir(n >= step ? 1 : -1);
    setStepNow(n);
  };
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<PoolDetail | null>(null);
  const amountBox = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState(false);
  const [d, setD] = useState<Draft>({
    typeIndex: -1,
    emoji: "✨",
    name: "",
    amountText: "",
    feeCovered: false,
    count: 20,
    deadline: null,
    deadlineChoice: -1,
    approverIds: [],
    members: [],
    membersSource: "",
    pickYourName: true,
    allowNotOnList: true,
    diversCanShare: true,
  });
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const amount = roundUsdc(Number(d.amountText || 0));
  const share = grossShare(amount, FEE_BPS, d.feeCovered);
  const goal = roundUsdc(share * d.count);
  const receive = roundUsdc(goal - feeOf(goal, FEE_BPS));
  const type = TYPES[Math.max(0, d.typeIndex)];
  const people = usable(d.members);
  const approverNames = useMemo(
    () => (contacts.data ?? []).filter((c) => d.approverIds.includes(c.userId)).map((c) => c.name.split(" ")[0]),
    [contacts.data, d.approverIds],
  );
  const needed = d.approverIds.length ? Math.floor(d.approverIds.length / 2) + 1 : 0;

  const valid = [
    d.typeIndex >= 0,
    d.name.trim().length >= 3,
    amount >= MIN_AMOUNT,
    d.count >= 2,
    d.deadline !== null && d.deadline.getTime() > now + 60_000,
    true,
    true,
    true,
  ][step];
  const label = step === STEPS - 1 ? "Create pool" : (step === 5 && !d.approverIds.length) || (step === 6 && !d.members.length) ? "Skip for now" : "Continue";

  function key(k: string) {
    let t = d.amountText;
    if (k === "del") t = t.slice(0, -1);
    else if (k === ".") t = t.includes(".") ? t : `${t || "0"}.`;
    else if (/^\d$/.test(k)) {
      const [whole, frac] = t.split(".");
      if (frac !== undefined ? frac.length >= 2 : whole.replace(/^0+/, "").length >= 7) return shake(amountBox.current);
      t = t === "0" ? k : t + k;
    }
    set({ amountText: t });
  }

  async function next() {
    if (!valid) return;
    if (step < STEPS - 1) {
      setStep(step + 1);
      return;
    }
    setMaking(true);
    const [done] = await Promise.all([
      create.run({
        type: type.type,
        emoji: d.emoji,
        name: d.name.trim(),
        amount,
        feeCoveredByDivers: d.feeCovered,
        expectedCount: Math.max(d.count, people.length),
        deadline: (d.deadline as Date).toISOString(),
        approverIds: d.approverIds,
        members: people.map(({ name, contact }) => ({ name, contact })),
        pickYourName: d.pickYourName,
        allowNotOnList: d.allowNotOnList,
        diversCanShare: d.diversCanShare,
      }),
      wait(MAKING_MS),
    ]);
    if (!done.ok) return setMaking(false);
    const pool = await api.getPool(done.value.id).catch(() => null);
    setMaking(false);
    if (pool) setMade(pool);
    else router.push(`/pools/${done.value.id}?share=1`);
  }

  const deadlineOptions: [string, string, Date][] = [
    ["🗓️", "This Friday", nextFriday()],
    ["📅", "In 1 week", plusDays(7)],
    ["🗓️", "In 2 weeks", plusDays(14)],
  ];

  const views = [
    // 1. What for
    <>
      <h1 className={s.title}>What are you collecting for?</h1>
      <p className={s.lead}>Pick the closest one. You&apos;ll name it next.</p>
      <div className={s.types}>
        {TYPES.map((t, i) => (
          <button
            key={t.type}
            type="button"
            className={`${s.type} ${d.typeIndex === i ? s.typeOn : ""}`}
            aria-pressed={d.typeIndex === i}
            onClick={() => set({ typeIndex: i, emoji: t.emoji, name: d.name || "" })}
          >
            <span className={s.typeEmoji} aria-hidden="true">{t.emoji}</span>
            {t.type}
          </button>
        ))}
      </div>
      {d.typeIndex >= 0 && (
        <div key={d.typeIndex} className={`${s.tip} say-in`}>
          <Drip size={44} mood="cheer" pop />
          <div>
            <b>{CHEERS[d.typeIndex % CHEERS.length]}</b>
            {type.tip}
          </div>
        </div>
      )}
    </>,
    // 2. Name
    <>
      <h1 className={s.title}>Give your pool a name</h1>
      <p className={s.lead}>Divers see this when they open your link.</p>
      <div className={s.nameRow}>
        <button type="button" className={s.emojiBtn} onClick={() => setPicking(!picking)} aria-label="Change the emoji">
          <span key={d.emoji} className="bounce" style={{ display: "inline-block" }}>
            {d.emoji}
          </span>
        </button>
        <label className="field" style={{ flex: 1 }}>
          <span className="field-label">Pool name</span>
          <input ref={nameInput} className="input" maxLength={40} value={d.name} onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && next()} autoFocus />
        </label>
      </div>
      {picking && (
        <div className={`${s.emojis} rise`}>
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                set({ emoji: e });
                setPicking(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <p className="t-caption muted" style={{ marginTop: 10 }}>
        {d.name.length} of 40 characters. Tap the emoji to change it.
      </p>
      <p className="t-h3" style={{ marginTop: 18, fontWeight: 700 }}>Ideas</p>
      <div className={s.ideas}>
        {type.ideas.map((idea) => (
          <button
            key={idea}
            type="button"
            className="chip"
            aria-pressed={d.name === idea}
            onClick={() => {
              set({ name: idea });
              replay(nameInput.current, "flash-bg");
            }}
          >
            {idea}
          </button>
        ))}
      </div>
    </>,
    // 3. Amount
    <>
      <h1 className={`${s.title} ${s.amountTitle}`}>How much should each diver pay?</h1>
      <div ref={amountBox} className={s.amount} style={{ marginTop: 22 }}>
        {/* Each key press bumps the number; the caret blinks after it. */}
        <span key={d.amountText} className={`${s.amountValue} bump`}>
          {d.amountText || "0"}
        </span>
        <span className="caret" style={{ height: 44 }} aria-hidden="true" />
        <span className={s.amountUnit}>USDC</span>
      </div>
      <div className={s.presets}>
        {PRESETS.map((v) => (
          <button key={v} type="button" className="chip" aria-pressed={amount === v} onClick={() => set({ amountText: String(v) })}>
            {formatAmount(v)}
          </button>
        ))}
      </div>
      <FeeTip on={d.feeCovered} onChange={(on) => set({ feeCovered: on })}>
        {amount
          ? d.feeCovered
            ? `Each diver pays ${formatUsdc(share)}: ${formatUsdc(amount)} plus ${formatUsdc(roundUsdc(share - amount))} towards the fee. You still receive the full ${formatUsdc(amount)} per person.`
            : `Each diver pays ${formatUsdc(amount)}. After PoolFi's ${FEE_BPS / 100}%, you receive ${formatUsdc(roundUsdc(amount - feeOf(amount, FEE_BPS)))} per person.`
          : `Turn this on and each share includes the fee, so you receive the full amount.`}
      </FeeTip>
      <div className={s.keypad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((k) => (
          <button key={k} type="button" className={s.key} onClick={() => key(k)} aria-label={k === "del" ? "Delete" : k}>
            {k === "del" ? <Icon name="back" /> : k}
          </button>
        ))}
      </div>
      {d.amountText && amount < MIN_AMOUNT && <p className="field-error" style={{ textAlign: "center", marginTop: 10 }}>The smallest amount is {formatUsdc(MIN_AMOUNT)}.</p>}
    </>,
    // 4. How many
    <>
      <h1 className={s.title}>How many divers are you expecting?</h1>
      <p className={s.lead}>A rough number is fine. There&apos;s no limit.</p>
      <div className={s.counter}>
        <button type="button" className={s.round} onClick={() => set({ count: Math.max(2, d.count - 1) })} aria-label="Fewer">
          <Icon name="minus" />
        </button>
        <input
          key={d.count}
          className={`${s.count} bump`}
          inputMode="numeric"
          aria-label="Number of divers"
          value={d.count}
          onChange={(e) => set({ count: Math.min(1_000_000, Number(e.target.value.replace(/\D/g, "")) || 0) })}
          onBlur={() => set({ count: Math.max(2, d.count) })}
        />
        <button type="button" className={s.round} onClick={() => set({ count: d.count + 1 })} aria-label="More">
          <Icon name="plus" />
        </button>
      </div>
      <input className={s.slider} type="range" min={2} max={200} value={Math.min(d.count, 200)} onChange={(e) => set({ count: Number(e.target.value) })} aria-label="Number of divers" />
      <p className="t-caption muted" style={{ textAlign: "center" }}>
        Tap the number to type an exact amount.
      </p>
      <div className={s.goal}>
        <span>Your goal</span>
        <b>
          <CountUp value={goal} duration={300} from={goal} format={(v) => formatUsdc(roundUsdc(v))} />
        </b>
      </div>
    </>,
    // 5. Deadline
    <>
      <h1 className={s.title}>When should it close?</h1>
      <p className={s.lead}>Divers get reminders before this date.</p>
      <div className={s.options}>
        {deadlineOptions.map(([emoji, title, date], i) => (
          <Option key={title} icon={emoji} title={title} sub={`${dayDate(date.toISOString())}, 11:59 pm`} on={d.deadlineChoice === i} onClick={() => set({ deadlineChoice: i, deadline: date })} />
        ))}
        <label className={`${s.option} ${d.deadlineChoice === 3 ? s.optionOn : ""}`} style={{ cursor: "pointer" }}>
          <span className={s.optionIcon}>✏️</span>
          <span className={s.optionText}>
            <span className={s.optionTitle} style={{ display: "block" }}>Pick a date</span>
            <input
              type="date"
              min={new Date(now + 86_400_000).toISOString().slice(0, 10)}
              onChange={(e) => e.target.value && set({ deadlineChoice: 3, deadline: endOfDay(new Date(`${e.target.value}T12:00:00`)) })}
              style={{ border: 0, padding: 0, font: "inherit", color: "var(--slate)", fontSize: 13, background: "transparent" }}
            />
          </span>
          <span className={s.radio}>{d.deadlineChoice === 3 && <Icon name="check" />}</span>
        </label>
      </div>
      <p className="note" style={{ marginTop: 16 }}>
        <Icon name="refresh" />
        Automatic refunds are always on. If the goal isn&apos;t met by the deadline, everyone gets their money back.
      </p>
    </>,
    // 6. Approvers
    <>
      <h1 className={s.title}>
        Add approvers <StatusPill status="optional" />
      </h1>
      <p className={s.lead}>Approvers confirm payouts with you, so nobody moves the money alone. Pick up to {MAX_APPROVERS}, or skip and release payouts yourself.</p>
      <label className="field">
        <span className="field-label">Search contacts</span>
        <input className="input" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <p key={d.approverIds.length} className={`${s.picked} bump`}>
        {d.approverIds.length ? `${d.approverIds.length} picked, ${needed} must approve` : "None picked"}
      </p>
      <div className={s.options}>
        {(contacts.data ?? [])
          .filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
          .map((c) => {
            const on = d.approverIds.includes(c.userId);
            return (
              <Option
                key={c.userId}
                icon={<Avatar name={c.name} />}
                title={c.name}
                sub={c.detail}
                on={on}
                onClick={(button) => {
                  if (on) return set({ approverIds: d.approverIds.filter((id) => id !== c.userId) });
                  if (d.approverIds.length >= MAX_APPROVERS) {
                    shake(button);
                    return toast(`${MAX_APPROVERS} approvers at most. Unpick someone first.`, "🔑");
                  }
                  set({ approverIds: [...d.approverIds, c.userId] });
                }}
              />
            );
          })}
        {contacts.loading && <p className="muted t-small">Loading your contacts…</p>}
        <ErrorText error={contacts.error} />
      </div>
      {d.approverIds.length === MAX_APPROVERS && (
        <div className={`${s.tip} say-in`}>
          <Drip size={44} mood="cheer" pop />
          <div>
            <b>Your approvers are set</b>
            {approverNames.join(", ")} will approve payouts. Any {needed} of them is enough.
          </div>
        </div>
      )}
      <button type="button" className={s.skip} onClick={() => setStep(step + 1)}>
        Skip for now
      </button>
    </>,
    // 7. Who's in
    <>
      <h1 className={s.title}>
        Who&apos;s in this pool? <StatusPill status="optional" />
      </h1>
      <p className={s.lead}>Add your group now so everyone can find their name and see who has paid. Or skip and just share the link.</p>
      {d.members.length ? (
        <div style={{ display: "grid", gap: 12 }}>
          <EntryList entries={d.members} />
          <button type="button" className={s.skip} style={{ marginTop: 0, justifySelf: "start" }} onClick={() => set({ members: [], membersSource: "" })}>
            Start over
          </button>
          <div className={s.setting}>
            <div>
              <b>Let people pick their name from this list</b>
              <span>When they open the link, they tap their name and pay. Everyone sees who has paid.</span>
            </div>
            <Toggle on={d.pickYourName} onChange={(on) => set({ pickYourName: on })} label="Let people pick their name" />
          </div>
          <div className={s.setting}>
            <div>
              <b>Allow people who aren&apos;t on the list</b>
              <span>Turn this off if only your list should be able to pay.</span>
            </div>
            <Toggle on={d.allowNotOnList} onChange={(on) => set({ allowNotOnList: on })} label="Allow people who aren't on the list" />
          </div>
        </div>
      ) : (
        <ImportOptions existing={[]} onAdd={(entries, source) => set({ members: entries, membersSource: source, count: Math.max(d.count, usable(entries).length) })} />
      )}
    </>,
    // 8. Review
    <>
      <h1 className={s.title}>Ready to dive in?</h1>
      <p className={s.lead}>Check the details. Tap a line to change it.</p>
      <div className={s.review}>
        <div className={s.reviewHead}>
          <span className={s.previewEmoji} style={{ width: 40, height: 40 }}>{d.emoji}</span>
          <div>
            <div className={s.previewName}>{d.name}</div>
            <div className="t-caption muted">Lifeguard: You</div>
          </div>
        </div>
        <dl style={{ margin: 0 }}>
          {(
            [
              ["Each diver pays", `${formatUsdc(share)}${d.feeCovered ? " (fee included)" : ""}`, 2],
              ["Divers", String(Math.max(d.count, people.length)), 3],
              ["Goal", formatUsdc(goal), 3],
              ["You receive", formatUsdc(receive), 2],
              ["Closes", d.deadline ? `${dayDate(d.deadline.toISOString())}, 11:59 pm` : "Not set", 4],
              ["Approvers", approverNames.join(", ") || "None", 5],
              ["Member list", people.length ? `${people.length} people` : "None, just the link", 6],
            ] as [string, string, number][]
          ).map(([label, value, target], i) => (
            <button key={label} type="button" className={`${s.reviewLine} rise`} style={{ animationDelay: `${i * 50}ms` }} onClick={() => setStep(target)}>
              <dt>{label}</dt>
              <dd>{value}</dd>
              <Icon name="edit" />
            </button>
          ))}
        </dl>
      </div>
      <div className={s.setting} style={{ marginTop: 14 }}>
        <div>
          <b>Divers can share the invite link</b>
          <span>Adding people directly is always just you.</span>
        </div>
        <Toggle on={d.diversCanShare} onChange={(on) => set({ diversCanShare: on })} label="Divers can share the invite link" />
      </div>
      <ErrorText error={create.error} />
    </>,
  ];

  if (made) return <Made pool={made} />;
  if (making) return <Making />;

  return (
    <FocusShell
      progress={(step + 1) / STEPS}
      onClose={() => router.push("/home")}
      onBack={step > 0 ? () => setStep(step - 1) : undefined}
      footer={
        <BusyButton busy={create.busy} disabled={!valid} className="btn btn-primary btn-block" onClick={next} data-sound="pick">
          {label}
        </BusyButton>
      }
    >
      <div className={s.grid}>
        <section key={step} className={dir > 0 ? "cs-in" : "cs-back"} aria-label={`Step ${step + 1} of ${STEPS}`}>
          {views[step]}
        </section>
        <aside>
          <div className={s.previewLabel}>Live preview</div>
          <div className={s.preview}>
            <div className={s.previewHead}>
              <span className={s.previewEmoji}>{d.emoji}</span>
              <div>
                <div className={s.previewName}>{d.name || type.ideas[0]}</div>
                <div className="t-caption muted">Lifeguard: You</div>
              </div>
            </div>
            {(
              [
                ["Each diver pays", amount ? `${formatUsdc(share)}${d.feeCovered ? " (fee included)" : ""}` : "Not set"],
                ["Divers", String(Math.max(d.count, people.length))],
                ["Goal", amount ? formatUsdc(goal) : "Not set"],
                ["You receive", amount ? formatUsdc(receive) : "Not set"],
                ["Approvers", approverNames.join(", ") || "Not picked"],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className={s.previewRow}>
                <span>{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
          <p className="t-caption muted" style={{ marginTop: 10 }}>
            Roughly what divers see when they open your link.
          </p>
        </aside>
      </div>
    </FocusShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <RequireSession>{() => <Create />}</RequireSession>
    </Suspense>
  );
}
