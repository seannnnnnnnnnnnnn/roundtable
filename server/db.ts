import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromJson, nowIso, toJson } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.ROUND_TABLE_DATA_DIR || path.join(rootDir, "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_rules TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      user_input TEXT NOT NULL,
      input_type TEXT NOT NULL DEFAULT 'text',
      status TEXT NOT NULL DEFAULT 'legacy',
      intent_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS audit_results (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL,
      result_type TEXT NOT NULL,
      input_action TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (turn_id) REFERENCES turns(id)
    );

    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      provider TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key_ref TEXT NOT NULL,
      model TEXT NOT NULL,
      api_style TEXT NOT NULL DEFAULT 'chat-completions',
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      streaming INTEGER NOT NULL DEFAULT 0,
      json_output INTEGER NOT NULL DEFAULT 1,
      tool_calling INTEGER NOT NULL DEFAULT 0,
      multimodal INTEGER NOT NULL DEFAULT 0,
      timeout_ms INTEGER NOT NULL DEFAULT 60000,
      retry_count INTEGER NOT NULL DEFAULT 1,
      fallback_provider_id TEXT,
      status TEXT NOT NULL DEFAULT 'disabled',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discussions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      user_input TEXT NOT NULL,
      status TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      questions_json TEXT NOT NULL DEFAULT '[]',
      error_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS discussion_role_outputs (
      id TEXT PRIMARY KEY,
      discussion_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      headline TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      content_json TEXT NOT NULL,
      raw_content_json TEXT NOT NULL DEFAULT '{}',
      prompt_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL,
      UNIQUE(discussion_id, role_id, phase),
      FOREIGN KEY (discussion_id) REFERENCES discussions(id)
    );

    CREATE TABLE IF NOT EXISTS discussion_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discussion_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (discussion_id) REFERENCES discussions(id)
    );

    CREATE TABLE IF NOT EXISTS model_call_metrics (
      id TEXT PRIMARY KEY,
      discussion_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      error_name TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      usage_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (discussion_id) REFERENCES discussions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_model_call_metrics_discussion
      ON model_call_metrics (discussion_id, started_at);

    CREATE TABLE IF NOT EXISTS discussion_versions (
      id TEXT PRIMARY KEY,
      discussion_id TEXT NOT NULL,
      version_type TEXT NOT NULL,
      label TEXT NOT NULL,
      result_json TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (discussion_id) REFERENCES discussions(id)
    );

    CREATE TABLE IF NOT EXISTS role_definitions (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      md_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS archive_events (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  const roleOutputColumns = db
    .prepare("PRAGMA table_info(discussion_role_outputs)")
    .all() as Array<{ name: string }>;
  if (!roleOutputColumns.some((column) => column.name === "raw_content_json")) {
    db.exec(
      "ALTER TABLE discussion_role_outputs ADD COLUMN raw_content_json TEXT NOT NULL DEFAULT '{}'"
    );
  }

  seedProvider();
  const restartTime = nowIso();
  db.prepare(
    `UPDATE model_call_metrics
     SET status = 'interrupted',
         completed_at = ?,
         duration_ms = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)),
         error_name = 'ProcessRestart',
         error_message = '服务重启时调用仍未结束'
     WHERE status = 'running'`
  ).run(restartTime, restartTime);
  db.prepare(
    `UPDATE discussions
     SET status = 'failed',
         error_json = ?,
         updated_at = ?
     WHERE status IN ('running', 'preparing', 'designing_roles')`
  ).run(toJson({ message: "服务重启，已保存完成步骤，可从失败阶段重试。" }), nowIso());
}

function seedProvider() {
  const now = nowIso();
  const openai = db.prepare("SELECT id FROM model_providers WHERE id = ?").get("provider_openai_compatible");
  if (!openai) {
    db.prepare(
      `INSERT INTO model_providers (
        id, label, provider, base_url, api_key_ref, model, api_style,
        capabilities_json, streaming, json_output, tool_calling, multimodal,
        timeout_ms, retry_count, fallback_provider_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'chat-completions', ?, 0, 1, 0, 0, 60000, 1, NULL, ?, ?, ?)`
    ).run(
      "provider_openai_compatible",
      "GPT-5.5",
      "openai-compatible",
      "https://api.openai.com/v1",
      "OPENAI_COMPATIBLE_API_KEY",
      "gpt-5.5",
      toJson({ json: true, vision: false }),
      process.env.OPENAI_COMPATIBLE_API_KEY ? "active" : "disabled",
      now,
      now
    );
  }

  db.prepare("UPDATE model_providers SET status = 'disabled', updated_at = ? WHERE provider = 'mock'").run(now);
}

export function rowToJson<T extends Record<string, unknown>>(row: T) {
  const next: Record<string, unknown> = { ...row };
  for (const key of Object.keys(next)) {
    if (
      key.endsWith("_json") ||
      key === "project_rules" ||
      key === "content"
    ) {
      const value = next[key];
      if (typeof value === "string") {
        next[key] = fromJson(value, value);
      }
    }
  }
  return next;
}

export function providerView(row: any) {
  return {
    id: row.id,
    label: row.label,
    provider: row.provider,
    base_url: row.base_url,
    api_key_ref: row.api_key_ref,
    model: row.model,
    status: row.status,
    has_env_key: Boolean(row.api_key_ref && process.env[row.api_key_ref])
  };
}
