import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentNetworkDaemonServer } from '../../packages/cli/src/daemon/server.js';
import { DaemonStore } from '../../packages/cli/src/daemon/store.js';
import { parseSseChunk } from '../../packages/cli/src/utils/sse-parser.js';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function openJsonSseStream(url: string): Promise<{
  next<T>(timeoutMs?: number): Promise<T>;
  close(): Promise<void>;
}> {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to open stream: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const queue: string[] = [];
  let carry = '';

  return {
    async next<T>(timeoutMs = 5_000): Promise<T> {
      const deadline = Date.now() + timeoutMs;

      while (queue.length === 0) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(`Timed out waiting for SSE event from ${url}`);
        }

        const result = await Promise.race([
          reader.read(),
          new Promise<{ timeout: true }>((resolve) => {
            setTimeout(() => resolve({ timeout: true }), remaining);
          }),
        ]);

        if ('timeout' in result) {
          throw new Error(`Timed out waiting for SSE event from ${url}`);
        }

        if (result.done) {
          throw new Error(`SSE stream closed before an event arrived: ${url}`);
        }

        const parsed = parseSseChunk(decoder.decode(result.value, { stream: true }), carry);
        carry = parsed.carry;
        queue.push(...parsed.events);
      }

      return JSON.parse(queue.shift()!) as T;
    },
    async close(): Promise<void> {
      await reader.cancel();
    },
  };
}

