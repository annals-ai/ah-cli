import type { ReactNode } from 'react';

interface AppShellProps {
  uiBaseUrl: string | null;
  startedAt: string;
  refreshing: boolean;
  onRefresh(): void;
  children: ReactNode;
}

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'agents', label: 'Agents' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'exposure', label: 'Exposure' },
  { id: 'logs', label: 'Logs' },
];

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function AppShell({ uiBaseUrl, startedAt, refreshing, onRefresh, children }: AppShellProps) {
  return (
    <div className="console-shell">
      <aside className="console-rail">
        <div className="console-brand">
          <p className="console-kicker">Local Console</p>
          <h1>Agent Mesh</h1>
          <p className="console-summary">
            A daemon-first operations desk for local agents, session history, provider exposure, and runtime pressure.
          </p>
        </div>

        <nav className="console-nav" aria-label="Sections">
          {NAV_ITEMS.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="console-nav-link">
              {item.label}
            </a>
          ))}
        </nav>

        <button type="button" className="console-refresh" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing snapshot...' : 'Refresh snapshot'}
        </button>

        <dl className="console-meta">
          <div>
            <dt>UI origin</dt>
            <dd>{uiBaseUrl ?? 'offline'}</dd>
          </div>
          <div>
            <dt>Daemon start</dt>
            <dd>{formatTimestamp(startedAt)}</dd>
          </div>
        </dl>
      </aside>

      <div className="console-main">{children}</div>
    </div>
  );
}
