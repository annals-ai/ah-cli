import type { AgentRecord, SessionRecord, SessionStatus, TaskRecord } from '../api';

interface SessionFilters {
  agentId: string;
  taskGroupId: string;
  status: SessionStatus | 'all';
}

interface SessionsPanelProps {
  agents: AgentRecord[];
  tasks: TaskRecord[];
  sessions: SessionRecord[];
  filters: SessionFilters;
  selectedSessionId: string | null;
  onFiltersChange(filters: SessionFilters): void;
  onSelectSession(sessionId: string): void;
}

const STATUS_OPTIONS: Array<SessionStatus | 'all'> = [
  'all',
  'active',
  'idle',
  'paused',
  'queued',
  'completed',
  'failed',
  'archived',
];

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function SessionsPanel({
  agents,
  tasks,
  sessions,
  filters,
  selectedSessionId,
  onFiltersChange,
  onSelectSession,
}: SessionsPanelProps) {
  return (
    <section id="sessions" className="panel-section">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Sessions</p>
          <h2>Live desk</h2>
        </div>
        <p className="panel-note">Filter by agent, task group, or lifecycle state.</p>
      </div>

      <div className="filter-grid">
        <label className="field">
          <span>Agent</span>
          <select
            value={filters.agentId}
            onChange={(event) => onFiltersChange({ ...filters, agentId: event.target.value })}
          >
            <option value="all">All agents</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Task group</span>
          <select
            value={filters.taskGroupId}
            onChange={(event) => onFiltersChange({ ...filters, taskGroupId: event.target.value })}
          >
            <option value="all">All task groups</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Status</span>
          <select
            value={filters.status}
            onChange={(event) => onFiltersChange({ ...filters, status: event.target.value as SessionFilters['status'] })}
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="stack-list">
        {sessions.length === 0 ? (
          <div className="empty-state">
            <strong>No sessions match the current filters.</strong>
            <p>Try another agent, task group, or status slice.</p>
          </div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`stack-item ${selectedSessionId === session.id ? 'is-active' : ''}`}
              onClick={() => onSelectSession(session.id)}
            >
              <div className="stack-header">
                <div>
                  <strong>{session.title ?? 'Untitled session'}</strong>
                  <span>{session.agent?.name ?? session.agentId}</span>
                </div>
                <span className={`badge badge-status badge-${session.status}`}>{session.status}</span>
              </div>

              <p className="stack-copy">
                {session.summary ?? `${session.origin} · ${session.principalType}`}
              </p>

              <div className="stack-meta">
                <span>{formatTimestamp(session.lastActiveAt)}</span>
                <span>{session.taskGroupId ? 'Task linked' : 'Standalone'}</span>
                <span>{session.tags.length} tags</span>
              </div>

              {session.tags.length > 0 ? (
                <div className="tag-row">
                  {session.tags.map((tag) => (
                    <span key={tag} className="tag-chip">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
