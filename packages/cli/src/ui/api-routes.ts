import { readFileSync } from 'node:fs';
import {
  createManagedAgent,
  exposeManagedAgent,
  getProviderCatalog,
  removeManagedAgent,
  unexposeManagedAgent,
  updateManagedAgent,
} from '../daemon/agent-management.js';
import { getDaemonLogPath } from '../daemon/paths.js';
import type { DaemonRuntime } from '../daemon/runtime.js';
import type { DaemonStore } from '../daemon/store.js';
import type { DaemonAgent, ProviderBinding, SessionRecord, TaskGroup } from '../daemon/types.js';
import type { UiHttpRequestHandler } from './http-server.js';

interface UiApiRoutesOptions {
  store: DaemonStore;
  runtime: DaemonRuntime;
  startedAt: string;
  getUiBaseUrl(): string | null;
  getUiPort(): number | null;
}

function writeJson(response: Parameters<UiHttpRequestHandler>[0]['response'], status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

function expectNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function clampLineCount(value: string | null): number {
  const parsed = Number.parseInt(value ?? '100', 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(parsed, 1), 1000);
}

async function readJsonBody(request: Parameters<UiHttpRequestHandler>[0]['request']): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  return typeof parsed === 'object' && parsed ? parsed as Record<string, unknown> : {};
}

