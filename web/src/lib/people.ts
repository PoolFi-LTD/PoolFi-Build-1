import type { NewDiver } from "./types";

export type EntryStatus = "ready" | "fixed" | "invalid" | "dup";

export interface Entry extends NewDiver {
  status: EntryStatus;
}

const EMAIL = /[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}/;
/** Anything that looks like an attempt at a number, so short or broken ones get flagged. */
const PHONE = /\+?\d[\d\s().-]{1,}\d/;

/** A Nigerian phone number as "+234 803 555 0142", whether it was "fixed" or already right, or null. */
export function normalisePhone(raw: string): { phone: string; fixed: boolean } | null {
  let digits = raw.replace(/\D/g, "");
  const hadCountryCode = raw.trim().startsWith("+234") || digits.startsWith("234");
  if (digits.startsWith("234")) digits = digits.slice(3);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10 || !/^[789]/.test(digits)) return null;
  return { phone: `+234 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`, fixed: !hadCountryCode };
}

function entryFrom(nameRaw: string, contactRaw: string): Entry | null {
  const name = nameRaw.replace(/[,;\t|"]+/g, " ").replace(/\s+/g, " ").trim();
  const contactText = contactRaw.trim();
  if (!name && !contactText) return null;
  const email = contactText.match(EMAIL)?.[0];
  if (email) return { name: name || email.split("@")[0], contact: email.toLowerCase(), status: "ready" };
  if (!contactText) return { name, contact: "", status: "ready" };
  const phone = normalisePhone(contactText);
  if (!phone) return { name, contact: contactText, status: "invalid" };
  return { name, contact: phone.phone, status: phone.fixed ? "fixed" : "ready" };
}

/** One person per line: "Ada Eze, 0803 555 0142", "Segun Ajayi segun@gmail.com", or just a name. */
export function parseText(text: string): Entry[] {
  const out: Entry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^(name|full name|names?)\b.*(phone|email|number)/i.test(trimmed)) continue;
    const contact = trimmed.match(EMAIL)?.[0] ?? trimmed.match(PHONE)?.[0] ?? "";
    const entry = entryFrom(contact ? trimmed.replace(contact, "") : trimmed, contact);
    if (entry) out.push(entry);
  }
  return out;
}

/** Contacts exported as a .vcf file. */
export function parseVcf(text: string): Entry[] {
  const out: Entry[] = [];
  for (const card of text.split(/BEGIN:VCARD/i).slice(1)) {
    const name = card.match(/^FN[^:]*:(.+)$/im)?.[1]?.trim() ?? "";
    const contact = card.match(/^TEL[^:]*:(.+)$/im)?.[1] ?? card.match(/^EMAIL[^:]*:(.+)$/im)?.[1] ?? "";
    const entry = entryFrom(name, contact);
    if (entry) out.push(entry);
  }
  return out;
}

/** A spreadsheet (.xlsx), a CSV, a text file or contacts (.vcf). */
export async function parseFile(file: File): Promise<Entry[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "vcf") return parseVcf(await file.text());
  if (ext === "xlsx") {
    const { readSheet } = await import("read-excel-file/browser");
    const rows = await readSheet(file);
    return parseText(rows.map((row) => row.filter((c) => c !== null && c !== undefined).join(", ")).join("\n"));
  }
  if (ext === "xls" || ext === "numbers" || ext === "ods") {
    throw new Error("Save the sheet as .xlsx or CSV and upload it again.");
  }
  return parseText(await file.text());
}

/** Marks people already on the list, or listed twice, as duplicates. */
export function markDuplicates(entries: Entry[], existing: { name: string; contact: string | null }[] = []): Entry[] {
  const seen = new Set(existing.flatMap((e) => [e.contact ? `c:${e.contact}` : `n:${e.name.toLowerCase()}`]));
  return entries.map((e) => {
    const key = e.contact ? `c:${e.contact}` : `n:${e.name.toLowerCase()}`;
    if (seen.has(key)) return { ...e, status: "dup" };
    seen.add(key);
    return e;
  });
}

export function counts(entries: Entry[]) {
  return {
    ready: entries.filter((e) => e.status === "ready" || e.status === "fixed").length,
    fixed: entries.filter((e) => e.status === "fixed").length,
    invalid: entries.filter((e) => e.status === "invalid").length,
    dup: entries.filter((e) => e.status === "dup").length,
  };
}
