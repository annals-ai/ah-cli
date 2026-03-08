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
  const [status, agents, sessions, tasks, providers, logs] = await Promise.all([
    fetchJson<DaemonStatusResponse>('/api/daemon/status'),
    fetchJson<{ items: AgentRecord[] }>('/api/agents'),
    fetchJson<{ items: SessionRecord[] }>('/api/sessions'),
    fetchJson<{ items: TaskRecord[] }>('/api/tasks'),
    fetchJson<{ items: ProviderRecord[] }>('/api/providers'),
    fetchJson<{ items: string[]; path: string }>('/api/logs?lines=120'),
  ]);

  return {
    status,
    agents: agents.items,
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
