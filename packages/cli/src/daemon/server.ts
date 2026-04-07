import { createServer, type Server as NetServer, type Socket } from 'node:net';
import { unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import pLimit from 'p-limit';
import { DaemonRuntime } from './runtime.js';
import {
  getDaemonDbPath,
  getDaemonSocketPath,
  getDaemonUiDefaultPort,
  getDaemonUiHost,
} from './paths.js';
import { DaemonStore } from './store.js';
import {
  createManagedAgent,
  exposeManagedAgent,
  removeManagedAgent,
  unexposeManagedAgent,
  updateManagedAgent,
} from './agent-management.js';
import type { DaemonEnvelope, DaemonRequest } from './protocol.js';
import type { AutoPruneConfig } from './types.js';
import { shutdownProviders } from '../providers/index.js';
import { loadToken } from '../platform/auth.js';
import { createClient } from '../platform/api-client.js';
import { log } from '../utils/logger.js';
import { createUiApiHandler } from '../ui/api-routes.js';
import { startUiHttpServer, type UiHttpServerHandle } from '../ui/http-server.js';
import { removeDaemonPid, scheduleDaemonRestartFromCurrentProcess } from './process.js';

/** Default auto prune config */
const DEFAULT_AUTO_PRUNE_CONFIG: AutoPruneConfig = {
  enabled: false,
  olderThan: '7d',
  status: 'failed,idle,completed',
  action: 'archive',
  limit: 100,
};

/**
 * Parse duration string like "7d", "24h", "1w" into milliseconds.
 * Supports: d (days), h (hours), w (weeks).
 */
function parseOlderThan(duration: string): number | null {
  const match = duration.match(/^(\d+)([dhw])$/);
  if (!match) return null;
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

interface AgentNetworkDaemonServerOptions {
  dbPath?: string;
  logPath?: string;
  uiHost?: string;
  uiPort?: number;
  uiControlHooks?: {
    stop?: () => void | Promise<void>;
    restart?: () => void | Promise<void>;
  };
}

interface DaemonListenAddress {
  socketPath: string;
  uiBaseUrl: string;
  uiPort: number;
}

function respond(socket: Socket, payload: DaemonEnvelope): void {
  socket.write(JSON.stringify(payload) + '\n');
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export class AgentNetworkDaemonServer {
  private readonly store: DaemonStore;
  private readonly runtime: DaemonRuntime;
  private readonly startedAt = new Date().toISOString();
  private readonly dbPath: string;
  private readonly preferredUiHost: string;
  private readonly preferredUiPort: number;
  private readonly logPath: string | null;
  private readonly uiControlHooks: AgentNetworkDaemonServerOptions['uiControlHooks'];
  private socketServer: NetServer | null = null;
  private socketPath: string | null = null;
  private uiServer: UiHttpServerHandle | null = null;
  private uiBaseUrl: string | null = null;
  private uiPort: number | null = null;
  private signalHandlersRegistered = false;
  private closed = false;
  private closing: Promise<void> | null = null;

  private readonly handleProcessSignal = (): void => {
    void this.close()
      .catch((error) => {
        log.warn(`Failed to stop daemon cleanly: ${(error as Error).message}`);
      })
      .finally(() => {
        process.exit(0);
      });
  };

  constructor(options: AgentNetworkDaemonServerOptions = {}) {
    this.dbPath = options.dbPath ?? getDaemonDbPath();
    this.logPath = options.logPath ?? null;
    this.uiControlHooks = options.uiControlHooks;
    this.store = new DaemonStore(this.dbPath);
    this.preferredUiHost = options.uiHost ?? getDaemonUiHost();
    this.preferredUiPort = options.uiPort ?? this.getPersistedUiPort() ?? getDaemonUiDefaultPort();
    this.runtime = new DaemonRuntime(this.store);
  }

  async listen(socketPath = getDaemonSocketPath()): Promise<void> {
    await this.start(socketPath, true);
  }

  async listenForTest(socketPath = this.getTestSocketPath()): Promise<DaemonListenAddress> {
    await this.start(socketPath, false);
    return {
      socketPath,
      uiBaseUrl: this.uiBaseUrl!,
      uiPort: this.uiPort!,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.closing) return this.closing;

    this.closing = this.closeInternal().finally(() => {
      this.closed = true;
      this.closing = null;
    });

    return this.closing;
  }

  private getTestSocketPath(): string {
    return join(dirname(this.dbPath), 'daemon.sock');
  }

  private getPersistedUiPort(): number | null {
    const setting = this.store.getDaemonSetting<{ value?: unknown } | number>('ui.last_port');
    const candidate = typeof setting === 'number'
      ? setting
      : typeof setting?.value === 'number'
        ? setting.value
        : null;

    if (!Number.isFinite(candidate) || candidate === null) {
      return null;
    }

    return Math.max(0, Math.trunc(candidate));
  }

  private async start(socketPath: string, registerSignalHandlers: boolean): Promise<void> {
    if (this.closed) {
      throw new Error('Agent mesh daemon server has already been closed.');
    }
    if (this.socketServer || this.uiServer) {
      return;
    }

    try {
      unlinkSync(socketPath);
    } catch {}

    this.socketPath = socketPath;
    this.uiServer = await startUiHttpServer({
      host: this.preferredUiHost,
      preferredPort: this.preferredUiPort,
      handleRequest: createUiApiHandler({
        store: this.store,
        runtime: this.runtime,
        startedAt: this.startedAt,
        getUiBaseUrl: () => this.uiBaseUrl,
        getUiPort: () => this.uiPort,
        getLogPath: this.logPath ? () => this.logPath! : undefined,
        requestStop: () => this.requestUiStop(),
        requestRestart: () => this.requestUiRestart(),
      }),
    });
    this.uiBaseUrl = this.uiServer.baseUrl;
    this.uiPort = this.uiServer.port;
    this.store.setDaemonSetting('ui.last_port', { value: this.uiPort });

    const server = createServer((socket) => {
      const rl = createInterface({ input: socket });

      rl.on('line', (line) => {
        void this.handleLine(socket, line);
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => resolve());
      });
    } catch (error) {
      await this.uiServer.close();
      this.uiServer = null;
      this.uiBaseUrl = null;
      this.uiPort = null;
      this.socketPath = null;
      throw error;
    }

    this.socketServer = server;

    if (registerSignalHandlers) {
      this.registerSignalHandlers();
    }

    log.info(`ah daemon listening on ${socketPath}`);
    log.info(`ah local ui listening on ${this.uiBaseUrl}`);
    void this.restoreProviderIngresses();
    void this.runAutoPrune();
  }

  private registerSignalHandlers(): void {
    if (this.signalHandlersRegistered) return;
    process.on('SIGTERM', this.handleProcessSignal);
    process.on('SIGINT', this.handleProcessSignal);
    this.signalHandlersRegistered = true;
  }

  private unregisterSignalHandlers(): void {
    if (!this.signalHandlersRegistered) return;
    process.off('SIGTERM', this.handleProcessSignal);
    process.off('SIGINT', this.handleProcessSignal);
    this.signalHandlersRegistered = false;
  }

  private requestUiStop(): void {
    if (this.uiControlHooks?.stop) {
      void Promise.resolve(this.uiControlHooks.stop());
      return;
    }

    setTimeout(() => {
      void this.close()
        .catch((error) => {
          log.warn(`Failed to stop daemon from local UI: ${(error as Error).message}`);
        })
        .finally(() => {
          removeDaemonPid();
          process.exit(0);
        });
    }, 150);
  }

  private requestUiRestart(): void {
    if (this.uiControlHooks?.restart) {
      void Promise.resolve(this.uiControlHooks.restart());
      return;
    }

    try {
      scheduleDaemonRestartFromCurrentProcess();
    } catch (error) {
      log.warn(`Failed to schedule daemon restart from local UI: ${(error as Error).message}`);
      return;
    }

    this.requestUiStop();
  }

  private async closeInternal(): Promise<void> {
    this.unregisterSignalHandlers();

    const socketServer = this.socketServer;
    const uiServer = this.uiServer;
    const socketPath = this.socketPath;

    this.socketServer = null;
    this.uiServer = null;
    this.socketPath = null;
    this.uiBaseUrl = null;
    this.uiPort = null;

    await Promise.all([
      new Promise<void>((resolve) => {
        if (!socketServer) {
          resolve();
          return;
        }
        socketServer.close(() => resolve());
      }),
      uiServer?.close() ?? Promise.resolve(),
    ]);

    await shutdownProviders().catch((error) => {
      log.warn(`Failed to stop provider ingress cleanly: ${error}`);
    });

    this.store.close();

    if (socketPath) {
      try {
        unlinkSync(socketPath);
      } catch {}
    }
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let request: DaemonRequest;
    try {
      request = JSON.parse(line) as DaemonRequest;
    } catch {
      return;
    }

    try {
      const result = await this.dispatchRequest(request, (event) => {
        respond(socket, {
          id: request.id,
          type: 'event',
          event,
        });
      });

      respond(socket, {
        id: request.id,
        type: 'result',
        result,
      });
    } catch (error) {
      respond(socket, {
        id: request.id,
        type: 'error',
        error: {
          code: 'daemon_error',
          message: (error as Error).message,
        },
      });
    }
  }

  private async dispatchRequest(request: DaemonRequest, emit: (event: unknown) => void): Promise<unknown> {
    switch (request.method) {
      case 'ping':
        return {
          ok: true,
          pid: process.pid,
          startedAt: this.startedAt,
        };

      case 'daemon.status':
        return {
          pid: process.pid,
          startedAt: this.startedAt,
          uiBaseUrl: this.uiBaseUrl,
          uiPort: this.uiPort,
          agents: this.store.listAgents().length,
          sessions: this.store.listSessions({ status: 'all' }).length,
          providerBindings: this.store.listProviderBindings().length,
          taskGroups: this.store.listTaskGroups().length,
          onlineBindings: this.store.listProviderBindings().filter((binding) => binding.status === 'online').length,
        };

      case 'agent.list':
        return {
          agents: this.store.listAgents(),
          bindings: this.store.listProviderBindings(),
        };

      case 'agent.get': {
        const ref = expectString(request.params?.ref, 'ref');
        const agent = this.store.resolveAgentRef(ref);
        if (!agent) throw new Error(`Local agent not found: ${ref}`);
        const sessions = this.store.listSessions({ agentId: agent.id, status: 'all' });
        return {
          agent,
          bindings: this.store.listProviderBindings(agent.id),
          sessionCount: sessions.length,
        };
      }

      case 'agent.ping': {
        const agentRefs = request.params?.agentRefs;
        if (!Array.isArray(agentRefs) || agentRefs.length === 0) {
          throw new Error('agentRefs is required and must be a non-empty array');
        }
        const timeoutMs = typeof request.params?.timeoutMs === 'number' ? request.params.timeoutMs : 30000;

        // Use simple health check that doesn't require launching Claude Code
        // This checks: agent exists, project path exists, runtime is available
        const pingAgent = async (ref: string): Promise<{
          agentRef: string;
          agentSlug: string;
          status: 'healthy' | 'unhealthy' | 'error';
          responseTimeMs?: number;
          error?: string;
        }> => {
          const startTime = Date.now();

          try {
            const agent = this.store.resolveAgentRef(ref);
            if (!agent) {
              return { agentRef: ref, agentSlug: ref, status: 'error', error: 'Agent not found' };
            }

            // Check project path exists
            try {
              const { statSync } = await import('node:fs');
              const stat = statSync(agent.projectPath);
              if (!stat.isDirectory()) {
                return {
                  agentRef: ref,
                  agentSlug: agent.slug,
                  status: 'unhealthy',
                  error: 'Project path is not a directory',
                };
              }
            } catch {
              return {
                agentRef: ref,
                agentSlug: agent.slug,
                status: 'unhealthy',
                error: `Project path not found: ${agent.projectPath}`,
              };
            }

            // Check runtime type is supported
            const supportedRuntimes = ['claude', 'gemini', 'openai'];
            if (!supportedRuntimes.includes(agent.runtimeType.toLowerCase())) {
              return {
                agentRef: ref,
                agentSlug: agent.slug,
                status: 'unhealthy',
                error: `Unsupported runtime: ${agent.runtimeType}`,
              };
            }

            const responseTimeMs = Date.now() - startTime;
            return {
              agentRef: ref,
              agentSlug: agent.slug,
              status: 'healthy',
              responseTimeMs,
            };
          } catch (error) {
            return {
              agentRef: ref,
              agentSlug: ref,
              status: 'error',
              error: (error as Error).message,
            };
          }
        };

        const results = await Promise.all(agentRefs.map((ref) => pingAgent(String(ref))));
        return { results };
      }

      case 'agent.add': {
        const agent = createManagedAgent({ store: this.store, runtime: this.runtime }, {
          name: expectString(request.params?.name, 'name'),
          slug: typeof request.params?.slug === 'string' ? request.params.slug : undefined,
          runtimeType: typeof request.params?.runtimeType === 'string' ? request.params.runtimeType : 'claude',
          projectPath: expectString(request.params?.projectPath, 'projectPath'),
          sandbox: request.params?.sandbox === true,
          persona: typeof request.params?.persona === 'string' ? request.params.persona : null,
          description: typeof request.params?.description === 'string' ? request.params.description : null,
          capabilities: Array.isArray(request.params?.capabilities)
            ? request.params?.capabilities.map((item) => String(item))
            : [],
          visibility: typeof request.params?.visibility === 'string'
            ? request.params.visibility as 'public' | 'private' | 'unlisted'
            : 'private',
          remoteHost: typeof request.params?.remoteHost === 'string' ? request.params.remoteHost : null,
        });
        return { agent };
      }

      case 'agent.update': {
        const ref = expectString(request.params?.ref, 'ref');
        const agent = await updateManagedAgent({ store: this.store, runtime: this.runtime }, ref, {
          slug: typeof request.params?.slug === 'string' ? request.params.slug : undefined,
          name: typeof request.params?.name === 'string' ? request.params.name : undefined,
          runtimeType: typeof request.params?.runtimeType === 'string' ? request.params.runtimeType : undefined,
          projectPath: typeof request.params?.projectPath === 'string' ? request.params.projectPath : undefined,
          sandbox: typeof request.params?.sandbox === 'boolean' ? request.params.sandbox : undefined,
          persona: typeof request.params?.persona === 'string' ? request.params.persona : undefined,
          description: typeof request.params?.description === 'string' ? request.params.description : undefined,
          capabilities: Array.isArray(request.params?.capabilities)
            ? request.params.capabilities.map((item) => String(item))
            : undefined,
          visibility: typeof request.params?.visibility === 'string'
            ? request.params.visibility as 'public' | 'private' | 'unlisted'
            : undefined,
          remoteHost: request.params?.remoteHost === null ? null
            : typeof request.params?.remoteHost === 'string' ? request.params.remoteHost
            : undefined,
        });
        return { agent };
      }

      case 'agent.remove': {
        const ref = expectString(request.params?.ref, 'ref');
        return removeManagedAgent({ store: this.store, runtime: this.runtime }, ref);
      }

      case 'agent.expose': {
        const ref = expectString(request.params?.ref, 'ref');
        const providerName = expectString(request.params?.provider, 'provider');
        return exposeManagedAgent(
          { store: this.store, runtime: this.runtime },
          ref,
          providerName,
          typeof request.params?.config === 'object' && request.params?.config
            ? request.params.config as Record<string, unknown>
            : {},
        );
      }

      case 'agent.unexpose': {
        const ref = expectString(request.params?.ref, 'ref');
        const providerName = expectString(request.params?.provider, 'provider');
        return unexposeManagedAgent({ store: this.store, runtime: this.runtime }, ref, providerName);
      }

      case 'agent.grant': {
        const ref = expectString(request.params?.ref, 'ref');
        const principal = expectString(request.params?.principal, 'principal');
        const permission = typeof request.params?.permission === 'string' ? request.params.permission : 'call';
        const agent = this.store.resolveAgentRef(ref);
        if (!agent) throw new Error(`Local agent not found: ${ref}`);
        const entry = this.store.grantAccess({ agentId: agent.id, principal, permission });
        return { agent, entry };
      }

      case 'agent.revoke': {
        const ref = expectString(request.params?.ref, 'ref');
        const principal = expectString(request.params?.principal, 'principal');
        const permission = typeof request.params?.permission === 'string' ? request.params.permission : undefined;
        const agent = this.store.resolveAgentRef(ref);
        if (!agent) throw new Error(`Local agent not found: ${ref}`);
        const revoked = this.store.revokeAccess(agent.id, principal, permission);
        return { agent, revoked };
      }

      case 'agent.acl': {
        const ref = expectString(request.params?.ref, 'ref');
        const agent = this.store.resolveAgentRef(ref);
        if (!agent) throw new Error(`Local agent not found: ${ref}`);
        return { agent, entries: this.store.listAcl(agent.id) };
      }

      case 'task.create': {
        const title = expectString(request.params?.title, 'title');
        const source = typeof request.params?.source === 'string' ? request.params.source : undefined;
        return { taskGroup: this.store.createTaskGroup({ title, source }) };
      }

      case 'task.list': {
        const status = typeof request.params?.status === 'string' ? request.params.status : undefined;
        return { taskGroups: this.store.listTaskGroups({ status }) };
      }

      case 'task.show': {
        const id = expectString(request.params?.id, 'id');
        const taskGroup = this.store.getTaskGroup(id);
        if (!taskGroup) throw new Error(`Task group not found: ${id}`);
        const sessions = this.store.listSessions({ taskGroupId: id, status: 'all' });
        return { taskGroup, sessions };
      }

      case 'task.archive': {
        const id = expectString(request.params?.id, 'id');
        return { taskGroup: this.store.archiveTaskGroup(id) };
      }

      case 'task.update': {
        const id = expectString(request.params?.id, 'id');
        return {
          taskGroup: this.store.updateTaskGroup(id, {
            title: typeof request.params?.title === 'string' ? request.params.title : undefined,
            status: typeof request.params?.status === 'string' ? request.params.status : undefined,
          }),
        };
      }

      case 'runtime.fan-out': {
        const task = expectString(request.params?.task, 'task');
        const agentRefs = request.params?.agentRefs;
        if (!Array.isArray(agentRefs) || agentRefs.length === 0) {
          throw new Error('agentRefs is required and must be a non-empty array');
        }
        return this.runtime.fanOut({
          task,
          agentRefs: agentRefs.map(String),
          synthesizerRef: typeof request.params?.synthesizerRef === 'string' ? request.params.synthesizerRef : undefined,
          tags: Array.isArray(request.params?.tags) ? request.params.tags.map(String) : undefined,
        }, emit);
      }

      case 'provider.status': {
        const bindings = this.store.listProviderBindings();
        const agents = bindings.map((b) => {
          const agent = this.store.getAgentById(b.agentId);
          return {
            slug: agent?.slug ?? b.agentId,
            name: agent?.name ?? 'unknown',
            status: b.status,
            remoteAgentId: b.remoteAgentId,
            remoteSlug: b.remoteSlug,
            lastSyncedAt: b.lastSyncedAt,
          };
        });
        const hasToken = !!loadToken();
        return { provider: 'agents-hot', authenticated: hasToken, agents, network: null };
      }

      case 'provider.join': {
        const inviteCode = expectString(request.params?.inviteCode, 'inviteCode');
        const client = createClient();
        return client.post<{ network: { id: string; name: string }; role: string }>(
          '/api/developer/network/join',
          { inviteCode },
        );
      }

      case 'provider.invite': {
        const client = createClient();
        return client.post<{ inviteCode: string; expiresAt: string; sentTo: string | null }>(
          '/api/developer/network/invite',
          {
            email: typeof request.params?.email === 'string' ? request.params.email : undefined,
            role: typeof request.params?.role === 'string' ? request.params.role : 'member',
            expires: typeof request.params?.expires === 'string' ? request.params.expires : '7d',
          },
        );
      }

      case 'provider.members': {
        const client = createClient();
        return client.get<{ members: Array<{ id: string; name: string | null; email: string | null; role: string; agentCount: number; joinedAt: string; lastActiveAt: string | null }> }>(
          '/api/developer/network/members',
        );
      }

      case 'provider.kick': {
        const memberId = expectString(request.params?.memberId, 'memberId');
        const client = createClient();
        return client.post<{ ok: boolean; memberId: string }>(
          '/api/developer/network/kick',
          { memberId },
        );
      }

      case 'session.list': {
        let agentId: string | undefined;
        if (typeof request.params?.agentRef === 'string' && request.params.agentRef.trim()) {
          const agent = this.store.resolveAgentRef(request.params.agentRef);
          if (!agent) throw new Error(`Local agent not found: ${request.params.agentRef}`);
          agentId = agent.id;
        }
        const taskGroupId = typeof request.params?.taskGroupId === 'string' ? request.params.taskGroupId : undefined;
        const limit = typeof request.params?.limit === 'number'
          ? request.params.limit
          : typeof request.params?.limit === 'string'
            ? parseInt(request.params.limit, 10)
            : undefined;
        return {
          sessions: this.store.listSessions({
            agentId,
            taskGroupId,
            status: typeof request.params?.status === 'string'
              ? request.params.status as 'queued' | 'active' | 'idle' | 'paused' | 'completed' | 'failed' | 'archived' | 'all'
              : 'all',
            tag: typeof request.params?.tag === 'string' ? request.params.tag : undefined,
            search: typeof request.params?.search === 'string' ? request.params.search : undefined,
            limit: limit && Number.isFinite(limit) ? Math.max(1, limit) : undefined,
          }),
        };
      }

      case 'session.show': {
        const id = expectString(request.params?.id, 'id');
        const resolvedId = this.store.resolveSessionRef(id);
        if (!resolvedId) throw new Error(`Session not found: ${id}`);
        const session = this.store.getSession(resolvedId);
        if (!session) throw new Error(`Session not found: ${id}`);
        const agent = this.store.getAgentById(session.agentId);
        return {
          session,
          agent,
          messages: this.store.getSessionMessages(resolvedId),
        };
      }

      case 'session.attach': {
        const id = expectString(request.params?.id, 'id');
        const resolvedId = this.store.resolveSessionRef(id);
        if (!resolvedId) throw new Error(`Session not found: ${id}`);
        const session = this.store.getSession(resolvedId);
        if (!session) throw new Error(`Session not found: ${id}`);
        const agent = this.store.getAgentById(session.agentId);
        return {
          session,
          agent,
          messages: this.store.getSessionMessages(resolvedId),
        };
      }

      case 'session.messages': {
        const id = expectString(request.params?.id, 'id');
        const resolvedId = this.store.resolveSessionRef(id);
        if (!resolvedId) throw new Error(`Session not found: ${id}`);
        const session = this.store.getSession(resolvedId);
        if (!session) throw new Error(`Session not found: ${id}`);
        const messages = this.store.getSessionMessages(resolvedId);
        return { messages };
      }

      case 'session.fork': {
        const id = expectString(request.params?.id, 'id');
        const resolvedId = this.store.resolveSessionRef(id);
        if (!resolvedId) throw new Error(`Session not found: ${id}`);
        const session = this.store.forkSession({
          sourceSessionId: resolvedId,
          title: typeof request.params?.title === 'string' ? request.params.title : undefined,
          taskGroupId: typeof request.params?.taskGroupId === 'string' ? request.params.taskGroupId : undefined,
          tags: normalizeTags(request.params?.tags),
        });
        return {
          session,
          messages: this.store.getSessionMessages(session.id),
        };
      }

      case 'session.stop': {
        const id = expectString(request.params?.id, 'id');
        const resolvedId = this.store.resolveSessionRef(id);
        if (!resolvedId) throw new Error(`Session not found: ${id}`);
        return { session: this.runtime.stopSession(resolvedId) };
      }

      case 'session.start': {
        const ids = request.params?.ids;
        if (!Array.isArray(ids) || ids.length === 0) {
          throw new Error('ids array is required');
        }
        const maxParallel = typeof request.params?.maxParallel === 'number'
          ? Math.max(1, Math.min(request.params.maxParallel, 20))
          : 4;

        // Start sessions in parallel
        const results: Array<{ id: string; status: string; error?: string }> = [];

        // Process in batches
        for (let i = 0; i < ids.length; i += maxParallel) {
          const batch = ids.slice(i, i + maxParallel);
          const batchResults = await Promise.all(
            batch.map(async (id: string) => {
              try {
                const session = this.runtime.startSession(id);
                return { id, status: session.status, error: undefined };
              } catch (err) {
                return { id, status: '', error: err instanceof Error ? err.message : String(err) };
              }
            })
          );
          results.push(...batchResults);
        }

        return { results };
      }

      // --- Start multiple agents in parallel, creating idle sessions ---
      case 'session.startAgents': {
        const agentRefs = request.params?.agentRefs;
        if (!Array.isArray(agentRefs) || agentRefs.length === 0) {
          throw new Error('agentRefs array is required');
        }
        const maxParallel = typeof request.params?.maxParallel === 'number'
          ? Math.max(1, Math.min(request.params.maxParallel, 20))
          : 4;
        const tags = normalizeTags(request.params?.tags);

        // Limit concurrent session creations
        const limit = pLimit(maxParallel);

        // Process each agent in parallel with limit
        const results = await Promise.all(
          agentRefs.map((agentRef: string, index: number) =>
            limit(async () => {
              try {
                const agent = this.store.resolveAgentRef(agentRef);
                if (!agent) {
                  return {
                    index,
                    agentRef,
                    status: 'error',
                    error: `Agent not found: ${agentRef}`,
                  };
                }

                // Create idle session for this agent
                const session = this.store.createSession({
                  agentId: agent.id,
                  origin: 'local_cli',
                  principalType: 'owner_local',
                  principalId: 'owner',
                  status: 'idle',
                  title: `Session with ${agent.name || agent.slug}`,
                  tags,
                });

                this.runtime.schedulePlatformSessionSync(session.id);

                return {
                  index,
                  agentRef,
                  sessionId: session.id,
                  status: 'idle',
                };
              } catch (err) {
                return {
                  index,
                  agentRef,
                  status: 'error',
                  error: err instanceof Error ? err.message : String(err),
                };
              }
            })
          )
        );

        // Sort by original index to preserve order
        results.sort((a, b) => a.index - b.index);

        return { results };
      }

      case 'session.archive': {
        const id = expectString(request.params?.id, 'id');
        const resolvedId = this.store.resolveSessionRef(id);
        if (!resolvedId) throw new Error(`Session not found: ${id}`);
        const session = this.store.archiveSession(resolvedId);
        await this.runtime.syncSessionToPlatform(resolvedId);
        return { session };
      }

      case 'session.delete': {
        const id = expectString(request.params?.id, 'id');
        const resolvedId = this.store.resolveSessionRef(id);
        if (!resolvedId) throw new Error(`Session not found: ${id}`);
        this.store.deleteSession(resolvedId);
        return { deleted: true, id: resolvedId };
      }

      case 'session.run': {
        const agentRef = expectString(request.params?.agentRef, 'agentRef');
        const messages = request.params?.messages;
        if (!Array.isArray(messages) || messages.length === 0) {
          throw new Error('messages array is required');
        }
        const maxParallel = typeof request.params?.maxParallel === 'number'
          ? Math.max(1, Math.min(request.params.maxParallel, 20))
          : 4;
        const tags = normalizeTags(request.params?.tags);
        const timeoutMs = typeof request.params?.timeoutMs === 'number'
          ? request.params.timeoutMs
          : 300_000;

        const result = await this.runtime.runSessionsParallel({
          agentRef,
          messages,
          maxParallel,
          tags,
          timeoutMs,
        }, (event) => emit(event));

        return result;
      }

      case 'runtime.chat':
      case 'runtime.call': {
        // Send keepalive events every 15s to prevent client socket timeout
        // during agent startup (Claude process spawn + first output can take minutes)
        const keepalive = setInterval(() => {
          emit({ type: 'keepalive' } as unknown as RuntimeStreamEvent);
        }, 15_000);
        try {
          const result = await this.runtime.execute({
            agentRef: typeof request.params?.agentRef === 'string' ? request.params.agentRef : undefined,
            sessionId: typeof request.params?.sessionId === 'string' ? request.params.sessionId : undefined,
            forkFromSessionId: typeof request.params?.forkFromSessionId === 'string' ? request.params.forkFromSessionId : undefined,
            message: expectString(request.params?.message, 'message'),
            mode: request.method === 'runtime.chat' ? 'chat' : 'call',
            title: typeof request.params?.title === 'string' ? request.params.title : undefined,
            taskGroupId: typeof request.params?.taskGroupId === 'string' ? request.params.taskGroupId : undefined,
            tags: normalizeTags(request.params?.tags),
            principalType: 'owner_local',
            principalId: 'owner',
            withFiles: request.params?.withFiles === true,
          }, emit);
          return {
            ...result,
            completion: result.completion
              ? {
                attachments: result.completion.attachments,
                fileTransferOffer: result.completion.fileTransferOffer,
              }
              : undefined,
          };
        } finally {
          clearInterval(keepalive);
        }
      }

      case 'config.get': {
        const key = expectString(request.params?.key, 'key');
        const value = this.store.getDaemonSetting(key);
        return { key, value };
      }

      case 'config.set': {
        const key = expectString(request.params?.key, 'key');
        const value = request.params?.value;
        this.store.setDaemonSetting(key, value);
        return { key, value };
      }

      case 'config.autoPrune.get': {
        const config = this.store.getDaemonSetting<AutoPruneConfig>('autoPrune') ?? DEFAULT_AUTO_PRUNE_CONFIG;
        return { config };
      }

      case 'config.autoPrune.set': {
        const partial = request.params ?? {};
        const current = this.store.getDaemonSetting<AutoPruneConfig>('autoPrune') ?? DEFAULT_AUTO_PRUNE_CONFIG;
        const updated: AutoPruneConfig = {
          enabled: typeof partial.enabled === 'boolean' ? partial.enabled : current.enabled,
          olderThan: typeof partial.olderThan === 'string' ? partial.olderThan : current.olderThan,
          status: typeof partial.status === 'string' ? partial.status : current.status,
          action: typeof partial.action === 'string' ? partial.action as 'archive' | 'delete' : current.action,
          limit: typeof partial.limit === 'number' ? partial.limit : current.limit,
        };
        this.store.setDaemonSetting('autoPrune', updated);
        return { config: updated };
      }

      default:
        throw new Error(`Unknown daemon method: ${request.method}`);
    }
  }

  private async restoreProviderIngresses(): Promise<void> {
    for (const binding of this.store.listProviderBindings()) {
      if (binding.status === 'inactive') continue;
      const agent = this.store.getAgentById(binding.agentId);
      if (!agent) continue;

      try {
        const provider = getProvider(binding.provider);
        await provider.startIngress({ agent, binding, store: this.store, runtime: this.runtime });
      } catch (error) {
        this.store.upsertProviderBinding({
          agentId: binding.agentId,
          provider: binding.provider,
          remoteAgentId: binding.remoteAgentId,
          remoteSlug: binding.remoteSlug,
          status: 'error',
          config: binding.config,
          lastSyncedAt: new Date().toISOString(),
        });
        log.warn(`Failed to restore ${binding.provider} ingress for ${agent.slug}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Run auto prune if enabled in daemon settings.
   * This is called on daemon start to clean up old sessions.
   */
  private async runAutoPrune(): Promise<void> {
    const config = this.store.getDaemonSetting<AutoPruneConfig>('autoPrune');
    if (!config?.enabled) return;

    const olderThanMs = parseOlderThan(config.olderThan);
    if (!olderThanMs || olderThanMs <= 0) {
      log.warn(`Invalid autoPrune.olderThan: ${config.olderThan}`);
      return;
    }

    const cutoff = Date.now() - olderThanMs;
    const statuses = config.status.split(',').map(s => s.trim()).filter(Boolean);

    if (statuses.length === 0) {
      log.warn('autoPrune.status is empty, skipping');
      return;
    }

    // Get sessions matching the criteria
    const sessions = [];
    for (const status of statuses) {
      const list = this.store.listSessions({ status: status as 'queued' | 'active' | 'idle' | 'paused' | 'completed' | 'failed' | 'archived' });
      sessions.push(...list);
    }

    // Filter by olderThan
    const toPrune = sessions.filter(s => {
      const lastActive = new Date(s.lastActiveAt).getTime();
      return lastActive < cutoff;
    });

    // Apply limit
    const limited = config.limit > 0 ? toPrune.slice(0, config.limit) : toPrune;

    if (limited.length === 0) {
      log.info(`Auto prune: no sessions to ${config.action}`);
      return;
    }

    log.info(`Auto prune: ${config.action}ing ${limited.length} session(s) (older than ${config.olderThan}, status: ${config.status})`);

    let success = 0;
    let errors = 0;

    for (const session of limited) {
      try {
        if (config.action === 'archive') {
          this.store.archiveSession(session.id);
        } else {
          this.store.deleteSession(session.id);
        }
        success++;
      } catch {
        errors++;
      }
    }

    if (errors > 0) {
      log.warn(`Auto prune completed: ${success} ${config.action}d, ${errors} error(s)`);
    } else {
      log.info(`Auto prune completed: ${success} session(s) ${config.action}d`);
    }
  }
}
