import type { ProviderRecord } from '../api';

function visibleUrls(config: Record<string, unknown>): Array<{ key: string; value: string }> {
  return Object.entries(config)
    .filter(([, value]) => typeof value === 'string')
    .filter(([key, value]) => key.toLowerCase().includes('url') || String(value).startsWith('http'))
    .map(([key, value]) => ({ key, value: String(value) }));
}

export function ExposurePanel({ providers }: { providers: ProviderRecord[] }) {
  return (
    <section id="exposure" className="panel-section">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Exposure</p>
          <h2>Provider bindings</h2>
        </div>
        <p className="panel-note">Gateway reachability and remote ids stay visible without leaving local history.</p>
      </div>

      <div className="stack-list">
        {providers.length === 0 ? (
          <div className="empty-state">
            <strong>No providers exposed.</strong>
            <p>Bindings such as Agents Hot and generic A2A will appear here after registration.</p>
          </div>
        ) : (
          providers.map((provider) => (
            <article key={provider.id} className="stack-item">
              <div className="stack-header">
                <div>
                  <strong>{provider.provider}</strong>
                  <span>{provider.agent?.name ?? provider.agentId}</span>
                </div>
                <span className={`badge badge-status badge-${provider.status}`}>{provider.status}</span>
              </div>

              <div className="stack-meta">
                <span>{provider.remoteSlug ?? provider.remoteAgentId ?? 'Local only'}</span>
                <span>{provider.lastSyncedAt ? new Date(provider.lastSyncedAt).toLocaleString() : 'Never synced'}</span>
              </div>

              {visibleUrls(provider.config).length > 0 ? (
                <ul className="url-list">
                  {visibleUrls(provider.config).map((entry) => (
                    <li key={entry.key}>
                      <span>{entry.key}</span>
                      <a href={entry.value} target="_blank" rel="noreferrer">
                        {entry.value}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mini-copy">No URL endpoints advertised in this binding config.</p>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
