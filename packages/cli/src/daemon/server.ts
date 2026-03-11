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
import { shutdownProviders } from '../providers/index.js';
import { log } from '../utils/logger.js';
import { createUiApiHandler } from '../ui/api-routes.js';
import { startUiHttpServer, type UiHttpServerHandle } from '../ui/http-server.js';
import { removeDaemonPid, scheduleDaemonRestartFromCurrentProcess } from './process.js';

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
          taskGroups: this.store.listTaskGroups().length,
          providerBindings: this.store.listProviderBindings().length,
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
            const supportedRuntimes = ['claude', 'codex', 'gemini', 'openai'];
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

      case 'task.create': {
        const taskGroup = this.store.createTaskGroup({
          title: expectString(request.params?.title, 'title'),
          ownerPrincipal: typeof request.params?.ownerPrincipal === 'string' ? request.params.ownerPrincipal : 'owner:local',
          source: typeof request.params?.source === 'string' ? request.params.source : 'cli',
          status: typeof request.params?.status === 'string' ? request.params.status : 'active',
          metadata: typeof request.params?.metadata === 'object' && request.params?.metadata
            ? request.params.metadata as Record<string, unknown>
            : {},
        });
        return { taskGroup };
      }

      case 'task.list': {
        const status = request.params?.status as string | undefined;
        return { taskGroups: this.store.listTaskGroups({ status }) };
      }

      case 'task.show': {
        const id = expectString(request.params?.id, 'id');
        const taskGroup = this.store.getTaskGroup(id);
        if (!taskGroup) throw new Error(`Task group not found: ${id}`);
        return {
          taskGroup,
          sessions: this.store.listSessions({ taskGroupId: id, status: 'all' }),
        };
      }

      case 'task.archive': {
        const id = expectString(request.params?.id, 'id');
        return { taskGroup: this.store.archiveTaskGroup(id) };
      }

      case 'task.update': {
        const id = expectString(request.params?.id, 'id');
        const taskGroup = this.store.updateTaskGroup(id, {
          title: typeof request.params?.title === 'string' ? request.params.title : undefined,
          status: typeof request.params?.status === 'string' ? request.params.status : undefined,
        });
        return { taskGroup };
      }

      case 'session.list': {
        let agentId: string | undefined;
        if (typeof request.params?.agentRef === 'string' && request.params.agentRef.trim()) {
          const agent = this.store.resolveAgentRef(request.params.agentRef);
          if (!agent) throw new Error(`Local agent not found: ${request.params.agentRef}`);
          agentId = agent.id;
        }
        const limit = typeof request.params?.limit === 'number'
          ? request.params.limit
          : typeof request.params?.limit === 'string'
            ? parseInt(request.params.limit, 10)
            : undefined;
        return {
          sessions: this.store.listSessions({
            agentId,
            taskGroupId: typeof request.params?.taskGroupId === 'string' ? request.params.taskGroupId : undefined,
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
        const session = this.store.getSession(id);
        if (!session) throw new Error(`Session not found: ${id}`);
        const agent = this.store.getAgentById(session.agentId);
        return {
          session,
          agent,
          messages: this.store.getSessionMessages(id),
        };
      }

      case 'session.attach': {
        const id = expectString(request.params?.id, 'id');
        const session = this.store.getSession(id);
        if (!session) throw new Error(`Session not found: ${id}`);
        const agent = this.store.getAgentById(session.agentId);
        return {
          session,
          agent,
          messages: this.store.getSessionMessages(id),
        };
      }

      case 'session.fork': {
        const id = expectString(request.params?.id, 'id');
        const session = this.store.forkSession({
          sourceSessionId: id,
          taskGroupId: typeof request.params?.taskGroupId === 'string' ? request.params.taskGroupId : undefined,
          title: typeof request.params?.title === 'string' ? request.params.title : undefined,
          tags: normalizeTags(request.params?.tags),
        });
        return {
          session,
          messages: this.store.getSessionMessages(session.id),
        };
      }

      case 'session.stop': {
        const id = expectString(request.params?.id, 'id');
        return { session: this.runtime.stopSession(id) };
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
        const taskGroupId = typeof request.params?.taskGroupId === 'string'
          ? request.params.taskGroupId
          : undefined;
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
                  taskGroupId,
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
        const session = this.store.archiveSession(id);
        await this.runtime.syncSessionToPlatform(id);
        return { session };
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
        const taskGroupId = typeof request.params?.taskGroupId === 'string'
          ? request.params.taskGroupId
          : undefined;
        const tags = normalizeTags(request.params?.tags);
        const timeoutMs = typeof request.params?.timeoutMs === 'number'
          ? request.params.timeoutMs
          : 300_000;

        const result = await this.runtime.runSessionsParallel({
          agentRef,
          messages,
          maxParallel,
          taskGroupId,
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
            taskGroupId: typeof request.params?.taskGroupId === 'string' ? request.params.taskGroupId : undefined,
            title: typeof request.params?.title === 'string' ? request.params.title : undefined,
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

      case 'runtime.fan-out': {
        const task = expectString(request.params?.task, 'task');
        const agentRefs = Array.isArray(request.params?.agentRefs)
          ? (request.params.agentRefs as string[]).map(String)
          : [];
        if (agentRefs.length === 0) throw new Error('agentRefs must be a non-empty array');
        const result = await this.runtime.fanOut({
          task,
          agentRefs,
          synthesizerRef: typeof request.params?.synthesizerRef === 'string' ? request.params.synthesizerRef : undefined,
          tags: normalizeTags(request.params?.tags),
        }, emit);
        return result;
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
}
