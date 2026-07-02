import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Eye,
  EyeOff,
  FileOutput,
  Folder,
  Gauge,
  KeyRound,
  Layers3,
  LockKeyhole,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  PencilLine,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Square,
  Target,
  UserRoundCheck,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type {
  ActionOutput,
  AppState,
  ArchiveState,
  ConclusionOutput,
  ContextAnswer,
  DiscussionRoleConfig,
  DiscussionState,
  FullRecordEntry,
  ProcessModule,
  Project,
  RoleOutput,
  RolePanel,
  Session
} from "./types";

type RightView = "roles" | "conclusion" | "detail" | "role_setup";
type Drawer = "settings" | "archive" | null;
type DraftAnswer = ContextAnswer & { display: string };

const EMPTY_APP: AppState = { projects: [], sessions: [], providers: [], roles: [] };

const STAGE_COPY: Record<string, string> = {
  context: "前提",
  framing: "定题",
  positions: "立场",
  responses: "回应",
  conflict: "分歧",
  practice: "取舍",
  synthesis: "综合"
};

function App() {
  const [appState, setAppState] = useState<AppState>(EMPTY_APP);
  const [projectId, setProjectId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [discussions, setDiscussions] = useState<DiscussionState[]>([]);
  const [active, setActive] = useState<DiscussionState | null>(null);
  const [rightView, setRightView] = useState<RightView>("roles");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [mobileCanvasOpen, setMobileCanvasOpen] = useState(false);
  const [archive, setArchive] = useState<ArchiveState | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>({});
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherValue, setOtherValue] = useState("");
  const [selectedProcessId, setSelectedProcessId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState<RolePanel["id"]>("supporter");
  const [roleDrafts, setRoleDrafts] = useState<DiscussionRoleConfig[]>([]);
  const [selectedSetupRoleId, setSelectedSetupRoleId] =
    useState<DiscussionRoleConfig["role_id"]>("moderator");
  const [roleDirty, setRoleDirty] = useState(false);
  const [createMode, setCreateMode] = useState<"project" | "session" | null>(null);
  const [createValue, setCreateValue] = useState("");
  const [usableOpen, setUsableOpen] = useState(false);
  const [customTarget, setCustomTarget] = useState("");
  const [generatingTarget, setGeneratingTarget] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const cancelledActionRef = useRef(false);

  const activeProjects = appState.projects.filter((item) => item.status === "active");
  const project = activeProjects.find((item) => item.id === projectId) || null;
  const sessions = appState.sessions.filter(
    (item) => item.project_id === projectId && item.status === "active"
  );
  const session = sessions.find((item) => item.id === sessionId) || null;
  const providerReady = appState.providers.some(
    (item) => item.status === "active" && item.has_env_key && item.provider !== "mock"
  );
  const actionBusy = ["deep_risk", "safer", "usable_version"].includes(busy);
  const canPause = Boolean(
    active &&
    (
      ["preparing", "needs_context", "designing_roles", "ready", "running"].includes(active.discussion.status) ||
      actionBusy
    )
  );

  useEffect(() => {
    void refreshApp();
  }, []);

  useEffect(() => {
    if (activeProjects.length === 0) {
      setProjectId("");
      setSessionId("");
      return;
    }
    if (!activeProjects.some((item) => item.id === projectId)) {
      const remembered = localStorage.getItem("roundtable-project");
      const next = activeProjects.find((item) => item.id === remembered) || activeProjects[0];
      setProjectId(next.id);
    }
  }, [appState.projects, projectId]);

  useEffect(() => {
    if (!projectId) return;
    if (!sessions.some((item) => item.id === sessionId)) {
      const remembered = localStorage.getItem(`roundtable-session:${projectId}`);
      const next = sessions.find((item) => item.id === remembered) || sessions[0];
      setSessionId(next?.id || "");
    }
  }, [appState.sessions, projectId, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setDiscussions([]);
      setActive(null);
      return;
    }
    localStorage.setItem("roundtable-project", projectId);
    localStorage.setItem(`roundtable-session:${projectId}`, sessionId);
    void loadSession(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    setQuestionIndex(0);
    setAnswers({});
    setOtherOpen(false);
    setOtherValue("");
    setSelectedProcessId(active.process.at(-1)?.id || "");
    setRoleDrafts(active.role_config || []);
    setSelectedSetupRoleId("moderator");
    setRoleDirty(false);
  }, [active?.discussion.id]);

  useEffect(() => {
    if (
      !active ||
      !["preparing", "designing_roles", "running"].includes(active.discussion.status)
    ) return;
    let refreshTimer = 0;
    const refresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refreshDiscussion(active.discussion.id), 120);
    };
    const unsubscribe = api.subscribeDiscussion(active.discussion.id, (event) => {
      refresh();
      if (event.type === "discussion_completed") {
        setRightView("conclusion");
        setMobileCanvasOpen(true);
      }
    }, refresh);
    return () => {
      window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [active?.discussion.id, active?.discussion.status]);

  async function refreshApp() {
    try {
      setAppState(await api.appState());
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function loadSession(id: string, preferredDiscussionId?: string) {
    try {
      const response = await api.sessionDiscussions(id);
      setDiscussions(response.discussions);
      const next = preferredDiscussionId
        ? response.discussions.find((item) => item.discussion.id === preferredDiscussionId)
        : response.discussions.at(-1);
      setActive(next || null);
      if (next?.discussion.status === "completed") {
        setRightView("conclusion");
        setMobileCanvasOpen(true);
      }
      else if (next?.discussion.status === "ready") setRightView("role_setup");
      else setRightView("roles");
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function refreshDiscussion(id: string) {
    try {
      const next = await api.discussion(id);
      setActive(next);
      setDiscussions((items) =>
        [...items.filter((item) => item.discussion.id !== id), next].sort((a, b) =>
          a.discussion.created_at.localeCompare(b.discussion.created_at)
        )
      );
      setSelectedProcessId((current) => current || next.process.at(-1)?.id || "");
      if (next.discussion.status === "completed") setRightView("conclusion");
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function createWorkspaceItem() {
    const value = createValue.trim();
    if (!value) return;
    setBusy("create");
    setError("");
    try {
      if (createMode === "project") {
        const { project: nextProject } = await api.createProject(value);
        const { session: nextSession } = await api.createSession(nextProject.id, "首次圆桌");
        await refreshApp();
        setProjectId(nextProject.id);
        setSessionId(nextSession.id);
      } else if (createMode === "session" && projectId) {
        const { session: nextSession } = await api.createSession(projectId, value);
        await refreshApp();
        setSessionId(nextSession.id);
      }
      setCreateMode(null);
      setCreateValue("");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy("");
    }
  }

  async function ensureWorkspace() {
    let nextProject = project;
    let nextSession = session;
    if (!nextProject) {
      const created = await api.createProject("我的圆桌项目");
      nextProject = created.project;
    }
    if (!nextSession || nextSession.project_id !== nextProject.id) {
      const created = await api.createSession(nextProject.id, "首次圆桌");
      nextSession = created.session;
    }
    await refreshApp();
    setProjectId(nextProject.id);
    setSessionId(nextSession.id);
    return { projectId: nextProject.id, sessionId: nextSession.id };
  }

  async function submitDiscussion() {
    const userInput = input.trim();
    if (!userInput) return;
    setBusy("submit");
    setError("");
    try {
      const workspace = await ensureWorkspace();
      const next = await api.createDiscussion(workspace.projectId, workspace.sessionId, userInput);
      setInput("");
      setActive(next);
      setDiscussions((items) => [...items, next]);
      setRightView("roles");
    } catch (cause) {
      const message = messageOf(cause);
      setError(message);
      if (/Provider|环境变量|模型/.test(message)) setDrawer("settings");
    } finally {
      setBusy("");
    }
  }

  function chooseAnswer(answer: DraftAnswer) {
    if (!active) return;
    const question = active.questions[questionIndex];
    if (!question) return;
    setAnswers((current) => ({ ...current, [question.id]: answer }));
    setOtherOpen(false);
    setOtherValue("");
    setQuestionIndex((current) => Math.min(current + 1, active.questions.length));
  }

  async function confirmPremises() {
    if (!active) return;
    const completeAnswers = active.questions.map((question) =>
      answers[question.id] || {
        question_id: question.id,
        answer_type: "skip" as const,
        display: "暂不确定"
      }
    );
    setBusy("premises");
    setError("");
    try {
      const next = await api.answerContext(active.discussion.id, completeAnswers);
      setActive(next);
      updateDiscussion(next);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy("");
    }
  }

  async function confirmRoles() {
    if (!active || roleDrafts.length !== 6) return;
    setBusy("roles");
    setError("");
    try {
      const next = await api.configureDiscussionRoles(
        active.discussion.id,
        roleDrafts.map((role) => ({
          role_id: role.role_id,
          enabled: role.enabled,
          content: role.content
        }))
      );
      setActive(next);
      updateDiscussion(next);
      setRoleDrafts(next.role_config);
      setRoleDirty(false);
      setRightView("role_setup");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy("");
    }
  }

  function updateRoleDraft(
    roleId: DiscussionRoleConfig["role_id"],
    patch: Partial<Pick<DiscussionRoleConfig, "content" | "enabled">>
  ) {
    setRoleDrafts((items) =>
      items.map((item) => (item.role_id === roleId ? { ...item, ...patch } : item))
    );
    setRoleDirty(true);
  }

  async function startRoundtable(retry = false) {
    if (!active) return;
    setBusy("run");
    setError("");
    setRightView("roles");
    try {
      const next = retry
        ? await api.retryDiscussion(active.discussion.id)
        : await api.runDiscussion(active.discussion.id);
      setActive(next);
      updateDiscussion(next);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy("");
    }
  }

  async function pauseCurrentDiscussion() {
    if (!active || !canPause) return;
    if (actionBusy) cancelledActionRef.current = true;
    setCancelling(true);
    setError("");
    try {
      const next = await api.pauseDiscussion(active.discussion.id);
      setActive(next);
      updateDiscussion(next);
    } catch (cause) {
      cancelledActionRef.current = false;
      setError(messageOf(cause));
    } finally {
      setCancelling(false);
    }
  }

  async function runAction(
    actionType: "deep_risk" | "safer" | "usable_version",
    target = ""
  ) {
    if (!active) return;
    setBusy(actionType);
    if (actionType === "usable_version") setGeneratingTarget(target || "可用版本");
    setError("");
    try {
      const next = await api.runAction(active.discussion.id, actionType, target);
      setActive(next);
      updateDiscussion(next);
      setRightView("conclusion");
      setUsableOpen(false);
      setCustomTarget("");
      setGeneratingTarget("");
    } catch (cause) {
      if (!cancelledActionRef.current) setError(messageOf(cause));
    } finally {
      setBusy("");
      cancelledActionRef.current = false;
      if (actionType === "usable_version") setGeneratingTarget("");
    }
  }

  async function selectVersion(versionId: string) {
    if (!active) return;
    try {
      const next = await api.selectVersion(active.discussion.id, versionId);
      setActive(next);
      updateDiscussion(next);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function archiveProject(item: Project) {
    await api.setProjectStatus(item.id, "archived");
    await refreshApp();
  }

  async function archiveSession(item: Session) {
    await api.setSessionStatus(item.id, "archived");
    await refreshApp();
  }

  async function openArchive() {
    setDrawer("archive");
    try {
      setArchive(await api.archive());
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  function updateDiscussion(next: DiscussionState) {
    setDiscussions((items) =>
      [...items.filter((item) => item.discussion.id !== next.discussion.id), next].sort((a, b) =>
        a.discussion.created_at.localeCompare(b.discussion.created_at)
      )
    );
  }

  function beginNewDiscussion() {
    setActive(null);
    setRightView("roles");
    setMobileCanvasOpen(false);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  const question = active?.questions[questionIndex] || null;
  const premisePreview = useMemo(() => {
    if (!active) return [];
    return active.questions.map((item) => ({
      key: item.premise_key,
      label: item.title,
      value: answers[item.id]?.display || "暂不确定"
    }));
  }, [active, answers]);

  const selectedProcess =
    active?.process.find((item) => item.id === selectedProcessId) || active?.process.at(-1) || null;
  const selectedRole =
    active?.roles.find((item) => item.id === selectedRoleId) || active?.roles[0] || null;
  const selectedSetupRole =
    roleDrafts.find((item) => item.role_id === selectedSetupRoleId) || roleDrafts[0] || null;

  return (
    <div className="workspace">
      <LeftRail
        projects={activeProjects}
        sessions={sessions}
        projectId={projectId}
        sessionId={sessionId}
        onProject={setProjectId}
        onSession={setSessionId}
        onNewDiscussion={beginNewDiscussion}
        onCreate={(mode) => {
          setCreateMode(mode);
          setCreateValue("");
        }}
        onArchiveProject={archiveProject}
        onArchiveSession={archiveSession}
        onSettings={() => setDrawer("settings")}
        onArchive={openArchive}
      />

      <main className="control-column">
        <header className="column-header">
          <div>
            <span className="eyebrow">当前会话</span>
            <h1>{session?.title || "新的圆桌"}</h1>
          </div>
          <span className={`provider-dot ${providerReady ? "ready" : ""}`} title={providerReady ? "模型已就绪" : "模型未就绪"} />
        </header>

        {discussions.length > 0 && (
          <div className="discussion-strip" aria-label="会话内的圆桌记录">
            {discussions.slice(-6).map((item, index) => (
              <button
                key={item.discussion.id}
                className={active?.discussion.id === item.discussion.id ? "selected" : ""}
                onClick={() => {
                  setActive(item);
                  setRightView(
                    item.discussion.status === "completed"
                      ? "conclusion"
                      : item.discussion.status === "ready"
                        ? "role_setup"
                        : "roles"
                  );
                }}
                title={item.discussion.user_input}
              >
                <span>{index + Math.max(1, discussions.length - 5)}</span>
                {short(item.discussion.user_input, 18)}
              </button>
            ))}
          </div>
        )}

        <section className="control-scroll">
          {!providerReady && (
            <button className="provider-notice" onClick={() => setDrawer("settings")}>
              <CircleAlert size={17} />
              <span>
                <strong>真实模型尚未就绪</strong>
                <small>查看 Provider 环境状态</small>
              </span>
              <ChevronRight size={16} />
            </button>
          )}

          {active && (
            <article className="question-card input-card">
              <div className="card-kicker">
                <MessageSquareText size={15} />
                你 · 已发送
              </div>
              <p>{active.discussion.user_input}</p>
              <StatusPill status={active.discussion.status} />
            </article>
          )}

          {active?.discussion.status === "needs_context" && question && (
            <ContextQuestionCard
              question={question}
              index={questionIndex}
              total={active.questions.length}
              selected={answers[question.id]}
              otherOpen={otherOpen}
              otherValue={otherValue}
              onOtherOpen={() => setOtherOpen(true)}
              onOtherValue={setOtherValue}
              onBack={() => setQuestionIndex((value) => Math.max(0, value - 1))}
              onChoose={chooseAnswer}
            />
          )}

          {active?.discussion.status === "preparing" && (
            <article className="question-card preparing-card">
              <div className="card-kicker live">
                <LoaderCircle className="spin" size={15} />
                API 思考
              </div>
              <h2>引导 Agent 正在判断还缺哪些关键条件</h2>
              <p className="muted">问题已经进入会话。你可以切换页面，完成后会自动出现选择题。</p>
              <div className="thinking-steps">
                <span className="completed"><Check size={12} />接收原文</span>
                <span className="active"><LoaderCircle className="spin" size={12} />判断缺失前提</span>
                <span><CircleDot size={12} />生成选择题</span>
              </div>
            </article>
          )}

          {active?.discussion.status === "designing_roles" && (
            <article className="question-card preparing-card role-designing-card">
              <div className="card-kicker live">
                <LoaderCircle className="spin" size={15} />
                角色编制 Agent
              </div>
              <h2>正在为这个问题定义本轮专属角色</h2>
              <p className="muted">Agent 正在根据问题和已确认前提编写角色任务、立场锚点和 md。完成后可以逐个查看、修改并确认。</p>
              <div className="thinking-steps">
                <span className="completed"><Check size={12} />读取讨论前提</span>
                <span className="active"><LoaderCircle className="spin" size={12} />编制角色与立场</span>
                <span><CircleDot size={12} />生成本轮 md</span>
              </div>
            </article>
          )}

          {active?.discussion.status === "needs_context" && !question && (
            <article className="question-card premise-review">
              <div className="card-kicker">
                <Check size={15} />
                讨论前提
              </div>
              <h2>本次圆桌将按这些条件进行</h2>
              <div className="premise-list">
                {premisePreview.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => {
                      const index = active.questions.findIndex((questionItem) => questionItem.premise_key === item.key);
                      setQuestionIndex(Math.max(0, index));
                    }}
                  >
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
              <button className="primary-button" disabled={busy === "premises"} onClick={confirmPremises}>
                {busy === "premises" ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
                确认前提
              </button>
            </article>
          )}

          {active?.discussion.status === "ready" && (
            <RoleSetupCard
              premises={active.premises}
              roles={roleDrafts}
              notice={active.role_design_notice}
              confirmed={active.role_config_confirmed && !roleDirty}
              busy={busy}
              selectedRoleId={selectedSetupRoleId}
              onSelect={(roleId) => {
                setSelectedSetupRoleId(roleId);
                setRightView("role_setup");
                setMobileCanvasOpen(true);
              }}
              onToggle={(roleId, enabled) => updateRoleDraft(roleId, { enabled })}
              onConfirm={confirmRoles}
              onStart={() => startRoundtable()}
            />
          )}

          {active?.discussion.status === "running" && (
            <article className="question-card stage-card">
              <div className="card-kicker live">
                <span className="live-dot" />
                圆桌进行中
              </div>
              <StageList stages={active.stages} />
              <p className="muted">页面刷新后可继续恢复当前阶段。</p>
            </article>
          )}

          {active?.discussion.status === "failed" && (
            <article className="question-card failure-card">
              <div className="card-kicker">
                <ShieldAlert size={15} />
                本轮暂停
              </div>
              <h2>
                {active.discussion.current_stage === "context"
                  ? "引导问题生成失败"
                  : active.discussion.current_stage === "role_design"
                    ? "角色编制失败"
                    : "已保留完成的模块"}
              </h2>
              <p>{active.discussion.error_json?.message || "角色执行失败，请从当前阶段重试。"}</p>
              <button className="primary-button" disabled={busy === "run"} onClick={() => startRoundtable(true)}>
                <RefreshCw size={17} />
                {active.discussion.current_stage === "context" ? "重新生成引导问题" : "从失败阶段重试"}
              </button>
            </article>
          )}

          {active?.discussion.status === "paused" && (
            <article className="question-card paused-card">
              <div className="card-kicker">
                <Square size={14} />
                本轮已暂停
              </div>
              <h2>已停止当前处理，完成内容仍然保留</h2>
              <p>可以继续本轮，也可以直接在下方输入一个新问题。</p>
              <button className="primary-button" disabled={busy === "run"} onClick={() => startRoundtable(true)}>
                {busy === "run" ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
                继续本轮
              </button>
            </article>
          )}

          {active && active.process.length > 0 && (
            <CenterDiscussionFeed
              modules={active.process}
              selectedId={selectedProcessId}
              running={active.discussion.status === "running"}
              onSelect={(moduleId) => {
                setSelectedProcessId(moduleId);
                setRightView("detail");
                setMobileCanvasOpen(true);
              }}
            />
          )}

          {active?.discussion.status === "completed" && (
            <article className="question-card action-card">
              <div className="card-kicker">
                <Target size={15} />
                继续处理
              </div>
              <h2>基于本轮圆桌继续</h2>
              {["deep_risk", "safer", "usable_version"].includes(busy) && (
                <div className="action-processing-banner">
                  <LoaderCircle className="spin" size={15} />
                  <span>
                    <strong>
                      {busy === "deep_risk"
                        ? "正在沿用本轮观点深挖风险"
                        : busy === "safer"
                          ? "正在整理更稳妥的修正方案"
                          : `正在生成${generatingTarget || "可用版本"}`}
                    </strong>
                    <small>原圆桌内容和当前版本都会保留</small>
                  </span>
                </div>
              )}
              <div className="action-grid">
                <button className={busy === "deep_risk" ? "processing" : ""} disabled={Boolean(busy)} onClick={() => runAction("deep_risk")}>
                  {busy === "deep_risk" ? <LoaderCircle className="spin" size={17} /> : <ShieldAlert size={17} />}
                  <span><strong>{busy === "deep_risk" ? "正在深挖风险" : "深挖风险"}</strong><small>{busy === "deep_risk" ? "请稍候，完成后自动切换版本" : "放大最不稳的前提"}</small></span>
                </button>
                <button className={busy === "safer" ? "processing" : ""} disabled={Boolean(busy)} onClick={() => runAction("safer")}>
                  {busy === "safer" ? <LoaderCircle className="spin" size={17} /> : <UserRoundCheck size={17} />}
                  <span><strong>{busy === "safer" ? "正在重组方案" : "改得更稳"}</strong><small>{busy === "safer" ? "保留价值并降低表达风险" : "保留价值，降低风险"}</small></span>
                </button>
                <button className={busy === "usable_version" ? "processing" : ""} disabled={Boolean(busy)} onClick={() => setUsableOpen(true)}>
                  {busy === "usable_version" ? <LoaderCircle className="spin" size={17} /> : <FileOutput size={17} />}
                  <span><strong>{busy === "usable_version" ? `正在生成${generatingTarget}` : "生成可用版本"}</strong><small>{busy === "usable_version" ? "完成后自动显示在右侧" : "选择最终使用格式"}</small></span>
                </button>
              </div>
            </article>
          )}

          {!active && (
            <div className="empty-control">
              <div className="empty-orbit"><UsersRound size={26} /></div>
              <h2>从一个真实问题开始</h2>
              <p>输入文案、选题、话术或商业想法。系统会先补齐关键条件。</p>
            </div>
          )}

          {error && (
            <div className="inline-error">
              <CircleAlert size={16} />
              <span>{error}</span>
              <button onClick={() => setError("")}><X size={14} /></button>
            </div>
          )}
        </section>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (canPause) void pauseCurrentDiscussion();
            else void submitDiscussion();
          }}
        >
          <textarea
            ref={composerRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="输入一个需要多方讨论的问题…"
            rows={3}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canPause) void pauseCurrentDiscussion();
                else void submitDiscussion();
              }
            }}
          />
          <div>
            <span>Enter 发送 · Shift + Enter 换行</span>
            <button
              type="submit"
              className={canPause ? "pause-button" : ""}
              disabled={canPause ? cancelling : !input.trim() || Boolean(busy)}
              aria-label={canPause ? "暂停当前讨论" : "发起圆桌"}
              title={canPause ? (cancelling ? "正在暂停" : "暂停当前讨论") : "发起圆桌"}
            >
              {busy === "submit" || cancelling
                ? <LoaderCircle className="spin" size={18} />
                : canPause
                  ? <Square size={16} />
                  : <Send size={18} />}
            </button>
          </div>
        </form>
      </main>

      <ResultCanvas
        active={active}
        view={rightView}
        onView={setRightView}
        selectedProcess={selectedProcess}
        selectedRole={selectedRole}
        onRole={setSelectedRoleId}
        selectedSetupRole={selectedSetupRole}
        onSetupContent={(content) => {
          if (selectedSetupRole) updateRoleDraft(selectedSetupRole.role_id, { content });
        }}
        onVersion={selectVersion}
        mobileOpen={mobileCanvasOpen}
        onMobileClose={() => setMobileCanvasOpen(false)}
      />

      {createMode && (
        <Modal title={createMode === "project" ? "新建项目" : "新建会话"} onClose={() => setCreateMode(null)}>
          <label className="field-label">
            名称
            <input
              autoFocus
              value={createValue}
              onChange={(event) => setCreateValue(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void createWorkspaceItem()}
              placeholder={createMode === "project" ? "例如：内容增长" : "例如：新品发布文案"}
            />
          </label>
          <button className="primary-button" disabled={!createValue.trim() || busy === "create"} onClick={createWorkspaceItem}>
            <Plus size={17} />
            创建
          </button>
        </Modal>
      )}

      {usableOpen && active && (
        <Modal
          title={busy === "usable_version" ? `正在生成${generatingTarget}` : "生成什么可用版本？"}
          locked={busy === "usable_version"}
          onClose={() => {
            if (busy !== "usable_version") setUsableOpen(false);
          }}
        >
          {busy === "usable_version" ? (
            <div className="generation-progress">
              <span className="generation-spinner"><LoaderCircle className="spin" size={22} /></span>
              <h3>综合输出者正在继承本轮圆桌</h3>
              <p>正在读取前提、正反观点、交叉回应和主持人结论，不会重新起答。</p>
              <div>
                <span className="completed"><Check size={12} />载入本轮上下文</span>
                <span className="active"><LoaderCircle className="spin" size={12} />生成 {generatingTarget}</span>
                <span><CircleDot size={12} />创建新版本</span>
              </div>
              <button
                className="generation-cancel"
                disabled={cancelling}
                onClick={pauseCurrentDiscussion}
              >
                {cancelling ? <LoaderCircle className="spin" size={14} /> : <Square size={13} />}
                {cancelling ? "正在暂停" : "暂停生成"}
              </button>
            </div>
          ) : (
            <>
              <div className="format-options">
                {suggestFormats(active.discussion.user_input).map((format) => (
                  <button key={format} onClick={() => runAction("usable_version", format)}>
                    {format}<ChevronRight size={15} />
                  </button>
                ))}
              </div>
              <div className="custom-target">
                <input value={customTarget} onChange={(event) => setCustomTarget(event.target.value)} placeholder="其他，我自己填写" />
                <button disabled={!customTarget.trim()} onClick={() => runAction("usable_version", customTarget.trim())}>
                  生成
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {drawer === "settings" && (
        <Drawer title="设置" onClose={() => setDrawer(null)}>
          <SettingsPanel state={appState} onRefresh={refreshApp} onError={setError} />
        </Drawer>
      )}

      {drawer === "archive" && (
        <Drawer title="归档" onClose={() => setDrawer(null)}>
          <ArchivePanel state={archive} />
        </Drawer>
      )}
    </div>
  );
}

function LeftRail(props: {
  projects: Project[];
  sessions: Session[];
  projectId: string;
  sessionId: string;
  onProject: (id: string) => void;
  onSession: (id: string) => void;
  onNewDiscussion: () => void;
  onCreate: (mode: "project" | "session") => void;
  onArchiveProject: (project: Project) => void;
  onArchiveSession: (session: Session) => void;
  onSettings: () => void;
  onArchive: () => void;
}) {
  return (
    <aside className="left-rail">
      <div className="brand">
        <span className="brand-mark"><UsersRound size={19} /></span>
        <div className="nav-copy">
          <strong>ROUND TABLE</strong>
          <small>多方讨论工作台</small>
        </div>
      </div>
      <button className="new-discussion" title="新建讨论" onClick={props.onNewDiscussion}>
        <Plus size={17} />
        <span className="nav-copy">新建讨论</span>
      </button>
      <div className="nav-section">
        <div className="nav-section-title">
          <span className="nav-copy">项目</span>
          <button onClick={() => props.onCreate("project")} title="新建项目"><Plus size={14} /></button>
        </div>
        <nav className="project-list">
          {props.projects.map((project) => (
            <div key={project.id} className="project-group">
              <div className={`project-row ${props.projectId === project.id ? "selected" : ""}`}>
                <button className="project-main" onClick={() => props.onProject(project.id)} title={project.name}>
                  <span className="project-initial">{project.name.slice(0, 1)}</span>
                  <Folder size={15} />
                  <span className="nav-copy">{project.name}</span>
                </button>
                {props.projectId === project.id && (
                  <button className="row-action nav-copy" title="归档项目" onClick={() => props.onArchiveProject(project)}>
                    <Archive size={13} />
                  </button>
                )}
              </div>
              {props.projectId === project.id && (
                <div className="session-list">
                  {props.sessions.map((session) => (
                    <div key={session.id} className={`session-row ${props.sessionId === session.id ? "selected" : ""}`}>
                      <button onClick={() => props.onSession(session.id)} title={session.title}>
                        <MessageSquareText size={14} />
                        <span className="nav-copy">{session.title}</span>
                      </button>
                      {props.sessionId === session.id && (
                        <button className="row-action nav-copy" title="归档会话" onClick={() => props.onArchiveSession(session)}>
                          <Archive size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button className="add-session" title="新建会话" onClick={() => props.onCreate("session")}>
                    <Plus size={13} />
                    <span className="nav-copy">新建会话</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
      <div className="rail-footer">
        <button title="归档" onClick={props.onArchive}><Archive size={16} /><span className="nav-copy">归档</span></button>
        <button title="设置" onClick={props.onSettings}><Settings size={16} /><span className="nav-copy">设置</span></button>
      </div>
    </aside>
  );
}

function ContextQuestionCard(props: {
  question: DiscussionState["questions"][number];
  index: number;
  total: number;
  selected?: DraftAnswer;
  otherOpen: boolean;
  otherValue: string;
  onOtherOpen: () => void;
  onOtherValue: (value: string) => void;
  onBack: () => void;
  onChoose: (answer: DraftAnswer) => void;
}) {
  const questionId = props.question.id;
  return (
    <article className="question-card context-card">
      <div className="question-progress">
        <span>反问 Agent</span>
        <div>{Array.from({ length: props.total }, (_, index) => <i key={index} className={index <= props.index ? "active" : ""} />)}</div>
        <small>{props.index + 1}/{props.total}</small>
      </div>
      <h2>{props.question.title}</h2>
      <p className="muted">{props.question.reason}</p>
      <div className="choice-list">
        <button
          className="choice system-choice"
          onClick={() => props.onChoose({
            question_id: questionId,
            answer_type: "system",
            display: props.question.system_choice.value
          })}
        >
          <Sparkles size={16} />
          <span><strong>系统判断：{props.question.system_choice.label}</strong><small>按当前输入推断</small></span>
          <ArrowRight size={15} />
        </button>
        {props.question.options.map((option) => (
          <button
            key={option.id}
            className={`choice ${props.selected?.value === option.value ? "selected" : ""}`}
            onClick={() => props.onChoose({
              question_id: questionId,
              answer_type: "option",
              value: option.value,
              display: option.label
            })}
          >
            <CircleDot size={16} />
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
            <ChevronRight size={15} />
          </button>
        ))}
        {props.question.allow_other && !props.otherOpen && (
          <button className="choice quiet-choice" onClick={props.onOtherOpen}>
            <MoreHorizontal size={16} />
            <span><strong>其他，我自己填写</strong></span>
            <ChevronRight size={15} />
          </button>
        )}
        {props.otherOpen && (
          <div className="other-answer">
            <input autoFocus value={props.otherValue} onChange={(event) => props.onOtherValue(event.target.value)} placeholder="输入一个简短答案" />
            <button
              disabled={!props.otherValue.trim()}
              onClick={() => props.onChoose({
                question_id: questionId,
                answer_type: "other",
                value: props.otherValue.trim(),
                display: props.otherValue.trim()
              })}
            >
              确认
            </button>
          </div>
        )}
        {props.question.allow_skip && (
          <button className="skip-choice" onClick={() => props.onChoose({
            question_id: questionId,
            answer_type: "skip",
            display: "暂不确定"
          })}>
            暂不确定，继续
          </button>
        )}
      </div>
      {props.index > 0 && (
        <button className="back-button" onClick={props.onBack}><ArrowLeft size={14} />返回上一题</button>
      )}
    </article>
  );
}

function RoleSetupCard(props: {
  premises: DiscussionState["premises"];
  roles: DiscussionRoleConfig[];
  notice: string;
  confirmed: boolean;
  busy: string;
  selectedRoleId: DiscussionRoleConfig["role_id"];
  onSelect: (roleId: DiscussionRoleConfig["role_id"]) => void;
  onToggle: (roleId: DiscussionRoleConfig["role_id"], enabled: boolean) => void;
  onConfirm: () => void;
  onStart: () => void;
}) {
  const selectedParticipants = props.roles.filter(
    (role) =>
      ["supporter", "opponent", "practice-advisor"].includes(role.role_id) &&
      role.enabled
  );
  const hasSupporter = selectedParticipants.some((role) => role.role_id === "supporter");
  const hasOpponent = selectedParticipants.some((role) => role.role_id === "opponent");
  return (
    <article className="question-card role-setup-card">
      <div className="card-kicker">
        <UsersRound size={15} />
        角色编制 Agent · 已完成
      </div>
      <h2>确认 Agent 为本轮编制的角色</h2>
      <div className="premise-chips">
        {props.premises.map((item) => <span key={item.key}>{item.value}</span>)}
      </div>
      {props.notice && (
        <div className="role-design-notice">
          <ShieldAlert size={15} />
          <span>{props.notice}</span>
        </div>
      )}
      <p className="muted">角色身份和 md 已根据当前问题生成。点击角色可查看任务、立场锚点并修改；正反席位固定保留，实践顾问可以选择是否加入。</p>
      <div className="role-selection-summary">
        <span>{selectedParticipants.length} 位讨论角色已选</span>
        <small>
          {hasSupporter && hasOpponent
            ? "只有选中的角色会调用模型并进入开桌流程"
            : "未同时选择正反双方，本轮将跳过交叉回应"}
        </small>
      </div>
      <div className="role-setup-list">
        {props.roles.map((role) => (
          <div
            key={role.role_id}
            className={`role-setup-row ${props.selectedRoleId === role.role_id ? "selected" : ""} ${!role.enabled ? "disabled" : ""}`}
          >
            <button className="role-setup-main" onClick={() => props.onSelect(role.role_id)}>
              <span className="role-status-icon">
                {role.locked ? <LockKeyhole size={13} /> : <PencilLine size={13} />}
              </span>
              <span>
                <strong>{role.label}</strong>
                <small>{role.mission || role.note}</small>
              </span>
              <em>{role.generated ? "AI MD" : "MD"}</em>
              <ChevronRight size={14} />
            </button>
            {!role.locked && (
              <button
                className={`role-toggle ${role.enabled ? "enabled" : ""}`}
                onClick={() => props.onToggle(role.role_id, !role.enabled)}
              >
                {role.enabled ? "参与" : "不参与"}
              </button>
            )}
          </div>
        ))}
      </div>
      {props.confirmed ? (
        <button
          className="primary-button"
          disabled={props.busy === "run" || selectedParticipants.length < 2}
          onClick={props.onStart}
        >
          {props.busy === "run" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
          {selectedParticipants.length < 2 ? "至少选择两位讨论角色" : "按当前选择开始圆桌"}
        </button>
      ) : (
        <button className="primary-button" disabled={props.busy === "roles" || props.roles.length !== 6} onClick={props.onConfirm}>
          {props.busy === "roles" ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
          确认角色配置
        </button>
      )}
    </article>
  );
}

function RoleSetupEditor(props: {
  role: DiscussionRoleConfig | null;
  onContent: (content: string) => void;
}) {
  if (!props.role) {
    return <div className="canvas-empty compact"><p>先从中栏选择一个角色。</p></div>;
  }
  const readOnly = props.role.role_id === "context-guide";
  return (
    <div className="role-editor-layout">
      <article className="role-editor">
        <header>
          <div>
            <span>
              {readOnly
                ? "本轮已执行 · 只读"
                : props.role.generated
                  ? "角色编制 Agent 生成 · 仅作用于本轮"
                  : "仅作用于当前讨论"}
            </span>
            <h2>{props.role.label}</h2>
            <p>{props.role.note}</p>
          </div>
          <em>{props.role.enabled ? "参与本轮" : "本轮停用"}</em>
        </header>
        {!readOnly && (
          <div className="role-contract-summary">
            <div>
              <span>本轮任务</span>
              <p>{props.role.mission}</p>
            </div>
            <div>
              <span>立场锚点</span>
              <p>{props.role.stance}</p>
            </div>
            <div>
              <span>服务对象</span>
              <p>{props.role.serves}</p>
            </div>
            <div>
              <span>目标函数</span>
              <p>{props.role.objective_function}</p>
            </div>
            <div>
              <span>可接受代价</span>
              <p>{props.role.acceptable_costs.join(" · ") || "未设额外代价"}</p>
            </div>
            <div>
              <span>硬底线</span>
              <p>{props.role.hard_boundaries.join(" · ") || "仅遵守平台底线"}</p>
            </div>
            {props.role.non_negotiables.length > 0 && (
              <div>
                <span>不可退让</span>
                <p>{props.role.non_negotiables.join(" · ")}</p>
              </div>
            )}
          </div>
        )}
        <label>
          <span>Markdown 角色设定</span>
          <textarea
            aria-label={`${props.role.label} Markdown 角色设定`}
            value={props.role.content}
            readOnly={readOnly}
            onChange={(event) => props.onContent(event.target.value)}
            spellCheck={false}
          />
        </label>
        <footer>
          <span>{props.role.source_path}</span>
          <code>{props.role.content_hash.slice(0, 10)}</code>
        </footer>
      </article>
    </div>
  );
}

function ResultCanvas(props: {
  active: DiscussionState | null;
  view: RightView;
  onView: (view: RightView) => void;
  selectedProcess: ProcessModule | null;
  selectedRole: RolePanel | null;
  onRole: (id: RolePanel["id"]) => void;
  selectedSetupRole: DiscussionRoleConfig | null;
  onSetupContent: (content: string) => void;
  onVersion: (id: string) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  return (
    <section className={`result-canvas ${props.mobileOpen ? "mobile-open" : ""}`}>
      <header className="canvas-header">
        <div className="view-tabs">
          {props.view === "detail" && (
            <button className="selected">
              <Layers3 size={15} />讨论详情
            </button>
          )}
          {props.view === "role_setup" && (
            <button className="selected">
              <PencilLine size={15} />角色设定
            </button>
          )}
          <button className={props.view === "roles" ? "selected" : ""} onClick={() => props.onView("roles")}>
            <UsersRound size={15} />角色立场
          </button>
          <button className={props.view === "conclusion" ? "selected" : ""} onClick={() => props.onView("conclusion")}>
            <Gauge size={15} />主持人结论
          </button>
        </div>
        {props.active && <span className="canvas-status">{statusLabel(props.active.discussion.status)}</span>}
        <button className="mobile-canvas-close" aria-label="关闭右侧画布" onClick={props.onMobileClose}>
          <X size={16} />
        </button>
      </header>
      <div className="canvas-body">
        {!props.active && <CanvasEmpty />}
        {props.active && props.view === "detail" && (
          <div className="detail-canvas">
            <ModuleDetail module={props.selectedProcess} />
          </div>
        )}
        {props.active && props.view === "role_setup" && (
          <RoleSetupEditor
            role={props.selectedSetupRole}
            onContent={props.onSetupContent}
          />
        )}
        {props.active && props.view === "roles" && (
          <RolesView active={props.active} selected={props.selectedRole} onSelect={props.onRole} />
        )}
        {props.active && props.view === "conclusion" && (
          <ConclusionView active={props.active} onVersion={props.onVersion} />
        )}
      </div>
    </section>
  );
}

function CenterDiscussionFeed(props: {
  modules: ProcessModule[];
  selectedId: string;
  running: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <article className="question-card discussion-feed">
      <div className="card-kicker">
        <Layers3 size={15} />
        多方讨论过程
      </div>
      {processRounds(props.modules).map((round) => (
        <section className="feed-round" key={round.id}>
          <div className="feed-round-title">
            <span>{round.step}</span>
            <div><strong>{round.label}</strong><small>{round.description}</small></div>
          </div>
          {round.modules.map((module) => (
            <button
              key={module.id}
              className={`feed-entry role-${module.role_id} ${props.selectedId === module.id ? "selected" : ""}`}
              onClick={() => props.onSelect(module.id)}
            >
              <div>
                <small>{module.label}</small>
                <strong>{short(module.headline, 54)}</strong>
              </div>
              <span>{module.tags.slice(0, 2).map((tag) => <i key={tag}>{tag}</i>)}</span>
              <ChevronRight size={15} />
            </button>
          ))}
        </section>
      ))}
      {props.running && (
        <div className="feed-waiting">
          <LoaderCircle className="spin" size={14} />
          下一位角色正在形成观点
        </div>
      )}
    </article>
  );
}

function ModuleDetail({ module }: { module: ProcessModule | null }) {
  if (!module) {
    return (
      <div className="canvas-empty compact">
        <p>从中间讨论流点击一个观点，在这里展开查看。</p>
      </div>
    );
  }
  const output = module.content;
  const tags = Array.isArray(output.tags) ? output.tags : [];
  const points = Array.isArray(output.points) ? output.points : [];
  const detail = typeof output.detail === "string" ? output.detail : safeText(output.detail);
  return (
    <article className={`module-detail role-${module.role_id}`}>
      <div className="module-heading">
        <span>{module.label}</span>
        <div>{tags.slice(0, 3).map((tag) => <i key={tag}>{tag}</i>)}</div>
      </div>
      <h2>{safeText(output.headline)}</h2>
      {points.length > 0 && (
        <div className="point-grid">
          {points.slice(0, 6).map((point, index) => (
            <div key={`${point}-${index}`}><span>{index + 1}</span><p>{safeText(point)}</p></div>
          ))}
        </div>
      )}
      {detail && <p className="detail-copy">{detail}</p>}
    </article>
  );
}

function RolesView(props: {
  active: DiscussionState;
  selected: RolePanel | null;
  onSelect: (id: RolePanel["id"]) => void;
}) {
  return (
    <div className="roles-layout">
      <div className="role-card-grid">
        {props.active.roles.map((role) => (
          <button
            key={role.id}
            className={`role-card role-${role.id} ${props.selected?.id === role.id ? "selected" : ""}`}
            onClick={() => props.onSelect(role.id)}
          >
            <RoleIcon role={role.id} />
            <span>
              <small>{role.label}<em>MD ROLE</em></small>
              <strong>{short(role.headline, 44)}</strong>
            </span>
            <ChevronDown size={15} />
          </button>
        ))}
      </div>
      {props.selected && props.selected.initial ? (
        <article className={`role-detail role-${props.selected.id}`}>
          <div className="module-heading">
            <span>{props.selected.label} · 独立立场</span>
            <div>{props.selected.tags.map((tag) => <i key={tag}>{tag}</i>)}</div>
          </div>
          <h2>{props.selected.initial.headline}</h2>
          <PointList output={props.selected.initial} />
          {props.selected.response && (
            <div className="response-block">
              <span>
                交叉回应
                <em className={`stance-state state-${props.selected.response.position_status || "held"}`}>
                  {stanceStatusLabel(props.selected.response.position_status)}
                </em>
              </span>
              <h3>{props.selected.response.headline}</h3>
              <PointList output={props.selected.response} />
            </div>
          )}
        </article>
      ) : (
        <div className="canvas-empty compact"><p>该角色尚未完成发言。</p></div>
      )}
    </div>
  );
}

function ConclusionView(props: { active: DiscussionState; onVersion: (id: string) => void }) {
  const result = props.active.current_result;
  return (
    <div className="conclusion-view">
      {props.active.versions.length > 0 && (
        <div className="version-switcher">
          <span>本轮版本</span>
          <div>
            {props.active.versions.map((version) => (
              <button key={version.id} className={version.is_current ? "selected" : ""} onClick={() => props.onVersion(version.id)}>
                {version.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!result && (
        <div className="canvas-empty compact">
          <div className="empty-orbit"><Gauge size={23} /></div>
          <h2>完成讨论后生成结论</h2>
          <p>主持人只提炼本轮已经出现的关键分歧。</p>
        </div>
      )}
      {result && isConclusion(result) && (
        <BaseConclusion
          result={result}
          fullRecord={props.active.full_record}
        />
      )}
      {result && !isConclusion(result) && <ActionConclusion result={result as ActionOutput} />}
    </div>
  );
}

function BaseConclusion(props: {
  result: ConclusionOutput;
  fullRecord: FullRecordEntry[];
}) {
  const [showDigest, setShowDigest] = useState(false);
  const [showFullRecord, setShowFullRecord] = useState(false);
  const { result } = props;
  const summary = result.display_summary;
  const digest = result.process_digest;

  function toggleDigest() {
    setShowDigest((visible) => {
      if (visible) setShowFullRecord(false);
      return !visible;
    });
  }

  return (
    <div className="layered-result">
      <section className="reading-tier tier-one" data-testid="result-tier-1">
        <header className="reading-tier-heading">
          <span>10 秒结论</span>
          <small>先看判断，再决定是否展开</small>
        </header>
        <article className="summary-card summary-judgement">
          <span><Sparkles size={15} />一句话判断</span>
          <h2>{summary.judgement}</h2>
          <small><i />可信度 {result.confidence.label}</small>
        </article>
        <div className="summary-card-grid">
          <article className="summary-card summary-conditions">
            <span><Check size={14} />成立条件</span>
            <p>{summary.conditions.join(" · ")}</p>
          </article>
          <article className="summary-card summary-risk">
            <span><CircleAlert size={14} />最大风险</span>
            <p>{summary.maximum_risk}</p>
          </article>
          <article className="summary-card summary-disagreement">
            <span><CircleDot size={14} />关键分歧</span>
            <p>{summary.key_disagreement}</p>
          </article>
          <article className="summary-card summary-changes">
            <span><Target size={14} />建议改法</span>
            <p>{summary.recommended_changes.join(" · ")}</p>
          </article>
        </div>
      </section>

      <button
        type="button"
        className={`reading-tier-toggle ${showDigest ? "open" : ""}`}
        data-testid="toggle-tier-2"
        onClick={toggleDigest}
      >
        <span><Layers3 size={15} />{showDigest ? "收起分歧摘要" : "查看 1 分钟分歧摘要"}</span>
        <ChevronDown size={15} />
      </button>

      {showDigest && (
        <section className="reading-tier tier-two" data-testid="result-tier-2">
          <header className="reading-tier-heading">
            <span>1 分钟分歧</span>
            <small>只保留四个会改变判断的观点</small>
          </header>
          <div className="digest-grid">
            <DigestCard role="supporter" label="支持者核心" text={digest.supporter} />
            <DigestCard role="opponent" label="反对者核心" text={digest.opponent} />
            <DigestCard role="cross" label="双方交叉回应" text={digest.cross_response} />
            <DigestCard role="practice" label="实践顾问取舍" text={digest.practice} />
          </div>
          <button
            type="button"
            className={`full-record-toggle ${showFullRecord ? "open" : ""}`}
            data-testid="toggle-tier-3"
            onClick={() => setShowFullRecord((visible) => !visible)}
          >
            <span>{showFullRecord ? "收起完整记录" : "查看完整记录"}</span>
            <ChevronDown size={14} />
          </button>
        </section>
      )}

      {showDigest && showFullRecord && (
        <section className="reading-tier tier-three" data-testid="result-tier-3">
          <header className="reading-tier-heading">
            <span>完整圆桌记录</span>
            <small>逐个角色展开，默认不铺开长文</small>
          </header>
          <div className="full-record-list">
            {props.fullRecord.map((record) => (
              <FullRecordCard key={`${record.id}-${record.phase}`} record={record} />
            ))}
            <details className="full-record-card synthesis-evidence">
              <summary>
                <span><Gauge size={15} />综合判断依据</span>
                <ChevronDown size={14} />
              </summary>
              <div className="synthesis-evidence-body">
                {result.value_lenses.map((lens, index) => (
                  <section key={`${lens.label}-${index}`}>
                    <strong>{lens.label}</strong>
                    <p>{lens.judgement}</p>
                    <small>目标：{lens.objective}</small>
                  </section>
                ))}
                <footer>
                  <strong>判断边界</strong>
                  <p>{result.confidence.reason}</p>
                  {result.confidence.missing.length > 0 && (
                    <small>缺失：{result.confidence.missing.join(" · ")}</small>
                  )}
                </footer>
              </div>
            </details>
          </div>
        </section>
      )}
    </div>
  );
}

function DigestCard(props: {
  role: "supporter" | "opponent" | "cross" | "practice";
  label: string;
  text: string;
}) {
  return (
    <article className={`digest-card digest-${props.role}`}>
      <span>{props.label}</span>
      <p>{props.text}</p>
    </article>
  );
}

function FullRecordCard({ record }: { record: FullRecordEntry }) {
  const output = record.content;
  return (
    <details className={`full-record-card role-${record.role_id}`}>
      <summary>
        <span>
          <RoleRecordIcon roleId={record.role_id} />
          {record.label}
        </span>
        <strong>{short(output.headline, 56)}</strong>
        <ChevronDown size={14} />
      </summary>
      <div className="full-record-body">
        <h3>{output.headline}</h3>
        <PointList output={output} />
      </div>
    </details>
  );
}

function RoleRecordIcon({ roleId }: { roleId: string }) {
  if (roleId === "supporter") return <Sparkles size={15} />;
  if (roleId === "opponent") return <ShieldAlert size={15} />;
  if (roleId === "practice-advisor") return <Target size={15} />;
  if (roleId === "moderator") return <UsersRound size={15} />;
  return <Gauge size={15} />;
}

function ActionConclusion({ result }: { result: ActionOutput }) {
  return (
    <>
      <article className="judgement-hero">
        <span><FileOutput size={15} />继续处理结果</span>
        <h2>{result.title}</h2>
        <p>{result.summary}</p>
      </article>
      <div className="action-result-grid">
        {result.modules.map((module, index) => (
          <article key={`${module.title}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h3>{module.title}</h3>
            <p>{module.content}</p>
            {module.tags && <div>{module.tags.map((tag) => <i key={tag}>{tag}</i>)}</div>}
          </article>
        ))}
      </div>
    </>
  );
}

function SettingsPanel(props: {
  state: AppState;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  return (
    <div className="settings-panel">
      <div className="drawer-intro">
        <span className="drawer-icon"><Settings size={18} /></span>
        <div><h3>模型与 API</h3><p>配置保存在本机，API Key 不会在接口中回传。</p></div>
      </div>
      {props.state.providers.filter((provider) => provider.provider !== "mock").map((provider) => (
        <ProviderEditor
          key={provider.id}
          provider={provider}
          onRefresh={props.onRefresh}
          onError={props.onError}
        />
      ))}
      <DesktopUpdatePanel />
      <div className="role-runtime">
        <span>md 角色</span>
        <strong>{props.state.roles.length}/7 已加载</strong>
        <p>每次运行都会重新读取角色文件并记录内容哈希。</p>
      </div>
    </div>
  );
}

function DesktopUpdatePanel() {
  const desktop = window.roundtableDesktop;
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [update, setUpdate] = useState<DesktopUpdateStatus | null>(null);

  useEffect(() => {
    if (!desktop) return;
    void desktop.getInfo().then((next) => {
      setInfo(next);
      setUpdate(next.update);
    });
    return desktop.onUpdateStatus(setUpdate);
  }, [desktop]);

  if (!desktop) {
    return (
      <article className="software-update-card">
        <div className="software-update-heading">
          <span><RefreshCw size={15} /></span>
          <div><strong>桌面自动更新</strong><small>安装 macOS 版后启用</small></div>
        </div>
        <p>桌面版会从 GitHub Releases 自动检查并下载新版本。</p>
      </article>
    );
  }

  const current = update || info?.update;
  const busy = current?.status === "checking" || current?.status === "downloading";
  const ready = current?.status === "ready";
  return (
    <article className="software-update-card">
      <div className="software-update-heading">
        <span className={ready ? "ready" : ""}>
          {busy ? <LoaderCircle className="spin" size={15} /> : ready ? <Check size={15} /> : <RefreshCw size={15} />}
        </span>
        <div>
          <strong>Roundtable {info?.version || current?.version || ""}</strong>
          <small>{info ? `${info.arch} · ${info.isPackaged ? "正式更新通道" : "开发环境"}` : "读取版本信息"}</small>
        </div>
      </div>
      <p>{current?.message || "启动后自动检查更新"}</p>
      {current?.status === "downloading" && (
        <div className="update-progress">
          <i style={{ width: `${current.progress || 3}%` }} />
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (ready) void desktop.installUpdate();
          else void desktop.checkForUpdates();
        }}
      >
        {ready ? "立即重启并更新" : busy ? "处理中…" : "立即检查更新"}
      </button>
    </article>
  );
}

function ProviderEditor(props: {
  provider: AppState["providers"][number];
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(props.provider.base_url);
  const [model, setModel] = useState(props.provider.model);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const ready = props.provider.status === "active" && props.provider.has_env_key;

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      await api.configureProvider(props.provider.id, {
        base_url: baseUrl.trim(),
        model: model.trim(),
        api_key: apiKey.trim()
      });
      setApiKey("");
      setFeedback({ kind: "ok", message: "配置已保存并启用，可直接开始圆桌。" });
      await props.onRefresh();
    } catch (cause) {
      const message = messageOf(cause);
      setFeedback({ kind: "error", message });
      props.onError(message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    setSaving(true);
    setFeedback(null);
    try {
      await api.setProviderStatus(props.provider.id, ready ? "disabled" : "active");
      setFeedback({ kind: "ok", message: ready ? "Provider 已停用。" : "Provider 已启用。" });
      await props.onRefresh();
    } catch (cause) {
      const message = messageOf(cause);
      setFeedback({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="provider-card">
      <div className="provider-title">
        <div>
          <strong>{props.provider.label}</strong>
          <span>{ready ? "已连接配置" : "等待配置"}</span>
        </div>
        <i className={ready ? "ready" : ""} />
      </div>

      <div className="provider-form">
        <label>
          <span>API Base URL</span>
          <input
            aria-label="API Base URL"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </label>
        <label>
          <span>模型</span>
          <input
            aria-label="模型"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="gpt-5.5"
          />
        </label>
        <label>
          <span>API Key</span>
          <div className="secret-input">
            <KeyRound size={15} />
            <input
              aria-label="API Key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              placeholder={props.provider.has_env_key ? "已配置，留空则保留" : "请输入 API Key"}
            />
            <button
              type="button"
              aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
              onClick={() => setShowKey((value) => !value)}
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </label>
      </div>

      <div className="provider-meta">
        <span>保存在</span>
        <code>{props.provider.api_key_ref}</code>
      </div>

      {feedback && <div className={`provider-feedback ${feedback.kind}`}>{feedback.message}</div>}

      <div className="provider-actions">
        <button
          className="provider-save"
          disabled={saving || !baseUrl.trim() || !model.trim() || (!apiKey.trim() && !props.provider.has_env_key)}
          onClick={save}
        >
          {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
          保存并启用
        </button>
        {props.provider.has_env_key && (
          <button className="provider-toggle" disabled={saving} onClick={toggleStatus}>
            {ready ? "停用" : "启用"}
          </button>
        )}
      </div>
    </article>
  );
}

function ArchivePanel({ state }: { state: ArchiveState | null }) {
  if (!state) return <div className="drawer-loading"><LoaderCircle className="spin" /></div>;
  return (
    <div className="archive-panel">
      <section>
        <span>已归档项目</span>
        {state.projects.length === 0 && <p>暂无</p>}
        {state.projects.map((project) => <div key={project.id}><Folder size={15} /><strong>{project.name}</strong></div>)}
      </section>
      <section>
        <span>已归档会话</span>
        {state.sessions.length === 0 && <p>暂无</p>}
        {state.sessions.map((session) => <div key={session.id}><MessageSquareText size={15} /><strong>{session.title}</strong></div>)}
      </section>
      <section>
        <span>旧版历史 · 只读</span>
        {state.legacy_discussions.length === 0 && <p>暂无</p>}
        {state.legacy_discussions.slice(0, 20).map((item) => (
          <div className="legacy-row" key={item.id}>
            <Layers3 size={15} />
            <strong>{short(item.user_input, 34)}</strong>
            <small>{item.result_count} 个旧结果</small>
          </div>
        ))}
      </section>
    </div>
  );
}

function StageList({ stages }: { stages: DiscussionState["stages"] }) {
  return (
    <div className="stage-list">
      {stages.map((stage) => (
        <div key={stage.id} className={stage.status}>
          <span>{stage.status === "completed" ? <Check size={12} /> : stage.status === "active" ? <LoaderCircle className="spin" size={12} /> : <i />}</span>
          <small>{STAGE_COPY[stage.id] || stage.label}</small>
        </div>
      ))}
    </div>
  );
}

function PointList({ output }: { output: RoleOutput }) {
  const points = Array.isArray(output.points) ? output.points : [];
  const detail = typeof output.detail === "string" ? output.detail : safeText(output.detail);
  return (
    <>
      {output.value_basis?.objective_function && (
        <div className="value-basis-panel">
          <div>
            <span>服务对象</span>
            <strong>{output.value_basis.serves}</strong>
          </div>
          <div>
            <span>目标函数</span>
            <strong>{output.value_basis.objective_function}</strong>
          </div>
          <div>
            <span>接受代价</span>
            <strong>{output.value_basis.acceptable_costs.join(" · ") || "未说明"}</strong>
          </div>
        </div>
      )}
      <div className="role-points">
        {points.map((point, index) => <p key={`${point}-${index}`}><span /><strong>{safeText(point)}</strong></p>)}
      </div>
      {detail && <p className="detail-copy">{detail}</p>}
      {((output.gains?.length || 0) > 0 || (output.costs?.length || 0) > 0) && (
        <div className="role-tradeoff-row">
          <div><span>收益</span><p>{output.gains?.join(" · ") || "未说明"}</p></div>
          <div><span>代价</span><p>{output.costs?.join(" · ") || "未说明"}</p></div>
        </div>
      )}
    </>
  );
}

function RoleIcon({ role }: { role: RolePanel["id"] }) {
  if (role === "supporter") return <Sparkles size={18} />;
  if (role === "opponent") return <ShieldAlert size={18} />;
  return <Target size={18} />;
}

function StatusPill({ status }: { status: DiscussionState["discussion"]["status"] }) {
  return <span className={`status-pill status-${status}`}>{statusLabel(status)}</span>;
}

function CanvasEmpty() {
  return (
    <div className="canvas-empty">
      <div className="grid-mark">
        <span /><span /><span /><span /><UsersRound size={28} />
      </div>
      <h2>圆桌画布</h2>
      <p>过程、角色立场和最终结论会在同一画布中切换，不向下堆叠。</p>
    </div>
  );
}

function Modal(props: { title: string; onClose: () => void; children: React.ReactNode; locked?: boolean }) {
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div className="modal">
        <header>
          <h2>{props.title}</h2>
          {props.locked
            ? <span className="modal-live"><LoaderCircle className="spin" size={16} /></span>
            : <button onClick={props.onClose}><X size={17} /></button>}
        </header>
        {props.children}
      </div>
    </div>
  );
}

function Drawer(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="drawer-overlay" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <aside className="drawer">
        <header><h2>{props.title}</h2><button onClick={props.onClose}><PanelLeftClose size={18} /></button></header>
        <div className="drawer-content">{props.children}</div>
      </aside>
    </div>
  );
}

function isConclusion(value: ConclusionOutput | ActionOutput): value is ConclusionOutput {
  return "conditional_judgement" in value;
}

function statusLabel(status: DiscussionState["discussion"]["status"]) {
  return {
    preparing: "正在准备",
    needs_context: "补充条件",
    designing_roles: "编制角色",
    ready: "等待开始",
    running: "讨论中",
    paused: "已暂停",
    completed: "已完成",
    failed: "已暂停"
  }[status];
}

function stanceStatusLabel(status: RoleOutput["position_status"]) {
  if (status === "revised") return "证据触发修订";
  if (status === "refined") return "收紧条件";
  return "保持立场";
}

function currentStageLabel(active: DiscussionState) {
  return active.stages.find((stage) => stage.status === "active")?.label || "等待下一阶段";
}

function processRounds(modules: ProcessModule[]) {
  const definitions = [
    {
      id: "framing",
      step: "00",
      label: "主持人定题",
      description: "确认讨论边界",
      accepts: (module: ProcessModule) => module.role_id === "moderator" && module.phase === "framing"
    },
    {
      id: "positions",
      step: "01",
      label: "独立立场",
      description: "正反角色分别读取 md",
      accepts: (module: ProcessModule) => module.phase === "initial"
    },
    {
      id: "responses",
      step: "02",
      label: "交叉回应",
      description: "双方回应对方首发",
      accepts: (module: ProcessModule) => module.phase === "response"
    },
    {
      id: "decision",
      step: "03",
      label: "分歧与取舍",
      description: "主持人提炼，顾问落地",
      accepts: (module: ProcessModule) =>
        (module.role_id === "moderator" && module.phase === "conflict") ||
        module.role_id === "practice-advisor"
    }
  ];
  return definitions
    .map((definition) => ({
      ...definition,
      modules: modules.filter(definition.accepts)
    }))
    .filter((round) => round.modules.length > 0);
}

function suggestFormats(input: string) {
  if (/小红书|笔记|文案|发布|内容/.test(input)) return ["小红书笔记", "短视频口播稿", "社媒发布文案"];
  if (/销售|话术|成交|客户/.test(input)) return ["销售对话话术", "私聊跟进消息", "异议处理卡"];
  if (/商业|产品|项目|功能/.test(input)) return ["行动方案", "一页决策稿", "内部提案"];
  if (/课程|培训/.test(input)) return ["课程介绍", "课程大纲", "招生页文案"];
  return ["行动清单", "可直接发送的文案", "一页简报"];
}

function short(value: string, max: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : "操作失败，请稍后重试。";
}

function safeText(value: unknown) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default App;
