import { z } from "zod";
import type { Clarification, ProspectInput, SenderProfile } from "../types";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max, `Must be ${max} characters or fewer`).optional());

function withScheme(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/**
 * A company website must be a public domain name. IP literals and internal names (localhost,
 * *.local, *.internal, cloud metadata) are never a company's site and shouldn't be sent to a
 * third-party fetcher.
 */
export function isPublicHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":")) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|intranet|corp)$/.test(h)) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(h);
}

const websiteSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .max(300)
    .transform(withScheme)
    .refine((value) => {
      try {
        const url = new URL(value);
        return /^https?:$/.test(url.protocol) && url.hostname.includes(".") && !url.username && isPublicHostname(url.hostname);
      } catch {
        return false;
      }
    }, "Enter a valid website, e.g. acme.com")
    .optional(),
);

const linkedinSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .max(300)
    .transform(withScheme)
    .refine((value) => {
      try {
        const url = new URL(value);
        return /(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/in\/[^/]+/i.test(url.pathname);
      } catch {
        return false;
      }
    }, "Enter a LinkedIn profile URL like linkedin.com/in/jane-doe")
    .optional(),
);

const nameSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .min(2, "Enter at least two characters")
    .max(100, "Name is too long")
    .refine((v) => /\p{L}/u.test(v), "Name must contain letters")
    .optional(),
);

export const emailSchema = z.preprocess(
  blankToUndefined,
  z.string().trim().max(254).email("Enter a valid email address, e.g. priya@northwindfreight.com").optional(),
);

const ProspectFields = {
    name: nameSchema,
    email: emailSchema,
    company: optionalText(120),
    role: optionalText(120),
    linkedinUrl: linkedinSchema,
    companyWebsite: websiteSchema,
    notes: optionalText(500),
};

const ProspectFieldsSchema = z.object(ProspectFields);

/** Every field is optional, but at least one must be filled in (or a document attached). */
export const ProspectSchema = ProspectFieldsSchema
  .refine((p) => Boolean(p.name || p.company || p.role || p.linkedinUrl || p.companyWebsite || p.notes), {
    message: "Fill in at least one field so there is something to research.",
    path: ["_form"],
  });

export type FieldErrors = Record<string, string>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/** Validates prospect fields. `allowEmpty` is for runs whose details come entirely from attached documents. */
export function validateProspect(input: unknown, options: { allowEmpty?: boolean } = {}): ValidationResult<ProspectInput> {
  const parsed = ProspectSchema.safeParse(input ?? {});
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors = toFieldErrors(parsed.error);
  if (options.allowEmpty && Object.keys(errors).length === 1 && errors._form) {
    const fieldsOnly = ProspectFieldsSchema.safeParse(input ?? {});
    if (fieldsOnly.success) return { ok: true, value: fieldsOnly.data };
  }
  return { ok: false, errors };
}

export const ClarificationSchema = z
  .object({
    candidateIndex: z.number().int().min(0).max(20).optional(),
    company: optionalText(120),
    role: optionalText(120),
    linkedinUrl: linkedinSchema,
    companyWebsite: websiteSchema,
    notes: optionalText(500),
  })
  .refine(
    (c) =>
      c.candidateIndex !== undefined || Boolean(c.company || c.role || c.linkedinUrl || c.companyWebsite || c.notes),
    { message: "Pick a candidate or add at least one more detail", path: ["_form"] },
  );

export function validateClarification(input: unknown): ValidationResult<Clarification> {
  const parsed = ClarificationSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, errors: toFieldErrors(parsed.error) };
}

const optionalProfileText = (max: number) =>
  z.preprocess((v) => (v === undefined || v === null ? "" : v), z.string().trim().max(max, `Must be ${max} characters or fewer`));

/** What a new run pitches: chosen offering ids, or "let Signal Scout choose" from all of them. */
export const PitchChoiceSchema = z.object({
  offeringIds: z.array(z.string().max(64)).max(50).optional(),
  autoPitch: z.boolean().optional(),
});

const TemplateId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");

const OfferingSchema = z.object({
  id: TemplateId,
  name: z.string().trim().min(1, "Give the offering a name").max(80, "Must be 80 characters or fewer"),
  whatItDoes: optionalProfileText(600),
  cta: optionalProfileText(200),
  documentIds: z.array(z.string().uuid()).max(10).default([]),
});

const SectorSchema = z.object({
  id: TemplateId,
  name: z.string().trim().min(1, "Give the sector a name").max(60, "Must be 60 characters or fewer"),
  offerings: z.array(OfferingSchema).max(20, "At most 20 offerings per sector"),
});

/** Every sender field is optional; drafts adapt to whatever is filled in. Sectors group offering templates. */
export const SenderProfileSchema = z
  .object({
    senderName: optionalProfileText(80),
    senderRole: optionalProfileText(80),
    companyName: optionalProfileText(80),
    companyWebsite: optionalProfileText(200),
    defaultCta: optionalProfileText(200),
    sectors: z.array(SectorSchema).max(12, "At most 12 sectors").default([]),
  })
  .superRefine((profile, ctx) => {
    // Runs and documents refer to offerings by id, so ids must be unique across the whole profile.
    const seen = new Set<string>();
    profile.sectors.forEach((sector, s) => {
      if (seen.has(sector.id)) ctx.addIssue({ code: "custom", path: ["sectors", s, "id"], message: "Duplicate id" });
      seen.add(sector.id);
      sector.offerings.forEach((o, i) => {
        if (seen.has(o.id)) ctx.addIssue({ code: "custom", path: ["sectors", s, "offerings", i, "id"], message: "Duplicate id" });
        seen.add(o.id);
      });
    });
  });

export function validateSenderProfile(input: unknown): ValidationResult<SenderProfile> {
  const parsed = SenderProfileSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, errors: toFieldErrors(parsed.error) };
}
