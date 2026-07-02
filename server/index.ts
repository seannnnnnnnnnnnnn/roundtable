import "dotenv/config";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { db, initDb, providerView, rowToJson } from "./db.js";
import {
  answerContext,
  configureDiscussionRoles,
  createDiscussion,
  getDiscussionState,
  getSessionDiscussions,
  listDiscussionEvents,
  pauseDiscussion,
  retryDiscussion,
  runDiscussionAction,
  setCurrentVersion,
  startDiscussion,
  subscribeDiscussion
} from "./services/roundtableOrchestrator.js";
import { listRoles } from "./services/roleLoader.js";
import {
  getDiscussionModelTimings,
  ProviderUnavailableError
} from "./services/llmGateway.js";
import { configureProvider } from "./services/providerConfig.js";
import { id, nowIso, toJson } from "./utils.js";

initDb();
listRoles();

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: (origin, callback) => {
    if (
      !origin ||
      /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
    ) {
      callback(null, true);
      return;
    }
    callback(new Error("不允许的来源。"), false);
  }
});

const staticDir = process.env.ROUND_TABLE_STATIC_DIR;
if (staticDir && fs.existsSync(staticDir)) {
  await app.register(staticPlugin, {
    root: path.resolve(staticDir),
    prefix: "/"
  });
}

app.setErrorHandler((error, _request, reply) => {
  const status = error instanceof ProviderUnavailableError ? 503 : 400;
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : "请求处理失败。";
  reply.status(status).send({
    error: name,
    message
  });
});

app.get("/api/health", async () => ({
  ok: true,
  service: "roundtable",
  version: process.env.ROUND_TABLE_APP_VERSION || "0.1.0",
  time: nowIso()
}));

app.get("/api/app-state", async () => {
  const projects = db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as any[];
  const sessions = db.prepare("SELECT * FROM sessions ORDER BY created_at DESC").all() as any[];
  const providers = db.prepare("SELECT * FROM model_providers ORDER BY created_at").all() as any[];
  const roles = db.prepare("SELECT * FROM role_definitions ORDER BY id").all() as any[];
  return {
    projects: projects.map(rowToJson),
    sessions,
    providers: providers.map(providerView),
    roles
  };
});

app.post("/api/projects", async (request) => {
  const body = z.object({ name: z.string().trim().min(1) }).parse(request.body);
  const projectId = id("project");
  const now = nowIso();
  db.prepare(
    `INSERT INTO projects (id, name, project_rules, status, created_at, updated_at)
     VALUES (?, ?, '{}', 'active', ?, ?)`
  ).run(projectId, body.name, now, now);
  return { project: rowToJson(db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any) };
});

app.patch("/api/projects/:projectId/status", async (request) => {
  const params = z.object({ projectId: z.string() }).parse(request.params);
  const body = z.object({ status: z.enum(["active", "archived"]) }).parse(request.body);
  db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(
    body.status,
    nowIso(),
    params.projectId
  );
  recordArchive("project", params.projectId, body.status);
  return { ok: true };
});

