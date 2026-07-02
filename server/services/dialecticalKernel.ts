import type { JsonObject, RoleGenerationInput, RoleId } from "../types.js";

export const DIALECTICAL_KERNEL_VERSION = "v2";

export const DIALECTICAL_KERNEL_PROMPT = `
# 平台级辩证内核
version: ${DIALECTICAL_KERNEL_VERSION}

本协议由圆桌平台强制注入，优先于具体角色 md 中未明确写出的价值偏好。角色 md 决定专业身份，本协议决定讨论方法。

## 1. 道德边界是底线，不是默认目标函数

- 严重伤害、暴力犯罪、违法实施、事实捏造等明确越界内容必须限制到安全、合法、非实施性的讨论范围。
- 除上述底线外，不得默认充当道德裁判，不得把“更温和、更负责、更少焦虑、更少争议”当作天然正确。
- 只限制越界部分；不得借底线之名终止其余合法的事实、机制、策略和利益冲突分析。

## 2. 价值判断必须显式化

- 每个判断必须能追溯到：服务对象、目标函数、收益、可接受代价、外部性和硬底线。
- “焦虑营销”“逐利”“强转化”“冒犯”“保守”“用户利益”等标签没有固定褒贬，必须拆解为对谁有效、实现什么、谁获益、谁承担成本、短期与长期结果。
- 不得用“社会普遍认为”“更符合伦理”“应该负责任”等模糊表达替代具体目标和证据。

## 3. 冲突必须保留

- 不同目标函数得到不同答案时，必须并列保留，不得自动折中或中庸化。
- 可以选择一条明显偏向某一利益相关者的路径，但必须公开收益、代价和外部性。
- 综合输出的职责是呈现选择结构，不是替用户消除价值冲突。

## 4. 结构要求

- 立场输出必须显式包含价值坐标：serves、objective_function、acceptable_costs、hard_boundaries。
- 实践取舍必须提供至少两条目标函数不同的路径。
- 综合结论必须提供至少两个 value_lenses，以及对应的 choice_guidance。

## 5. 表达压缩协议

- 内部推理可以充分展开，但返回给产品的单次角色发言必须压缩：headline、points、detail 合计不超过 120 个中文字符。
- 不得用长自然段堆叠观点；headline 只放一个结论，points 最多保留两个证据或条件。
- 综合输出必须额外返回 display_summary 和 process_digest，主结果只能读取这两个压缩结构，不得直接渲染角色原始发言。
- display_summary 必须包含一句话判断、成立条件、最大风险、关键分歧、建议改法；每项只保留会改变行动的信息。
- process_digest 只保留支持者核心、反对者核心、交叉回应和实践取舍，不复述完整会议记录。
`.trim();

export const PLATFORM_VALUE_PROTOCOL: JsonObject = {
  version: DIALECTICAL_KERNEL_VERSION,
  moral_boundary: "安全与法律是最低底线，不是默认目标函数",
  required_coordinates: [
    "serves",
    "objective_function",
    "gains",
    "acceptable_costs",
    "externalities",
    "hard_boundaries"
  ],
  conflict_rule: "不同目标函数的答案必须并列保留，不得自动折中",
  label_rule: "价值标签本身无固定褒贬，必须拆解收益、代价和承担者",
  expression_rule: "角色可见发言不超过120字，主结果必须先经过综合输出者压缩"
};

export function withDialecticalKernel(roleContent: string) {
  return `${roleContent}\n\n---\n\n${DIALECTICAL_KERNEL_PROMPT}`;
}

export function withPlatformValueProtocol(payload: JsonObject): JsonObject {
  return {
    ...payload,
    platform_value_protocol: PLATFORM_VALUE_PROTOCOL
  };
}

