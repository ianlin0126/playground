import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";

let db: Database;

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
}

export function insertTurn(direction: "kid" | "guardian", message: string, flagged = false): void {
  db.prepare("INSERT INTO turns (ts, direction, message, flagged) VALUES (?, ?, ?, ?)").run(
    new Date().toISOString(),
    direction,
    message,
    flagged ? 1 : 0
  );
}

export function getRecentTurns(limit = 50): Array<{ id: number; ts: string; direction: string; message: string; flagged: number }> {
  return db.prepare("SELECT * FROM turns ORDER BY id DESC LIMIT ?").all(limit) as any;
}

export function flagTurn(id: number): void {
  db.prepare("UPDATE turns SET flagged = 1 WHERE id = ?").run(id);
}