describe('AgentNetworkDaemonServer UI API', () => {
  let tempDir: string;
  let dbPath: string;
  let server: AgentNetworkDaemonServer | null = null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ah-ui-api-'));
    dbPath = join(tempDir, 'state.db');
  });

  afterEach(async () => {
    await server?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns sessions and transcript messages through the ui api', async () => {
    const store = new DaemonStore(dbPath);
    const agent = store.createAgent({
      name: 'Writer Agent',
      projectPath: '/tmp/writer-agent',
      capabilities: ['writing'],
    });
    const session = store.createSession({
      agentId: agent.id,
      title: 'Homepage rewrite',
      status: 'idle',
    });
    store.appendMessage({
      sessionId: session.id,
      role: 'user',
      kind: 'chat',
      content: 'Rewrite the hero section for the launch page.',
    });
    store.appendMessage({
      sessionId: session.id,
      role: 'assistant',
      kind: 'chat',
      content: 'Here is a sharper launch hero.',
    });
    store.close();

    server = new AgentNetworkDaemonServer({ dbPath });
    const address = await server.listenForTest();

    const sessions = await fetchJson<{ items: Array<{ id: string }> }>(`${address.uiBaseUrl}/api/sessions`);
    const messages = await fetchJson<{ items: Array<{ content: string }> }>(
      `${address.uiBaseUrl}/api/sessions/${session.id}/messages`,
    );

    expect(sessions.items[0]?.id).toBe(session.id);
    expect(messages.items[0]?.content).toContain('Rewrite the hero');
  });

  it('returns an aggregated dashboard snapshot through the ui api', async () => {
    const store = new DaemonStore(dbPath);
    const agent = store.createAgent({
      name: 'Dashboard Agent',
      projectPath: '/tmp/dashboard-agent',
      capabilities: ['monitoring'],
    });
    store.createSession({
      agentId: agent.id,
      title: 'Observe live changes',
      status: 'idle',
    });
    store.close();

    server = new AgentNetworkDaemonServer({ dbPath, uiPort: 0 });
    const address = await server.listenForTest();

    const dashboard = await fetchJson<{
      status: {
        daemon: { uiBaseUrl: string | null };
        counts: { agents: number; sessions: number };
      };
      agents: Array<{ id: string }>;
      providerCatalog: string[];
      sessions: Array<{ agentId: string }>;
      logs: string[];
      logPath: string | null;
    }>(`${address.uiBaseUrl}/api/dashboard?lines=50`);

    expect(dashboard.status.daemon.uiBaseUrl).toBe(address.uiBaseUrl);
    expect(dashboard.status.counts).toMatchObject({
      agents: 1,
      sessions: 1,
    });
    expect(dashboard.agents[0]?.id).toBe(agent.id);
    expect(dashboard.sessions[0]?.agentId).toBe(agent.id);
    expect(dashboard.providerCatalog.length).toBeGreaterThan(0);
    expect(Array.isArray(dashboard.logs)).toBe(true);
    expect(typeof dashboard.logPath).toBe('string');
  });

  it('stops, archives, and forks sessions through the ui api', async () => {
    const store = new DaemonStore(dbPath);
    const agent = store.createAgent({
      name: 'Reviewer Agent',
      projectPath: '/tmp/reviewer-agent',
      capabilities: ['review'],
    });
    const session = store.createSession({
      agentId: agent.id,
      title: 'Patch review',
      status: 'active',
    });
    store.appendMessage({
      sessionId: session.id,
      role: 'user',
      kind: 'call',
      content: 'Review this patch.',
    });
    store.close();

    server = new AgentNetworkDaemonServer({ dbPath });
    const address = await server.listenForTest();

    const stopped = await postJson<{ session: { status: string } }>(
      `${address.uiBaseUrl}/api/sessions/${session.id}/stop`,
      {},
    );
    const archived = await postJson<{ session: { status: string } }>(
      `${address.uiBaseUrl}/api/sessions/${session.id}/archive`,
      {},
    );
    const fork = await postJson<{ session: { parentSessionId: string | null; title: string | null } }>(
      `${address.uiBaseUrl}/api/sessions/${session.id}/fork`,
      { title: 'Experiment' },
    );

    expect(stopped.session.status).toBe('paused');
    expect(archived.session.status).toBe('archived');
    expect(fork.session.parentSessionId).toBe(session.id);
    expect(fork.session.title).toBe('Experiment');
  });

  it('streams transcript updates through the ui api', async () => {
    const store = new DaemonStore(dbPath);
    const agent = store.createAgent({
      name: 'Live Agent',
      projectPath: '/tmp/live-agent',
      capabilities: ['streaming'],
    });
    const session = store.createSession({
      agentId: agent.id,
      title: 'Realtime transcript',
      status: 'active',
    });
    store.appendMessage({
      sessionId: session.id,
      role: 'user',
      kind: 'chat',
      content: 'Start the live stream.',
    });
    store.close();

    server = new AgentNetworkDaemonServer({ dbPath, uiPort: 0 });
    const address = await server.listenForTest();
    const stream = await openJsonSseStream(`${address.uiBaseUrl}/api/sessions/${session.id}/messages/stream`);
    const serverStore = (server as any).store as DaemonStore;

    const initial = await stream.next<{ items: Array<{ content: string }> }>();
    serverStore.appendMessage({
      sessionId: session.id,
      role: 'assistant',
      kind: 'chat',
      content: 'Transcript update received.',
    });
    const updated = await stream.next<{ items: Array<{ content: string }> }>();

    await stream.close();

    expect(initial.items.map((message) => message.content)).toEqual([
      'Start the live stream.',
    ]);
    expect(updated.items.at(-1)?.content).toBe('Transcript update received.');
  });

  it('creates and continues sessions through the ui api chat endpoint', async () => {
    const store = new DaemonStore(dbPath);
    const agent = store.createAgent({
      name: 'Operator Agent',
      projectPath: '/tmp/operator-agent',
      capabilities: ['ops'],
    });
    store.close();

    server = new AgentNetworkDaemonServer({ dbPath, uiPort: 0 });
    const address = await server.listenForTest();

    const runtime = (server as any).runtime;
    const serverStore = (server as any).store as DaemonStore;

    runtime.execute = async (input: {
      agentRef?: string;
      sessionId?: string;
      message: string;
      mode: 'chat' | 'call';
    }) => {
      const resolvedAgent = input.sessionId
        ? serverStore.getAgentById(serverStore.getSession(input.sessionId)!.agentId)!
        : serverStore.resolveAgentRef(input.agentRef!)!;
      const currentSession = input.sessionId
        ? serverStore.getSession(input.sessionId)!
        : serverStore.createSession({
            agentId: resolvedAgent.id,
            title: input.message,
            status: 'idle',
          });

      serverStore.appendMessage({
        sessionId: currentSession.id,
        role: 'user',
        kind: input.mode,
        content: input.message,
      });
      serverStore.appendMessage({
        sessionId: currentSession.id,
        role: 'assistant',
        kind: input.mode,
        content: `Echo: ${input.message}`,
      });

      return {
        session: serverStore.getSession(currentSession.id)!,
        agent: resolvedAgent,
        result: `Echo: ${input.message}`,
      };
    };

    const created = await postJson<{ session: { id: string }; messages: Array<{ content: string }> }>(
      `${address.uiBaseUrl}/api/runtime/chat`,
      {
        agentRef: agent.slug,
        message: 'Draft the initial incident summary.',
      },
    );

    const continued = await postJson<{ session: { id: string }; messages: Array<{ content: string }> }>(
      `${address.uiBaseUrl}/api/runtime/chat`,
      {
        sessionId: created.session.id,
        message: 'Add the next remediation step.',
      },
    );

    const messages = await fetchJson<{ items: Array<{ content: string }> }>(
      `${address.uiBaseUrl}/api/sessions/${created.session.id}/messages`,
    );

    expect(continued.session.id).toBe(created.session.id);
    expect(created.messages.at(-1)?.content).toBe('Echo: Draft the initial incident summary.');
    expect(continued.messages.at(-1)?.content).toBe('Echo: Add the next remediation step.');
    expect(messages.items.map((message) => message.content)).toEqual([
      'Draft the initial incident summary.',
      'Echo: Draft the initial incident summary.',
      'Add the next remediation step.',
      'Echo: Add the next remediation step.',
    ]);
  });

  it('creates, updates, removes, and exposes agents through the ui api', async () => {
    server = new AgentNetworkDaemonServer({ dbPath, uiPort: 0 });
    const address = await server.listenForTest();

    const providerCatalog = await fetchJson<{ items: string[] }>(`${address.uiBaseUrl}/api/providers/catalog`);
    expect(providerCatalog.items).toContain('agents-hot');

    const created = await postJson<{ agent: { id: string; slug: string; visibility: string } }>(
      `${address.uiBaseUrl}/api/agents`,
      {
        name: 'Monitor Agent',
        projectPath: '/tmp/monitor-agent',
        visibility: 'public',
        capabilities: ['monitoring', 'ops'],
      },
    );

    const updated = await postJson<{ agent: { name: string; sandbox: boolean } }>(
      `${address.uiBaseUrl}/api/agents/${created.agent.slug}/update`,
      {
        name: 'Updated Monitor Agent',
        sandbox: true,
      },
    );

    const removed = await postJson<{ ok: boolean; agentId: string }>(
      `${address.uiBaseUrl}/api/agents/${created.agent.slug}/remove`,
      {},
    );

    const agents = await fetchJson<{ items: Array<{ id: string }> }>(`${address.uiBaseUrl}/api/agents`);

    expect(created.agent.visibility).toBe('public');
    expect(updated.agent).toMatchObject({
      name: 'Updated Monitor Agent',
      sandbox: true,
    });
    expect(removed.ok).toBe(true);
    expect(agents.items.find((agent) => agent.id === removed.agentId)).toBeUndefined();
  });

  it('returns provider status through the ui api', async () => {
    const store = new DaemonStore(dbPath);
    const agent = store.createAgent({
      name: 'Provider Status Agent',
      projectPath: '/tmp/provider-status-agent',
      capabilities: ['testing'],
    });
    store.upsertProviderBinding({
      agentId: agent.id,
      provider: 'agents-hot',
      remoteAgentId: 'remote-123',
      remoteSlug: 'provider-status-agent',
      status: 'online',
      config: {},
      lastSyncedAt: new Date().toISOString(),
    });
    store.close();

    server = new AgentNetworkDaemonServer({ dbPath, uiPort: 0 });
    const address = await server.listenForTest();

    const status = await fetchJson<{
      provider: string;
      agents: Array<{ slug: string; status: string; remoteSlug: string | null }>;
      onlineCount: number;
      totalCount: number;
    }>(`${address.uiBaseUrl}/api/providers/status`);

    expect(status.provider).toBe('agents-hot');
    expect(status.totalCount).toBe(1);
    expect(status.agents[0]?.slug).toBe(agent.slug);
    expect(status.agents[0]?.remoteSlug).toBe('provider-status-agent');
    // Binding may transition from 'online' to 'error' during server startup
    // because no real WebSocket connection exists in the test environment
    expect(['online', 'error']).toContain(status.agents[0]?.status);
  });
});
