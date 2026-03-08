import { randomUUID } from 'node:crypto';
import type { CliAdapter } from '../adapters/cli-session.js';
import { CliAdapter as RuntimeCliAdapter } from '../adapters/cli-session.js';
import type { SessionDonePayload, SessionHandle, ToolEvent } from '../adapters/base.js';
import { getProfile } from '../adapters/profiles.js';
import { createClient, PlatformApiError } from '../platform/api-client.js';
import { createLocalRuntimeQueue, type QueueLease, type RuntimeQueueController } from '../utils/local-runtime-queue.js';
import { log } from '../utils/logger.js';
import type { DaemonStore } from './store.js';
import type {
  DaemonAgent,
  ExecuteSessionInput,
  ExecuteSessionResult,
  RuntimeStreamEvent,
  SessionMessage,
  SessionRecord,
} from './types.js';

interface ActiveExecution {
  requestId: string;
  mode: 'chat' | 'call';
  agent: DaemonAgent;
  sessionId: string;
  result: string;
  emit(event: RuntimeStreamEvent): void;
  resolve(result: { result: string; completion?: SessionDonePayload }): void;
  reject(error: Error): void;
}

interface ManagedSession {
  agent: DaemonAgent;
  handle: SessionHandle;
  active?: ActiveExecution;
}

function mergeTags(existing: string[], next: string[] | undefined): string[] {
  const merged = new Set<string>(existing);
  for (const tag of next ?? []) {
    const normalized = tag.trim();
    if (normalized) merged.add(normalized);
  }
  return Array.from(merged);
}

function truncateTitle(input: string): string {
  const text = input.trim();
  return text.length <= 80 ? text : `${text.slice(0, 77)}...`;
}

function roleLabel(message: SessionMessage): string {
  switch (message.role) {
    case 'assistant':
      return 'Assistant';
    case 'tool':
      return 'Tool';
    case 'system':
      return 'System';
    default:
      return 'User';
  }
}

export function buildPromptFromHistory(messages: SessionMessage[], nextMessage: string): string {
  if (messages.length === 0) {
    return nextMessage;
  }

  const transcript = messages
    .map((message) => `${roleLabel(message)} (${message.kind}):\n${message.content}`)
    .join('\n\n');

  return [
    'Continue the existing agent-mesh local session using the transcript below.',
    'Preserve context and respond as the assistant for the next user turn.',
    '',
    'Transcript:',
    transcript,
    '',
    'Next user message:',
    nextMessage,
  ].join('\n');
}

export class DaemonRuntime {
  private adapters = new Map<string, CliAdapter>();
  private managedSessions = new Map<string, ManagedSession>();
  private sessionChains = new Map<string, Promise<unknown>>();
  private runtimeQueue: RuntimeQueueController;

  constructor(private store: DaemonStore) {
    const limits = this.store.getRuntimeLimit('daemon', 'global');
    this.runtimeQueue = createLocalRuntimeQueue({
      max_active_requests: limits.maxConcurrent ?? 10,
      queue_wait_timeout_ms: limits.queueWaitTimeoutMs ?? 10 * 60_000,
      queue_max_length: limits.queueMaxLength ?? 1000,
    });
  }

  async execute(input: ExecuteSessionInput, emit: (event: RuntimeStreamEvent) => void): Promise<ExecuteSessionResult> {
    const resolved = this.resolveSessionInput(input);
    const { session, agent } = resolved;

    emit({ type: 'session', session, agent });

    return this.enqueueSession(session.id, async () => {
      if (input.withFiles && !agent.sandbox) {
        throw new Error(`Agent "${agent.slug}" does not support file flows unless sandbox is enabled.`);
      }

      const requestId = randomUUID();
        const queueLease = await this.runtimeQueue.acquire({
          agentId: agent.id,
          sessionId: session.id,
          requestId,
          pid: process.pid,
        }, {
          signal: input.signal,
        });
      const stopHeartbeat = queueLease.startHeartbeat();
      let releaseReason: 'done' | 'error' = 'done';

      try {
        const currentSession = this.store.getSession(session.id)!;
        const tags = mergeTags(currentSession.tags, input.tags);
        const updatedSession = this.store.updateSession(session.id, {
          taskGroupId: input.taskGroupId ?? currentSession.taskGroupId,
          status: 'active',
          title: currentSession.title ?? input.title ?? truncateTitle(input.message),
          tags,
          touchLastActive: true,
        });
        this.schedulePlatformSessionSync(updatedSession.id);

        this.store.appendMessage({
          sessionId: updatedSession.id,
          role: 'user',
          kind: input.mode,
          content: input.message,
          metadata: {
            mode: input.mode,
            task_group_id: updatedSession.taskGroupId,
            origin: input.origin ?? 'local_cli',
            client_id: input.clientId ?? null,
            attachments: (input.attachments ?? []).map((attachment) => ({
              name: attachment.name,
              type: attachment.type,
              url: attachment.url,
            })),
          },
        });

        const prompt = this.buildPrompt(updatedSession, input.message);
        const managed = this.getManagedSession(updatedSession, agent);

        const execution = await new Promise<{ result: string; completion?: SessionDonePayload }>((resolve, reject) => {
          managed.active = {
            requestId,
            mode: input.mode,
            agent,
            sessionId: updatedSession.id,
            result: '',
            emit,
            resolve,
            reject,
          };

          try {
            managed.handle.send(
              prompt,
              input.attachments,
              input.clientId ?? (agent.sandbox ? updatedSession.id : undefined),
              input.withFiles ?? false,
            );
          } catch (error) {
            managed.active = undefined;
            reject(error as Error);
          }
        });

        const freshSession = this.store.getSession(updatedSession.id)!;
        return {
          session: freshSession,
          agent,
          result: execution.result,
          completion: execution.completion,
        };
      } catch (error) {
        releaseReason = 'error';
        throw error;
      } finally {
        await this.safeReleaseLease(queueLease, stopHeartbeat, releaseReason);
      }
    });
  }

