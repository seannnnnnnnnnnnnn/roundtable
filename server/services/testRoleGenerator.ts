import type { RoleGenerationInput } from "../types.js";

const generic = (headline: string, tags: string[], points: string[], detail: string) => ({
  headline,
  tags,
  points,
  detail
});

export function generateTestRoleOutput(input: RoleGenerationInput): unknown {
  const payload = input.payload as any;
  const userInput = String(payload.user_input || "");
  const identity = JSON.stringify(payload.premises || []).includes("达人号") ? "达人号" : "品牌号";

  if (input.role.id === "context-guide") {
    return {
      task_type: /话术/.test(userInput) ? "销售话术" : /商业|项目/.test(userInput) ? "商业想法" : "内容判断",
      needs_more_info: true,
      summary: "先确认判断目标、目标对象和发布身份。",
      inferred_premises: [],
      questions: [
        {
          id: "goal",
          premise_key: "goal",
          title: "这次最希望判断什么？",
          reason: "目标会改变圆桌采用的判断标准。",
          options: [
            { id: "direction", label: "整体方向", value: "整体方向", description: "判断是否值得继续" },
            { id: "conversion", label: "转化可能", value: "转化可能", description: "关注信任和行动" },
            { id: "risk", label: "表达风险", value: "表达风险", description: "关注误解和反感" }
          ],
          system_choice: { label: "整体方向", value: "整体方向", confidence: "medium" },
          allow_other: true,
          allow_skip: true
        },
        {
          id: "identity",
          premise_key: "identity",
          title: "准备用什么身份？",
          reason: "身份会改变可信度和表达边界。",
          options: [
            { id: "brand", label: "品牌号", value: "品牌号", description: "强调可信度和转化" },
            { id: "creator", label: "达人号", value: "达人号", description: "强调体验感和自然表达" }
          ],
          system_choice: { label: "品牌号", value: "品牌号", confidence: "low" },
          allow_other: true,
          allow_skip: true
        }
      ]
    };
  }

  if (input.role.id === "role-architect") {
    const topic = /话术/.test(userInput) ? "销售转化" : /新品|文案/.test(userInput) ? "内容可信度" : "商业可行性";
    const requestedRoleIds = new Set(
      Array.isArray(payload.role_slots)
        ? payload.role_slots.map((item: any) => String(item?.role_id || ""))
        : []
    );
    const includeRole = (roleId: string) => requestedRoleIds.size === 0 || requestedRoleIds.has(roleId);
    return {
      analysis_summary: `围绕${topic}建立相互独立的成立论证与风险质疑。`,
      roles: [
        {
          role_id: "moderator",
          label: `${topic}主持人`,
          mission: "锁定决策目标并阻止双方偏离已确认前提",
          stance: "保持中立，只提炼真实前提分歧",
          decision_criteria: ["是否围绕用户目标", "分歧是否落在具体前提"],
          non_negotiables: ["不替正反方发言", "不引入新论点"],
          markdown: "## 本轮职责\n持续检查双方是否仍在回答同一个决策问题。"
        },
        {
          role_id: "supporter",
          label: `${topic}成立论证者`,
          mission: "从真实价值与最小成立条件证明方案值得推进",
          stance: "只要最小成立条件可验证，就坚持保留推进价值",
          decision_criteria: ["需求是否真实", "条件是否可以验证"],
          non_negotiables: ["不把局部风险等同于整体失败", "不接受对方改写本方任务"],
          markdown: "## 本轮职责\n以最小成立条件为核心，逐条回应风险但保持推进方向。"
        },
        {
          role_id: "opponent",
          label: `${topic}风险守门人`,
          mission: "检验证据、成本和最可能导致失败的隐藏前提",
          stance: "核心证据与执行条件未满足前，不接受方案已经成立",
          decision_criteria: ["证据是否足够", "风险是否可逆"],
          non_negotiables: ["可能性不能替代证据", "不接受对方改写本方举证门槛"],
          markdown: "## 本轮职责\n承认局部价值时仍需保留核心举证门槛。"
        },
        {
          role_id: "practice-advisor",
          label: `${topic}落地顾问`,
          mission: "把保留价值与风险控制转换为最小可执行动作",
          stance: "不站队，只选择风险可控的下一步",
          decision_criteria: ["动作是否可执行", "验证成本是否合理"],
          non_negotiables: ["不跳过验证", "不提出讨论外的新方向"],
          markdown: "## 本轮职责\n优先给出低成本、可回退、可验证的行动。"
        },
        {
          role_id: "synthesizer",
          label: `${topic}综合输出者`,
          mission: "只基于已出现的观点生成条件判断",
          stance: "不新增事实，只说明何时成立与何时不建议",
          decision_criteria: ["是否引用已有讨论", "建议是否可执行"],
          non_negotiables: ["不另起答案", "不掩盖缺失信息"],
          markdown: "## 本轮职责\n让结论能够追溯到正反观点和实践取舍。"
        }
      ].filter((role) => includeRole(role.role_id))
    };
  }

  if (input.role.id === "moderator" && input.phase === "framing") {
    return {
      ...generic("围绕成立条件与可信度展开", ["目标", "身份", "边界"], ["先看价值是否真实", "再看风险能否修正"], "本轮只处理会影响行动的分歧。"),
      topic: "这个想法在当前身份和目标下是否值得推进",
      decision_target: "形成条件判断和修正动作",
      boundaries: ["不假装完成事实核验", "不脱离已确认前提"]
    };
  }

  if (input.role.id === "moderator") {
    return {
      ...generic("真正争议是价值能否抵消可信度成本", ["关键分歧", "信任", "证据"], ["支持方相信价值足以吸引用户", "反对方认为身份会放大怀疑"], "双方争夺的是用户是否愿意相信这段表达。"),
      supporter_claim: "价值和场景足以吸引目标用户",
      disputed_premise: "目标用户是否信任当前发布身份",
      opponent_claim: "证据和身份不足以支撑强表达"
    };
  }

  if (input.role.id === "supporter") {
    const response = input.phase === "response";
    return {
      ...generic(
      response ? "风险可以通过降低承诺和补充细节修正" : `${identity}场景下方向有成立空间`,
      response ? ["回应风险", "修正"] : ["价值", "吸引力", "条件"],
      response
        ? ["承认证据不足", "把强结论改成真实观察", "补一个可验证细节"]
        : ["用户需求真实", "表达有具体场景", "条件是降低推销感"],
      response ? "反方指出的可信度问题成立，但不要求放弃方向。" : "方向成立不等于原表达可以直接使用。"
      ),
      stance_thesis: `${identity}场景下应保留推进方向`,
      position_status: "held",
      concessions: response ? ["承认证据需要补充"] : [],
      rebuttals: response ? ["证据不足要求修正表达，不等于方向失效"] : [],
      invalidating_evidence: []
    };
  }

  if (input.role.id === "opponent") {
    const response = input.phase === "response";
    return {
      ...generic(
      response ? "价值存在，但仍不足以覆盖身份带来的怀疑" : "最大风险是表达强度超过证据",
      response ? ["回应价值", "边界"] : ["风险", "证据", "误解"],
      response
        ? ["认可需求存在", "要求降低普遍化表达", "保留事实边界"]
        : ["单一案例不能证明普遍效果", "身份会放大广告感", "强承诺容易引发反感"],
      response ? "支持方修正后风险降低，但仍需要真实反馈。" : "风险来自可信度，而不是选题本身。"
      ),
      stance_thesis: "证据不足前不能把可能价值当成已经成立",
      position_status: "held",
      concessions: response ? ["认可需求可能存在"] : [],
      rebuttals: response ? ["需求存在仍不能替代可信证据"] : [],
      invalidating_evidence: []
    };
  }

  if (input.role.id === "practice-advisor") {
    return {
      ...generic("保留选题价值，重写表达方式", ["取舍", "行动", "稳妥"], ["保留真实需求", "规避强承诺", "先小范围验证"], "最小动作是先改标题和开头，再补证据。"),
      keep: ["真实用户需求", "具体使用场景"],
      avoid: ["普遍化结论", "过强品牌露出"],
      actions: ["降低标题承诺", "补一个真实细节", "用低压力方式验证反馈"]
    };
  }

  if (input.role.id === "synthesizer" && input.phase.startsWith("action:")) {
    const action = input.phase.slice("action:".length);
    const actionCopy = action === "deep_risk"
      ? {
          title: "风险深挖",
          summary: "当前最需要验证的是发布身份带来的信任折损。",
          modules: [
            { title: "高概率风险", content: "强承诺会让用户先判断广告意图，再理解内容价值。", tags: ["信任", "表达强度"] },
            { title: "验证动作", content: "用两个标题版本做小范围测试，观察负面反馈与停留差异。", tags: ["小范围验证"] }
          ]
        }
      : action === "safer"
        ? {
            title: "更稳妥版本",
            summary: "保留真实场景，把确定性承诺改成可验证的个人观察。",
            modules: [
              { title: "表达调整", content: "先描述具体困扰和使用过程，再给有限条件下的结论。", tags: ["降低承诺", "补充细节"] },
              { title: "发布边界", content: "明确适用人群，不把单一体验泛化为普遍效果。", tags: ["边界"] }
            ]
          }
        : {
            title: "可用版本",
            summary: `已按${String(payload.target_format || "行动方案")}整理为可直接继续编辑的版本。`,
            modules: [
              { title: "开头", content: "先从一个具体问题切入，不急于给出产品结论。", tags: ["自然切入"] },
              { title: "主体", content: "说明真实使用场景、可验证细节和适用边界。", tags: ["可信细节", "适用条件"] },
              { title: "收尾", content: "邀请用户根据自身情况判断，避免强推动。", tags: ["低压力行动"] }
            ]
          };
    return actionCopy;
  }

  return {
    conditional_judgement: "可以推进，但必须先降低承诺强度并补足可信细节。",
    support_reasons: ["目标用户确实存在相关需求", "选题具有具体场景和吸引力"],
    retained_risks: ["发布身份会放大广告感", "现有证据不足以支持普遍结论"],
    key_disagreement: {
      supporter_claim: "价值足以吸引目标用户",
      disputed_premise: "用户是否信任当前发布身份",
      opponent_claim: "证据不足会让价值表达失去可信度"
    },
    corrections: ["降低标题承诺", "把产品露出后置", "补充可验证细节"],
    confidence: {
      label: "中等",
      reason: "前提已经确认，但缺少真实发布反馈。",
      missing: ["真实发布数据", "目标用户反馈"]
    },
    process_summary: "正反双方最终同意保留方向，分歧集中在可信度成本。"
  };
}
