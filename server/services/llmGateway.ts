import { db, providerView } from "../db.js";
import type { JsonObject, RoleGenerationInput } from "../types.js";
import { fromJson, id, nowIso } from "../utils.js";
import {
  buildDialecticalRepairInput,
  findDialecticalContractGaps,
  mergeAndEnforceDialecticalContract,
  withDialecticalKernel,
  withPlatformValueProtocol
} from "./dialecticalKernel.js";

export class ProviderUnavailableError extends Error {
  constructor(message = "真实模型尚未就绪，请先在设置中启用 GPT-5.5 并配置环境变量。") {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export class GenerationCancelledError extends Error {
  constructor() {
    super("本轮处理已由用户暂停。");
    this.name = "GenerationCancelledError";
  }
}

class ProviderHttpError extends Error {
  retryable: boolean;

  constructor(name: string, message: string, retryable: boolean) {
    super(message);
    this.name = name;
    this.retryable = retryable;
  }
}

type TestGenerator = (input: RoleGenerationInput) => unknown | Promise<unknown>;
let injectedTestGenerator: TestGenerator | null = null;
const activeControllers = new Map<string, Set<AbortController>>();

export function setTestRoleGenerator(generator: TestGenerator | null) {
  injectedTestGenerator = generator;
}

export function cancelDiscussionGeneration(discussionId: string) {
  const controllers = activeControllers.get(discussionId);
  if (!controllers) return 0;
  for (const controller of controllers) controller.abort();
  return controllers.size;
}

export function getProviderStatus() {
  const rows = db.prepare("SELECT * FROM model_providers ORDER BY created_at").all() as any[];
  return rows.map(providerView);
}

export async function generateRoleJSON<T>(input: RoleGenerationInput): Promise<T> {
  if (injectedTestGenerator) {
    return (await injectedTestGenerator(input)) as T;
  }

  if (process.env.ROUND_TABLE_TEST_MODE === "1") {
    const { generateTestRoleOutput } = await import("./testRoleGenerator.js");
    return generateTestRoleOutput(input) as T;
  }

  const provider = selectProvider();
  const output = await callProviderWithRetry<T>(provider, input);
  const gaps = findDialecticalContractGaps(input.phase, input.role.id, output);
  if (gaps.length === 0) return output;

  console.warn(
    `[dialectical-kernel] phase=${input.phase} role=${input.role.id} gaps=${gaps.join("|")}`
  );
  const repairInput = buildDialecticalRepairInput(input, output, gaps);
  const repaired = await callProviderWithRetry<T>(provider, repairInput);
  const enforced = mergeAndEnforceDialecticalContract(
    input,
    output,
    repaired
  ) as T;
  const remaining = findDialecticalContractGaps(
    input.phase,
    input.role.id,
    enforced
  );
  if (remaining.length > 0) {
    console.warn(
      `[dialectical-kernel] phase=${input.phase} role=${input.role.id} remaining_gaps=${remaining.join("|")}`
    );
  }
  return enforced;
}

async function callProviderWithRetry<T>(provider: any, input: RoleGenerationInput) {
  const maxAttempts = Math.max(2, Number(provider.retry_count || 0) + 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await callProvider<T>(provider, input, attempt);
    } catch (error) {
      lastError = error;
      if (error instanceof GenerationCancelledError) throw error;
      if (!(error instanceof ProviderHttpError) || !error.retryable || attempt === maxAttempts) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("模型调用失败。");
}

function selectProvider() {
  const rows = db
    .prepare("SELECT * FROM model_providers WHERE status = 'active' AND provider != 'mock' ORDER BY created_at")
    .all() as any[];

  const provider = rows.find((row) => row.api_key_ref && process.env[row.api_key_ref]);
  if (!provider) throw new ProviderUnavailableError();
  return provider;
}

async function callProvider<T>(
  provider: any,
  input: RoleGenerationInput,
  attempt: number
): Promise<T> {
  const baseUrl = String(provider.base_url || "").replace(/\/$/, "");
  const apiKey = process.env[provider.api_key_ref];
  if (!baseUrl || !apiKey) throw new ProviderUnavailableError();

  const controller = new AbortController();
  const startedAt = Date.now();
  const metricId = id("model_call");
  db.prepare(
    `INSERT INTO model_call_metrics (
      id, discussion_id, role_id, phase, provider_id, model,
      attempt, status, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`
  ).run(
    metricId,
    input.discussionId,
    input.role.id,
    input.phase,
    provider.id,
    provider.model,
    attempt,
    nowIso()
  );
  const controllers = activeControllers.get(input.discussionId) || new Set<AbortController>();
  controllers.add(controller);
  activeControllers.set(input.discussionId, controllers);
  try {
    const requestBody = buildChatRequestBody(baseUrl, provider.model, input);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const text = await response.text();
      throw providerHttpError(response.status, text);
    }

    const data = (await response.json()) as any;
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error("模型返回了空内容。");
    const parsed = JSON.parse(stripCodeFence(String(raw))) as T;
    finishModelMetric(metricId, "completed", startedAt, null, data.usage);
    console.info(
      `[llm] phase=${input.phase} role=${input.role.id} duration_ms=${Date.now() - startedAt} status=completed`
    );
    return parsed;
  } catch (error) {
    if (controller.signal.aborted) {
      const cancelled = new GenerationCancelledError();
      finishModelMetric(metricId, "cancelled", startedAt, cancelled);
      throw cancelled;
    }
    finishModelMetric(metricId, "failed", startedAt, error);
    console.warn(
      `[llm] phase=${input.phase} role=${input.role.id} duration_ms=${Date.now() - startedAt} status=failed`
    );
    throw error;
  } finally {
    controllers.delete(controller);
    if (controllers.size === 0) activeControllers.delete(input.discussionId);
  }
}

function finishModelMetric(
  metricId: string,
  status: "completed" | "failed" | "cancelled",
  startedAt: number,
  error: unknown,
  usage: unknown = {}
) {
  const normalized = normalizeProviderError(error);
  db.prepare(
    `UPDATE model_call_metrics
     SET status = ?, completed_at = ?, duration_ms = ?,
         error_name = ?, error_message = ?, usage_json = ?
     WHERE id = ?`
  ).run(
    status,
    nowIso(),
    Date.now() - startedAt,
    error ? String(normalized.name || "") : "",
    error ? String(normalized.message || "") : "",
    JSON.stringify(usage || {}),
    metricId
  );
}

export function getDiscussionModelTimings(discussionId: string) {
  const calls = db.prepare(
    `SELECT id, role_id, phase, provider_id, model, attempt, status,
            started_at, completed_at, duration_ms, error_name, error_message, usage_json
     FROM model_call_metrics
     WHERE discussion_id = ?
     ORDER BY started_at, attempt`
  ).all(discussionId) as any[];
  const phases = db.prepare(
    `SELECT phase,
            COUNT(*) AS call_count,
            CAST(ROUND(AVG(duration_ms)) AS INTEGER) AS average_ms,
            MIN(duration_ms) AS minimum_ms,
            MAX(duration_ms) AS maximum_ms,
            SUM(duration_ms) AS total_ms
     FROM model_call_metrics
     WHERE discussion_id = ? AND status = 'completed' AND duration_ms IS NOT NULL
     GROUP BY phase
     ORDER BY MIN(started_at)`
  ).all(discussionId);
  const completedCalls = calls.filter((call) => call.completed_at && call.duration_ms != null);
  return {
    timeout_policy: "disabled",
    calls: calls.map((call) => ({
      ...call,
      usage: fromJson(call.usage_json, {})
    })),
    phases,
    totals: {
      call_count: calls.length,
      completed_count: calls.filter((call) => call.status === "completed").length,
      failed_count: calls.filter((call) => call.status === "failed").length,
      cancelled_count: calls.filter((call) => call.status === "cancelled").length,
      running_count: calls.filter((call) => call.status === "running").length,
      measured_ms: completedCalls.reduce(
        (total, call) => total + Number(call.duration_ms || 0),
        0
      )
    }
  };
}

export function buildChatRequestBody(
  baseUrl: string,
  model: string,
  input: RoleGenerationInput
) {
  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "system",
        content: `${withDialecticalKernel(input.role.content)}\n\n## 接口输出约束\n\n只输出一个合法 JSON 对象，不要使用 Markdown 代码围栏，不要附加解释文字。`
      },
      {
        role: "user",
        content: JSON.stringify({
          phase: input.phase,
          discussion_id: input.discussionId,
          payload: withPlatformValueProtocol(input.payload)
        })
      }
    ],
    max_completion_tokens: completionBudget(input.phase)
  };

  // xi-ai 的 gpt-5-chat-latest 路由会拒绝这两个 OpenAI 兼容参数。
  // 该模式仍通过 system prompt 强制 JSON，响应进入同一 JSON 解析与校验流程。
  const limitedChatCompatibility =
    baseUrl.includes("api.xi-ai.cn") && model === "gpt-5-chat-latest";
  if (!limitedChatCompatibility) {
    requestBody.response_format = { type: "json_object" };
    requestBody.reasoning_effort = reasoningEffort(input.phase);
  }
  return requestBody;
}