  stopSession(sessionId: string): SessionRecord {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const managed = this.managedSessions.get(sessionId);
    if (managed?.active) {
      const active = managed.active;
      managed.active = undefined;
      managed.handle.kill();
      active.emit({ type: 'error', sessionId, message: 'Session stopped by owner.' });
      active.reject(new Error('Session stopped by owner.'));
    }

    const next = this.store.stopSession(sessionId);
    this.schedulePlatformSessionSync(next.id);
    return next;
  }

  async archiveSession(sessionId: string): Promise<SessionRecord> {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const next = this.store.archiveSession(sessionId);
    this.schedulePlatformSessionSync(next.id);
    return next;
  }

  async getUiStatusSnapshot(): Promise<{
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
  }> {
    const queue = await this.runtimeQueue.snapshot();
    const activeExecutions = Array.from(this.managedSessions.values()).filter((managed) => managed.active).length;

    return {
      activeExecutions,
      managedSessions: this.managedSessions.size,
      queue,
    };
  }

  async syncSessionToPlatform(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId);
    if (!session || session.principalType !== 'owner_local') {
      return;
    }

    const agent = this.store.getAgentById(session.agentId);
    if (!agent) {
      return;
    }

    const binding = this.store.getProviderBinding(agent.id, 'agents-hot');
    if (!binding?.remoteAgentId || binding.status === 'inactive') {
      return;
    }

