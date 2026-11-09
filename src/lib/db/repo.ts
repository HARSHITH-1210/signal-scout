import { randomUUID } from "node:crypto";
import { getDb } from "./schema";
import { pitchOrDefault, upgradeSenderProfile } from "../pipeline/pitch";
import {
  STAGES,
  type Clarification,
  type DocumentKind,
  type DocumentScope,
  type Draft,
  type DraftKind,
  type DraftNotes,
  type GuardReport,
  type Hook,
  type Identity,
  type ProspectInput,
  type QueryLogEntry,
  type RunDetail,
  type RunDocument,
  type RunEvent,
  type RunPitch,
  type RunStatus,
  type RunSummary,
  type SenderProfile,
  type SentRecord,
  type ContactHold,
  type Degradation,
  type ProviderCall,
  type ProviderHealth,
  type ContactRules,
  type Signal,
  type SignalType,
  type Source,
  type StageName,
  type StageStatus,
  type StoredDocument,
} from "../types";

interface RunRow {
  id: string;
  status: RunStatus;
  prospect_json: string;
  clarifications_json: string;
  identity_json: string | null;
  hook_json: string | null;
  limitations_json: string;
  research_log_json: string;
  documents_json: string | null;
  current_stage: StageName | null;
  error: string | null;
  owner_pid: number | null;
  approved_version: number | null;
  active_ms: number | null;
  sent_json: string | null;
  hold_json: string | null;
  degraded_json: string | null;
  pitch_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface EventRow {
  id: number;
  run_id: string;
  stage: StageName;
  status: StageStatus;
  message: string;
  detail_json: string | null;
  created_at: string;
}

interface DraftRow {
  id: number;
  run_id: string;
  version: number;
  kind: DraftKind;
  subject: string;
  body: string;
  signal_ids_json: string;
  author: "ai" | "human";
  guard_json: string;
  recipient_hint: string | null;
  notes_json: string | null;
  created_at: string;
}

const nowIso = () => new Date().toISOString();
const parseJson = <T>(value: string | null, fallback: T): T => (value ? (JSON.parse(value) as T) : fallback);

export interface RunRecord {
  id: string;
  status: RunStatus;
  prospect: ProspectInput;
  clarifications: Clarification[];
  identity: Identity | null;
  hook: Hook | null;
  limitations: string[];
  researchLog: QueryLogEntry[];
  documents: RunDocument[];
  currentStage: StageName | null;
  error: string | null;
  approvedVersion: number | null;
  activeMs: number;
  sent: SentRecord | null;
  hold: ContactHold | null;
  degraded: Degradation[];
  /** Null on runs created before offerings existed. */
  pitch: RunPitch | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function toRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    status: row.status,
    prospect: JSON.parse(row.prospect_json) as ProspectInput,
    clarifications: parseJson<Clarification[]>(row.clarifications_json, []),
    identity: parseJson<Identity | null>(row.identity_json, null),
    hook: parseJson<Hook | null>(row.hook_json, null),
    limitations: parseJson<string[]>(row.limitations_json, []),
    researchLog: parseJson<QueryLogEntry[]>(row.research_log_json, []),
    documents: parseJson<RunDocument[]>(row.documents_json, []),
    currentStage: row.current_stage,
    error: row.error,
    approvedVersion: row.approved_version ?? null,
    activeMs: row.active_ms ?? 0,
    sent: parseJson<SentRecord | null>(row.sent_json ?? null, null),
    hold: parseJson<ContactHold | null>(row.hold_json ?? null, null),
    degraded: parseJson<Degradation[]>(row.degraded_json ?? null, []),
    pitch: parseJson<RunPitch | null>(row.pitch_json ?? null, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function createRun(prospect: ProspectInput, documents: RunDocument[] = [], pitch: RunPitch | null = null): RunRecord {
  const id = randomUUID();
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO runs (id, status, prospect_json, documents_json, pitch_json, created_at, updated_at) VALUES (?, 'queued', ?, ?, ?, ?, ?)`,
    )
    .run(id, JSON.stringify(prospect), JSON.stringify(documents), pitch ? JSON.stringify(pitch) : null, now, now);
  return getRun(id)!;
}

/** Permanently deletes a run and everything it collected (sources, findings, drafts, events). */
export function deleteRun(id: string): boolean {
  return getDb().prepare(`DELETE FROM runs WHERE id = ?`).run(id).changes > 0;
}

const prospectKey = (p: ProspectInput) =>
  JSON.stringify([p.name, p.company, p.companyWebsite, p.linkedinUrl, p.role].map((v) => v?.trim().toLowerCase() ?? ""));

/** A recent, non-failed run for the same prospect details, so the rep can reuse it instead of paying again. */
export function findRecentDuplicate(prospect: ProspectInput, withinHours = 24): RunSummary | null {
  const since = new Date(Date.now() - withinHours * 3_600_000).toISOString();
  const rows = getDb()
    .prepare(`SELECT * FROM runs WHERE created_at >= ? AND status != 'failed' ORDER BY created_at DESC LIMIT 200`)
    .all(since) as RunRow[];
  const key = prospectKey(prospect);
  const match = rows.find((r) => prospectKey(JSON.parse(r.prospect_json) as ProspectInput) === key && parseJson<RunDocument[]>(r.documents_json, []).length === 0);
  return match ? summarise(toRecord(match)) : null;
}

/** Records which process is executing a run, so another process opening the DB won't fail it. */
export function claimRun(id: string): void {
  getDb().prepare(`UPDATE runs SET owner_pid = ? WHERE id = ?`).run(process.pid, id);
}

/** Adds working time from one pipeline execution to the run's total. */
export function addActiveTime(id: string, ms: number): void {
  getDb().prepare(`UPDATE runs SET active_ms = COALESCE(active_ms, 0) + ? WHERE id = ?`).run(Math.max(0, Math.round(ms)), id);
}

export function getRun(id: string): RunRecord | null {
  const row = getDb().prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as RunRow | undefined;
  return row ? toRecord(row) : null;
}

export interface RunPatch {
  status?: RunStatus;
  prospect?: ProspectInput;
  clarifications?: Clarification[];
  identity?: Identity | null;
  hook?: Hook | null;
  limitations?: string[];
  researchLog?: QueryLogEntry[];
  documents?: RunDocument[];
  currentStage?: StageName | null;
  error?: string | null;
  approvedVersion?: number | null;
  sent?: SentRecord | null;
  hold?: ContactHold | null;
  degraded?: Degradation[];
  completedAt?: string | null;
}

const PATCH_COLUMNS: Record<keyof RunPatch, { column: string; json: boolean }> = {
  status: { column: "status", json: false },
  prospect: { column: "prospect_json", json: true },
  clarifications: { column: "clarifications_json", json: true },
  identity: { column: "identity_json", json: true },
  hook: { column: "hook_json", json: true },
  limitations: { column: "limitations_json", json: true },
  researchLog: { column: "research_log_json", json: true },
  documents: { column: "documents_json", json: true },
  currentStage: { column: "current_stage", json: false },
  error: { column: "error", json: false },
  approvedVersion: { column: "approved_version", json: false },
  sent: { column: "sent_json", json: true },
  hold: { column: "hold_json", json: true },
  degraded: { column: "degraded_json", json: true },
  completedAt: { column: "completed_at", json: false },
};

export function updateRun(id: string, patch: RunPatch): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch) as [keyof RunPatch, unknown][]) {
    if (value === undefined) continue;
    const { column, json } = PATCH_COLUMNS[key];
    sets.push(`${column} = ?`);
    values.push(json && value !== null ? JSON.stringify(value) : value);
  }
  sets.push("updated_at = ?");
  values.push(nowIso(), id);
  getDb().prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function addEvent(
  runId: string,
  stage: StageName,
  status: StageStatus,
  message: string,
  detail?: Record<string, unknown>,
): void {
  getDb()
    .prepare(`INSERT INTO run_events (run_id, stage, status, message, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(runId, stage, status, message, detail ? JSON.stringify(detail) : null, nowIso());
  getDb().prepare(`UPDATE runs SET updated_at = ? WHERE id = ?`).run(nowIso(), runId);
}

export function listEvents(runId: string, afterId = 0): RunEvent[] {
  const rows = getDb()
    .prepare(`SELECT * FROM run_events WHERE run_id = ? AND id > ? ORDER BY id`)
    .all(runId, afterId) as EventRow[];
  return rows.map((r) => ({
    id: r.id,
    stage: r.stage,
    status: r.status,
    message: r.message,
    detail: parseJson<Record<string, unknown> | null>(r.detail_json, null),
    createdAt: r.created_at,
  }));
}

/** Current status per stage = the latest event for that stage. */
export function stageStatuses(events: RunEvent[]): Record<StageName, StageStatus> {
  const result = Object.fromEntries(STAGES.map((s) => [s, "pending"])) as Record<StageName, StageStatus>;
  for (const e of events) result[e.stage] = e.status;
  return result;
}

function replaceRows(table: "sources" | "signals", runId: string, items: { id: string }[]) {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM ${table} WHERE run_id = ?`).run(runId);
    const insert = db.prepare(`INSERT INTO ${table} (run_id, id, position, data_json) VALUES (?, ?, ?, ?)`);
    items.forEach((item, i) => insert.run(runId, item.id, i, JSON.stringify(item)));
  })();
}

function listRows<T>(table: "sources" | "signals", runId: string): T[] {
  const rows = getDb()
    .prepare(`SELECT data_json FROM ${table} WHERE run_id = ? ORDER BY position`)
    .all(runId) as { data_json: string }[];
  return rows.map((r) => JSON.parse(r.data_json) as T);
}

export const replaceSources = (runId: string, sources: Source[]) => replaceRows("sources", runId, sources);
export const listSources = (runId: string) => listRows<Source>("sources", runId);
export const replaceSignals = (runId: string, signals: Signal[]) => replaceRows("signals", runId, signals);
export const listSignals = (runId: string) => listRows<Signal>("signals", runId);

function toDraft(r: DraftRow): Draft {
  return {
    id: r.id,
    version: r.version,
    kind: r.kind,
    subject: r.subject,
    body: r.body,
    signalIdsUsed: JSON.parse(r.signal_ids_json) as string[],
    author: r.author,
    guard: JSON.parse(r.guard_json) as GuardReport,
    recipientHint: r.recipient_hint,
    notes: parseJson<DraftNotes | null>(r.notes_json, null),
    createdAt: r.created_at,
  };
}

export function addDraft(
  runId: string,
  draft: {
    kind: DraftKind;
    subject: string;
    body: string;
    signalIdsUsed: string[];
    author: "ai" | "human";
    guard: GuardReport;
    recipientHint?: string | null;
    notes?: DraftNotes | null;
  },
): Draft {
  const db = getDb();
  const { next } = db
    .prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM drafts WHERE run_id = ?`)
    .get(runId) as { next: number };
  const info = db
    .prepare(
      `INSERT INTO drafts (run_id, version, kind, subject, body, signal_ids_json, author, guard_json, recipient_hint, notes_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      next,
      draft.kind,
      draft.subject,
      draft.body,
      JSON.stringify(draft.signalIdsUsed),
      draft.author,
      JSON.stringify(draft.guard),
      draft.recipientHint ?? null,
      draft.notes ? JSON.stringify(draft.notes) : null,
      nowIso(),
    );
  const row = db.prepare(`SELECT * FROM drafts WHERE id = ?`).get(info.lastInsertRowid) as DraftRow;
  return toDraft(row);
}

export function listDrafts(runId: string): Draft[] {
  const rows = getDb().prepare(`SELECT * FROM drafts WHERE run_id = ? ORDER BY version`).all(runId) as DraftRow[];
  return rows.map(toDraft);
}

export function latestDraft(runId: string): Draft | null {
  const row = getDb()
    .prepare(`SELECT * FROM drafts WHERE run_id = ? ORDER BY version DESC LIMIT 1`)
    .get(runId) as DraftRow | undefined;
  return row ? toDraft(row) : null;
}

function summarise(record: RunRecord): RunSummary {
  // One targeted lookup each instead of loading every signal (the dashboard polls this list).
  const hookRow = record.hook
    ? (getDb().prepare(`SELECT data_json FROM signals WHERE run_id = ? AND id = ?`).get(record.id, record.hook.signalId) as { data_json: string } | undefined)
    : undefined;
  const hookSignal = hookRow ? (JSON.parse(hookRow.data_json) as Signal) : undefined;
  const draft = getDb().prepare(`SELECT kind FROM drafts WHERE run_id = ? ORDER BY version DESC LIMIT 1`).get(record.id) as { kind: DraftKind } | undefined;
  return {
    id: record.id,
    status: record.status,
    prospect: record.prospect,
    resolvedLabel: record.identity?.status === "resolved" ? (record.identity.resolvedName ?? record.identity.resolvedCompany) : null,
    currentStage: record.currentStage,
    error: record.error,
    hookType: (hookSignal?.type as SignalType | undefined) ?? null,
    draftKind: draft?.kind ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    activeMs: record.activeMs,
    documentCount: record.documents.length,
    sourceCount: (getDb().prepare(`SELECT COUNT(*) AS n FROM sources WHERE run_id = ?`).get(record.id) as { n: number }).n,
    verifiedCount: (
      getDb().prepare(`SELECT COUNT(*) AS n FROM signals WHERE run_id = ? AND json_extract(data_json, '$.status') = 'verified'`).get(record.id) as { n: number }
    ).n,
  };
}

export function listRuns(options: { status?: RunStatus; limit?: number } = {}): RunSummary[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = (
    options.status
      ? getDb().prepare(`SELECT * FROM runs WHERE status = ? ORDER BY created_at DESC LIMIT ?`).all(options.status, limit)
      : getDb().prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`).all(limit)
  ) as RunRow[];
  return rows.map((r) => summarise(toRecord(r)));
}

/**
 * Full run detail. `forClient` drops each source's captured text (about 90 KB per run): the UI never
 * shows it, and the live view refetches this after every pipeline event.
 */
export function getRunDetail(id: string, options: { forClient?: boolean } = {}): RunDetail | null {
  const record = getRun(id);
  if (!record) return null;
  const events = listEvents(id);
  const sources = listSources(id);
  return {
    ...summarise(record),
    documents: record.documents,
    pitch: pitchOrDefault(record.pitch, getSenderProfile()),
    approvedVersion: record.approvedVersion,
    sent: record.sent,
    hold: record.hold,
    degraded: record.degraded,
    providerCalls: listProviderCalls(id),
    identity: record.identity,
    hook: record.hook,
    limitations: record.limitations,
    researchLog: record.researchLog,
    sources: options.forClient ? sources.map((s) => ({ ...s, text: "" })) : sources,
    signals: listSignals(id),
    drafts: listDrafts(id),
    events,
    stageStatuses: stageStatuses(events),
  };
}

/** A new workspace's profile: every field empty until the rep fills it in. */
export const EMPTY_SENDER_PROFILE: SenderProfile = {
  senderName: "",
  senderRole: "",
  companyName: "",
  companyWebsite: "",
  defaultCta: "",
  sectors: [],
};

/** The saved profile, upgraded from older versions; empty until the rep saves one. */
export function getSenderProfile(): SenderProfile {
  const row = getDb().prepare(`SELECT value_json FROM settings WHERE key = 'sender_profile'`).get() as
    | { value_json: string }
    | undefined;
  return row ? upgradeSenderProfile(JSON.parse(row.value_json), EMPTY_SENDER_PROFILE) : EMPTY_SENDER_PROFILE;
}

export function saveSenderProfile(profile: SenderProfile): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES ('sender_profile', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(JSON.stringify(profile));
}

// ---------------------------------------------------------------------------- uploaded documents

interface DocumentRow {
  id: string;
  scope: DocumentScope;
  name: string;
  kind: DocumentKind;
  text: string;
  meta_json: string;
  created_at: string;
}

export interface DocumentMeta {
  pages: number | null;
  csv: { headers: string[]; rows: string[][] } | null;
}

export interface DocumentRecord extends StoredDocument {
  text: string;
  rows: string[][] | null;
}

function toDocument(row: DocumentRow): DocumentRecord {
  const meta = parseJson<DocumentMeta>(row.meta_json, { pages: null, csv: null });
  return {
    id: row.id,
    scope: row.scope,
    name: row.name,
    kind: row.kind,
    charCount: row.text.length,
    pages: meta.pages,
    csv: meta.csv ? { headers: meta.csv.headers, rowCount: meta.csv.rows.length } : null,
    createdAt: row.created_at,
    text: row.text,
    rows: meta.csv?.rows ?? null,
  };
}

/** Public metadata only (no text), for the browser. */
export function toStoredDocument(doc: DocumentRecord): StoredDocument {
  return {
    id: doc.id,
    scope: doc.scope,
    name: doc.name,
    kind: doc.kind,
    charCount: doc.charCount,
    pages: doc.pages,
    csv: doc.csv,
    createdAt: doc.createdAt,
  };
}

export function createDocument(input: { scope: DocumentScope; name: string; kind: DocumentKind; text: string; meta: DocumentMeta }): DocumentRecord {
  const id = randomUUID();
  getDb()
    .prepare(`INSERT INTO documents (id, scope, name, kind, text, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.scope, input.name, input.kind, input.text, JSON.stringify(input.meta), nowIso());
  return getDocument(id)!;
}

export function getDocument(id: string): DocumentRecord | null {
  const row = getDb().prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRow | undefined;
  return row ? toDocument(row) : null;
}

export function listDocuments(scope: DocumentScope): DocumentRecord[] {
  return (getDb().prepare(`SELECT * FROM documents WHERE scope = ? ORDER BY created_at DESC`).all(scope) as DocumentRow[]).map(toDocument);
}

export function deleteDocument(id: string): boolean {
  return getDb().prepare(`DELETE FROM documents WHERE id = ?`).run(id).changes > 0;
}

// ---------------------------------------------------------------------------- Gmail connection

/** Server-side only: holds OAuth tokens. Never return this shape to the browser. */
export interface GmailConnection {
  email: string;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  connectedAt: string;
  autoSendOnApprove: boolean;
  /** Scopes Google granted. Absent on connections saved before tracking existed (send-only). */
  scopes?: string[];
}

export function getGmailConnection(): GmailConnection | null {
  const row = getDb().prepare(`SELECT value_json FROM settings WHERE key = 'gmail'`).get() as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as GmailConnection) : null;
}

export function saveGmailConnection(connection: GmailConnection): void {
  getDb()
    .prepare(`INSERT INTO settings (key, value_json) VALUES ('gmail', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`)
    .run(JSON.stringify(connection));
}

export function deleteGmailConnection(): void {
  getDb().prepare(`DELETE FROM settings WHERE key = 'gmail'`).run();
}

/** The Google account that owns this workspace: the first to sign in, when ALLOWED_EMAILS is unset. */
export function getOwnerEmail(): string | null {
  const row = getDb().prepare(`SELECT value_json FROM settings WHERE key = 'owner'`).get() as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as { email: string }).email : null;
}

export function setOwnerEmail(email: string): void {
  getDb()
    .prepare(`INSERT INTO settings (key, value_json) VALUES ('owner', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`)
    .run(JSON.stringify({ email }));
}

const EMPTY_CONTACT_RULES: ContactRules = { doNotContact: [], relationships: [] };

export function getContactRules(): ContactRules {
  const row = getDb().prepare(`SELECT value_json FROM settings WHERE key = 'contact_rules'`).get() as { value_json: string } | undefined;
  return row ? { ...EMPTY_CONTACT_RULES, ...(JSON.parse(row.value_json) as Partial<ContactRules>) } : EMPTY_CONTACT_RULES;
}

export function saveContactRules(rules: ContactRules): void {
  getDb()
    .prepare(`INSERT INTO settings (key, value_json) VALUES ('contact_rules', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`)
    .run(JSON.stringify(rules));
}

/** Every run with a sent record, newest send first (for tracking and the Outreach page). */
export function listSentRuns(): { runId: string; sent: SentRecord }[] {
  const rows = getDb().prepare(`SELECT id, sent_json FROM runs WHERE sent_json IS NOT NULL`).all() as { id: string; sent_json: string }[];
  return rows
    .map((r) => ({ runId: r.id, sent: JSON.parse(r.sent_json) as SentRecord }))
    .sort((a, b) => b.sent.sentAt.localeCompare(a.sent.sentAt));
}

// ---------------------------------------------------------------------------
// Resilience: provider call log and circuit-breaker state.

type ProviderCallRow = {
  id: number;
  stage: string | null;
  task: string;
  provider: string;
  model: string | null;
  outcome: ProviderCall["outcome"];
  error_kind: string | null;
  message: string | null;
  fallback_from: string | null;
  duration_ms: number;
  created_at: string;
};

export function addProviderCall(call: Omit<ProviderCall, "id" | "createdAt"> & { runId: string | null }): void {
  getDb()
    .prepare(
      `INSERT INTO provider_calls (run_id, stage, task, provider, model, outcome, error_kind, message, fallback_from, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(call.runId, call.stage, call.task, call.provider, call.model, call.outcome, call.errorKind, call.message, call.fallbackFrom, Math.round(call.durationMs), new Date().toISOString());
}

export function listProviderCalls(runId: string): ProviderCall[] {
  const rows = getDb().prepare(`SELECT * FROM provider_calls WHERE run_id = ? ORDER BY id`).all(runId) as ProviderCallRow[];
  return rows.map((r) => ({
    id: r.id,
    stage: r.stage as ProviderCall["stage"],
    task: r.task,
    provider: r.provider,
    model: r.model,
    outcome: r.outcome,
    errorKind: r.error_kind,
    message: r.message,
    fallbackFrom: r.fallback_from,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  }));
}

/** Calls and failures per provider since a time (for the status panel). Drops entries older than 30 days. */
export function providerCallCounts(sinceIso: string): Record<string, { calls: number; failures: number }> {
  getDb().prepare(`DELETE FROM provider_calls WHERE created_at < ?`).run(new Date(Date.now() - 30 * 86_400_000).toISOString());
  const rows = getDb()
    .prepare(`SELECT provider, SUM(outcome = 'ok') AS ok, SUM(outcome = 'error') AS failed FROM provider_calls WHERE created_at >= ? GROUP BY provider`)
    .all(sinceIso) as { provider: string; ok: number; failed: number }[];
  return Object.fromEntries(rows.map((r) => [r.provider, { calls: r.ok + r.failed, failures: r.failed }]));
}

type HealthRow = {
  provider: string;
  down_until: string | null;
  consecutive_failures: number;
  last_error: string | null;
  last_error_kind: string | null;
  last_ok_at: string | null;
  updated_at: string;
};

const toHealth = (r: HealthRow): ProviderHealth => ({
  provider: r.provider,
  downUntil: r.down_until,
  consecutiveFailures: r.consecutive_failures,
  lastError: r.last_error,
  lastErrorKind: r.last_error_kind,
  lastOkAt: r.last_ok_at,
  updatedAt: r.updated_at,
});

export function getProviderHealth(provider: string): ProviderHealth | null {
  const row = getDb().prepare(`SELECT * FROM provider_health WHERE provider = ?`).get(provider) as HealthRow | undefined;
  return row ? toHealth(row) : null;
}

export function listProviderHealth(): ProviderHealth[] {
  return (getDb().prepare(`SELECT * FROM provider_health ORDER BY provider`).all() as HealthRow[]).map(toHealth);
}

export function saveProviderHealth(h: ProviderHealth): void {
  getDb()
    .prepare(
      `INSERT INTO provider_health (provider, down_until, consecutive_failures, last_error, last_error_kind, last_ok_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET down_until = excluded.down_until, consecutive_failures = excluded.consecutive_failures,
         last_error = excluded.last_error, last_error_kind = excluded.last_error_kind, last_ok_at = excluded.last_ok_at, updated_at = excluded.updated_at`,
    )
    .run(h.provider, h.downUntil, h.consecutiveFailures, h.lastError, h.lastErrorKind, h.lastOkAt, h.updatedAt);
}

export function clearProviderHealth(provider?: string): void {
  if (provider) getDb().prepare(`DELETE FROM provider_health WHERE provider = ?`).run(provider);
  else getDb().prepare(`DELETE FROM provider_health`).run();
}
