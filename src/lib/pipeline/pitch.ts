import type { Offering, PitchedOffering, RunPitch, Sector, SenderProfile, Signal } from "../types";

/** Most offerings a rep can pick for one run: one email can only carry so many. */
export const MAX_CHOSEN_OFFERINGS = 5;
/** In "let Signal Scout choose" mode, how many other linked offerings the draft may name besides the lead. */
export const MAX_AUTO_MENTIONS = 2;

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Joins a retired value-proposition text onto "what it does", so nothing the rep wrote is lost. */
function withoutValueProp(whatItDoes: string, valueProp: string): string {
  return [whatItDoes.trim(), valueProp.trim()].filter(Boolean).join(" ");
}

/** An offering as stored, from before or after the value proposition was dropped. */
function readOffering(raw: unknown): Offering {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(o.id),
    name: str(o.name),
    whatItDoes: withoutValueProp(str(o.whatItDoes), str(o.valueProp)),
    cta: str(o.cta),
    documentIds: Array.isArray(o.documentIds) ? o.documentIds.filter((d): d is string => typeof d === "string") : [],
  };
}

/**
 * Reads a stored sender profile of any version. Version 1 had one free-text offering; it becomes a
 * "General" sector with one offering, so nothing the rep wrote is lost.
 */
export function upgradeSenderProfile(raw: unknown, fallback: SenderProfile): SenderProfile {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const identity = {
    senderName: "senderName" in r ? str(r.senderName) : fallback.senderName,
    senderRole: "senderRole" in r ? str(r.senderRole) : fallback.senderRole,
    companyName: "companyName" in r ? str(r.companyName) : fallback.companyName,
    companyWebsite: "companyWebsite" in r ? str(r.companyWebsite) : fallback.companyWebsite,
  };
  if (Array.isArray(r.sectors)) {
    const sectors = (r.sectors as unknown[]).map((raw): Sector => {
      const s = (raw ?? {}) as Record<string, unknown>;
      return { id: str(s.id), name: str(s.name), offerings: Array.isArray(s.offerings) ? s.offerings.map(readOffering) : [] };
    });
    return { ...identity, defaultCta: str(r.defaultCta), sectors };
  }
  const whatItDoes = withoutValueProp(str(r.offering), str(r.valueProp));
  return {
    ...identity,
    defaultCta: str(r.callToAction),
    sectors: whatItDoes
      ? [{ id: "general", name: "General", offerings: [{ id: "main", name: identity.companyName.trim() || "Main offering", whatItDoes, cta: "", documentIds: [] }] }]
      : [],
  };
}

/** Every offering in the profile, with its sector name. */
export function allOfferings(profile: SenderProfile): PitchedOffering[] {
  return profile.sectors.flatMap((sector) => sector.offerings.map((o: Offering) => ({ ...o, documentIds: [...o.documentIds], sectorName: sector.name })));
}

export type PitchChoice = { offeringIds?: string[]; auto?: boolean };

/**
 * Turns the rep's choice into the run's snapshot. With no offerings set up there is nothing to choose
 * and drafts stay general. Otherwise the rep must pick at least one offering or let research choose.
 */
export function buildPitch(profile: SenderProfile, choice: PitchChoice): { ok: true; pitch: RunPitch } | { ok: false; error: string } {
  const offerings = allOfferings(profile);
  if (offerings.length === 0) return { ok: true, pitch: { mode: "auto", offerings: [] } };
  if (choice.auto) return { ok: true, pitch: { mode: "auto", offerings } };
  const ids = [...new Set(choice.offeringIds ?? [])];
  if (ids.length === 0) return { ok: false, error: "Choose what you're pitching, or let Signal Scout choose." };
  if (ids.length > MAX_CHOSEN_OFFERINGS) return { ok: false, error: `Choose at most ${MAX_CHOSEN_OFFERINGS} offerings for one email.` };
  const byId = new Map(offerings.map((o) => [o.id, o]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) return { ok: false, error: "An offering you chose no longer exists. Reload the page and choose again." };
  return { ok: true, pitch: { mode: "chosen", offerings: ids.map((id) => byId.get(id)!) } };
}

/** Runs created before offerings existed pitch everything in the current profile, like "let Signal Scout choose". */
export function pitchOrDefault(pitch: RunPitch | null, profile: SenderProfile): RunPitch {
  return pitch ?? { mode: "auto", offerings: allOfferings(profile) };
}

/**
 * Which offering the email leads with and which it only names. The lead is the offering the hook links
 * to; failing that, the one most verified findings link to; failing that, the first one. In "chosen"
 * mode every other chosen offering is named; in "auto" mode only others that a verified finding links to.
 */
export function pitchFocus(pitch: RunPitch, hookSignal: Signal | undefined, signals: Signal[]): { lead: PitchedOffering | null; others: PitchedOffering[] } {
  if (pitch.offerings.length === 0) return { lead: null, others: [] };
  const byId = new Map(pitch.offerings.map((o) => [o.id, o]));
  const links = new Map<string, number>();
  for (const s of signals)
    if (s.status === "verified" && !s.sensitive && s.offeringId && byId.has(s.offeringId)) links.set(s.offeringId, (links.get(s.offeringId) ?? 0) + 1);
  const mostLinked = [...links.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const leadId = (hookSignal?.offeringId && byId.has(hookSignal.offeringId) ? hookSignal.offeringId : undefined) ?? mostLinked ?? pitch.offerings[0].id;
  const lead = byId.get(leadId)!;
  const rest = pitch.offerings.filter((o) => o.id !== leadId);
  const others = pitch.mode === "chosen" ? rest : rest.filter((o) => links.has(o.id)).sort((a, b) => links.get(b.id)! - links.get(a.id)!).slice(0, MAX_AUTO_MENTIONS);
  return { lead, others };
}

/** Seller documents for a run: company-wide ones (assigned to no offering) plus those of the pitched offerings. */
export function documentsForPitch<T extends { id: string }>(docs: T[], profile: SenderProfile, pitch: RunPitch): T[] {
  const assigned = new Set(allOfferings(profile).flatMap((o) => o.documentIds));
  const pitched = new Set(pitch.offerings.flatMap((o) => o.documentIds));
  return docs.filter((d) => !assigned.has(d.id) || pitched.has(d.id));
}
