import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DaemonStore } from '../../packages/cli/src/daemon/store.js';
import { buildPromptFromHistory } from '../../packages/cli/src/daemon/runtime.js';

describe('DaemonStore', () => {
  let tempDir: string;
  let store: DaemonStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ah-daemon-'));
    store = new DaemonStore(join(tempDir, 'state.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates agents, sessions, and messages', () => {
    const first = store.createAgent({
      name: 'Writer Agent',
      projectPath: '/tmp/writer',
      capabilities: ['writing', 'editing'],
      visibility: 'private',
    });
    const second = store.createAgent({
      name: 'Writer Agent',
      projectPath: '/tmp/writer-2',
    });

    expect(first.slug).toBe('writer-agent');
    expect(second.slug).toBe('writer-agent-2');

    const session = store.createSession({
      agentId: first.id,
      title: 'Homepage rewrite',
      tags: ['tuning', 'release'],
    });

    store.appendMessage({
      sessionId: session.id,
      role: 'user',
      kind: 'chat',
      content: 'Rewrite the hero section.',
    });
    store.appendMessage({
      sessionId: session.id,
      role: 'assistant',
      kind: 'chat',
      content: 'Here is a sharper hero section.',
    });

    const sessions = store.listSessions({ agentId: first.id, status: 'all' });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tags).toEqual(['release', 'tuning']);

    const messages = store.getSessionMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.seq).toBe(1);
    expect(messages[1]?.seq).toBe(2);
  });

  it('forks a session and copies messages while resetting resume state', () => {
    const agent = store.createAgent({
      name: 'Reviewer',
      projectPath: '/tmp/reviewer',
      sandbox: true,
    });

    const source = store.createSession({
      agentId: agent.id,
      title: 'Original review',
      claudeResumeId: 'resume-123',
      tags: ['review'],
    });

    store.appendMessage({
      sessionId: source.id,
      role: 'user',
      kind: 'call',
      content: 'Review this patch.',
    });
    store.appendMessage({
      sessionId: source.id,
      role: 'assistant',
      kind: 'call',
      content: 'The patch looks good, but add one test.',
    });

    const forked = store.forkSession({
      sourceSessionId: source.id,
      title: 'Experimental review',
    });

    expect(forked.parentSessionId).toBe(source.id);
    expect(forked.title).toBe('Experimental review');
    expect(forked.claudeResumeId).toBeNull();
    expect(forked.tags).toEqual(['review']);

    const forkedMessages = store.getSessionMessages(forked.id);
    expect(forkedMessages).toHaveLength(2);
    expect(forkedMessages[0]?.content).toContain('Review this patch.');
    expect(forkedMessages[1]?.content).toContain('add one test');
  });

  it('upserts provider bindings and keeps remote identifiers', () => {
    const agent = store.createAgent({
      name: 'Support Agent',
      projectPath: '/tmp/support',
    });

    const created = store.upsertProviderBinding({
      agentId: agent.id,
      provider: 'agents-hot',
      remoteAgentId: 'remote-1',
      remoteSlug: 'support-agent',
      status: 'registered',
      config: { public: true },
      lastSyncedAt: '2026-03-07T00:00:00.000Z',
    });

    expect(created.remoteAgentId).toBe('remote-1');
    expect(created.status).toBe('registered');

    const updated = store.upsertProviderBinding({
      agentId: agent.id,
      provider: 'agents-hot',
      status: 'inactive',
      config: { public: false },
      lastSyncedAt: '2026-03-07T01:00:00.000Z',
    });

    expect(updated.remoteAgentId).toBe('remote-1');
    expect(updated.status).toBe('inactive');
    expect(updated.config).toEqual({ public: false });
  });

  it('stores daemon settings for ui launch state', () => {
    store.setDaemonSetting('ui.first_open_completed', { value: true });

    expect(store.getDaemonSetting('ui.first_open_completed')).toEqual({ value: true });
  });
});

describe('buildPromptFromHistory', () => {
  it('creates a transcript-backed fallback prompt when resume state is unavailable', () => {
    const prompt = buildPromptFromHistory([
      {
        id: '1',
        sessionId: 's1',
        seq: 1,
        role: 'user',
        kind: 'chat',
        content: 'Summarize the changelog.',
        metadata: {},
        createdAt: '2026-03-07T00:00:00.000Z',
      },
      {
        id: '2',
        sessionId: 's1',
        seq: 2,
        role: 'assistant',
        kind: 'chat',
        content: 'The main change is the new daemon runtime.',
        metadata: {},
        createdAt: '2026-03-07T00:00:01.000Z',
      },
    ], 'Now turn it into release notes.');

    expect(prompt).toContain('Continue the existing local session');
    expect(prompt).toContain('Summarize the changelog.');
    expect(prompt).toContain('The main change is the new daemon runtime.');
    expect(prompt).toContain('Now turn it into release notes.');
  });
});
