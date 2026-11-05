import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, recoverInterruptedRuns, SCHEMA_VERSION, useInMemoryDbForTests } from "@/lib/db/schema";

describe("schema", () => {
  it("upgrades a database created before versioned migrations (F-24)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scout-schema-"));
    const legacy = new Database(path.join(dir, "app.db"));
    legacy.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, prospect_json TEXT NOT NULL, clarifications_json TEXT NOT NULL DEFAULT '[]',
      identity_json TEXT, hook_json TEXT, limitations_json TEXT NOT NULL DEFAULT '[]', research_log_json TEXT NOT NULL DEFAULT '[]', current_stage TEXT, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT);
      CREATE TABLE drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL,
      body TEXT NOT NULL, signal_ids_json TEXT NOT NULL, author TEXT NOT NULL, guard_json TEXT NOT NULL, recipient_hint TEXT, created_at TEXT NOT NULL);`);
    legacy.close();

    const saved = process.env.DATA_DIR;
    const g = globalThis as typeof globalThis & { __signalScoutDb?: Database.Database };
    g.__signalScoutDb?.close();
    g.__signalScoutDb = undefined;
    process.env.DATA_DIR = dir; // set before getDb() runs, and only restored after it has closed
    try {
      const upgraded = getDb();
      expect(upgraded.name).toBe(path.join(dir, "app.db"));
      expect(upgraded.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
      const cols = (t: string) => (upgraded.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      expect(cols("runs")).toEqual(expect.arrayContaining(["documents_json", "owner_pid", "approved_version", "active_ms"]));
      expect(cols("drafts")).toEqual(expect.arrayContaining(["recipient_hint", "notes_json"]));
      expect(cols("documents")).toContain("text");
    } finally {
      (g.__signalScoutDb as Database.Database | undefined)?.close();
      g.__signalScoutDb = undefined;
      if (saved === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails runs from dead processes but leaves another live process's runs alone (F-10)", () => {
    const db = useInMemoryDbForTests();
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const insert = db.prepare(`INSERT INTO runs (id, status, prospect_json, owner_pid, created_at, updated_at) VALUES (?, 'running', '{}', ?, ?, ?)`);
    insert.run("dead", 111, now, now);
    insert.run("alive", 222, now, now);
    insert.run("alive-but-stuck", 222, old, old);
    insert.run("legacy", null, now, now);
    recoverInterruptedRuns(db, (pid) => pid === 222);
    const status = (id: string) => (db.prepare(`SELECT status FROM runs WHERE id = ?`).get(id) as { status: string }).status;
    expect(status("dead")).toBe("failed");
    expect(status("alive")).toBe("running");
    expect(status("alive-but-stuck")).toBe("failed");
    expect(status("legacy")).toBe("failed");
  });
});
