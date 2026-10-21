"use client";

import { useRef, useState } from "react";
import { counts, markDuplicates, parseFile, parseText, type Entry } from "@/lib/people";
import { useToast } from "./providers";
import { Avatar, Modal } from "./ui";
import { sound } from "@/lib/sound";

interface ContactsManager {
  select(props: string[], options: { multiple: boolean }): Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]>;
}

function OptionCard({ emoji, title, detail, onClick, active }: { emoji: string; title: string; detail: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        padding: "12px 14px",
        border: `2px solid ${active ? "var(--blue)" : "var(--line)"}`,
        borderRadius: 16,
        background: active ? "var(--blue-50)" : "var(--white)",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 12, background: "var(--bg)", fontSize: 20 }} aria-hidden="true">
        {emoji}
      </span>
      <span>
        <span style={{ display: "block", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 16 }}>{title}</span>
        <span style={{ display: "block", color: "var(--slate)", fontSize: 13 }}>{detail}</span>
      </span>
    </button>
  );
}

/** Pick from contacts (Android), paste a list, or upload a file. Calls `onAdd` with what was found and its source name. */
export function ImportOptions({ onAdd, existing }: { onAdd: (entries: Entry[], source: string) => void; existing: { name: string; contact: string | null }[] }) {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const [last, setLast] = useState<"contacts" | "paste" | "file" | null>(null);

  function take(found: Entry[], source: string) {
    if (!found.length) {
      toast("We couldn't find anyone in that. Check the format and try again.", "🤔");
      return;
    }
    onAdd(markDuplicates(found, existing), source);
    sound.win();
  }

  async function pickContacts() {
    setLast("contacts");
    const contacts = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
    if (!contacts?.select) {
      toast("Picking contacts works on Android phones. Paste a list or upload a file here.", "📇");
      return;
    }
    const picked = await contacts.select(["name", "tel", "email"], { multiple: true }).catch(() => []);
    take(parseText(picked.map((c) => `${c.name?.[0] ?? ""}, ${c.tel?.[0] ?? c.email?.[0] ?? ""}`).join("\n")), "Your contacts");
  }

  async function upload(f: File | undefined) {
    if (!f) return;
    setLast("file");
    try {
      take(await parseFile(f), f.name);
    } catch (e) {
      toast(e instanceof Error && e.message.startsWith("Save") ? e.message : "We couldn't read that file. Try Excel (.xlsx), CSV, text or contacts (.vcf).", "📁");
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <OptionCard emoji="📇" title="Pick from your contacts" detail="Opens your phone's contacts on Android" onClick={pickContacts} active={last === "contacts"} />
      <OptionCard
        emoji="📋"
        title="Paste a list"
        detail="From a class list, notes, anywhere"
        onClick={() => {
          setLast("paste");
          setPaste(true);
        }}
        active={last === "paste"}
      />
      <OptionCard emoji="📁" title="Upload a file" detail="Excel, Google Sheets, CSV, text or contacts (.vcf)" onClick={() => file.current?.click()} active={last === "file"} />
      <input ref={file} type="file" hidden accept=".xlsx,.xls,.csv,.txt,.vcf,text/csv,text/plain,text/vcard" onChange={(e) => upload(e.target.files?.[0])} />

      <Modal open={paste} onClose={() => setPaste(false)} label="Paste a list" wide>
        <div style={{ display: "grid", gap: 12 }}>
          <h2 className="t-h2">Paste a list</h2>
          <p className="muted t-small">One person per line. Add a phone number or email after each name if you have it.</p>
          <textarea
            className="input"
            rows={8}
            placeholder={"Chioma Nwosu, 0803 555 0142\nFemi Balogun 08125550187\nSegun Ajayi, segun.ajayi@gmail.com"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <button
            className="btn btn-primary btn-block"
            disabled={!text.trim()}
            onClick={() => {
              take(parseText(text), "Pasted list");
              setText("");
              setPaste(false);
            }}
          >
            Add these people
          </button>
        </div>
      </Modal>
    </div>
  );
}

const TAG: Record<Entry["status"], { label: string; className: string } | null> = {
  ready: null,
  fixed: { label: "+234 added", className: "pill pill-navy" },
  invalid: { label: "Check this", className: "pill pill-red" },
  dup: { label: "Duplicate", className: "pill pill-amber" },
};

/** Summary chips and the people found, with what needs attention. */
export function EntryList({ entries, title }: { entries: Entry[]; title?: string }) {
  const c = counts(entries);
  return (
    <div className="cs-in" style={{ display: "grid", gap: 12 }}>
      {title && <div className="t-h3" style={{ fontWeight: 700 }}>{title}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <span className="pill pill-green">{c.ready} ready</span>
        {c.fixed > 0 && <span className="pill pill-navy">{c.fixed} numbers formatted to +234</span>}
        {c.invalid > 0 && <span className="pill pill-red">{c.invalid} to check</span>}
        {c.dup > 0 && <span className="pill pill-amber">{c.dup} duplicate{c.dup > 1 ? "s" : ""} skipped</span>}
      </div>
      <div style={{ overflow: "hidden", maxHeight: 380, overflowY: "auto", borderRadius: 16, background: "var(--white)", border: "1px solid var(--line-soft)" }}>
        {entries.map((e, i) => {
          const tag = TAG[e.status];
          return (
            <div
              key={`${e.name}-${i}`}
              className="rise"
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: i ? "1px solid var(--line-soft)" : 0, background: e.status === "dup" ? "var(--bg)" : undefined, opacity: e.status === "dup" ? 0.7 : 1, animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
              <Avatar name={e.name || e.contact || "?"} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{e.name || "No name"}</div>
                <div className="t-small muted">{e.contact || "No phone or email"}</div>
              </div>
              {tag && <span className={tag.className}>{tag.label}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The people that will actually be added. */
export function usable(entries: Entry[]): Entry[] {
  return entries.filter((e) => e.status === "ready" || e.status === "fixed");
}