function readLogTail(lines: number): string[] {
  try {
    return readFileSync(getDaemonLogPath(), 'utf-8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(-lines);
  } catch {
    return [];
  }
}

function serializeAgent(
  agent: DaemonAgent,
  bindings: ProviderBinding[],
  sessionCount: number,
): DaemonAgent & { bindings: ProviderBinding[]; sessionCount: number } {
  return {
    ...agent,
    bindings,
    sessionCount,
  };
}

function serializeTaskGroup(
  taskGroup: TaskGroup,
  sessionCount: number,
): TaskGroup & { sessionCount: number } {
  return {
    ...taskGroup,
    sessionCount,
  };
}

function serializeSession(
  session: SessionRecord,
  agent: DaemonAgent | null,
): SessionRecord & { agent: DaemonAgent | null } {
  return {
    ...session,
    agent,
  };
}

function serializeSessionSnapshot(options: UiApiRoutesOptions, sessionId: string): {
  session: SessionRecord & { agent: DaemonAgent | null };
  messages: ReturnType<DaemonStore['getSessionMessages']>;
} {
  const snapshot = options.store.getSessionSnapshot(sessionId);
  if (!snapshot) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  return {
    session: serializeSession(snapshot.session, options.store.getAgentById(snapshot.session.agentId)),
    messages: snapshot.messages,
  };
}

export function createUiApiHandler(options: UiApiRoutesOptions): UiHttpRequestHandler {
  return async ({ method, pathname, searchParams, response, request }) => {
    if (!pathname.startsWith('/api/')) {
      return false;
    }

    const segments = splitPath(pathname);

    try {
      if (method === 'POST' && segments.length === 4 && segments[1] === 'sessions' && segments[3] === 'stop') {
        const session = options.runtime.stopSession(segments[2]!);
        writeJson(response, 200, {
          session: serializeSession(session, options.store.getAgentById(session.agentId)),
        });
        return true;
      }

      if (method === 'POST' && segments.length === 4 && segments[1] === 'sessions' && segments[3] === 'archive') {
        const session = await options.runtime.archiveSession(segments[2]!);
        writeJson(response, 200, {
          session: serializeSession(session, options.store.getAgentById(session.agentId)),
        });
        return true;
      }

      if (method === 'POST' && segments.length === 4 && segments[1] === 'sessions' && segments[3] === 'fork') {
        const body = await readJsonBody(request);
        const session = options.store.forkSession({
          sourceSessionId: segments[2]!,
          taskGroupId: typeof body.taskGroupId === 'string' ? body.taskGroupId : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag)) : undefined,
        });
        const snapshot = options.store.getSessionSnapshot(session.id)!;
        writeJson(response, 200, {
          session: serializeSession(snapshot.session, options.store.getAgentById(snapshot.session.agentId)),
          messages: snapshot.messages,
        });
        return true;
      }

      if (method === 'POST' && segments.length === 3 && segments[1] === 'runtime' && segments[2] === 'chat') {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim().length > 0
          ? body.sessionId.trim()
          : undefined;
        const agentRef = typeof body.agentRef === 'string' && body.agentRef.trim().length > 0
          ? body.agentRef.trim()
          : undefined;

        if (!sessionId && !agentRef) {
          throw new Error('sessionId or agentRef is required');
        }

        const result = await options.runtime.execute({
          agentRef,
          sessionId,
          message: expectNonEmptyString(body.message, 'message'),
          taskGroupId: typeof body.taskGroupId === 'string' && body.taskGroupId.trim().length > 0
            ? body.taskGroupId.trim()
            : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag)) : undefined,
          mode: 'chat',
          principalType: 'owner_local',
          principalId: 'owner',
        }, () => {});
        const snapshot = serializeSessionSnapshot(options, result.session.id);

        writeJson(response, 200, {
          session: snapshot.session,
          messages: snapshot.messages,
          result: result.result,
        });
        return true;
      }

      if (method === 'POST' && segments.length === 2 && segments[1] === 'agents') {
        const body = await readJsonBody(request);
        const agent = createManagedAgent({ store: options.store, runtime: options.runtime }, {
          name: expectNonEmptyString(body.name, 'name'),
          slug: typeof body.slug === 'string' ? body.slug : undefined,
          runtimeType: typeof body.runtimeType === 'string' ? body.runtimeType : 'claude',
          projectPath: expectNonEmptyString(body.projectPath, 'projectPath'),
          sandbox: body.sandbox === true,
          description: typeof body.description === 'string' ? body.description : null,
          capabilities: Array.isArray(body.capabilities) ? body.capabilities.map((item) => String(item)) : [],
          visibility: typeof body.visibility === 'string'
            ? body.visibility as 'public' | 'private' | 'unlisted'
            : 'private',
        });
        writeJson(response, 200, {
          agent: serializeAgent(
            agent,
            options.store.listProviderBindings(agent.id),
            options.store.getSessionCountsByAgent()[agent.id] ?? 0,
          ),
        });
        return true;
      }

      if (method === 'POST' && segments.length === 4 && segments[1] === 'agents' && segments[3] === 'update') {
        const body = await readJsonBody(request);
        const agent = await updateManagedAgent({ store: options.store, runtime: options.runtime }, segments[2]!, {
          slug: typeof body.slug === 'string' ? body.slug : undefined,
          name: typeof body.name === 'string' ? body.name : undefined,
          runtimeType: typeof body.runtimeType === 'string' ? body.runtimeType : undefined,
          projectPath: typeof body.projectPath === 'string' ? body.projectPath : undefined,
          sandbox: typeof body.sandbox === 'boolean' ? body.sandbox : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
          capabilities: Array.isArray(body.capabilities) ? body.capabilities.map((item) => String(item)) : undefined,
          visibility: typeof body.visibility === 'string'
            ? body.visibility as 'public' | 'private' | 'unlisted'
            : undefined,
        });
        writeJson(response, 200, {
          agent: serializeAgent(
            agent,
            options.store.listProviderBindings(agent.id),
            options.store.getSessionCountsByAgent()[agent.id] ?? 0,
          ),
        });
        return true;
      }

      if (method === 'POST' && segments.length === 4 && segments[1] === 'agents' && segments[3] === 'remove') {
        writeJson(
          response,
          200,
          await removeManagedAgent({ store: options.store, runtime: options.runtime }, segments[2]!),
        );
        return true;
      }

      if (method === 'POST' && segments.length === 4 && segments[1] === 'agents' && segments[3] === 'expose') {
        const body = await readJsonBody(request);
        const result = await exposeManagedAgent(
          { store: options.store, runtime: options.runtime },
          segments[2]!,
          expectNonEmptyString(body.provider, 'provider'),
          typeof body.config === 'object' && body.config ? body.config as Record<string, unknown> : {},
        );
        writeJson(response, 200, {
          agent: serializeAgent(
            result.agent,
            options.store.listProviderBindings(result.agent.id),
            options.store.getSessionCountsByAgent()[result.agent.id] ?? 0,
          ),
          binding: result.binding,
        });
        return true;
      }

      if (method === 'POST' && segments.length === 4 && segments[1] === 'agents' && segments[3] === 'unexpose') {
        const body = await readJsonBody(request);
        const result = await unexposeManagedAgent(
          { store: options.store, runtime: options.runtime },
          segments[2]!,
          expectNonEmptyString(body.provider, 'provider'),
        );
        writeJson(response, 200, {
          agent: serializeAgent(
            result.agent,
            options.store.listProviderBindings(result.agent.id),
            options.store.getSessionCountsByAgent()[result.agent.id] ?? 0,
          ),
          binding: result.binding,
        });
        return true;
      }

      if (method !== 'GET') {
        writeJson(response, 405, { error: 'method_not_allowed' });
        return true;
      }

      if (segments.length === 3 && segments[1] === 'daemon' && segments[2] === 'status') {
        const runtime = await options.runtime.getUiStatusSnapshot();
        writeJson(response, 200, {
          daemon: {
            pid: process.pid,
            startedAt: options.startedAt,
            uiBaseUrl: options.getUiBaseUrl(),
            uiPort: options.getUiPort(),
          },
          counts: {
            agents: options.store.listAgents().length,
            sessions: options.store.listSessions({ status: 'all' }).length,
            taskGroups: options.store.listTaskGroups().length,
            providerBindings: options.store.listProviderBindings().length,
          },
          runtime,
        });
        return true;
      }

      if (segments.length === 2 && segments[1] === 'agents') {
        const sessionCounts = options.store.getSessionCountsByAgent();
        const items = options.store.listAgents().map((agent) => serializeAgent(
          agent,
          options.store.listProviderBindings(agent.id),
          sessionCounts[agent.id] ?? 0,
        ));
        writeJson(response, 200, { items });
        return true;
      }

      if (segments.length === 3 && segments[1] === 'agents') {
        const agent = options.store.resolveAgentRef(segments[2]!);
        if (!agent) {
          writeJson(response, 404, { error: 'not_found', message: `Agent not found: ${segments[2]}` });
          return true;
        }

        writeJson(response, 200, {
          agent: serializeAgent(
            agent,
            options.store.listProviderBindings(agent.id),
            options.store.getSessionCountsByAgent()[agent.id] ?? 0,
          ),
          sessions: options.store.listSessions({ agentId: agent.id, status: 'all' }).map((session) => serializeSession(session, agent)),
        });
        return true;
      }

      if (segments.length === 2 && segments[1] === 'sessions') {
        const agentParam = searchParams.get('agent') ?? searchParams.get('agentId');
        const taskGroupId = searchParams.get('taskGroupId') ?? undefined;
        const status = searchParams.get('status') ?? 'all';
        const agent = agentParam ? options.store.resolveAgentRef(agentParam) : null;
        const items = options.store.listSessions({
          agentId: agent?.id,
          taskGroupId,
          status: status as SessionRecord['status'] | 'all',
        }).map((session) => serializeSession(session, options.store.getAgentById(session.agentId)));

        writeJson(response, 200, { items });
        return true;
      }

      if (segments.length === 3 && segments[1] === 'sessions') {
        const session = options.store.getSession(segments[2]!);
        if (!session) {
          writeJson(response, 404, { error: 'not_found', message: `Session not found: ${segments[2]}` });
          return true;
        }

        writeJson(response, 200, {
          session: serializeSession(session, options.store.getAgentById(session.agentId)),
        });
        return true;
      }

      if (segments.length === 4 && segments[1] === 'sessions' && segments[3] === 'messages') {
        const session = options.store.getSession(segments[2]!);
        if (!session) {
          writeJson(response, 404, { error: 'not_found', message: `Session not found: ${segments[2]}` });
          return true;
        }

        writeJson(response, 200, {
          items: options.store.getSessionMessages(session.id),
        });
        return true;
      }

      if (segments.length === 2 && segments[1] === 'tasks') {
        const sessionCounts = options.store.getSessionCountsByTaskGroup();
        const items = options.store.listTaskGroups().map((taskGroup) => serializeTaskGroup(
          taskGroup,
          sessionCounts[taskGroup.id] ?? 0,
        ));
        writeJson(response, 200, { items });
        return true;
      }

      if (segments.length === 3 && segments[1] === 'tasks') {
        const taskGroup = options.store.getTaskGroup(segments[2]!);
        if (!taskGroup) {
          writeJson(response, 404, { error: 'not_found', message: `Task group not found: ${segments[2]}` });
          return true;
        }

        writeJson(response, 200, {
          taskGroup: serializeTaskGroup(
            taskGroup,
            options.store.getSessionCountsByTaskGroup()[taskGroup.id] ?? 0,
          ),
          sessions: options.store.listSessions({ taskGroupId: taskGroup.id, status: 'all' }).map((session) => (
            serializeSession(session, options.store.getAgentById(session.agentId))
          )),
        });
        return true;
      }

      if (segments.length === 2 && segments[1] === 'providers') {
        const items = options.store.listProviderBindings().map((binding) => ({
          ...binding,
          agent: options.store.getAgentById(binding.agentId),
        }));
        writeJson(response, 200, { items });
        return true;
      }

      if (segments.length === 3 && segments[1] === 'providers' && segments[2] === 'catalog') {
        writeJson(response, 200, { items: getProviderCatalog() });
        return true;
      }

      if (segments.length === 2 && segments[1] === 'logs') {
        writeJson(response, 200, {
          items: readLogTail(clampLineCount(searchParams.get('lines'))),
          path: getDaemonLogPath(),
        });
        return true;
      }

      writeJson(response, 404, { error: 'not_found' });
      return true;
    } catch (error) {
      if (error instanceof SyntaxError) {
        writeJson(response, 400, {
          error: 'invalid_json',
          message: error.message,
        });
        return true;
      }

      writeJson(response, 500, {
        error: 'internal_error',
        message: (error as Error).message,
      });
      return true;
    }
  };
}
