// Contact-list entries: what kind each one is, how it's normalised, and validation of a whole list.
// Pure and browser-safe: the Contacts page, the API route and the run checks all share it.
import type { ContactRules, RelationshipEntry, RelationshipKind } from "../types";

export type EntryKind = "email" | "domain" | "company";

export const MAX_ENTRIES_PER_LIST = 5000;
export const MAX_ENTRY_LENGTH = 200;
export const MAX_NOTE_LENGTH = 300;

export const RELATIONSHIP_KINDS: { value: RelationshipKind; label: string }[] = [
  { value: "customer", label: "Customer" },
  { value: "open_deal", label: "Open deal" },
  { value: "past_contact", label: "Past contact" },
  { value: "partner", label: "Partner" },
  { value: "other", label: "Other" },
];

export function relationshipLabel(kind: RelationshipKind | undefined): string | null {
  return RELATIONSHIP_KINDS.find((k) => k.value === kind)?.label ?? null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * Shared mailbox providers. A domain entry like gmail.com would match everyone who uses it, so these
 * are only accepted as full email addresses.
 */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "zoho.com",
  "mail.com", "yandex.com", "qq.com", "163.com",
]);

/** How an entry is matched: a full address, everyone at a domain, or a company name. */
export function entryKind(entry: string): EntryKind {
  const e = entry.trim();
  if (e.includes("@")) return "email";
  if (DOMAIN.test(e)) return "domain";
  return "company";
}

export const ENTRY_KIND_LABEL: Record<EntryKind, string> = { email: "Email", domain: "Domain", company: "Company" };

export type Normalised = { ok: true; value: string; kind: EntryKind } | { ok: false; reason: string };

/**
 * Cleans one entry: emails and domains are lowercased, a website URL becomes its bare domain
 * ("https://www.acme.com/about" → "acme.com"), company names keep their spelling.
 */
export function normaliseEntry(raw: string): Normalised {
  let value = raw.replace(/\s+/g, " ").trim().replace(/^mailto:/i, "");
  if (!value) return { ok: false, reason: "Empty" };
  if (value.length > MAX_ENTRY_LENGTH) return { ok: false, reason: `Longer than ${MAX_ENTRY_LENGTH} characters` };
  if (value.includes("@")) {
    value = value.toLowerCase();
    return EMAIL.test(value) && !value.includes(" ") ? { ok: true, value, kind: "email" } : { ok: false, reason: "Not a valid email address" };
  }
  if (/^https?:\/\//i.test(value) || /^www\./i.test(value) || (DOMAIN.test(value.split(/[/?#]/)[0]) && /[/?#]/.test(value))) {
    value = value.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  }
  if (DOMAIN.test(value)) {
    value = value.toLowerCase().replace(/^www\./, "");
    if (FREE_MAIL_DOMAINS.has(value)) return { ok: false, reason: `${value} is a shared mail provider; it would match everyone who uses it. Add full email addresses instead.` };
    return { ok: true, value, kind: "domain" };
  }
  return { ok: true, value, kind: "company" };
}

/** A stable key for spotting duplicates (company names compare case-insensitively). */
export const entryKey = (value: string) => value.trim().toLowerCase();

export type RulesCheck = { ok: true; value: ContactRules } | { ok: false; error: string };

/** Normalises and de-duplicates a whole contact list. Refuses it if any entry is invalid, naming the first. */
export function validateContactRules(rules: ContactRules): RulesCheck {
  if (rules.doNotContact.length > MAX_ENTRIES_PER_LIST || rules.relationships.length > MAX_ENTRIES_PER_LIST)
    return { ok: false, error: `Each list holds at most ${MAX_ENTRIES_PER_LIST.toLocaleString("en")} entries.` };

  const doNotContact: string[] = [];
  const seenDnc = new Set<string>();
  for (const raw of rules.doNotContact) {
    const n = normaliseEntry(raw);
    if (!n.ok) return { ok: false, error: `Do not contact: "${raw.slice(0, 60)}": ${n.reason}` };
    if (seenDnc.has(entryKey(n.value))) continue;
    seenDnc.add(entryKey(n.value));
    doNotContact.push(n.value);
  }

  const relationships: RelationshipEntry[] = [];
  const seenRel = new Set<string>();
  for (const entry of rules.relationships) {
    const n = normaliseEntry(entry.match);
    if (!n.ok) return { ok: false, error: `Existing relationships: "${entry.match.slice(0, 60)}": ${n.reason}` };
    const note = entry.note.replace(/\s+/g, " ").trim();
    if (note.length > MAX_NOTE_LENGTH) return { ok: false, error: `Existing relationships: the note for ${n.value} is longer than ${MAX_NOTE_LENGTH} characters.` };
    if (seenRel.has(entryKey(n.value))) continue;
    seenRel.add(entryKey(n.value));
    relationships.push({ match: n.value, ...(entry.kind ? { kind: entry.kind } : {}), note });
  }
  return { ok: true, value: { doNotContact, relationships } };
}
