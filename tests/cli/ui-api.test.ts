import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentMeshDaemonServer } from '../../packages/cli/src/daemon/server.js';
import { DaemonStore } from '../../packages/cli/src/daemon/store.js';

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

describe('AgentMeshDaemonServer UI API', () => {
  let tempDir: string;
  let dbPath: string;
  let server: AgentMeshDaemonServer | null = null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agent-mesh-ui-api-'));
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

    server = new AgentMeshDaemonServer({ dbPath });
    const address = await server.listenForTest();

    const sessions = await fetchJson<{ items: Array<{ id: string }> }>(`${address.uiBaseUrl}/api/sessions`);
    const messages = await fetchJson<{ items: Array<{ content: string }> }>(
      `${address.uiBaseUrl}/api/sessions/${session.id}/messages`,
    );

    expect(sessions.items[0]?.id).toBe(session.id);
    expect(messages.items[0]?.content).toContain('Rewrite the hero');
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

    server = new AgentMeshDaemonServer({ dbPath });
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

  it('creates, updates, removes, and exposes agents through the ui api', async () => {
    server = new AgentMeshDaemonServer({ dbPath, uiPort: 0 });
    const address = await server.listenForTest();

    const providerCatalog = await fetchJson<{ items: string[] }>(`${address.uiBaseUrl}/api/providers/catalog`);
    expect(providerCatalog.items).toContain('generic-a2a');

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

    const exposed = await postJson<{ binding: { provider: string; status: string } }>(
      `${address.uiBaseUrl}/api/agents/${created.agent.slug}/expose`,
      {
        provider: 'generic-a2a',
        config: {},
      },
    );

    const unexposed = await postJson<{ binding: { provider: string; status: string } }>(
      `${address.uiBaseUrl}/api/agents/${created.agent.slug}/unexpose`,
      {
        provider: 'generic-a2a',
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
    expect(exposed.binding.provider).toBe('generic-a2a');
    expect(['configured', 'online']).toContain(exposed.binding.status);
    expect(unexposed.binding.status).toBe('inactive');
    expect(removed.ok).toBe(true);
    expect(agents.items.find((agent) => agent.id === removed.agentId)).toBeUndefined();
  });
});