export function findDialecticalContractGaps(
  phase: string,
  roleId: RoleId,
  value: unknown
) {
  const source = isRecord(value) ? value : {};
  const gaps: string[] = [];
  if (phase === "role_design") {
    const roles = Array.isArray(source.roles) ? source.roles.filter(isRecord) : [];
    if (roles.length === 0) gaps.push("roles 为空");
    for (const role of roles) {
      const id = text(role.role_id) || "unknown";
      if (!text(role.serves)) gaps.push(`${id} 缺少 serves`);
      if (!text(role.objective_function)) gaps.push(`${id} 缺少 objective_function`);
      if (!hasList(role.acceptable_costs)) gaps.push(`${id} 缺少 acceptable_costs`);
      if (!Array.isArray(role.hard_boundaries)) gaps.push(`${id} 缺少 hard_boundaries`);
    }
  }
  if (
    ["initial", "response"].includes(phase) &&
    ["supporter", "opponent"].includes(roleId)
  ) {
    const basis = isRecord(source.value_basis) ? source.value_basis : {};
    if (!text(basis.serves)) gaps.push("缺少 value_basis.serves");
    if (!text(basis.objective_function)) gaps.push("缺少 value_basis.objective_function");
    if (!Array.isArray(basis.acceptable_costs)) gaps.push("缺少 value_basis.acceptable_costs");
    if (!Array.isArray(basis.hard_boundaries)) gaps.push("缺少 value_basis.hard_boundaries");
    if (!hasList(source.gains)) gaps.push("缺少 gains");
    if (!hasList(source.costs)) gaps.push("缺少 costs");
  }
  if (phase === "decision" && roleId === "practice-advisor") {
    if (!Array.isArray(source.decision_paths) || source.decision_paths.length < 2) {
      gaps.push("实践取舍缺少至少两条 decision_paths");
    }
  }
  if (phase === "synthesis" && roleId === "synthesizer") {
    if (!Array.isArray(source.value_lenses) || source.value_lenses.length < 2) {
      gaps.push("综合输出缺少至少两个 value_lenses");
    }
    if (!Array.isArray(source.choice_guidance) || source.choice_guidance.length < 2) {
      gaps.push("综合输出缺少至少两条 choice_guidance");
    }
    if (!Array.isArray(source.bottom_line)) gaps.push("综合输出缺少 bottom_line");
    const displaySummary = isRecord(source.display_summary)
      ? source.display_summary
      : {};
    if (!text(displaySummary.judgement)) gaps.push("综合输出缺少 display_summary.judgement");
    if (!hasList(displaySummary.conditions)) gaps.push("综合输出缺少 display_summary.conditions");
    if (!text(displaySummary.maximum_risk)) gaps.push("综合输出缺少 display_summary.maximum_risk");
    if (!text(displaySummary.key_disagreement)) gaps.push("综合输出缺少 display_summary.key_disagreement");
    if (!hasList(displaySummary.recommended_changes)) {
      gaps.push("综合输出缺少 display_summary.recommended_changes");
    }
    const processDigest = isRecord(source.process_digest) ? source.process_digest : {};
    if (!text(processDigest.supporter)) gaps.push("综合输出缺少 process_digest.supporter");
    if (!text(processDigest.opponent)) gaps.push("综合输出缺少 process_digest.opponent");
    if (!text(processDigest.cross_response)) gaps.push("综合输出缺少 process_digest.cross_response");
    if (!text(processDigest.practice)) gaps.push("综合输出缺少 process_digest.practice");
  }
  return gaps;
}

export function buildDialecticalRepairInput(
  input: RoleGenerationInput,
  previousOutput: unknown,
  gaps: string[]
): RoleGenerationInput {
  return {
    ...input,
    role: {
      ...input.role,
      content: `# 平台价值结构修复器

你只负责修复上一版 JSON 的价值结构，不重新扩展事实。

- 根据 original_payload 中的角色契约补齐服务对象、目标函数、收益、代价、外部性和硬底线。
- 保留已有事实和有效论据；如果原结论来自未公开的道德默认值，或与 original_payload 中公开的目标函数冲突，必须重写结论使其与公开目标函数一致。
- 不进行道德说教，不自动折中，不把价值标签当作结论。
- 必须返回 original_phase 所要求的完整 JSON，不得再套一层 previous_output、result 或 data。`
    },
    phase: `${input.phase}:value_repair`,
    payload: {
      original_phase: input.phase,
      original_payload: input.payload,
      previous_output: previousOutput as JsonObject,
      contract_gaps: gaps,
      repair_instruction:
        "保持原有事实和主要判断，只修复缺失的价值坐标。公开服务对象、目标函数、收益、代价、外部性与硬底线；不得自动折中。返回原阶段要求的完整 JSON。"
    }
  };
}

export function mergeAndEnforceDialecticalContract(
  input: RoleGenerationInput,
  originalOutput: unknown,
  repairedOutput: unknown
) {
  const original = isRecord(originalOutput) ? originalOutput : {};
  const repaired = isRecord(repairedOutput) ? repairedOutput : {};
  const merged = { ...original, ...repaired };
  return enforceDialecticalContract(input, merged);
}

