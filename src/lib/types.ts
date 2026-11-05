// Shared domain types. Safe to import from client components (no server-only imports).

export const RUN_STATUSES = [
  "queued",
  "running",
  "needs_clarification",
  "held",
  "insufficient_research",
  "awaiting_review",
  "approved",
  "sent",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Statuses where the pipeline has stopped and is waiting on nothing automated. */
export const TERMINAL_STATUSES: readonly RunStatus[] = [
  "needs_clarification",
  "held",
  "insufficient_research",
  "awaiting_review",
  "approved",
  "sent",
  "failed",
];

export const STAGES = [
  "validate",
  "resolve_identity",
  "research",
  "extract_signals",
  "verify",
  "rank_hook",
  "draft",
  "guard",
] as const;
export type StageName = (typeof STAGES)[number];

export const STAGE_LABELS: Record<StageName, string> = {
  validate: "Validate input",
  resolve_identity: "Resolve identity",
  research: "Research public sources",
  extract_signals: "Extract signals",
  verify: "Verify evidence",
  rank_hook: "Rank & select hook",
  draft: "Draft outreach",
  guard: "Quality & claim check",
};

export type StageStatus = "pending" | "running" | "succeeded" | "warning" | "failed" | "skipped";

/** Any subset of these may be given (at least one). Research is person-level only when a person is identified. */
export interface ProspectInput {
  name?: string;
  /** Recipient address for sending. Never researched, never shown to the model, never guessed. */
  email?: string;
  company?: string;
  role?: string;
  linkedinUrl?: string;
  companyWebsite?: string;
  notes?: string;
}

export interface SenderProfile {
  senderName: string;
  senderRole: string;
  companyName: string;
  companyWebsite: string;
  offering: string;
  valueProp: string;
  callToAction: string;
}

export type SourceCategory = "identity" | "website" | "news" | "funding" | "hiring" | "person" | "priorities" | "document";

/** Where a source came from. Rep documents are uploaded files; their quotes are verified like web pages. */
export type SourceOrigin = "web" | "prospect_document";

export interface Source {
  id: string; // "S1", "S2", ... stable within a run
  /** Web URL, or `upload://<file name>` for an uploaded document. */
  url: string;
  /** Older records predate this field and are treated as "web". */
  origin?: SourceOrigin;
  /** When the text was captured (ISO). The evidence is a snapshot from this moment. */
  fetchedAt?: string;
  title: string;
  domain: string;
  publishedDate: string | null; // ISO date as reported by the search provider
  category: SourceCategory;
  /** Sanitised text exactly as shown to the model; evidence quotes are verified against this. */
  text: string;
  /** True when the page contains text that tries to instruct an AI; it can never support a hook. */
  suspicious: boolean;
  reliability: number;
  reliabilityLabel: string;
}

export const SIGNAL_TYPES = [
  "funding",
  "hiring",
  "product_launch",
  "leadership_change",
  "expansion",
  "partnership",
  "strategic_priority",
  "challenge",
  "interview_or_talk",
  "award",
  "other",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export type Freshness = "fresh" | "aging" | "stale" | "unknown";
export type SignalStatus = "verified" | "rejected" | "conflicting";

export interface Signal {
  id: string; // "G1", "G2", ...
  type: SignalType;
  about: "person" | "company";
  claim: string;
  evidenceQuote: string;
  sourceId: string;
  eventDate: string | null;
  relevance: number; // 0..1, model-assessed (an inference, not a fact)
  whyItMatters: string; // model inference, labelled as such in the UI
  status: SignalStatus;
  statusReason: string | null;
  freshness: Freshness;
  ageDays: number | null;
  reliability: number;
  corroboratingSourceIds: string[];
  conflictGroup: string | null;
  score: number | null;
  /** Bad news (layoffs, breach, lawsuit…): never a hook, and holds the draft for the rep. Absent on older runs. */
  sensitive?: boolean;
  /** Model's link from this signal to a problem the seller's offering solves (inference); null when there is none. */
  offerLink?: string | null;
}

export interface IdentityCandidate {
  name: string;
  role: string | null;
  company: string | null;
  description: string;
  evidenceUrl: string | null;
}

export interface Identity {
  status: "resolved" | "ambiguous" | "not_found";
  resolvedName: string | null;
  resolvedRole: string | null;
  resolvedCompany: string | null;
  companyDomain: string | null;
  companyDescription: string | null;
  reasoning: string;
  evidenceUrls: string[];
  candidates: IdentityCandidate[];
  /** True only when a public source ties this person to the company; otherwise research is company-level. */
  personConfirmed: boolean;
  confirmedByUser: boolean;
}

export interface Hook {
  signalId: string;
  score: number;
  whyItMatters: string;
  staleCaveat: boolean;
  alternativeSignalIds: string[];
}

export interface GuardIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  excerpt?: string;
}

export interface ClaimCheck {
  text: string;
  kind: "prospect_fact" | "sender_claim" | "opinion_or_question";
  supportedBy: string | null;
}

export interface GuardReport {
  wordCount: number;
  issues: GuardIssue[];
  claims: ClaimCheck[] | null; // null when the claim check did not run (e.g. after a human edit)
  claimCheckNote: string | null;
}

export type DraftKind = "personalised" | "role_based";

export type DocumentKind = "pdf" | "csv";
export type DocumentScope = "prospect" | "sender";

/** Metadata for an uploaded file (its text stays on the server). */
export interface StoredDocument {
  id: string;
  scope: DocumentScope;
  name: string;
  kind: DocumentKind;
  charCount: number;
  pages: number | null;
  csv: { headers: string[]; rowCount: number } | null;
  createdAt: string;
}

/** A document attached to a run. For a CSV, only the chosen row is used as evidence. */
export interface RunDocument {
  documentId: string;
  name: string;
  kind: DocumentKind;
  rowIndex: number | null;
}

/** Reviewer-facing notes that travel with an AI draft. */
export interface DraftConfidence {
  level: "high" | "medium" | "low";
  /** What the personalisation rests on: the person, their company, or only their role. */
  basis: "person" | "company" | "role";
  reasons: string[];
}

export interface DraftNotes {
  alternateSubjects: string[];
  rationale: string[];
  /** Absent on drafts written before confidence labels existed. */
  confidence?: DraftConfidence;
  /** After this the draft must be re-researched, not sent. */
  expiresAt?: string;
}

export interface Draft {
  id: number;
  version: number;
  kind: DraftKind;
  subject: string;
  body: string;
  signalIdsUsed: string[];
  author: "ai" | "human";
  guard: GuardReport;
  /** When no person was named: the role(s) this draft is written for, e.g. "CFO or VP Finance". */
  recipientHint: string | null;
  notes: DraftNotes | null;
  createdAt: string;
}

export interface RunEvent {
  id: number;
  stage: StageName;
  status: StageStatus;
  message: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface QueryLogEntry {
  category: SourceCategory;
  query: string;
  resultCount: number;
  error: string | null;
}

export interface Clarification {
  candidateIndex?: number;
  company?: string;
  role?: string;
  linkedinUrl?: string;
  companyWebsite?: string;
  notes?: string;
}

export interface RunSummary {
  id: string;
  status: RunStatus;
  prospect: ProspectInput;
  /** What research resolved the prospect to (person, else company), when the rep gave no name. */
  resolvedLabel: string | null;
  currentStage: StageName | null;
  error: string | null;
  hookType: SignalType | null;
  draftKind: DraftKind | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Time the pipeline actually spent working, excluding time waiting for the rep. */
  activeMs: number;
  documentCount: number;
  sourceCount: number;
  verifiedCount: number;
}

/** Record of an approved draft sent through Gmail. */
export interface SentRecord {
  to: string;
  from: string;
  version: number;
  messageId: string;
  sentAt: string;
}

/** Public view of the Gmail connection (never includes tokens). */
export interface GmailStatus {
  configured: boolean; // OAuth client set in env
  connected: boolean;
  email: string | null;
  autoSendOnApprove: boolean;
}

/** The rep's own list: people and companies not to contact, and existing relationships to check first. */
export interface ContactRules {
  /** Emails, domains or company names that opted out. Never researched, never sent to. */
  doNotContact: string[];
  /** Customers, open deals, past contacts: the run stops for the rep, with this note. */
  relationships: { match: string; note: string }[];
}

/** Why a run stopped before research. A relationship hold can be overridden; an opt-out can't. */
export interface ContactHold {
  kind: "do_not_contact" | "relationship";
  match: string;
  note: string | null;
  overridden: boolean;
}

export interface RunDetail extends RunSummary {
  sent: SentRecord | null;
  hold: ContactHold | null;
  documents: RunDocument[];
  /** The draft version a person approved, if any. */
  approvedVersion: number | null;
  identity: Identity | null;
  hook: Hook | null;
  limitations: string[];
  researchLog: QueryLogEntry[];
  sources: Source[];
  signals: Signal[];
  drafts: Draft[];
  events: RunEvent[];
  stageStatuses: Record<StageName, StageStatus>;
}