    try {
      const client = createClient();
      await client.post(`/api/developer/agents/${binding.remoteAgentId}/sessions/sync`, {
        session_id: session.id,
        title: session.title,
        status: session.status,
        last_active_at: session.lastActiveAt,
      });
    } catch (error) {
      if (error instanceof PlatformApiError && error.statusCode === 401) {
        return;
      }
      log.warn(`Failed to sync daemon session ${session.id.slice(0, 8)}... to agents-hot: ${(error as Error).message}`);
    }
  }

  private resolveSessionInput(input: ExecuteSessionInput): { session: SessionRecord; agent: DaemonAgent } {
    if (input.sessionId) {
      const session = this.store.getSession(input.sessionId);
      if (!session) {
        if (!input.createIfMissing) {
          throw new Error(`Session not found: ${input.sessionId}`);
        }
        if (!input.agentRef) {
          throw new Error(`agentRef is required to create session ${input.sessionId}`);
        }

        const agent = this.store.resolveAgentRef(input.agentRef);
        if (!agent) {
          throw new Error(`Local agent not found: ${input.agentRef}`);
        }

        const created = this.store.createSession({
          id: input.sessionId,
          agentId: agent.id,
          taskGroupId: input.taskGroupId,
          origin: input.origin ?? 'local_cli',
          principalType: input.principalType ?? 'owner_local',
          principalId: input.principalId ?? 'owner',
          status: 'idle',
          title: input.title ?? truncateTitle(input.message),
          tags: input.tags,
        });
        return { session: created, agent };
      }

      const agent = this.store.getAgentById(session.agentId);
      if (!agent) throw new Error(`Agent not found for session: ${session.agentId}`);

      if (input.taskGroupId && input.taskGroupId !== session.taskGroupId) {
        return {
          session: this.store.updateSession(session.id, {
            taskGroupId: input.taskGroupId,
            touchLastActive: true,
          }),
          agent,
        };
      }

      return { session, agent };
    }

    if (input.forkFromSessionId) {
      const session = this.store.forkSession({
        sourceSessionId: input.forkFromSessionId,
        taskGroupId: input.taskGroupId,
        title: input.title,
        tags: input.tags,
      });
      const agent = this.store.getAgentById(session.agentId);
      if (!agent) throw new Error(`Agent not found for session: ${session.agentId}`);
      return { session, agent };
    }

    if (!input.agentRef) {
      throw new Error('agentRef is required when no session is provided.');
    }

    const agent = this.store.resolveAgentRef(input.agentRef);
    if (!agent) {
      throw new Error(`Local agent not found: ${input.agentRef}`);
    }

    const session = this.store.createSession({
      agentId: agent.id,
      taskGroupId: input.taskGroupId,
      origin: input.origin ?? 'local_cli',
      principalType: input.principalType ?? 'owner_local',
      principalId: input.principalId ?? 'owner',
      status: 'idle',
      title: input.title ?? truncateTitle(input.message),
      tags: input.tags,
    });

    return { session, agent };
  }

  private getAdapter(agent: DaemonAgent): CliAdapter {
    let adapter = this.adapters.get(agent.id);
    if (!adapter) {
      adapter = new RuntimeCliAdapter(getProfile(agent.runtimeType), {
        project: agent.projectPath,
        sandboxEnabled: agent.sandbox,
        agentId: agent.id,
      });
      this.adapters.set(agent.id, adapter);
    }
    return adapter;
  }

  private getManagedSession(session: SessionRecord, agent: DaemonAgent): ManagedSession {
    const existing = this.managedSessions.get(session.id);
    if (existing) {
      return existing;
    }

    const adapter = this.getAdapter(agent);
    const handle = adapter.createSession(session.id, {
      project: agent.projectPath,
      sandboxEnabled: agent.sandbox,
      agentId: agent.id,
      resumeSessionId: session.claudeResumeId ?? undefined,
    });

    const managed: ManagedSession = { agent, handle };
    this.wireSession(managed, session.id);
    this.managedSessions.set(session.id, managed);
    return managed;
  }

  private wireSession(managed: ManagedSession, sessionId: string): void {
    managed.handle.onChunk((delta) => {
      const active = managed.active;
      if (!active) return;
      active.result += delta;
      active.emit({ type: 'chunk', sessionId, delta });
    });

    managed.handle.onToolEvent((event: ToolEvent) => {
      const active = managed.active;
      if (!active) return;
      active.emit({ type: 'tool', sessionId, event });
    });

    managed.handle.onDone((payload) => {
      void this.finishSessionSuccess(sessionId, managed, payload);
    });

    managed.handle.onError((error) => {
      void this.finishSessionError(sessionId, managed, error);
    });
  }

  private async finishSessionSuccess(sessionId: string, managed: ManagedSession, payload?: SessionDonePayload): Promise<void> {
    const active = managed.active;
    if (!active) return;

    managed.active = undefined;

    const resumeId = managed.handle.getResumeSessionId() ?? null;
    if (active.result.trim()) {
      this.store.appendMessage({
        sessionId,
        role: 'assistant',
        kind: active.mode,
        content: active.result,
        metadata: {
          request_id: active.requestId,
        },
      });
    }

    const session = this.store.updateSession(sessionId, {
      status: 'idle',
      claudeResumeId: resumeId,
      touchLastActive: true,
    });

    active.emit({
      type: 'done',
      sessionId,
      result: active.result,
      claudeResumeId: session.claudeResumeId,
    });
    this.schedulePlatformSessionSync(session.id);
    active.resolve({
      result: active.result,
      completion: payload,
    });
  }

  private async finishSessionError(sessionId: string, managed: ManagedSession, error: Error): Promise<void> {
    const active = managed.active;
    if (!active) return;

    managed.active = undefined;
    this.store.updateSession(sessionId, {
      status: 'failed',
      touchLastActive: true,
    });
    this.schedulePlatformSessionSync(sessionId);

    active.emit({ type: 'error', sessionId, message: error.message });
    active.reject(error);
  }

  private buildPrompt(session: SessionRecord, message: string): string {
    if (session.claudeResumeId) {
      return message;
    }

    const history = this.store.getSessionMessages(session.id);
    if (history.length === 0) {
      return message;
    }

    return buildPromptFromHistory(history, message);
  }

  private enqueueSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.sessionChains.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    this.sessionChains.set(sessionId, next);
    return next.finally(() => {
      if (this.sessionChains.get(sessionId) === next) {
        this.sessionChains.delete(sessionId);
      }
    });
  }

  private async safeReleaseLease(lease: QueueLease, stopHeartbeat: (() => void) | undefined, reason: 'done' | 'error'): Promise<void> {
    try {
      stopHeartbeat?.();
    } catch {}

    try {
      await lease.release(reason);
    } catch (error) {
      log.warn(`Failed to release daemon runtime lease: ${error}`);
    }
  }

  private schedulePlatformSessionSync(sessionId: string): void {
    void this.syncSessionToPlatform(sessionId);
  }
}
