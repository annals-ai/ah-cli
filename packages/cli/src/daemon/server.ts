import { createServer, type Server as NetServer, type Socket } from 'node:net';
import { unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
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

interface AgentMeshDaemonServerOptions {
  dbPath?: string;
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

export class AgentMeshDaemonServer {
  private readonly store: DaemonStore;
  private readonly runtime: DaemonRuntime;
  private readonly startedAt = new Date().toISOString();
  private readonly dbPath: string;
  private readonly preferredUiHost: string;
  private readonly preferredUiPort: number;
  private readonly uiControlHooks: AgentMeshDaemonServerOptions['uiControlHooks'];
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

  constructor(options: AgentMeshDaemonServerOptions = {}) {
    this.dbPath = options.dbPath ?? getDaemonDbPath();
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

    log.info(`agent-mesh daemon listening on ${socketPath}`);
    log.info(`agent-mesh local ui listening on ${this.uiBaseUrl}`);
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
        return {
          agent,
          bindings: this.store.listProviderBindings(agent.id),
        };
      }

      case 'agent.add': {
        const agent = createManagedAgent({ store: this.store, runtime: this.runtime }, {
          name: expectString(request.params?.name, 'name'),
          slug: typeof request.params?.slug === 'string' ? request.params.slug : undefined,
          runtimeType: typeof request.params?.runtimeType === 'string' ? request.params.runtimeType : 'claude',
          projectPath: expectString(request.params?.projectPath, 'projectPath'),
          sandbox: request.params?.sandbox === true,
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

      case 'task.list':
        return { taskGroups: this.store.listTaskGroups() };

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

      case 'session.list': {
        let agentId: string | undefined;
        if (typeof request.params?.agentRef === 'string' && request.params.agentRef.trim()) {
          const agent = this.store.resolveAgentRef(request.params.agentRef);
          if (!agent) throw new Error(`Local agent not found: ${request.params.agentRef}`);
          agentId = agent.id;
        }
        return {
          sessions: this.store.listSessions({
            agentId,
            taskGroupId: typeof request.params?.taskGroupId === 'string' ? request.params.taskGroupId : undefined,
            status: typeof request.params?.status === 'string'
              ? request.params.status as 'queued' | 'active' | 'idle' | 'paused' | 'completed' | 'failed' | 'archived' | 'all'
              : 'all',
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

      case 'session.archive': {
        const id = expectString(request.params?.id, 'id');
        const session = this.store.archiveSession(id);
        await this.runtime.syncSessionToPlatform(id);
        return { session };
      }

      case 'runtime.chat':
      case 'runtime.call': {
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
