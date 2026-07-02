import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.ROUND_TABLE_TEST_MODE = "1";
process.env.ROUND_TABLE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-mvp-"));
process.env.ROUND_TABLE_ENV_PATH = path.join(process.env.ROUND_TABLE_DATA_DIR, ".env");

const { db, initDb } = await import("../server/db.js");
const { listRoles, loadRole } = await import("../server/services/roleLoader.js");
const { buildChatRequestBody, setTestRoleGenerator } = await import("../server/services/llmGateway.js");
const {
  enforceDialecticalContract,
  findDialecticalContractGaps
} = await import("../server/services/dialecticalKernel.js");
const { configureProvider } = await import("../server/services/providerConfig.js");
const { generateTestRoleOutput } = await import("../server/services/testRoleGenerator.js");
const {
  answerContext,
  configureDiscussionRoles,
  createDiscussion,
  getDiscussionState,
  listDiscussionEvents,
  pauseDiscussion,
  retryDiscussion,
  runDiscussionAction,
  startDiscussion
} = await import("../server/services/roundtableOrchestrator.js");
const { nowIso } = await import("../server/utils.js");
const typeModule = await import("../server/types.js");
void typeModule;

initDb();
const calls: Array<{
  role: string;
  phase: string;
  payload: Record<string, unknown>;
  prompt: string;
}> = [];

const recordingGenerator = (input: Parameters<NonNullable<Parameters<typeof setTestRoleGenerator>[0]>>[0]) => {
  calls.push({
    role: input.role.id,
    phase: input.phase,
    payload: input.payload,
    prompt: input.role.content
  });
  const output = generateTestRoleOutput(input) as any;
  if (input.role.id === "moderator" && input.phase === "framing") {
    return {
      ...output,
      detail: JSON.stringify({
        nested: `模型偶尔返回对象。${"这是完整记录中的内部展开内容，用于验证前台摘要不会直接渲染原始长文。".repeat(6)}`
      })
    };
  }
  if (input.role.id === "synthesizer" && input.phase === "synthesis") {
    return {
      ...output,
      confidence: {
        ...output.confidence,
        label: "中等偏高",
        missing: "仍缺少真实发布数据"
      }
    };
  }
  return output;
};

setTestRoleGenerator(recordingGenerator);

