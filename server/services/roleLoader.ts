import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.js";
import type { LoadedRole, RoleId } from "../types.js";
import { nowIso, sha256 } from "../utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const roleRoot =
  process.env.ROUND_TABLE_ROLE_DIR ||
  path.resolve(__dirname, "..", "prompts", "roles");

const ROLE_FILES: Record<RoleId, string> = {
  "context-guide": "context-guide.md",
  "role-architect": "role-architect.md",
  moderator: "moderator.md",
  supporter: "supporter.md",
  opponent: "opponent.md",
  "practice-advisor": "practice-advisor.md",
  synthesizer: "synthesizer.md"
};

export function loadRole(roleId: RoleId): LoadedRole {
  const fileName = ROLE_FILES[roleId];
  const fullPath = path.join(roleRoot, fileName);
  const content = fs.readFileSync(fullPath, "utf8");
  const versionMatch = content.match(/^version:\s*(.+)$/m);
  const role: LoadedRole = {
    id: roleId,
    content,
    hash: sha256(content),
    version: versionMatch?.[1]?.trim() || "v1",
    path: `roles/${fileName}`
  };

  db.prepare(
    `INSERT INTO role_definitions (id, version, md_path, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       version = excluded.version,
       md_path = excluded.md_path,
       content_hash = excluded.content_hash,
       updated_at = excluded.updated_at`
  ).run(role.id, role.version, role.path, role.hash, nowIso());

  return role;
}

export function listRoles() {
  return (Object.keys(ROLE_FILES) as RoleId[]).map(loadRole);
}
