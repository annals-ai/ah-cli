import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DaemonStore } from '../../packages/cli/src/daemon/store.js';
import type { RuntimeStreamEvent } from '../../packages/cli/src/daemon/types.js';

describe('Fan-Out types and store support', () => {
  let tempDir: string;
  let store: DaemonStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ah-fanout-'));
    store = new DaemonStore(join(tempDir, 'state.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates agents with persona field', () => {
    const agent = store.createAgent({
      name: 'Skeptic',
      projectPath: '/tmp/skeptic',
      persona: 'You are a skeptical code reviewer. Challenge every assumption.',
    });

    expect(agent.persona).toBe('You are a skeptical code reviewer. Challenge every assumption.');

    const fetched = store.getAgentById(agent.id);
    expect(fetched?.persona).toBe('You are a skeptical code reviewer. Challenge every assumption.');
  });

  it('creates agents without persona defaults to null', () => {
    const agent = store.createAgent({
      name: 'Plain',
      projectPath: '/tmp/plain',
    });

    expect(agent.persona).toBeNull();
  });

  it('updates agent persona', () => {
    const agent = store.createAgent({
      name: 'Architect',
      projectPath: '/tmp/architect',
    });

    expect(agent.persona).toBeNull();

    const updated = store.updateAgent(agent.id, {
      persona: 'You are a senior software architect.',
    });

    expect(updated.persona).toBe('You are a senior software architect.');
  });

  it('clears persona by setting to null', () => {
    const agent = store.createAgent({
      name: 'Test',
      projectPath: '/tmp/test',
      persona: 'initial persona',
    });

    expect(agent.persona).toBe('initial persona');

    const updated = store.updateAgent(agent.id, { persona: null });
    expect(updated.persona).toBeNull();
  });

  it('creates task group for fan-out source', () => {
    const taskGroup = store.createTaskGroup({
      title: 'Fan-out: Review the latest git diff',
      source: 'fan-out',
    });

    expect(taskGroup.title).toBe('Fan-out: Review the latest git diff');
    expect(taskGroup.source).toBe('fan-out');
    expect(taskGroup.status).toBe('active');
  });

  it('fan-out sessions share a task group', () => {
    const a1 = store.createAgent({ name: 'A1', projectPath: '/tmp/a1' });
    const a2 = store.createAgent({ name: 'A2', projectPath: '/tmp/a2' });

    const taskGroup = store.createTaskGroup({
      title: 'Fan-out: test',
      source: 'fan-out',
    });

    const s1 = store.createSession({ agentId: a1.id, taskGroupId: taskGroup.id });
    const s2 = store.createSession({ agentId: a2.id, taskGroupId: taskGroup.id });

    const sessions = store.listSessions({ taskGroupId: taskGroup.id, status: 'all' });
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
  });

  it('RuntimeStreamEvent type covers fan-out events', () => {
    const progressEvent: RuntimeStreamEvent = {
      type: 'fan-out-progress',
      agentSlug: 'skeptic',
      status: 'started',
    };
    expect(progressEvent.type).toBe('fan-out-progress');

    const verdictEvent: RuntimeStreamEvent = {
      type: 'fan-out-verdict',
      delta: 'The code looks good.',
    };
    expect(verdictEvent.type).toBe('fan-out-verdict');
  });
});