app.post("/api/projects/:projectId/sessions", async (request) => {
  const params = z.object({ projectId: z.string() }).parse(request.params);
  const body = z.object({ title: z.string().trim().min(1) }).parse(request.body);
  const project = db
    .prepare("SELECT id FROM projects WHERE id = ? AND status = 'active'")
    .get(params.projectId);
  if (!project) throw new Error("项目不存在或已归档。");
  const sessionId = id("session");
  const now = nowIso();
  db.prepare(
    `INSERT INTO sessions (id, project_id, title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(sessionId, params.projectId, body.title, now, now);
  return { session: db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) };
});

app.patch("/api/sessions/:sessionId/status", async (request) => {
  const params = z.object({ sessionId: z.string() }).parse(request.params);
  const body = z.object({ status: z.enum(["active", "archived"]) }).parse(request.body);
  db.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?").run(
    body.status,
    nowIso(),
    params.sessionId
  );
  recordArchive("session", params.sessionId, body.status);
  return { ok: true };
});

app.get("/api/sessions/:sessionId/discussions", async (request) => {
  const params = z.object({ sessionId: z.string() }).parse(request.params);
  return { discussions: getSessionDiscussions(params.sessionId) };
});

app.post("/api/discussions", async (request) => {
  const body = z
    .object({
      project_id: z.string(),
      session_id: z.string(),
      user_input: z.string().trim().min(1)
    })
    .parse(request.body);
  return createDiscussion({
    projectId: body.project_id,
    sessionId: body.session_id,
    userInput: body.user_input
  });
});

app.get("/api/discussions/:discussionId", async (request) => {
  const params = z.object({ discussionId: z.string() }).parse(request.params);
  return getDiscussionState(params.discussionId);
});

app.get("/api/discussions/:discussionId/timings", async (request) => {
  const params = z.object({ discussionId: z.string() }).parse(request.params);
  getDiscussionState(params.discussionId);
  return getDiscussionModelTimings(params.discussionId);
});

app.post("/api/discussions/:discussionId/context-answers", async (request) => {
  const params = z.object({ discussionId: z.string() }).parse(request.params);
  const body = z
    .object({
      answers: z.array(
        z.object({
          question_id: z.string(),
          answer_type: z.enum(["option", "system", "other", "skip"]),
          value: z.string().optional()
        })
      )
    })
    .parse(request.body);
  return answerContext(params.discussionId, body.answers);
});

app.put("/api/discussions/:discussionId/roles", async (request) => {
  const params = z.object({ discussionId: z.string() }).parse(request.params);
  const body = z
    .object({
      roles: z.array(
        z.object({
          role_id: z.enum([
            "context-guide",
            "moderator",
            "supporter",
            "opponent",
            "practice-advisor",
            "synthesizer"
          ]),
          enabled: z.boolean(),
          content: z.string().min(40).max(30000)
        })
      ).length(6)
    })
    .parse(request.body);
  return configureDiscussionRoles(params.discussionId, body.roles);
});

app.post("/api/discussions/:discussionId/run", async (request, reply) => {
  const params = z.object({ discussionId: z.string() }).parse(request.params);
  reply.status(202);
  return startDiscussion(params.discussionId);
});

app.post("/api/discussions/:discussionId/retry", async (request, reply) => {
  const params = z.object({ discussionId: z.string() }).parse(request.params);
  reply.status(202);
  return retryDiscussion(params.discussionId);
});

app.post("/api/discussions/:discussionId/pause", async (request) => {
  const params = z.object({ discussionId: z.string() }).parse(request.params);
  return pauseDiscussion(params.discussionId);
});

app.post("/api/discussions/:discussionId/actions", async (request) => {
  const params = z.object({ discussionId: z.string() }).parse(request.params);
  const body = z
    .object({
      action_type: z.enum(["deep_risk", "safer", "usable_version"]),
      target: z.string().optional().default("")
    })
    .parse(request.body);
  return runDiscussionAction(params.discussionId, body.action_type, body.target);
});

app.post("/api/discussions/:discussionId/versions/:versionId/select", async (request) => {
  const params = z
    .object({ discussionId: z.string(), versionId: z.string() })
    .parse(request.params);
  return setCurrentVersion(params.discussionId, params.versionId);
});

app.get("/api/discussions/:discussionId/events", async (request, reply) => {
  const params = z.object({ discussionId: z.string() }).parse(request.params);
  const query = z.object({ after: z.coerce.number().int().min(0).optional() }).parse(request.query);
  const lastEventHeader = Number(request.headers["last-event-id"] || 0);
  const after = Math.max(query.after || 0, Number.isFinite(lastEventHeader) ? lastEventHeader : 0);

  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });

  const writeEvent = (event: ReturnType<typeof listDiscussionEvents>[number]) => {
    reply.raw.write(`id: ${event.id}\n`);
    reply.raw.write(`event: ${event.type}\n`);
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  for (const event of listDiscussionEvents(params.discussionId, after)) writeEvent(event);
  const unsubscribe = subscribeDiscussion(params.discussionId, writeEvent);
  const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15000);
  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.get("/api/archive", async () => {
  const projects = db
    .prepare("SELECT * FROM projects WHERE status = 'archived' ORDER BY updated_at DESC")
    .all() as any[];
  const sessions = db
    .prepare("SELECT * FROM sessions WHERE status = 'archived' ORDER BY updated_at DESC")
    .all() as any[];
  const legacy = db
    .prepare(
      `SELECT turns.id, turns.project_id, turns.session_id, turns.user_input, turns.created_at,
              COUNT(audit_results.id) AS result_count
       FROM turns
       LEFT JOIN audit_results ON audit_results.turn_id = turns.id
       GROUP BY turns.id
       ORDER BY turns.created_at DESC
       LIMIT 100`
    )
    .all();
  return {
    projects: projects.map(rowToJson),
    sessions,
    legacy_discussions: legacy
  };
});

app.patch("/api/providers/:providerId/status", async (request) => {
  const params = z.object({ providerId: z.string() }).parse(request.params);
  const body = z.object({ status: z.enum(["active", "disabled"]) }).parse(request.body);
  const provider = db.prepare("SELECT * FROM model_providers WHERE id = ?").get(params.providerId) as any;
  if (!provider || provider.provider === "mock") throw new Error("该 Provider 不可启用。");
  if (body.status === "active" && !process.env[provider.api_key_ref]) {
    throw new ProviderUnavailableError(`未检测到环境变量 ${provider.api_key_ref}。`);
  }
  db.prepare("UPDATE model_providers SET status = ?, updated_at = ? WHERE id = ?").run(
    body.status,
    nowIso(),
    params.providerId
  );
  return { provider: providerView(db.prepare("SELECT * FROM model_providers WHERE id = ?").get(params.providerId)) };
});

app.put("/api/providers/:providerId/config", async (request) => {
  const params = z.object({ providerId: z.string() }).parse(request.params);
  const body = z
    .object({
      base_url: z
        .string()
        .trim()
        .url()
        .refine((value) => /^https?:\/\//.test(value), "Base URL 必须使用 http 或 https。"),
      model: z.string().trim().min(1).max(120),
      api_key: z.string().max(4096).optional().default("")
    })
    .parse(request.body);
  return {
    provider: configureProvider({
      providerId: params.providerId,
      baseUrl: body.base_url,
      model: body.model,
      apiKey: body.api_key
    })
  };
});

function recordArchive(entityType: string, entityId: string, action: string) {
  db.prepare(
    `INSERT INTO archive_events (id, entity_type, entity_id, action, reason, created_at)
     VALUES (?, ?, ?, ?, '', ?)`
  ).run(id("archive"), entityType, entityId, action, nowIso());
}

const port = Number(process.env.API_PORT || 8787);
app.listen({ host: "127.0.0.1", port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
