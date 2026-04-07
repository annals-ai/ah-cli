import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DEFAULT_RUNTIME_CONFIG } from '../utils/config.js';
import { getDaemonDbPath } from './paths.js';
import type {
  AclEntry,
  AppendMessageInput,
  CreateAgentInput,
  CreateSessionInput,
  CreateTaskGroupInput,
  DaemonSettingRecord,
  DaemonAgent,
  ForkSessionInput,
  ProviderBinding,
  RuntimeLimitRecord,
  SessionMessage,
  SessionQuery,
  SessionRecord,
  SessionStatus,
  TaskGroup,
  UpdateAgentInput,
  UpdateSessionInput,
} from './types.js';

type SqliteModule = typeof import('node:sqlite');

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as SqliteModule;

type SqlPrimitive = string | number | null;

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function intToBool(value: unknown): boolean {
  return value === 1 || value === true;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    || 'agent';
}

function buildSetClause(input: Record<string, SqlPrimitive>): { clause: string; params: SqlPrimitive[] } {
  const entries = Object.entries(input);
  return {
    clause: entries.map(([key]) => `${key} = ?`).join(', '),
    params: entries.map(([, value]) => value),
  };
}

export class DaemonStore {
  private db: DatabaseSync;

  constructor(dbPath = getDaemonDbPath()) {
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
    this.ensureDefaultRuntimeLimit();
  }

  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        runtime_type TEXT NOT NULL,
        project_path TEXT NOT NULL,
        sandbox INTEGER NOT NULL DEFAULT 0,
        persona TEXT,
        description TEXT,
        capabilities TEXT NOT NULL DEFAULT '[]',
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_bindings (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        remote_agent_id TEXT,
        remote_slug TEXT,
        status TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        last_synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(agent_id, provider),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        parent_session_id TEXT,
        origin TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        principal_id TEXT,
        status TEXT NOT NULL,
        claude_resume_id TEXT,
        title TEXT,
        summary TEXT,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_session_id) REFERENCES sessions(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        UNIQUE (session_id, seq)
      );

      CREATE TABLE IF NOT EXISTS session_tags (
        session_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, tag),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT,
        direction TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT,
        url TEXT,
        kind TEXT NOT NULL DEFAULT 'file',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES session_messages(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_limits (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        max_concurrent INTEGER,
        queue_wait_timeout_ms INTEGER,
        queue_max_length INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_type, scope_id)
      );

