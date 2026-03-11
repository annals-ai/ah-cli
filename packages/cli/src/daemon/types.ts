export type AgentVisibility = 'public' | 'private' | 'unlisted';

export type SessionStatus =
  | 'queued'
  | 'active'
  | 'idle'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'archived';

export interface AutoPruneConfig {
  /** Enable auto prune on daemon start */
  enabled: boolean;
  /** Prune sessions older than this duration (e.g., '7d', '24h', '1w') */
  olderThan: string;
  /** Comma-separated statuses to prune (e.g., 'failed,idle,completed') */
  status: string;
  /** Action to take: 'archive' or 'delete' */
  action: 'archive' | 'delete';
  /** Max sessions to prune per run (0 = no limit) */
  limit: number;
}

export interface DaemonAgent {
  id: string;
  slug: string;
  name: string;
  runtimeType: string;
  projectPath: string;
  sandbox: boolean;
  persona: string | null;
  description: string | null;
  capabilities: string[];
  visibility: AgentVisibility;
  createdAt: string;
  updatedAt: string;
}

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

export interface TaskGroup {
  id: string;
  title: string;
  ownerPrincipal: string;
  source: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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

export interface RuntimeLimitRecord {
  scopeType: string;
  scopeId: string;
  maxConcurrent: number | null;
  queueWaitTimeoutMs: number | null;
  queueMaxLength: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DaemonSettingRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
}

export interface CreateAgentInput {
  slug?: string;
  name: string;
  runtimeType?: string;
  projectPath: string;
  sandbox?: boolean;
  persona?: string | null;
  description?: string | null;
  capabilities?: string[];
  visibility?: AgentVisibility;
}

export interface UpdateAgentInput {
  slug?: string;
  name?: string;
  runtimeType?: string;
  projectPath?: string;
  sandbox?: boolean;
  persona?: string | null;
  description?: string | null;
  capabilities?: string[];
  visibility?: AgentVisibility;
}

export interface CreateTaskGroupInput {
  title: string;
  ownerPrincipal?: string;
  source?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateSessionInput {
  id?: string;
  agentId: string;
  taskGroupId?: string | null;
  parentSessionId?: string | null;
  origin?: string;
  principalType?: string;
  principalId?: string | null;
  status?: SessionStatus;
  claudeResumeId?: string | null;
  title?: string | null;
  summary?: string | null;
  tags?: string[];
}

export interface UpdateSessionInput {
  taskGroupId?: string | null;
  parentSessionId?: string | null;
  status?: SessionStatus;
  claudeResumeId?: string | null;
  title?: string | null;
  summary?: string | null;
  tags?: string[];
  touchLastActive?: boolean;
}

export interface AppendMessageInput {
  sessionId: string;
  role: string;
  kind: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ForkSessionInput {
  sourceSessionId: string;
  taskGroupId?: string | null;
  title?: string | null;
  tags?: string[];
}

export interface SessionQuery {
  agentId?: string;
  taskGroupId?: string;
  status?: SessionStatus | 'all';
  tag?: string;
  search?: string;
  limit?: number;
}

export interface SessionHistoryPromptOptions {
  includeSystemHint?: boolean;
}

export interface ExecuteSessionInput {
  agentRef?: string;
  sessionId?: string;
  createIfMissing?: boolean;
  forkFromSessionId?: string;
  message: string;
  mode: 'chat' | 'call';
  taskGroupId?: string | null;
  title?: string | null;
  tags?: string[];
  origin?: string;
  principalType?: string;
  principalId?: string | null;
  attachments?: Array<{ name: string; url: string; type: string }>;
  clientId?: string;
  withFiles?: boolean;
  signal?: AbortSignal;
}

export interface ExecuteSessionResult {
  session: SessionRecord;
  agent: DaemonAgent;
  result: string;
  completion?: {
    attachments?: Array<{ name: string; url: string; type: string }>;
    fileTransferOffer?: {
      transfer_id: string;
      zip_size: number;
      zip_sha256: string;
      file_count: number;
    };
    zipBuffer?: Buffer;
  };
}

export type RuntimeStreamEvent =
  | { type: 'session'; session: SessionRecord; agent: DaemonAgent }
  | { type: 'chunk'; sessionId: string; delta: string }
  | { type: 'tool'; sessionId: string; event: { kind: string; tool_name: string; tool_call_id: string; delta: string } }
  | { type: 'done'; sessionId: string; result: string; claudeResumeId: string | null }
  | { type: 'error'; sessionId?: string; message: string }
  | { type: 'fan-out-progress'; agentSlug: string; status: 'started' | 'chunk' | 'done' | 'error'; delta?: string; error?: string }
  | { type: 'fan-out-verdict'; delta: string }
  | { type: 'parallel-progress'; index: number; status: 'started' | 'completed' | 'error'; sessionId?: string; error?: string }
  | { type: 'parallel-chunk'; index: number; delta: string };

export interface ProviderExposureResult {
  remoteAgentId?: string | null;
  remoteSlug?: string | null;
  status: string;
  config?: Record<string, unknown>;
  lastSyncedAt?: string | null;
}

export interface FanOutInput {
  task: string;
  agentRefs: string[];
  synthesizerRef?: string;
  tags?: string[];
}

export interface FanOutAgentResult {
  agentRef: string;
  agentSlug: string;
  sessionId: string;
  result: string;
  error?: string;
}

export interface FanOutResult {
  taskGroupId: string;
  results: FanOutAgentResult[];
  verdict?: string;
}