function reasoningEffort(phase: string) {
  if (
    phase === "context" ||
    phase === "role_design" ||
    phase === "framing" ||
    phase === "conflict" ||
    phase === "synthesis" ||
    phase.startsWith("action:")
  ) {
    return "none";
  }
  return "low";
}

function completionBudget(phase: string) {
  if (phase === "context") return 1200;
  if (phase === "role_design") return 1200;
  if (phase === "framing" || phase === "conflict") return 1000;
  if (phase === "initial" || phase === "response" || phase === "decision") return 1200;
  if (phase === "synthesis" || phase.startsWith("action:")) return 1600;
  return 1600;
}

function providerHttpError(status: number, body: string) {
  let providerType = "";
  try {
    const parsed = JSON.parse(body) as any;
    providerType = String(parsed?.error?.type || parsed?.error?.code || "").trim();
  } catch {
    providerType = "";
  }

  const suffix = providerType ? `（${providerType}）` : "";
  return (
    status === 429
      ? new ProviderHttpError(
          "ProviderCapacityError",
          `模型服务当前繁忙${suffix}。当前进度已保留，请稍后从本阶段重试。`,
          true
        )
      : status >= 500
        ? new ProviderHttpError(
            "ProviderServiceError",
            `上游模型服务暂时不可用（${status}）${suffix}。这通常不是输入内容导致，当前进度已保留，请稍后重试或检查模型服务状态。`,
            true
          )
        : new ProviderHttpError(
            "ProviderRequestError",
            `模型请求被服务端拒绝（${status}）${suffix}。请检查 API 地址、模型名称和接口兼容性。`,
            false
          )
  );
}

function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

export function normalizeProviderError(error: unknown): JsonObject {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}