export function enforceDialecticalContract(
  input: RoleGenerationInput,
  value: unknown
) {
  const source = isRecord(value) ? { ...value } : {};
  if (input.phase === "role_design") {
    const roles = Array.isArray(source.roles) ? source.roles.filter(isRecord) : [];
    source.roles = roles.map((role) => ({
      ...role,
      ...fillRoleContract(text(role.role_id), role)
    }));
    return source;
  }

  if (
    ["initial", "response"].includes(input.phase) &&
    ["supporter", "opponent"].includes(input.role.id)
  ) {
    const contract = resolveRoleContract(input);
    const basis = isRecord(source.value_basis) ? source.value_basis : {};
    source.value_basis = {
      serves: text(basis.serves) || contract.serves,
      objective_function:
        text(basis.objective_function) || contract.objective_function,
      acceptable_costs:
        list(basis.acceptable_costs).length > 0
          ? list(basis.acceptable_costs)
          : contract.acceptable_costs,
      hard_boundaries:
        Array.isArray(basis.hard_boundaries)
          ? list(basis.hard_boundaries)
        : contract.hard_boundaries
    };
    const gains =
      list(source.gains).length > 0
        ? list(source.gains)
        : list(source.points).length > 0
          ? list(source.points)
          : [`更接近目标：${contract.objective_function}`];
    source.gains = gains;
    source.costs =
      list(source.costs).length > 0
        ? list(source.costs)
        : contract.acceptable_costs;
    source.externalities = list(source.externalities);
    source.headline =
      text(source.headline) ||
      `从${contract.serves}的目标看，应按“${contract.objective_function}”判断`;
    source.stance_thesis = text(source.stance_thesis) || text(source.headline);
    source.points = list(source.points).length > 0 ? list(source.points) : gains;
    source.detail =
      text(source.detail) ||
      `本判断公开采用“${contract.objective_function}”作为目标函数，并接受已列明代价。`;
    return source;
  }

  if (input.phase === "decision" && input.role.id === "practice-advisor") {
    const paths = Array.isArray(source.decision_paths)
      ? source.decision_paths.filter(isRecord)
      : [];
    if (paths.length < 2) {
      const supporter = selectedRole(input, "supporter");
      const opponent = selectedRole(input, "opponent");
      const actions = list(source.actions);
      source.decision_paths = [
        {
          label: "优先目标达成",
          objective:
            text(supporter.objective_function) || "最大化当前目标达成率",
          action: actions[0] || "保留有效机制并推进",
          gains: list(source.keep),
          costs:
            list(supporter.acceptable_costs).length > 0
              ? list(supporter.acceptable_costs)
              : ["承担争议和试错成本"],
          who_pays: text(supporter.serves) || "行动方与受影响对象"
        },
        {
          label: "优先控制代价",
          objective:
            text(opponent.objective_function) || "最小化不可逆损失和外部成本",
          action: actions[1] || "先验证关键前提再扩大",
          gains: list(source.avoid).map((item) => `减少：${item}`),
          costs:
            list(opponent.acceptable_costs).length > 0
              ? list(opponent.acceptable_costs)
              : ["牺牲部分速度和短期收益"],
          who_pays: text(opponent.serves) || "承担失败成本的利益相关者"
        }
      ];
    }
    return source;
  }

  if (input.phase === "synthesis" && input.role.id === "synthesizer") {
    const supporter = selectedRole(input, "supporter");
    const opponent = selectedRole(input, "opponent");
    if (!Array.isArray(source.value_lenses) || source.value_lenses.length < 2) {
      source.value_lenses = [
        {
          label: text(supporter.label) || "目标达成视角",
          serves: text(supporter.serves) || "推进方案的行动方",
          objective:
            text(supporter.objective_function) || "最大化目标达成和推进收益",
          judgement: list(source.support_reasons)[0] || text(source.conditional_judgement),
          gains: list(source.support_reasons),
          costs: list(supporter.acceptable_costs)
        },
        {
          label: text(opponent.label) || "代价承担视角",
          serves: text(opponent.serves) || "承担失败成本的利益相关者",
          objective:
            text(opponent.objective_function) || "最小化不可逆损失和外部成本",
          judgement: list(source.retained_risks)[0] || text(source.conditional_judgement),
          gains: list(source.retained_risks).map((item) => `避免：${item}`),
          costs: list(opponent.acceptable_costs)
        }
      ];
    }
    if (!Array.isArray(source.choice_guidance) || source.choice_guidance.length < 2) {
      const corrections = list(source.corrections);
      source.choice_guidance = [
        {
          priority:
            text(supporter.objective_function) || "优先目标达成与短期效果",
          choose: corrections[0] || "选择推进路径",
          accept:
            list(supporter.acceptable_costs).join("；") || "承担争议与试错成本"
        },
        {
          priority:
            text(opponent.objective_function) || "优先控制长期与外部成本",
          choose: corrections[1] || "选择验证或收缩路径",
          accept:
            list(opponent.acceptable_costs).join("；") || "接受速度与短期收益下降"
        }
      ];
    }
    if (!Array.isArray(source.bottom_line)) {
      source.bottom_line = unique([
        ...list(supporter.hard_boundaries),
        ...list(opponent.hard_boundaries)
      ]);
    }
    const disagreement = isRecord(source.key_disagreement)
      ? source.key_disagreement
      : {};
    const displaySummary = isRecord(source.display_summary)
      ? source.display_summary
      : {};
    source.display_summary = {
      judgement: compact(
        text(displaySummary.judgement) ||
          text(source.conditional_judgement) ||
          text(source.headline),
        72
      ),
      conditions: compactList(
        hasList(displaySummary.conditions)
          ? displaySummary.conditions
          : hasList(source.support_reasons)
            ? source.support_reasons
            : ["满足已确认的关键前提"],
        2,
        46
      ),
      maximum_risk: compact(
        text(displaySummary.maximum_risk) ||
          list(source.retained_risks)[0] ||
          "关键风险仍需验证",
        64
      ),
      key_disagreement: compact(
        text(displaySummary.key_disagreement) ||
          text(disagreement.disputed_premise) ||
          text(source.process_summary) ||
          "双方对关键前提是否成立判断不同",
        64
      ),
      recommended_changes: compactList(
        hasList(displaySummary.recommended_changes)
          ? displaySummary.recommended_changes
          : hasList(source.corrections)
            ? source.corrections
            : ["先验证关键前提，再决定是否扩大"],
        2,
        46
      )
    };
    const processDigest = isRecord(source.process_digest)
      ? source.process_digest
      : {};
    source.process_digest = {
      supporter: compact(
        text(processDigest.supporter) ||
          roleDigest(input.payload.supporter_initial) ||
          list(source.support_reasons)[0] ||
          "支持方未形成可保留的核心观点",
        88
      ),
      opponent: compact(
        text(processDigest.opponent) ||
          roleDigest(input.payload.opponent_initial) ||
          list(source.retained_risks)[0] ||
          "反对方未形成必须保留的核心风险",
        88
      ),
      cross_response: compact(
        text(processDigest.cross_response) ||
          [
            roleDigest(input.payload.supporter_response),
            roleDigest(input.payload.opponent_response)
          ].filter(Boolean).join("；") ||
          text(disagreement.disputed_premise) ||
          "本轮没有形成双方交叉回应",
        96
      ),
      practice: compact(
        text(processDigest.practice) ||
          roleDigest(input.payload.practice_advice) ||
          list(source.corrections)[0] ||
          "实践顾问未参与本轮取舍",
        88
      )
    };
    return source;
  }

  return source;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hasList(value: unknown) {
  return Array.isArray(value) && value.some((item) => text(item));
}

function list(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function compact(value: unknown, max: number) {
  const normalized = text(value).replace(/\s+/g, " ");
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

function compactList(value: unknown, count: number, max: number) {
  return list(value).slice(0, count).map((item) => compact(item, max));
}

function roleDigest(value: unknown) {
  if (!isRecord(value)) return "";
  return text(value.headline) || list(value.points)[0] || text(value.detail);
}

function selectedRole(input: RoleGenerationInput, roleId: string) {
  const roles = Array.isArray(input.payload.selected_roles)
    ? input.payload.selected_roles.filter(isRecord)
    : [];
  return roles.find((role) => role.role_id === roleId) || {};
}

function resolveRoleContract(input: RoleGenerationInput) {
  const direct = isRecord(input.payload.role_contract)
    ? input.payload.role_contract
    : isRecord(input.payload.stance_contract)
      ? input.payload.stance_contract
      : selectedRole(input, input.role.id);
  return fillRoleContract(input.role.id, direct);
}

function fillRoleContract(roleId: string, value: Record<string, any>) {
  const defaults = roleContractDefaults(roleId);
  return {
    serves: text(value.serves) || defaults.serves,
    objective_function:
      text(value.objective_function) || defaults.objective_function,
    acceptable_costs:
      list(value.acceptable_costs).length > 0
        ? list(value.acceptable_costs)
        : defaults.acceptable_costs,
    hard_boundaries:
      Array.isArray(value.hard_boundaries)
        ? list(value.hard_boundaries)
        : defaults.hard_boundaries
  };
}

function roleContractDefaults(roleId: string) {
  const hard = ["不提供直接严重伤害或违法实施方案", "不把捏造事实当作证据"];
  if (roleId === "supporter") {
    return {
      serves: "推进目标的行动方",
      objective_function: "最大化目标达成率和行动收益",
      acceptable_costs: ["可控争议", "试错成本"],
      hard_boundaries: hard
    };
  }
  if (roleId === "opponent") {
    return {
      serves: "承担失败成本和外部性的利益相关者",
      objective_function: "最小化不可逆损失和外部成本",
      acceptable_costs: ["降低速度", "放弃部分短期收益"],
      hard_boundaries: hard
    };
  }
  if (roleId === "practice-advisor") {
    return {
      serves: "最终执行和承担选择后果的用户",
      objective_function: "按用户优先级选择净收益最高的路径",
      acceptable_costs: ["放弃非优先目标"],
      hard_boundaries: hard
    };
  }
  return {
    serves: "本轮决策参与者",
    objective_function: "让不同目标函数的收益和代价可比较",
    acceptable_costs: ["保留冲突"],
    hard_boundaries: hard
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
}
