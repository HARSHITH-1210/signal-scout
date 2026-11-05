import type { ContactHold, ContactRules } from "../types";
import { mentionsCompany } from "./evidence";

/** What a contact-list entry is compared against. */
export interface ContactSubject {
  email?: string | null;
  company?: string | null;
  website?: string | null;
  domain?: string | null;
}

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function bareDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const host = value.includes("@") ? value.split("@")[1] : value.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  return host ? host.toLowerCase().replace(/^www\./, "") : null;
}

/** True when one contact-list entry (an email, a domain or a company name) matches the subject. */
export function entryMatches(entry: string, subject: ContactSubject): boolean {
  const e = entry.trim().toLowerCase();
  if (!e) return false;
  if (e.includes("@")) return subject.email?.trim().toLowerCase() === e;
  if (DOMAIN.test(e)) {
    const domains = [bareDomain(subject.email), bareDomain(subject.website), bareDomain(subject.domain)].filter(Boolean) as string[];
    return domains.some((d) => d === e || d.endsWith(`.${e}`));
  }
  return Boolean(subject.company) && mentionsCompany(subject.company!, entry.trim(), null);
}

/**
 * Checks the rep's contact list before any research: an opt-out always wins; a relationship (customer,
 * open deal, past contact) holds the run for the rep unless they already chose to proceed.
 */
export function checkContactRules(subject: ContactSubject, rules: ContactRules, relationshipOverridden = false): ContactHold | null {
  const optOut = rules.doNotContact.find((entry) => entryMatches(entry, subject));
  if (optOut) return { kind: "do_not_contact", match: optOut.trim(), note: null, overridden: false };
  if (relationshipOverridden) return null;
  const rel = rules.relationships.find((r) => entryMatches(r.match, subject));
  return rel ? { kind: "relationship", match: rel.match.trim(), note: rel.note.trim() || null, overridden: false } : null;
}

/** Parses the settings textarea: one entry per line, "match: note" for relationships. */
export function parseRelationshipLines(text: string): ContactRules["relationships"] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.search(/\s[-–—:]\s|:\s/);
      return at === -1 ? { match: line, note: "" } : { match: line.slice(0, at).trim(), note: line.slice(at).replace(/^\s*[-–—:]\s*/, "").trim() };
    });
}
