/**
 * db.ts — SQLite 持久化层
 *
 * 三张表：
 *   runs       — 每次运行的顶层信息（topic、文档标题/URL、状态、汇总统计）
 *   run_events — 该次运行的全量 SSE 事件（供前端历史回放）
 *   run_steps  — 每个 agent 步骤的 token 用量和耗时（供统计面板）
 *
 * 使用 better-sqlite3 同步 API，无需 await，调用点无感知。
 * DB 文件路径：data/history.db（由 .gitignore 排除，data/.gitkeep 保留目录）
 */

import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { PipelineEvent } from "./server.js";

const DB_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/history.db",
);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL"); // 写入性能优化

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id               TEXT    PRIMARY KEY,
    topic            TEXT    NOT NULL,
    doc_title        TEXT,
    doc_url          TEXT,
    doc_folder       TEXT,
    status           TEXT    NOT NULL DEFAULT 'running',
    total_tokens     INTEGER NOT NULL DEFAULT 0,
    total_duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS run_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     TEXT    NOT NULL,
    seq        INTEGER NOT NULL,
    event_json TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS run_steps (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id        TEXT    NOT NULL,
    role          TEXT    NOT NULL,
    label         TEXT    NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    duration_ms   INTEGER NOT NULL DEFAULT 0,
    started_at    INTEGER NOT NULL
  );
`);

// ── 运行记录 CRUD ─────────────────────────────────────────────────────────────

const stmtCreateRun = db.prepare(
  `INSERT INTO runs (id, topic, status, created_at) VALUES (?, ?, 'running', ?)`,
);
export function dbCreateRun(id: string, topic: string, createdAt: number): void {
  stmtCreateRun.run(id, topic, createdAt);
}

const stmtSetDocUrl = db.prepare(
  `UPDATE runs SET doc_url = ?, doc_folder = ? WHERE id = ?`,
);
export function dbSetDocUrl(id: string, url: string, folder: string): void {
  stmtSetDocUrl.run(url, folder, id);
}

const stmtSetDocTitle = db.prepare(
  `UPDATE runs SET doc_title = ? WHERE id = ?`,
);
export function dbSetDocTitle(id: string, title: string): void {
  stmtSetDocTitle.run(title, id);
}

const stmtSetStatus = db.prepare(
  `UPDATE runs SET status = ? WHERE id = ?`,
);
export function dbSetStatus(id: string, status: "done" | "error"): void {
  stmtSetStatus.run(status, id);
}

const stmtIncrTotals = db.prepare(
  `UPDATE runs SET total_tokens = total_tokens + ?, total_duration_ms = total_duration_ms + ? WHERE id = ?`,
);
export function dbIncrTotals(id: string, tokens: number, durationMs: number): void {
  stmtIncrTotals.run(tokens, durationMs, id);
}

/** 列出历史运行（最新在前，默认 50 条，可传 q 关键词搜索 topic/doc_title）*/
export function dbListRuns(opts: { limit?: number; q?: string } = {}): HistoryItem[] {
  const limit = opts.limit ?? 50;
  const cols = `id, topic,
    doc_title AS docTitle, doc_url AS docUrl, doc_folder AS docFolder,
    status, total_tokens AS totalTokens, total_duration_ms AS totalDurationMs,
    created_at AS createdAt`;
  if (opts.q && opts.q.trim()) {
    const kw = `%${opts.q.trim()}%`;
    return db
      .prepare(
        `SELECT ${cols} FROM runs WHERE topic LIKE ? OR doc_title LIKE ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(kw, kw, limit) as HistoryItem[];
  }
  return db
    .prepare(`SELECT ${cols} FROM runs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as HistoryItem[];
}

/** 删除运行记录及其所有事件和步骤（级联删除） */
const stmtDelEvents = db.prepare(`DELETE FROM run_events WHERE run_id = ?`);
const stmtDelSteps  = db.prepare(`DELETE FROM run_steps  WHERE run_id = ?`);
const stmtDelRun    = db.prepare(`DELETE FROM runs        WHERE id     = ?`);
export function dbDeleteRun(id: string): void {
  stmtDelEvents.run(id);
  stmtDelSteps.run(id);
  stmtDelRun.run(id);
}

// ── 事件 ──────────────────────────────────────────────────────────────────────

const stmtPushEvent = db.prepare(
  `INSERT INTO run_events (run_id, seq, event_json) VALUES (?, ?, ?)`,
);
export function dbPushEvent(runId: string, seq: number, event: PipelineEvent): void {
  stmtPushEvent.run(runId, seq, JSON.stringify(event));
}

export function dbGetEvents(runId: string): PipelineEvent[] {
  const rows = db
    .prepare(`SELECT event_json FROM run_events WHERE run_id = ? ORDER BY seq ASC`)
    .all(runId) as { event_json: string }[];
  return rows.map((r) => JSON.parse(r.event_json) as PipelineEvent);
}

// ── 步骤统计 ──────────────────────────────────────────────────────────────────

const stmtAddStep = db.prepare(
  `INSERT INTO run_steps (run_id, role, label, input_tokens, output_tokens, duration_ms, started_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
export function dbAddStep(
  runId: string,
  role: string,
  label: string,
  inputTokens: number,
  outputTokens: number,
  durationMs: number,
  startedAt: number,
): void {
  stmtAddStep.run(runId, role, label, inputTokens, outputTokens, durationMs, startedAt);
}

export function dbGetSteps(runId: string): StepStat[] {
  return db
    .prepare(
      `SELECT role, label,
         input_tokens AS inputTokens, output_tokens AS outputTokens,
         duration_ms AS durationMs, started_at AS startedAt
       FROM run_steps WHERE run_id = ? ORDER BY startedAt ASC`,
    )
    .all(runId) as StepStat[];
}

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface HistoryItem {
  id: string;
  topic: string;
  docTitle: string | null;
  docUrl: string | null;
  docFolder: string | null;
  status: "running" | "done" | "error";
  totalTokens: number;
  totalDurationMs: number;
  createdAt: number;
}

export interface StepStat {
  role: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  startedAt: number;
}
