interface LogsPanelProps {
  logs: string[];
  path: string | null;
}

export function LogsPanel({ logs, path }: LogsPanelProps) {
  return (
    <section id="logs" className="panel-section">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Logs</p>
          <h2>Recent daemon tail</h2>
        </div>
        <p className="panel-note">{path ?? 'Log path unavailable'}</p>
      </div>

      {logs.length === 0 ? (
        <div className="empty-state">
          <strong>No log lines yet.</strong>
          <p>The local daemon log will surface queue pressure, provider startup failures, and runtime warnings.</p>
        </div>
      ) : (
        <pre className="log-frame">{logs.join('\n')}</pre>
      )}
    </section>
  );
}
