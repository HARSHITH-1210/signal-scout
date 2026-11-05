import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  prospect_json TEXT NOT NULL,
  clarifications_json TEXT NOT NULL DEFAULT '[]',
  identity_json TEXT,
  hook_json TEXT,
  limitations_json TEXT NOT NULL DEFAULT '[]',
  research_log_json TEXT NOT NULL DEFAULT '[]',
  current_stage TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run ON run_events(run_id, id);

CREATE TABLE IF NOT EXISTS sources (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS signals (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  signal_ids_json TEXT NOT NULL,
  author TEXT NOT NULL,
  guard_json TEXT NOT NULL,
  recipient_hint TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drafts_run ON drafts(run_id, version);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
}

function addColumn(db: Database.Database, table: string, column: string, definition: string) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Ordered, idempotent migrations tracked with SQLite's user_version. Each step checks before it changes,
 * so databases created before versioning existed upgrade cleanly too.
 */
const MIGRATIONS: ((db: Database.Database) => void)[] = [
  // 1: draft recipient hint (runs without a named person)
  (db) => addColumn(db, "drafts", "recipient_hint", "TEXT"),
  // 2: uploaded documents, run ownership for safe restart recovery, approval integrity, draft notes
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_scope ON documents(scope, created_at DESC);`);
    addColumn(db, "runs", "documents_json", "TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, "runs", "owner_pid", "INTEGER");
    addColumn(db, "runs", "approved_version", "INTEGER");
    addColumn(db, "runs", "active_ms", "INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "drafts", "notes_json", "TEXT");
  },
  // 3: Gmail delivery record for approved drafts
  (db) => addColumn(db, "runs", "sent_json", "TEXT"),
  // 4: contact-list hold (opt-out or existing relationship)
  (db) => addColumn(db, "runs", "hold_json", "TEXT"),
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db: Database.Database) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      MIGRATIONS[version](db);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

type GlobalWithDb = typeof globalThis & { __signalScoutDb?: Database.Database };

function open(file: string): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Process-wide connection (cached on globalThis so dev hot-reload doesn't open new handles). */
export function getDb(): Database.Database {
  const g = globalThis as GlobalWithDb;
  if (!g.__signalScoutDb) {
    const { dataDir } = getConfig();
    fs.mkdirSync(dataDir, { recursive: true });
    g.__signalScoutDb = open(path.join(dataDir, "app.db"));
    recoverInterruptedRuns(g.__signalScoutDb);
  }
  return g.__signalScoutDb;
}

/** Tests use an isolated in-memory database. */
export function useInMemoryDbForTests(): Database.Database {
  const g = globalThis as GlobalWithDb;
  g.__signalScoutDb?.close();
  g.__signalScoutDb = open(":memory:");
  return g.__signalScoutDb;
}

/** True if a process with this pid is still alive (signal 0 only checks; it sends nothing). */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const STALE_RUN_MS = 30 * 60_000;

/**
 * Runs whose owning process has died can't resume their in-memory work, so they are marked failed.
 * Runs owned by another live process (e.g. the server while `npm run smoke` opens the database) are
 * left alone, unless they've shown no progress for 30 minutes.
 */
export function recoverInterruptedRuns(db: Database.Database, isAlive: (pid: number) => boolean = processAlive) {
  const now = new Date();
  const rows = db.prepare(`SELECT id, owner_pid, updated_at FROM runs WHERE status IN ('queued', 'running')`).all() as {
    id: string;
    owner_pid: number | null;
    updated_at: string;
  }[];
  const fail = db.prepare(
    `UPDATE runs SET status = 'failed', error = 'The server restarted while this run was in progress. Start a new run or retry the draft.',
     updated_at = ?, completed_at = ? WHERE id = ?`,
  );
  for (const row of rows) {
    const ownedElsewhere = row.owner_pid !== null && row.owner_pid !== process.pid && isAlive(row.owner_pid);
    const stale = now.getTime() - new Date(row.updated_at).getTime() > STALE_RUN_MS;
    if (!ownedElsewhere || stale) fail.run(now.toISOString(), now.toISOString(), row.id);
  }
}
