export type Project = {
  id: string;
  name: string;
  status: "active" | "archived";
  project_rules: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Session = {
  id: string;
  project_id: string;
  title: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type Provider = {
  id: string;
  label: string;
  provider: string;
  base_url: string;
  api_key_ref: string;
  model: string;
  status: "active" | "disabled";
  has_env_key: boolean;
};

export type RoleDefinition = {
  id: string;
  version: string;
  md_path: string;
  content_hash: string;
  updated_at: string;
};

export type AppState = {
  projects: Project[];
  sessions: Session[];
  providers: Provider[];
  roles: RoleDefinition[];
};

export type ContextOption = {
  id: string;
  label: string;
  value: string;
  description: string;
};

export type ContextQuestion = {
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
};

export type PremiseItem = {
  key: string;
  label: string;
  value: string;
  source: "user" | "system" | "skipped";
};

export type RoleOutput = {
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
  [key: string]: unknown;
};

export type ProcessModule = {
  id: string;
  role_id: string;
  phase: string;
  label: string;
  headline: string;
  tags: string[];
  content: RoleOutput;
};

export type RolePanel = {
  id: "supporter" | "opponent" | "practice-advisor";
  label: string;
  status: "pending" | "completed";
  headline: string;
  tags: string[];
  initial: RoleOutput | null;
  response: RoleOutput | null;
};

export type DiscussionRoleConfig = {
  role_id:
    | "context-guide"
    | "moderator"
    | "supporter"
    | "opponent"
    | "practice-advisor"
    | "synthesizer";
  label: string;
  note: string;
  mission: string;
  stance: string;
  serves: string;
  objective_function: string;
  acceptable_costs: string[];
  hard_boundaries: string[];
  decision_criteria: string[];
  non_negotiables: string[];
  generated: boolean;
  locked: boolean;
  enabled: boolean;
  content: string;
  content_hash: string;
  source_path: string;
};

export type ConclusionOutput = {
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
};

export type FullRecordEntry = {
  id: string;
  role_id: string;
  phase: string;
  label: string;
  content: RoleOutput;
};

export type ActionOutput = {
  title: string;
  summary: string;
  modules: Array<{
    title: string;
    content: string;
    tags?: string[];
  }>;
};

export type Stage = {
  id: string;
  label: string;
  status: "pending" | "active" | "completed" | "failed";
};

export type ResultVersion = {
  id: string;
  type: "base" | "deep_risk" | "safer" | "usable_version";
  label: string;
  is_current: boolean;
  created_at: string;
};

export type DiscussionState = {
  discussion: {
    id: string;
    project_id: string;
    session_id: string;
    user_input: string;
    status: "preparing" | "needs_context" | "designing_roles" | "ready" | "running" | "paused" | "completed" | "failed";
    current_stage: string;
    error_json: { message?: string; [key: string]: unknown };
    created_at: string;
    updated_at: string;
  };
  questions: ContextQuestion[];
  premises: PremiseItem[];
  role_config: DiscussionRoleConfig[];
  role_config_confirmed: boolean;
  role_design_mode: "agent" | "context_compiled";
  role_design_notice: string;
  stages: Stage[];
  process: ProcessModule[];
  roles: RolePanel[];
  role_outputs: Array<{
    role_id: string;
    phase: string;
    prompt_hash: string;
    content: RoleOutput;
  }>;
  full_record: FullRecordEntry[];
  conclusion: ConclusionOutput | null;
  current_result: ConclusionOutput | ActionOutput | null;
  versions: ResultVersion[];
};

export type ArchiveState = {
  projects: Project[];
  sessions: Session[];
  legacy_discussions: Array<{
    id: string;
    project_id: string;
    session_id: string;
    user_input: string;
    created_at: string;
    result_count: number;
  }>;
};

export type ContextAnswer = {
  question_id: string;
  answer_type: "option" | "system" | "other" | "skip";
  value?: string;
};

export type DiscussionEvent = {
  id: number;
  discussion_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
};