function seedWorkspace(suffix: string) {
  const now = nowIso();
  const projectId = `project_${suffix}`;
  const sessionId = `session_${suffix}`;
  db.prepare(
    `INSERT INTO projects (id, name, project_rules, status, created_at, updated_at)
     VALUES (?, ?, '{}', 'active', ?, ?)`
  ).run(projectId, `项目 ${suffix}`, now, now);
  db.prepare(
    `INSERT INTO sessions (id, project_id, title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(sessionId, projectId, `会话 ${suffix}`, now, now);
  return { projectId, sessionId };
}

async function waitForCompletion(discussionId: string) {
  for (let index = 0; index < 80; index += 1) {
    const state = getDiscussionState(discussionId);
    if (state.discussion.status === "completed") return state;
    if (state.discussion.status === "failed") {
      throw new Error(JSON.stringify(state.discussion.error_json));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("讨论未在测试时限内完成。");
}

async function waitForStatus(discussionId: string, expected: string[]) {
  for (let index = 0; index < 80; index += 1) {
    const state = getDiscussionState(discussionId);
    if (expected.includes(state.discussion.status)) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`讨论未进入预期状态：${expected.join(", ")}`);
}

test("七个底层 Agent 都由 md 文件加载，正文变化会改变哈希", () => {
  const roles = listRoles();
  assert.equal(roles.length, 7);
  assert.equal(new Set(roles.map((role) => role.path)).size, 7);
  assert.ok(roles.every((role) => role.content.length > 100));

  const supporter = loadRole("supporter");
  const absolutePath = path.resolve("server", "prompts", supporter.path);
  const original = fs.readFileSync(absolutePath, "utf8");
  try {
    fs.writeFileSync(absolutePath, `${original}\n测试边界：优先验证最小成立条件。\n`);
    const changed = loadRole("supporter");
    assert.notEqual(changed.hash, supporter.hash);
    assert.match(changed.content, /最小成立条件/);
  } finally {
    fs.writeFileSync(absolutePath, original);
    loadRole("supporter");
  }
});

test("API 配置写入本机密钥文件但不回传明文", () => {
  const configured = configureProvider({
    providerId: "provider_openai_compatible",
    baseUrl: "https://api.openai.com/v1/",
    model: "gpt-5-chat-latest",
    apiKey: "test-key-never-returned"
  });
  const envContent = fs.readFileSync(process.env.ROUND_TABLE_ENV_PATH!, "utf8");
  assert.match(envContent, /OPENAI_COMPATIBLE_API_KEY=/);
  assert.equal(configured.has_env_key, true);
  assert.equal(configured.status, "active");
  assert.equal("api_key" in configured, false);
  assert.equal(configured.base_url, "https://api.openai.com/v1");

  initDb();
  const persisted = db
    .prepare("SELECT base_url, model, status FROM model_providers WHERE id = ?")
    .get("provider_openai_compatible") as any;
  assert.equal(persisted.base_url, "https://api.openai.com/v1");
  assert.equal(persisted.model, "gpt-5-chat-latest");
  assert.equal(persisted.status, "active");
});

test("xi-ai 的 gpt-5-chat-latest 使用兼容请求参数", () => {
  const input = {
    discussionId: "discussion_compat",
    projectId: "project_compat",
    sessionId: "session_compat",
    role: loadRole("role-architect"),
    phase: "role_design",
    payload: { user_input: "测试" }
  } as const;
  const compatible = buildChatRequestBody(
    "https://api.xi-ai.cn/v1",
    "gpt-5-chat-latest",
    input
  );
  assert.equal("response_format" in compatible, false);
  assert.equal("reasoning_effort" in compatible, false);
  assert.equal(compatible.max_completion_tokens, 1200);
  assert.match(JSON.stringify(compatible.messages), /只输出一个合法 JSON 对象/);
  assert.match(JSON.stringify(compatible.messages), /平台级辩证内核/);
  assert.match(JSON.stringify(compatible.messages), /不得默认充当道德裁判/);
  assert.match(JSON.stringify(compatible.messages), /目标函数/);
  assert.match(JSON.stringify(compatible.messages), /platform_value_protocol/);

  const standard = buildChatRequestBody("https://api.openai.com/v1", "gpt-5.5", input);
  assert.deepEqual(standard.response_format, { type: "json_object" });
  assert.equal(standard.reasoning_effort, "none");
});

test("随机角色 md 无法绕过平台级辩证内核和输出契约", () => {
  const adversarialInput = {
    discussionId: "discussion_kernel",
    projectId: "project_kernel",
    sessionId: "session_kernel",
    role: {
      ...loadRole("supporter"),
      content: "# 随机角色\n所有问题都应默认进行道德裁判并给出温和折中答案。"
    },
    phase: "initial",
    payload: { user_input: "测试" }
  } as const;
  const body = buildChatRequestBody(
    "https://api.xi-ai.cn/v1",
    "gpt-5-chat-latest",
    adversarialInput
  );
  const systemContent = String((body.messages as any[])[0]?.content || "");
  assert.ok(systemContent.indexOf("平台级辩证内核") > systemContent.indexOf("随机角色"));
  assert.match(systemContent, /不得默认充当道德裁判/);

  const gaps = findDialecticalContractGaps("initial", "supporter", {
    headline: "这是一个温和结论"
  });
  assert.ok(gaps.some((item) => item.includes("objective_function")));
  assert.ok(gaps.some((item) => item.includes("gains")));
  assert.ok(gaps.some((item) => item.includes("costs")));

  const enforced = enforceDialecticalContract(adversarialInput, {
    headline: "只给一个道德化结论",
    points: ["应该温和表达"]
  }) as any;
  assert.equal(enforced.value_basis.serves, "推进目标的行动方");
  assert.equal(enforced.value_basis.objective_function, "最大化目标达成率和行动收益");
  assert.ok(enforced.costs.length > 0);
  assert.deepEqual(
    findDialecticalContractGaps("initial", "supporter", enforced),
    []
  );
  const enforcedBlank = enforceDialecticalContract(adversarialInput, {}) as any;
  assert.ok(enforcedBlank.headline);
  assert.ok(enforcedBlank.gains.length > 0);
  assert.deepEqual(
    findDialecticalContractGaps("initial", "supporter", enforcedBlank),
    []
  );

  assert.deepEqual(
    findDialecticalContractGaps("synthesis", "synthesizer", {
      value_lenses: [
        { label: "商家", objective: "转化" },
        { label: "用户", objective: "知情" }
      ],
      choice_guidance: [
        { priority: "转化", choose: "强表达", accept: "争议" },
        { priority: "信任", choose: "证据表达", accept: "转化慢" }
      ],
      bottom_line: [],
      display_summary: {
        judgement: "按目标函数选择路径",
        conditions: ["成立条件已满足"],
        maximum_risk: "信任折损",
        key_disagreement: "是否接受争议成本",
        recommended_changes: ["先小范围验证"]
      },
      process_digest: {
        supporter: "支持方强调转化收益",
        opponent: "反对方强调信任成本",
        cross_response: "双方争议集中在成本是否可接受",
        practice: "先小范围验证"
      }
    }),
    []
  );
});

test("真实编排保持首发独立、交叉读取、实践取舍和综合输出", async () => {
  calls.length = 0;
  const workspace = seedWorkspace("flow");
  const created = createDiscussion({
    ...workspace,
    userInput: "这段新品文案适合发布吗？"
  });
  assert.equal(created.discussion.status, "preparing");
  const guided = await waitForStatus(created.discussion.id, ["needs_context"]);
  assert.ok(guided.questions.length <= 3);

  const designing = answerContext(guided.discussion.id, [
    { question_id: "goal", answer_type: "option", value: "整体方向" },
    { question_id: "identity", answer_type: "option", value: "达人号" }
  ]);
  assert.equal(designing.discussion.status, "designing_roles");
  const ready = await waitForStatus(created.discussion.id, ["ready"]);
  assert.equal(ready.premises.find((item) => item.key === "identity")?.value, "达人号");
  assert.equal(ready.role_config.length, 6);
  assert.ok(ready.role_config.filter((role) => role.role_id !== "context-guide").every((role) => role.generated));
  assert.match(ready.role_config.find((role) => role.role_id === "supporter")?.label || "", /成立论证者/);
  assert.match(ready.role_config.find((role) => role.role_id === "supporter")?.content || "", /引用隔离/);
  const configured = configureDiscussionRoles(
    ready.discussion.id,
    ready.role_config.map((role) => ({
      role_id: role.role_id,
      enabled: role.enabled,
      content: role.role_id === "supporter"
        ? `${role.content}\n本轮测试强调：先验证最小成立条件。`
        : role.content
    }))
  );
  assert.equal(configured.role_config_confirmed, true);

  startDiscussion(created.discussion.id);
  const completed = await waitForCompletion(created.discussion.id);
  assert.equal(completed.roles.filter((role) => role.status === "completed").length, 3);
  assert.ok(completed.conclusion?.conditional_judgement);
  assert.equal(typeof completed.process[0]?.content.detail, "string");
  assert.match(completed.process[0]?.content.detail || "", /模型偶尔返回对象/);
  assert.doesNotMatch(completed.process[0]?.content.detail || "", /"nested"/);
  assert.ok(
    completed.role_outputs.every((item) => {
      const content = item.content;
      return (
        content.headline.length +
        content.points.reduce((total, point) => total + point.length, 0) +
        content.detail.length
      ) <= 120;
    })
  );
  const fullModerator = completed.full_record.find(
    (item) => item.role_id === "moderator" && item.phase === "framing"
  );
  const visibleModerator = completed.role_outputs.find(
    (item) => item.role_id === "moderator" && item.phase === "framing"
  );
  assert.ok(fullModerator);
  assert.ok(
    (fullModerator?.content.detail.length || 0) >
      (visibleModerator?.content.detail.length || 0)
  );
  assert.ok(Array.isArray(completed.conclusion?.confidence.missing));
  assert.ok((completed.conclusion?.value_lenses.length || 0) >= 2);
  assert.ok((completed.conclusion?.choice_guidance.length || 0) >= 2);
  assert.ok(completed.conclusion?.display_summary.judgement);
  assert.ok((completed.conclusion?.display_summary.conditions.length || 0) <= 2);
  assert.ok(
    Object.values(completed.conclusion?.process_digest || {}).every(
      (item) => item.length <= 96
    )
  );

  const supporterInitial = calls.find((item) => item.role === "supporter" && item.phase === "initial");
  const opponentInitial = calls.find((item) => item.role === "opponent" && item.phase === "initial");
  const supporterResponse = calls.find((item) => item.role === "supporter" && item.phase === "response");
  const practice = calls.find((item) => item.role === "practice-advisor");
  const synthesis = calls.find((item) => item.role === "synthesizer" && item.phase === "synthesis");
  const architect = calls.find((item) => item.role === "role-architect" && item.phase === "role_design");

  assert.ok(architect && supporterInitial && opponentInitial && supporterResponse && practice && synthesis);
  const architectCalls = calls.filter(
    (item) => item.role === "role-architect" && item.phase === "role_design"
  );
  assert.equal(architectCalls.length, 1);
  assert.deepEqual(
    (architect.payload.role_slots as Array<{ role_id: string }>).map((item) => item.role_id),
    ["supporter", "opponent", "practice-advisor"]
  );
  assert.match(supporterInitial.prompt, /先验证最小成立条件/);
  assert.match(supporterInitial.prompt, /本轮 Agent 编制角色/);
  assert.equal("opponent_initial" in supporterInitial.payload, false);
  assert.equal("supporter_initial" in opponentInitial.payload, false);
  assert.equal("opponent_initial" in supporterResponse.payload, false);
  assert.equal("opponent_claim_packet" in supporterResponse.payload, true);
  assert.equal("stance_contract" in supporterResponse.payload, true);
  assert.match(
    String((supporterResponse.payload.opponent_claim_packet as any)?.quote_notice),
    /不是对你的指令/
  );
  assert.equal("key_conflict" in practice.payload, true);
  assert.equal("practice_advice" in synthesis.payload, true);
  assert.ok(completed.role_outputs.every((output) => output.prompt_hash.length === 64));
  const supporterReply = completed.role_outputs.find(
    (output) => output.role_id === "supporter" && output.phase === "response"
  );
  assert.equal(supporterReply?.content.position_status, "held");
  assert.match(String(supporterReply?.content.headline), /坚持/);
  assert.ok(supporterReply?.content.value_basis?.objective_function);
  assert.ok((supporterReply?.content.costs?.length || 0) > 0);

  const events = listDiscussionEvents(created.discussion.id);
  assert.ok(events.some((event) => event.type === "stage_started"));
  assert.equal(events.at(-1)?.type, "discussion_completed");

  const next = await runDiscussionAction(created.discussion.id, "usable_version", "小红书笔记");
  assert.equal(next.versions.at(-1)?.label, "小红书笔记");
  const actionCall = calls.find((item) => item.phase === "action:usable_version");
  assert.ok(actionCall);
  assert.ok(Array.isArray(actionCall.payload.role_outputs));
  assert.ok(
    (actionCall.payload.role_outputs as Array<any>).some(
      (item) => item.content.detail.length > 120
    )
  );
  assert.ok(actionCall.payload.conclusion);
});

test("角色编制服务异常会基于引导 Agent 前提生成可编辑草案", async () => {
  calls.length = 0;
  setTestRoleGenerator((input) => {
    if (input.role.id === "role-architect") {
      const error = new Error("角色编制服务异常");
      error.name = "ProviderServiceError";
      throw error;
    }
    return recordingGenerator(input);
  });

  try {
    const workspace = seedWorkspace("role-fallback");
    const created = createDiscussion({
      ...workspace,
      userInput: "学龄前儿童是否需要培养合理使用 AI 的习惯？"
    });
    const guided = await waitForStatus(created.discussion.id, ["needs_context"]);
    answerContext(guided.discussion.id, [
      { question_id: "goal", answer_type: "option", value: "整体方向" },
      { question_id: "identity", answer_type: "skip" }
    ]);
    const ready = await waitForStatus(created.discussion.id, ["ready"]);

    assert.equal(ready.role_design_mode, "context_compiled");
    assert.match(ready.role_design_notice, /已确认前提/);
    assert.equal(ready.role_config.length, 6);
    assert.ok(
      ready.role_config
        .filter((role) => role.role_id !== "context-guide")
        .every((role) => role.generated && role.content.includes("本轮 Agent 编制角色"))
    );
    assert.ok(
      listDiscussionEvents(created.discussion.id).some(
        (event) => event.type === "role_design_fallback"
      )
    );
  } finally {
    setTestRoleGenerator(recordingGenerator);
  }
});

test("同一输入更换发布身份会改变角色结论", async () => {
  const workspace = seedWorkspace("identity");
  const created = createDiscussion({
    ...workspace,
    userInput: "这段新品文案适合发布吗？"
  });
  const guided = await waitForStatus(created.discussion.id, ["needs_context"]);
  const designing = answerContext(guided.discussion.id, [
    { question_id: "goal", answer_type: "option", value: "整体方向" },
    { question_id: "identity", answer_type: "option", value: "品牌号" }
  ]);
  assert.equal(designing.discussion.status, "designing_roles");
  const ready = await waitForStatus(created.discussion.id, ["ready"]);
  configureDiscussionRoles(
    ready.discussion.id,
    ready.role_config.map((role) => ({
      role_id: role.role_id,
      enabled: role.enabled,
      content: role.content
    }))
  );
  startDiscussion(created.discussion.id);
  const completed = await waitForCompletion(created.discussion.id);
  const supporter = completed.role_outputs.find(
    (output) => output.role_id === "supporter" && output.phase === "initial"
  );
  assert.match(String(supporter?.content.headline), /品牌号/);
});

test("只有用户选中的讨论角色会进入开桌流程", async () => {
  calls.length = 0;
  const workspace = seedWorkspace("selection");
  const created = createDiscussion({
    ...workspace,
    userInput: "这个商业想法是否值得推进？"
  });
  const guided = await waitForStatus(created.discussion.id, ["needs_context"]);
  answerContext(guided.discussion.id, [
    { question_id: "goal", answer_type: "option", value: "整体方向" },
    { question_id: "identity", answer_type: "skip" }
  ]);
  const ready = await waitForStatus(created.discussion.id, ["ready"]);
  configureDiscussionRoles(
    ready.discussion.id,
    ready.role_config.map((role) => ({
      role_id: role.role_id,
      enabled: role.role_id === "practice-advisor" ? false : role.enabled,
      content: role.content
    }))
  );
  startDiscussion(created.discussion.id);
  const completed = await waitForCompletion(created.discussion.id);

  assert.equal(completed.roles.length, 2);
  assert.equal(
    calls.some((item) => item.role === "practice-advisor" && item.phase === "decision"),
    false
  );
  assert.ok(
    listDiscussionEvents(created.discussion.id).some(
      (event) =>
        event.type === "role_skipped" &&
        event.payload.role_id === "practice-advisor"
    )
  );
});

test("上下文阶段可以暂停并从原状态继续", async () => {
  const workspace = seedWorkspace("pause");
  const created = createDiscussion({
    ...workspace,
    userInput: "这段销售话术是否需要调整？"
  });
  const guided = await waitForStatus(created.discussion.id, ["needs_context"]);

  const paused = pauseDiscussion(guided.discussion.id);
  assert.equal(paused.discussion.status, "paused");
  assert.equal(
    listDiscussionEvents(created.discussion.id).at(-1)?.type,
    "discussion_paused"
  );

  const resumed = retryDiscussion(created.discussion.id);
  assert.equal(resumed.discussion.status, "needs_context");
});

test.after(() => {
  setTestRoleGenerator(null);
  db.close();
  fs.rmSync(process.env.ROUND_TABLE_DATA_DIR!, { recursive: true, force: true });
});
