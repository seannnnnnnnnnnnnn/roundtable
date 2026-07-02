export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type DiscussionStatus =
  | "preparing"
  | "needs_context"
  | "designing_roles"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export type DiscussionStage =
  | "context"
  | "role_design"
  | "framing"
  | "positions"
  | "responses"
  | "conflict"
  | "practice"
  | "synthesis"
  | "completed";

export type RoleId =
  | "context-guide"
  | "role-architect"
  | "moderator"
  | "supporter"
  | "opponent"
  | "practice-advisor"
  | "synthesizer";

export interface ContextOption {
  id: string;
  label: string;
  value: string;
  description: string;
}

export interface ContextQuestion {
  id: string;
  premise_key: string;
  title: string;
  reason: string;
  options: ContextOption[];
  system_choice: {
    label: string;
    value: string;
    confidence: "low" | "medium" | "high";
  };
  allow_other: boolean;
  allow_skip: boolean;
}

export interface PremiseItem {
  key: string;
  label: string;
  value: string;
  source: "user" | "system" | "skipped";
}

export interface ContextGuideOutput {
  task_type: string;
  needs_more_info: boolean;
  summary: string;
  inferred_premises: PremiseItem[];
  questions: ContextQuestion[];
}

export interface DesignedRoleSpec {
  role_id: Exclude<RoleId, "context-guide" | "role-architect">;
  label: string;
  mission: string;
  stance: string;
  serves: string;
  objective_function: string;
  acceptable_costs: string[];
  hard_boundaries: string[];
  decision_criteria: string[];
  non_negotiables: string[];
  /** 精简执行提醒；运行时会与结构化契约一起编译为完整 Markdown。 */
  markdown: string;
}

export interface RoleDesignOutput {
  analysis_summary: string;
  roles: DesignedRoleSpec[];
}

export interface RoleOutput {
  headline: string;
  tags: string[];
  points: string[];
  detail: string;
  value_basis?: {
    serves: string;
    objective_function: string;
    acceptable_costs: string[];
    hard_boundaries: string[];
  };
  gains?: string[];
  costs?: string[];
  externalities?: string[];
  stance_thesis?: string;
  position_status?: "held" | "refined" | "revised";
  concessions?: string[];
  rebuttals?: string[];
  invalidating_evidence?: string[];
}

export interface ModeratorFrame extends RoleOutput {
  topic: string;
  decision_target: string;
  boundaries: string[];
}

export interface ConflictOutput extends RoleOutput {
  supporter_claim: string;
  disputed_premise: string;
  opponent_claim: string;
}

export interface PracticeOutput extends RoleOutput {
  keep: string[];
  avoid: string[];
  actions: string[];
  decision_paths: Array<{
    label: string;
    objective: string;
    action: string;
    gains: string[];
    costs: string[];
    who_pays: string;
  }>;
}

export interface ConclusionOutput {
  conditional_judgement: string;
  support_reasons: string[];
  retained_risks: string[];
  key_disagreement: {
    supporter_claim: string;
    disputed_premise: string;
    opponent_claim: string;
  };
  corrections: string[];
  confidence: {
    label: string;
    reason: string;
    missing: string[];
  };
  process_summary: string;
  value_lenses: Array<{
    label: string;
    serves: string;
    objective: string;
    judgement: string;
    gains: string[];
    costs: string[];
  }>;
  choice_guidance: Array<{
    priority: string;
    choose: string;
    accept: string;
  }>;
  bottom_line: string[];
  display_summary: {
    judgement: string;
    conditions: string[];
    maximum_risk: string;
    key_disagreement: string;
    recommended_changes: string[];
  };
  process_digest: {
    supporter: string;
    opponent: string;
    cross_response: string;
    practice: string;
  };
}

export interface ActionOutput {
  title: string;
  summary: string;
  modules: Array<{
    title: string;
    content: string;
    tags?: string[];
  }>;
}

export interface LoadedRole {
  id: RoleId;
  content: string;
  hash: string;
  version: string;
  path: string;
}

export interface RoleGenerationInput {
  discussionId: string;
  projectId: string;
  sessionId: string;
  role: LoadedRole;
  phase: string;
  payload: JsonObject;
}

export interface DiscussionEvent {
  id: number;
  discussion_id: string;
  type: string;
  payload: JsonObject;
  created_at: string;
}
