import { useDeferredValue, useState } from 'react';
import type { SessionMessage, SessionRecord } from '../api';

interface TranscriptPanelProps {
  session: SessionRecord | null;
  messages: SessionMessage[];
  loading: boolean;
  error: string | null;
  actionState: 'stop' | 'archive' | 'fork' | null;
  forkTitle: string;
  onForkTitleChange(value: string): void;
  onStop(): void;
  onArchive(): void;
  onFork(): void;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function roleClass(role: string): string {
  switch (role) {
    case 'assistant':
      return 'role-assistant';
    case 'system':
      return 'role-system';
    case 'tool':
      return 'role-tool';
    default:
      return 'role-user';
  }
}

export function TranscriptPanel({
  session,
  messages,
  loading,
  error,
  actionState,
  forkTitle,
  onForkTitleChange,
  onStop,
  onArchive,
  onFork,
}: TranscriptPanelProps) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const visibleMessages = messages.filter((message) => {
    if (!deferredQuery) return true;
    return [
      message.role,
      message.kind,
      message.content,
      JSON.stringify(message.metadata),
    ].join(' ').toLowerCase().includes(deferredQuery);
  });

  return (
    <section id="transcript" className="panel-section transcript-panel">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Transcript</p>
          <h2>{session?.title ?? 'Select a session'}</h2>
        </div>
        <div className="action-row">
          <button type="button" onClick={onStop} disabled={!session || actionState !== null}>
            {actionState === 'stop' ? 'Stopping...' : 'Stop'}
          </button>
          <button type="button" onClick={onArchive} disabled={!session || actionState !== null}>
            {actionState === 'archive' ? 'Archiving...' : 'Archive'}
          </button>
        </div>
      </div>

      {session ? (
        <div className="transcript-meta">
          <span>{session.agent?.name ?? session.agentId}</span>
          <span>{session.origin}</span>
          <span>{session.status}</span>
          <span>{formatTimestamp(session.lastActiveAt)}</span>
        </div>
      ) : null}

      <div className="transcript-toolbar">
        <label className="field field-grow">
          <span>Search transcript</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search content, roles, kinds, metadata..."
            disabled={!session}
          />
        </label>

        <label className="field field-grow">
          <span>Fork title</span>
          <input
            type="text"
            value={forkTitle}
            onChange={(event) => onForkTitleChange(event.target.value)}
            placeholder="Experiment"
            disabled={!session || actionState !== null}
          />
        </label>

        <button type="button" onClick={onFork} disabled={!session || actionState !== null}>
          {actionState === 'fork' ? 'Forking...' : 'Fork session'}
        </button>
      </div>

      {!session ? (
        <div className="empty-state">
          <strong>Pick a session from the desk.</strong>
          <p>The transcript viewer shows every local message, including tool and system events.</p>
        </div>
      ) : loading ? (
        <div className="empty-state">
          <strong>Loading transcript...</strong>
          <p>Pulling local history from the daemon.</p>
        </div>
      ) : error ? (
        <div className="empty-state empty-error">
          <strong>Transcript load failed.</strong>
          <p>{error}</p>
        </div>
      ) : visibleMessages.length === 0 ? (
        <div className="empty-state">
          <strong>No messages match the current search.</strong>
          <p>Clear the query to inspect the full session stream.</p>
        </div>
      ) : (
        <div className="transcript-list">
          {visibleMessages.map((message) => (
            <article key={message.id} className={`transcript-item ${roleClass(message.role)}`}>
              <div className="transcript-item-header">
                <span className="transcript-role">{message.role}</span>
                <span className="transcript-kind">{message.kind}</span>
                <span className="transcript-time">{formatTimestamp(message.createdAt)}</span>
              </div>
              <pre className="transcript-content">{message.content}</pre>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
