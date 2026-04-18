import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";

type Turn = { id: number; ts: string; direction: string; message: string; flagged: number };

let db: Database | undefined;
let stmtInsert: ReturnType<Database["prepare"]>;
let stmtRecent: ReturnType<Database["prepare"]>;
let stmtFlag: ReturnType<Database["prepare"]>;

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
    )
  `);
  stmtInsert = db.prepare("INSERT INTO turns (ts, direction, message, flagged) VALUES (?, ?, ?, ?)");
  stmtRecent = db.prepare("SELECT * FROM turns ORDER BY id DESC LIMIT ?");
  stmtFlag = db.prepare("UPDATE turns SET flagged = 1 WHERE id = ?");
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
