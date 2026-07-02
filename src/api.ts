import type {
  AppState,
  ArchiveState,
  ContextAnswer,
  DiscussionEvent,
  DiscussionRoleConfig,
  DiscussionState
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || `请求失败（${response.status}）`);
  }
  return body as T;
}

const EVENT_TYPES = [
  "context_started",
  "context_questions_ready",
  "context_ready",
  "role_design_started",
  "role_design_batch_completed",
  "role_design_checkpoint_restored",
  "role_design_fallback",
  "roles_ready",
  "stage_started",
  "role_completed",
  "round_completed",
  "discussion_completed",
  "discussion_paused",
  "generation_cancelled",
  "discussion_failed",
  "version_completed"
];

export const api = {
  appState: () => request<AppState>("/api/app-state"),
  createProject: (name: string) =>
    request<{ project: AppState["projects"][number] }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name })
    }),
  setProjectStatus: (projectId: string, status: "active" | "archived") =>
    request<{ ok: boolean }>(`/api/projects/${projectId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    }),
  createSession: (projectId: string, title: string) =>
    request<{ session: AppState["sessions"][number] }>(`/api/projects/${projectId}/sessions`, {
      method: "POST",
      body: JSON.stringify({ title })
    }),
  setSessionStatus: (sessionId: string, status: "active" | "archived") =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    }),
  sessionDiscussions: (sessionId: string) =>
    request<{ discussions: DiscussionState[] }>(`/api/sessions/${sessionId}/discussions`),
  createDiscussion: (projectId: string, sessionId: string, userInput: string) =>
    request<DiscussionState>("/api/discussions", {
      method: "POST",
      body: JSON.stringify({
        project_id: projectId,
        session_id: sessionId,
        user_input: userInput
      })
    }),
  discussion: (discussionId: string) =>
    request<DiscussionState>(`/api/discussions/${discussionId}`),
  answerContext: (discussionId: string, answers: ContextAnswer[]) =>
    request<DiscussionState>(`/api/discussions/${discussionId}/context-answers`, {
      method: "POST",
      body: JSON.stringify({ answers })
    }),
  configureDiscussionRoles: (
    discussionId: string,
    roles: Array<Pick<DiscussionRoleConfig, "role_id" | "enabled" | "content">>
  ) =>
    request<DiscussionState>(`/api/discussions/${discussionId}/roles`, {
      method: "PUT",
      body: JSON.stringify({ roles })
    }),
  runDiscussion: (discussionId: string) =>
    request<DiscussionState>(`/api/discussions/${discussionId}/run`, {
      method: "POST",
      body: "{}"
    }),
  retryDiscussion: (discussionId: string) =>
    request<DiscussionState>(`/api/discussions/${discussionId}/retry`, {
      method: "POST",
      body: "{}"
    }),
  pauseDiscussion: (discussionId: string) =>
    request<DiscussionState>(`/api/discussions/${discussionId}/pause`, {
      method: "POST",
      body: "{}"
    }),
  runAction: (
    discussionId: string,
    actionType: "deep_risk" | "safer" | "usable_version",
    target = ""
  ) =>
    request<DiscussionState>(`/api/discussions/${discussionId}/actions`, {
      method: "POST",
      body: JSON.stringify({ action_type: actionType, target })
    }),
  selectVersion: (discussionId: string, versionId: string) =>
    request<DiscussionState>(`/api/discussions/${discussionId}/versions/${versionId}/select`, {
      method: "POST",
      body: "{}"
    }),
  archive: () => request<ArchiveState>("/api/archive"),
  setProviderStatus: (providerId: string, status: "active" | "disabled") =>
    request<{ provider: AppState["providers"][number] }>(`/api/providers/${providerId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    }),
  configureProvider: (
    providerId: string,
    config: { base_url: string; model: string; api_key: string }
  ) =>
    request<{ provider: AppState["providers"][number] }>(`/api/providers/${providerId}/config`, {
      method: "PUT",
      body: JSON.stringify(config)
    }),
  subscribeDiscussion: (
    discussionId: string,
    onEvent: (event: DiscussionEvent) => void,
    onReconnect?: () => void
  ) => {
    const stream = new EventSource(`/api/discussions/${discussionId}/events`);
    for (const type of EVENT_TYPES) {
      stream.addEventListener(type, (raw) => {
        onEvent(JSON.parse((raw as MessageEvent).data) as DiscussionEvent);
      });
    }
    stream.onopen = () => onReconnect?.();
    return () => stream.close();
  }
};
