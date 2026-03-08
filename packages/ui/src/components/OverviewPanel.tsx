import type { DaemonStatusResponse } from '../api';

interface OverviewPanelProps {
  status: DaemonStatusResponse;
}

const RUNTIME_METRICS: Array<{
  label: string;
  value: (status: DaemonStatusResponse) => number;
  detail: (status: DaemonStatusResponse) => string;
}> = [
  {
    label: 'Agents',
    value: (status) => status.counts.agents,
    detail: () => 'Tracked in the local daemon registry',
  },
  {
    label: 'Sessions',
    value: (status) => status.counts.sessions,
    detail: () => 'Full transcript history stays local',
  },
  {
    label: 'Task groups',
    value: (status) => status.counts.taskGroups,
    detail: () => 'Cross-agent bundles and workstreams',
  },
  {
    label: 'Provider bindings',
    value: (status) => status.counts.providerBindings,
    detail: () => 'Exposure points and gateway sync state',
  },
];

function formatDuration(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) {
    return `${minutes} min queue window`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours} hr queue window`;
}

export function OverviewPanel({ status }: OverviewPanelProps) {
  return (
    <section id="overview" className="panel-section">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Overview</p>
          <h2>Daemon pressure and local history at a glance</h2>
        </div>
        <p className="panel-note">
          Port <strong>{status.daemon.uiPort ?? 'n/a'}</strong> on <strong>{status.daemon.uiBaseUrl ?? 'offline'}</strong>
        </p>
      </div>

      <div className="metrics-grid">
        {RUNTIME_METRICS.map((metric) => (
          <article key={metric.label} className="metric-card">
            <p className="metric-label">{metric.label}</p>
            <p className="metric-value">{metric.value(status)}</p>
            <p className="metric-detail">{metric.detail(status)}</p>
          </article>
        ))}
      </div>

      <div className="status-strip">
        <article>
          <p className="status-label">Queue load</p>
          <strong>{status.runtime.queue.active} active</strong>
          <span>{status.runtime.queue.queued} queued</span>
        </article>
        <article>
          <p className="status-label">Managed sessions</p>
          <strong>{status.runtime.managedSessions}</strong>
          <span>{status.runtime.activeExecutions} currently streaming</span>
        </article>
        <article>
          <p className="status-label">Concurrency budget</p>
          <strong>{status.runtime.queue.config.maxActiveRequests}</strong>
          <span>{formatDuration(status.runtime.queue.config.queueWaitTimeoutMs)}</span>
        </article>
      </div>
    </section>
  );
}