      CREATE TABLE IF NOT EXISTS daemon_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        summary TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_acl (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        permission TEXT NOT NULL DEFAULT 'call',
        granted_by TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(agent_id, principal, permission),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_groups (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        owner_principal TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    try { this.db.exec(`ALTER TABLE agents ADD COLUMN persona TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN remote_host TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE sessions ADD COLUMN task_group_id TEXT REFERENCES task_groups(id) ON DELETE SET NULL`); } catch {}
  }

  private ensureDefaultRuntimeLimit(): void {
    const row = this.db.prepare(`
      SELECT scope_type FROM runtime_limits
      WHERE scope_type = 'daemon' AND scope_id = 'global'
    `).get() as { scope_type?: string } | undefined;

    if (row?.scope_type) return;

    const now = nowIso();
    this.db.prepare(`
      INSERT INTO runtime_limits (
        scope_type, scope_id, max_concurrent, queue_wait_timeout_ms, queue_max_length, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'daemon',
      'global',
      DEFAULT_RUNTIME_CONFIG.max_active_requests,
      DEFAULT_RUNTIME_CONFIG.queue_wait_timeout_ms,
      DEFAULT_RUNTIME_CONFIG.queue_max_length,
      '{}',
      now,
      now,
    );
  }

  private mapAgent(row: Record<string, unknown>): DaemonAgent {
    return {
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      runtimeType: String(row.runtime_type),
      projectPath: String(row.project_path),
      sandbox: intToBool(row.sandbox),
      persona: row.persona ? String(row.persona) : null,
      description: row.description ? String(row.description) : null,
      capabilities: parseJson<string[]>(row.capabilities as string, []),
      visibility: String(row.visibility) as DaemonAgent['visibility'],
      remoteHost: row.remote_host ? String(row.remote_host) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapTaskGroup(row: Record<string, unknown>): TaskGroup {
    return {
      id: String(row.id),
      title: String(row.title),
      ownerPrincipal: String(row.owner_principal),
      source: String(row.source),
      status: String(row.status),
      metadata: parseJson<Record<string, unknown>>(row.metadata_json as string, {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapSession(row: Record<string, unknown>): SessionRecord {
    return {
      id: String(row.id),
      agentId: String(row.agent_id),
      taskGroupId: row.task_group_id ? String(row.task_group_id) : null,
      parentSessionId: row.parent_session_id ? String(row.parent_session_id) : null,
      origin: String(row.origin),
      principalType: String(row.principal_type),
      principalId: row.principal_id ? String(row.principal_id) : null,
      status: String(row.status) as SessionStatus,
      claudeResumeId: row.claude_resume_id ? String(row.claude_resume_id) : null,
      title: row.title ? String(row.title) : null,
      summary: row.summary ? String(row.summary) : null,
      createdAt: String(row.created_at),
      lastActiveAt: String(row.last_active_at),
      updatedAt: String(row.updated_at),
      tags: this.listSessionTags(String(row.id)),
    };
  }

  private mapSessionWithAgent(row: Record<string, unknown>): SessionRecord {
    return {
      id: String(row.id),
      agentId: String(row.agent_id),
      agentName: row.agent_name ? String(row.agent_name) : undefined,
      agentSlug: row.agent_slug ? String(row.agent_slug) : undefined,
      taskGroupId: row.task_group_id ? String(row.task_group_id) : null,
      parentSessionId: row.parent_session_id ? String(row.parent_session_id) : null,
      origin: String(row.origin),
      principalType: String(row.principal_type),
      principalId: row.principal_id ? String(row.principal_id) : null,
      status: String(row.status) as SessionStatus,
      claudeResumeId: row.claude_resume_id ? String(row.claude_resume_id) : null,
      title: row.title ? String(row.title) : null,
      summary: row.summary ? String(row.summary) : null,
      createdAt: String(row.created_at),
      lastActiveAt: String(row.last_active_at),
      updatedAt: String(row.updated_at),
      tags: this.listSessionTags(String(row.id)),
    };
  }

  private mapMessage(row: Record<string, unknown>): SessionMessage {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      seq: Number(row.seq),
      role: String(row.role),
      kind: String(row.kind),
      content: String(row.content),
      metadata: parseJson<Record<string, unknown>>(row.metadata_json as string, {}),
      createdAt: String(row.created_at),
    };
  }

  private mapProviderBinding(row: Record<string, unknown>): ProviderBinding {
    return {
      id: String(row.id),
      agentId: String(row.agent_id),
      provider: String(row.provider),
      remoteAgentId: row.remote_agent_id ? String(row.remote_agent_id) : null,
      remoteSlug: row.remote_slug ? String(row.remote_slug) : null,
      status: String(row.status),
      config: parseJson<Record<string, unknown>>(row.config_json as string, {}),
      lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapRuntimeLimit(row: Record<string, unknown>): RuntimeLimitRecord {
    return {
      scopeType: String(row.scope_type),
      scopeId: String(row.scope_id),
      maxConcurrent: row.max_concurrent === null ? null : Number(row.max_concurrent),
      queueWaitTimeoutMs: row.queue_wait_timeout_ms === null ? null : Number(row.queue_wait_timeout_ms),
      queueMaxLength: row.queue_max_length === null ? null : Number(row.queue_max_length),
      metadata: parseJson<Record<string, unknown>>(row.metadata_json as string, {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapDaemonSetting(row: Record<string, unknown>): DaemonSettingRecord {
    return {
      key: String(row.key),
      value: parseJson<unknown>(row.value_json as string, null),
      updatedAt: String(row.updated_at),
    };
  }

  listAgents(): DaemonAgent[] {
    const rows = this.db.prepare(`
      SELECT * FROM agents
      ORDER BY updated_at DESC, created_at DESC
    `).all() as Record<string, unknown>[];
    return rows.map((row) => this.mapAgent(row));
  }

  getAgentById(agentId: string): DaemonAgent | null {
    const row = this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as Record<string, unknown> | undefined;
    return row ? this.mapAgent(row) : null;
  }

  resolveAgentRef(ref: string): DaemonAgent | null {
    if (!ref || ref.includes('/')) return null;

    const byId = this.getAgentById(ref);
    if (byId) return byId;

    const row = this.db.prepare(`
      SELECT * FROM agents
      WHERE slug = ?
         OR lower(name) = lower(?)
      LIMIT 1
    `).get(ref, ref) as Record<string, unknown> | undefined;

    return row ? this.mapAgent(row) : null;
  }

  createAgent(input: CreateAgentInput): DaemonAgent {
    const now = nowIso();
    const id = randomUUID();
    const slug = input.slug ? slugify(input.slug) : this.uniqueAgentSlug(slugify(input.name));
    const runtimeType = input.runtimeType || 'claude';

    this.db.prepare(`
      INSERT INTO agents (
        id, slug, name, runtime_type, project_path, sandbox, persona, description, capabilities, visibility, remote_host, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      slug,
      input.name,
      runtimeType,
      input.projectPath,
      boolToInt(input.sandbox ?? false),
      input.persona ?? null,
      input.description ?? null,
      JSON.stringify(input.capabilities ?? []),
      input.visibility ?? 'private',
      input.remoteHost ?? null,
      now,
      now,
    );

    return this.getAgentById(id)!;
  }

  updateAgent(agentId: string, input: UpdateAgentInput): DaemonAgent {
    const current = this.getAgentById(agentId);
    if (!current) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const update: Record<string, SqlPrimitive> = {
      updated_at: nowIso(),
    };

    if (input.slug !== undefined) update.slug = this.uniqueAgentSlug(slugify(input.slug), agentId);
    if (input.name !== undefined) update.name = input.name;
    if (input.runtimeType !== undefined) update.runtime_type = input.runtimeType;
    if (input.projectPath !== undefined) update.project_path = input.projectPath;
    if (input.sandbox !== undefined) update.sandbox = boolToInt(input.sandbox);
    if (input.persona !== undefined) update.persona = input.persona;
    if (input.description !== undefined) update.description = input.description;
    if (input.capabilities !== undefined) update.capabilities = JSON.stringify(input.capabilities);
    if (input.visibility !== undefined) update.visibility = input.visibility;
    if (input.remoteHost !== undefined) update.remote_host = input.remoteHost;

    const built = buildSetClause(update);
    this.db.prepare(`UPDATE agents SET ${built.clause} WHERE id = ?`).run(...built.params, agentId);

    return this.getAgentById(agentId)!;
  }

  removeAgent(agentId: string): boolean {
    const result = this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(agentId);
    return Number(result.changes ?? 0) > 0;
  }

  private uniqueAgentSlug(baseSlug: string, ignoreAgentId?: string): string {
    let candidate = baseSlug;
    let index = 2;

    while (true) {
      const row = this.db.prepare(`
        SELECT id FROM agents WHERE slug = ?
      `).get(candidate) as { id?: string } | undefined;

      if (!row?.id || row.id === ignoreAgentId) {
        return candidate;
      }

      candidate = `${baseSlug}-${index}`;
      index += 1;
    }
  }

  createSession(input: CreateSessionInput): SessionRecord {
    const now = nowIso();
    const id = input.id ?? randomUUID();
    this.db.prepare(`
      INSERT INTO sessions (
        id, agent_id, task_group_id, parent_session_id, origin, principal_type, principal_id,
        status, claude_resume_id, title, summary, created_at, last_active_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.agentId,
      input.taskGroupId ?? null,
      input.parentSessionId ?? null,
      input.origin ?? 'local',
      input.principalType ?? 'owner_local',
      input.principalId ?? 'owner',
      input.status ?? 'idle',
      input.claudeResumeId ?? null,
      input.title ?? null,
      input.summary ?? null,
      now,
      now,
      now,
    );

    if (input.tags?.length) {
      this.replaceSessionTags(id, input.tags);
    }

    return this.getSession(id)!;
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.mapSession(row) : null;
  }

  /**
   * Resolve a session reference (full ID or short prefix) to a full session ID.
   * - If the ID is a full UUID (36 chars), return it directly
   * - If it's a short prefix, find sessions that start with it
   * - Returns the full ID if exactly one match, null if not found
   * - Throws with ambiguous matches if multiple sessions match
   */
  resolveSessionRef(ref: string): string | null {
    // If it looks like a full UUID, try exact match first
    if (ref.length === 36 && ref.includes('-')) {
      const session = this.getSession(ref);
      return session ? session.id : null;
    }

    // Short ID prefix matching
    const rows = this.db.prepare(`
      SELECT id, title, status FROM sessions WHERE id LIKE ? ESCAPE '\\'
    `).all(`${ref}%`) as Array<{ id: string; title: string | null; status: string }>;

    if (rows.length === 0) {
      return null;
    }

    if (rows.length === 1) {
      return rows[0].id;
    }

    // Multiple matches - throw with helpful error
    const matches = rows.map(r => ({
      id: r.id.slice(0, 8),
      title: r.title?.slice(0, 40) || '(no title)',
      status: r.status,
    }));

    // Create a custom error that includes the matches
    const error = new Error(`Ambiguous session ID "${ref}" matches ${rows.length} sessions`);
    (error as Error & { ambiguousMatches?: typeof matches }).ambiguousMatches = matches;
    throw error;
  }

  listSessions(query: SessionQuery = {}): SessionRecord[] {
    const clauses: string[] = [];
    const params: SqlPrimitive[] = [];

    if (query.agentId) {
      clauses.push('s.agent_id = ?');
      params.push(query.agentId);
    }
    if (query.taskGroupId) {
      clauses.push('s.task_group_id = ?');
      params.push(query.taskGroupId);
    }
    if (query.status && query.status !== 'all') {
      clauses.push('s.status = ?');
      params.push(query.status);
    }
    if (query.tag) {
      clauses.push(`s.id IN (SELECT session_id FROM session_tags WHERE tag = ?)`);
      params.push(query.tag);
    }
    if (query.search) {
      clauses.push('s.title LIKE ?');
      params.push(`%${query.search}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limitClause = query.limit ? `LIMIT ${Math.max(1, Math.floor(query.limit))}` : '';
    const rows = this.db.prepare(`
      SELECT s.*, a.name as agent_name, a.slug as agent_slug
      FROM sessions s
      LEFT JOIN agents a ON s.agent_id = a.id
      ${where}
      ORDER BY s.last_active_at DESC, s.created_at DESC
      ${limitClause}
    `).all(...params) as Record<string, unknown>[];

    return rows.map((row) => this.mapSessionWithAgent(row));
  }

  getSessionCountsByAgent(): Record<string, number> {
    const rows = this.db.prepare(`
      SELECT agent_id, COUNT(*) AS count
      FROM sessions
      GROUP BY agent_id
    `).all() as Array<{ agent_id: string; count: number }>;

    return Object.fromEntries(rows.map((row) => [row.agent_id, Number(row.count)]));
  }

  /**
   * Get agent statistics including session counts by status.
   * Returns an array with stats for each agent.
   */
  getAgentStats(): Array<{
    agentId: string;
    agentName: string;
    agentSlug: string;
    totalSessions: number;
    sessionsByStatus: Record<string, number>;
    firstSessionAt: string | null;
    lastSessionAt: string | null;
  }> {
    const agents = this.listAgents();
    const stats: Array<{
      agentId: string;
      agentName: string;
      agentSlug: string;
      totalSessions: number;
      sessionsByStatus: Record<string, number>;
      firstSessionAt: string | null;
      lastSessionAt: string | null;
    }> = [];

    for (const agent of agents) {
      // Get total count
      const countRows = this.db.prepare(`
        SELECT COUNT(*) as total FROM sessions WHERE agent_id = ?
      `).get(agent.id) as { total: number };

      // Get counts by status
      const statusRows = this.db.prepare(`
        SELECT status, COUNT(*) as count
        FROM sessions
        WHERE agent_id = ?
        GROUP BY status
      `).all(agent.id) as Array<{ status: string; count: number }>;

      // Get first and last session times
      const timeRows = this.db.prepare(`
        SELECT MIN(created_at) as first_at, MAX(created_at) as last_at
        FROM sessions
        WHERE agent_id = ?
      `).get(agent.id) as { first_at: string | null; last_at: string | null };

      const sessionsByStatus: Record<string, number> = {};
      for (const row of statusRows) {
        sessionsByStatus[row.status] = Number(row.count);
      }

      stats.push({
        agentId: agent.id,
        agentName: agent.name,
        agentSlug: agent.slug,
        totalSessions: Number(countRows.total),
        sessionsByStatus,
        firstSessionAt: timeRows.first_at,
        lastSessionAt: timeRows.last_at,
      });
    }

    return stats;
  }

  updateSession(sessionId: string, input: UpdateSessionInput): SessionRecord {
    const current = this.getSession(sessionId);
    if (!current) throw new Error(`Session not found: ${sessionId}`);

    const update: Record<string, SqlPrimitive> = {
      updated_at: nowIso(),
    };

    if (input.taskGroupId !== undefined) update.task_group_id = input.taskGroupId;
    if (input.parentSessionId !== undefined) update.parent_session_id = input.parentSessionId;
    if (input.status !== undefined) update.status = input.status;
    if (input.claudeResumeId !== undefined) update.claude_resume_id = input.claudeResumeId;
    if (input.title !== undefined) update.title = input.title;
    if (input.summary !== undefined) update.summary = input.summary;
    if (input.touchLastActive) update.last_active_at = nowIso();

    const built = buildSetClause(update);
    this.db.prepare(`UPDATE sessions SET ${built.clause} WHERE id = ?`).run(...built.params, sessionId);

    if (input.tags !== undefined) {
      this.replaceSessionTags(sessionId, input.tags);
    }

    return this.getSession(sessionId)!;
  }

  archiveSession(sessionId: string): SessionRecord {
    return this.updateSession(sessionId, { status: 'archived', touchLastActive: true });
  }

  deleteSession(sessionId: string): void {
    // Verify session exists first
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // Delete the session - CASCADE will automatically delete:
    // - session_messages
    // - session_tags
    // - attachments
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }

  stopSession(sessionId: string): SessionRecord {
    return this.updateSession(sessionId, { status: 'paused', touchLastActive: true });
  }

  startSession(sessionId: string): SessionRecord {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // Can only start sessions that are paused or idle
    if (!['paused', 'idle', 'completed'].includes(session.status)) {
      throw new Error(`Cannot start session with status: ${session.status}`);
    }

    return this.updateSession(sessionId, { status: 'active', touchLastActive: true });
  }

  listSessionTags(sessionId: string): string[] {
    const rows = this.db.prepare(`
      SELECT tag FROM session_tags WHERE session_id = ? ORDER BY tag ASC
    `).all(sessionId) as Array<{ tag: string }>;
    return rows.map((row) => row.tag);
  }

  replaceSessionTags(sessionId: string, tags: string[]): void {
    const unique = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
    this.db.prepare(`DELETE FROM session_tags WHERE session_id = ?`).run(sessionId);
    if (unique.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT INTO session_tags (session_id, tag, created_at) VALUES (?, ?, ?)
    `);
    const now = nowIso();
    for (const tag of unique) {
      stmt.run(sessionId, tag, now);
    }
  }

  appendMessage(input: AppendMessageInput): SessionMessage {
    const seqRow = this.db.prepare(`
      SELECT COALESCE(MAX(seq), 0) AS seq
      FROM session_messages
      WHERE session_id = ?
    `).get(input.sessionId) as { seq?: number } | undefined;

    const seq = Number(seqRow?.seq ?? 0) + 1;
    const id = randomUUID();
    const createdAt = nowIso();

    this.db.prepare(`
      INSERT INTO session_messages (
        id, session_id, seq, role, kind, content, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sessionId,
      seq,
      input.role,
      input.kind,
      input.content,
      JSON.stringify(input.metadata ?? {}),
      createdAt,
    );

    this.updateSession(input.sessionId, { touchLastActive: true });
    return this.getSessionMessages(input.sessionId).at(-1)!;
  }

  getSessionMessages(sessionId: string): SessionMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM session_messages
      WHERE session_id = ?
      ORDER BY seq ASC
    `).all(sessionId) as Record<string, unknown>[];
    return rows.map((row) => this.mapMessage(row));
  }

  getSessionSnapshot(sessionId: string): { session: SessionRecord; messages: SessionMessage[] } | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    return {
      session,
      messages: this.getSessionMessages(sessionId),
    };
  }

  forkSession(input: ForkSessionInput): SessionRecord {
    const source = this.getSession(input.sourceSessionId);
    if (!source) throw new Error(`Source session not found: ${input.sourceSessionId}`);

    const cloned = this.createSession({
      agentId: source.agentId,
      taskGroupId: input.taskGroupId ?? source.taskGroupId,
      parentSessionId: source.id,
      origin: 'fork',
      principalType: source.principalType,
      principalId: source.principalId,
      status: 'idle',
      claudeResumeId: null,
      title: input.title ?? source.title,
      summary: source.summary,
      tags: input.tags ?? source.tags,
    });

    const messages = this.getSessionMessages(source.id);
    const insert = this.db.prepare(`
      INSERT INTO session_messages (
        id, session_id, seq, role, kind, content, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const message of messages) {
      insert.run(
        randomUUID(),
        cloned.id,
        message.seq,
        message.role,
        message.kind,
        message.content,
        JSON.stringify(message.metadata),
        message.createdAt,
      );
    }

    return this.getSession(cloned.id)!;
  }

  upsertProviderBinding(params: {
    agentId: string;
    provider: string;
    remoteAgentId?: string | null;
    remoteSlug?: string | null;
    status: string;
    config?: Record<string, unknown>;
    lastSyncedAt?: string | null;
  }): ProviderBinding {
    const current = this.getProviderBinding(params.agentId, params.provider);
    const now = nowIso();

    if (!current) {
      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO provider_bindings (
          id, agent_id, provider, remote_agent_id, remote_slug, status, config_json, last_synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        params.agentId,
        params.provider,
        params.remoteAgentId ?? null,
        params.remoteSlug ?? null,
        params.status,
        JSON.stringify(params.config ?? {}),
        params.lastSyncedAt ?? null,
        now,
        now,
      );
      return this.getProviderBinding(params.agentId, params.provider)!;
    }

    const update = buildSetClause({
      remote_agent_id: params.remoteAgentId ?? current.remoteAgentId,
      remote_slug: params.remoteSlug ?? current.remoteSlug,
      status: params.status,
      config_json: JSON.stringify(params.config ?? current.config),
      last_synced_at: params.lastSyncedAt ?? current.lastSyncedAt,
      updated_at: now,
    });

    this.db.prepare(`
      UPDATE provider_bindings
      SET ${update.clause}
      WHERE agent_id = ? AND provider = ?
    `).run(...update.params, params.agentId, params.provider);

    return this.getProviderBinding(params.agentId, params.provider)!;
  }

  getProviderBinding(agentId: string, provider: string): ProviderBinding | null {
    const row = this.db.prepare(`
      SELECT * FROM provider_bindings
      WHERE agent_id = ? AND provider = ?
    `).get(agentId, provider) as Record<string, unknown> | undefined;
    return row ? this.mapProviderBinding(row) : null;
  }

  listProviderBindings(agentId?: string): ProviderBinding[] {
    const rows = agentId
      ? this.db.prepare(`
          SELECT * FROM provider_bindings
          WHERE agent_id = ?
          ORDER BY updated_at DESC
        `).all(agentId)
      : this.db.prepare(`
          SELECT * FROM provider_bindings
          ORDER BY updated_at DESC
        `).all();

    return (rows as Record<string, unknown>[]).map((row) => this.mapProviderBinding(row));
  }

  removeProviderBinding(agentId: string, provider: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM provider_bindings
      WHERE agent_id = ? AND provider = ?
    `).run(agentId, provider);
    return Number(result.changes ?? 0) > 0;
  }

  // ─── ACL ──────────────────────────────────────────────────────

  private mapAclEntry(row: Record<string, unknown>): AclEntry {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      principal: row.principal as string,
      permission: row.permission as string,
      grantedBy: (row.granted_by as string) ?? null,
      createdAt: row.created_at as string,
    };
  }

  grantAccess(params: {
    agentId: string;
    principal: string;
    permission?: string;
    grantedBy?: string;
  }): AclEntry {
    const id = randomUUID();
    const now = nowIso();
    const permission = params.permission ?? 'call';
    this.db.prepare(`
      INSERT OR IGNORE INTO agent_acl (id, agent_id, principal, permission, granted_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, params.agentId, params.principal, permission, params.grantedBy ?? null, now);
    const row = this.db.prepare(`
      SELECT * FROM agent_acl WHERE agent_id = ? AND principal = ? AND permission = ?
    `).get(params.agentId, params.principal, permission) as Record<string, unknown>;
    return this.mapAclEntry(row);
  }

  revokeAccess(agentId: string, principal: string, permission?: string): boolean {
    const result = permission
      ? this.db.prepare(`DELETE FROM agent_acl WHERE agent_id = ? AND principal = ? AND permission = ?`).run(agentId, principal, permission)
      : this.db.prepare(`DELETE FROM agent_acl WHERE agent_id = ? AND principal = ?`).run(agentId, principal);
    return Number(result.changes ?? 0) > 0;
  }

  listAcl(agentId: string): AclEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM agent_acl WHERE agent_id = ? ORDER BY created_at ASC
    `).all(agentId) as Record<string, unknown>[];
    return rows.map((row) => this.mapAclEntry(row));
  }

  checkAccess(agentId: string, principal: string, permission = 'call'): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM agent_acl WHERE agent_id = ? AND (principal = ? OR principal = '*') AND permission = ?
    `).get(agentId, principal, permission);
    return !!row;
  }

  // ─── Task Groups ──────────────────────────────────────────────

  listTaskGroups(query: { status?: string } = {}): TaskGroup[] {
    const clauses: string[] = [];
    const params: SqlPrimitive[] = [];

    if (query.status && query.status !== 'all') {
      clauses.push('status = ?');
      params.push(query.status);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM task_groups
      ${where}
      ORDER BY updated_at DESC, created_at DESC
    `).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.mapTaskGroup(row));
  }

  createTaskGroup(input: CreateTaskGroupInput): TaskGroup {
    const now = nowIso();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO task_groups (
        id, title, owner_principal, source, status, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title,
      input.ownerPrincipal ?? 'owner:local',
      input.source ?? 'cli',
      input.status ?? 'active',
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
    );
    return this.getTaskGroup(id)!;
  }

  getTaskGroup(taskGroupId: string): TaskGroup | null {
    const row = this.db.prepare(`SELECT * FROM task_groups WHERE id = ?`).get(taskGroupId) as Record<string, unknown> | undefined;
    return row ? this.mapTaskGroup(row) : null;
  }

  archiveTaskGroup(taskGroupId: string): TaskGroup {
    const current = this.getTaskGroup(taskGroupId);
    if (!current) throw new Error(`Task group not found: ${taskGroupId}`);
    this.db.prepare(`
      UPDATE task_groups
      SET status = 'archived', updated_at = ?
      WHERE id = ?
    `).run(nowIso(), taskGroupId);
    return this.getTaskGroup(taskGroupId)!;
  }

  updateTaskGroup(taskGroupId: string, input: { title?: string; status?: string }): TaskGroup {
    const current = this.getTaskGroup(taskGroupId);
    if (!current) throw new Error(`Task group not found: ${taskGroupId}`);

    const update: Record<string, SqlPrimitive> = {
      updated_at: nowIso(),
    };

    if (input.title !== undefined) update.title = input.title;
    if (input.status !== undefined) update.status = input.status;

    const built = buildSetClause(update);
    this.db.prepare(`UPDATE task_groups SET ${built.clause} WHERE id = ?`).run(...built.params, taskGroupId);

    return this.getTaskGroup(taskGroupId)!;
  }

  getSessionCountsByTaskGroup(): Record<string, number> {
    const rows = this.db.prepare(`
      SELECT task_group_id, COUNT(*) AS count
      FROM sessions
      WHERE task_group_id IS NOT NULL
      GROUP BY task_group_id
    `).all() as Array<{ task_group_id: string; count: number }>;

    return Object.fromEntries(rows.map((row) => [row.task_group_id, Number(row.count)]));
  }

  getRuntimeLimit(scopeType = 'daemon', scopeId = 'global'): RuntimeLimitRecord {
    const row = this.db.prepare(`
      SELECT * FROM runtime_limits WHERE scope_type = ? AND scope_id = ?
    `).get(scopeType, scopeId) as Record<string, unknown> | undefined;

    if (!row) {
      const now = nowIso();
      this.db.prepare(`
        INSERT INTO runtime_limits (
          scope_type, scope_id, max_concurrent, queue_wait_timeout_ms, queue_max_length, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        scopeType,
        scopeId,
        DEFAULT_RUNTIME_CONFIG.max_active_requests,
        DEFAULT_RUNTIME_CONFIG.queue_wait_timeout_ms,
        DEFAULT_RUNTIME_CONFIG.queue_max_length,
        '{}',
        now,
        now,
      );
      return this.getRuntimeLimit(scopeType, scopeId);
    }

    return this.mapRuntimeLimit(row);
  }

  getDaemonSetting<T = unknown>(key: string): T | null {
    const row = this.db.prepare(`
      SELECT * FROM daemon_settings WHERE key = ?
    `).get(key) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.mapDaemonSetting(row).value as T;
  }

  setDaemonSetting<T>(key: string, value: T): T {
    this.db.prepare(`
      INSERT INTO daemon_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), nowIso());

    return this.getDaemonSetting<T>(key)!;
  }

  deleteDaemonSetting(key: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM daemon_settings WHERE key = ?
    `).run(key);
    return Number(result.changes ?? 0) > 0;
  }
}
