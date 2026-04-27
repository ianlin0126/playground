import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";

type Turn = { id: number; ts: string; direction: string; message: string; flagged: number };
type Summary = { id: number; ts: string; content: string };

let db: Database | undefined;
let stmtInsert: ReturnType<Database["prepare"]>;
let stmtRecent: ReturnType<Database["prepare"]>;
let stmtFlag: ReturnType<Database["prepare"]>;
let stmtInsertSummary: ReturnType<Database["prepare"]>;
let stmtLatestSummary: ReturnType<Database["prepare"]>;

function getDb(): Database {
  if (!db) throw new Error("DB not initialised — call initDb() before using db functions");
  return db;
}

export function initDb(playgroundDir: string): void {
  const dbDir = join(playgroundDir, ".guardian");
  mkdirSync(dbDir, { recursive: true });
  db = new Database(join(dbDir, "conversations.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      direction TEXT NOT NULL,
      message TEXT NOT NULL,
      flagged INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS summaries (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ts      TEXT NOT NULL,
      content TEXT NOT NULL
    );
  `);
  stmtInsert = db.prepare("INSERT INTO turns (ts, direction, message, flagged) VALUES (?, ?, ?, ?)");
  stmtRecent = db.prepare("SELECT * FROM turns ORDER BY id DESC LIMIT ?");
  stmtFlag = db.prepare("UPDATE turns SET flagged = 1 WHERE id = ?");
  stmtInsertSummary = db.prepare("INSERT INTO summaries (ts, content) VALUES (?, ?)");
  stmtLatestSummary = db.prepare("SELECT * FROM summaries ORDER BY id DESC LIMIT 1");
}

export function insertTurn(direction: "kid" | "guardian", message: string, flagged = false): void {
  getDb();
  stmtInsert.run(new Date().toISOString(), direction, message, flagged ? 1 : 0);
}

export function getRecentTurns(limit = 50): Turn[] {
  getDb();
  return stmtRecent.all(limit) as Turn[];
}

export function flagTurn(id: number): void {
  getDb();
  stmtFlag.run(id);
}

export function upsertSummary(content: string): void {
  getDb();
  stmtInsertSummary.run(new Date().toISOString(), content);
}

export function getLatestSummary(): Summary | null {
  getDb();
  return (stmtLatestSummary.get() as Summary | undefined) ?? null;
}
