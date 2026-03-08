export type SessionStatus =
  | 'queued'
  | 'active'
  | 'idle'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'archived';

export interface ProviderBinding {
  id: string;
  agentId: string;
  provider: string;
  remoteAgentId: string | null;
  remoteSlug: string | null;
  status: string;
  config: Record<string, unknown>;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRecord {
  id: string;
  slug: string;
  name: string;
  runtimeType: string;
  projectPath: string;
  sandbox: boolean;
  description: string | null;
  capabilities: string[];
  visibility: 'public' | 'private' | 'unlisted';
  createdAt: string;
  updatedAt: string;
  bindings: ProviderBinding[];
  sessionCount: number;
}

export interface AgentMutationInput {
  slug?: string;
  name: string;
  runtimeType: string;
  projectPath: string;
  sandbox: boolean;
  description: string;
  capabilities: string[];
  visibility: 'public' | 'private' | 'unlisted';
}

export interface SessionRecord {
  id: string;
  agentId: string;
  taskGroupId: string | null;
  parentSessionId: string | null;
  origin: string;
  principalType: string;
  principalId: string | null;
  status: SessionStatus;
  claudeResumeId: string | null;
  title: string | null;
  summary: string | null;
  createdAt: string;
  lastActiveAt: string;
  updatedAt: string;
  tags: string[];
  agent: AgentRecord | null;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  seq: number;
  role: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  title: string;
  ownerPrincipal: string;
  source: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
}

export interface ProviderRecord extends ProviderBinding {
  agent: AgentRecord | null;
}

export interface TaskMutationInput {
  title: string;
  source?: string;
  ownerPrincipal?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeChatInput {
  agentRef?: string;
  sessionId?: string;
  taskGroupId?: string;
  title?: string;
  tags?: string[];
  message: string;
}

export interface DaemonStatusResponse {
  daemon: {
    pid: number;
    startedAt: string;
    uiBaseUrl: string | null;
    uiPort: number | null;
  };
  counts: {
    agents: number;
    sessions: number;
    taskGroups: number;
    providerBindings: number;
  };
  runtime: {
    activeExecutions: number;
    managedSessions: number;
    queue: {
      active: number;
      queued: number;
      config: {
        maxActiveRequests: number;
        queueWaitTimeoutMs: number;
        queueMaxLength: number;
      };
    };
  };
}

export interface DashboardData {
  status: DaemonStatusResponse;
  agents: AgentRecord[];
  providerCatalog: string[];
  sessions: SessionRecord[];
  tasks: TaskRecord[];
  providers: ProviderRecord[];
  logs: string[];
  logPath: string;
}

export class UiApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'UiApiError';
    this.status = status;
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new UiApiError(response.status, `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return fetchJson<T>(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

export async function getDashboardData(): Promise<DashboardData> {
  const [status, agents, providerCatalog, sessions, tasks, providers, logs] = await Promise.all([
    fetchJson<DaemonStatusResponse>('/api/daemon/status'),
    fetchJson<{ items: AgentRecord[] }>('/api/agents'),
    fetchJson<{ items: string[] }>('/api/providers/catalog'),
    fetchJson<{ items: SessionRecord[] }>('/api/sessions'),
    fetchJson<{ items: TaskRecord[] }>('/api/tasks'),
    fetchJson<{ items: ProviderRecord[] }>('/api/providers'),
    fetchJson<{ items: string[]; path: string }>('/api/logs?lines=120'),
  ]);

  return {
    status,
    agents: agents.items,
    providerCatalog: providerCatalog.items,
    sessions: sessions.items,
    tasks: tasks.items,
    providers: providers.items,
    logs: logs.items,
    logPath: logs.path,
  };
}

export async function getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  const response = await fetchJson<{ items: SessionMessage[] }>(`/api/sessions/${sessionId}/messages`);
  return response.items;
}

export async function stopSession(sessionId: string): Promise<SessionRecord> {
  const response = await postJson<{ session: SessionRecord }>(`/api/sessions/${sessionId}/stop`, {});
  return response.session;
}

export async function archiveSession(sessionId: string): Promise<SessionRecord> {
  const response = await postJson<{ session: SessionRecord }>(`/api/sessions/${sessionId}/archive`, {});
  return response.session;
}

export async function forkSession(sessionId: string, title?: string): Promise<{ session: SessionRecord; messages: SessionMessage[] }> {
  return postJson<{ session: SessionRecord; messages: SessionMessage[] }>(`/api/sessions/${sessionId}/fork`, {
    title,
  });
}

export async function sendLocalChatTurn(
  input: RuntimeChatInput,
): Promise<{ session: SessionRecord; messages: SessionMessage[]; result: string }> {
  return postJson<{ session: SessionRecord; messages: SessionMessage[]; result: string }>('/api/runtime/chat', input);
}

export async function createTaskGroup(input: TaskMutationInput): Promise<TaskRecord> {
  const response = await postJson<{ taskGroup: TaskRecord }>('/api/tasks', input);
  return response.taskGroup;
}

export async function archiveTaskGroup(taskGroupId: string): Promise<TaskRecord> {
  const response = await postJson<{ taskGroup: TaskRecord }>(`/api/tasks/${taskGroupId}/archive`, {});
  return response.taskGroup;
}

export async function createAgent(input: AgentMutationInput): Promise<AgentRecord> {
  const response = await postJson<{ agent: AgentRecord }>('/api/agents', input);
  return response.agent;
}

export async function updateAgent(ref: string, input: Partial<AgentMutationInput>): Promise<AgentRecord> {
  const response = await postJson<{ agent: AgentRecord }>(`/api/agents/${ref}/update`, input);
  return response.agent;
}

export async function removeAgent(ref: string): Promise<{ ok: boolean; agentId: string }> {
  return postJson<{ ok: boolean; agentId: string }>(`/api/agents/${ref}/remove`, {});
}

export async function exposeAgent(
  ref: string,
  provider: string,
  config: Record<string, unknown>,
): Promise<{ agent: AgentRecord; binding: ProviderBinding }> {
  return postJson<{ agent: AgentRecord; binding: ProviderBinding }>(`/api/agents/${ref}/expose`, {
    provider,
    config,
  });
}

export async function unexposeAgent(
  ref: string,
  provider: string,
): Promise<{ agent: AgentRecord; binding: ProviderBinding }> {
  return postJson<{ agent: AgentRecord; binding: ProviderBinding }>(`/api/agents/${ref}/unexpose`, {
    provider,
  });
}
