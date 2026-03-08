import type { AgentRecord } from '../api';

interface AgentsPanelProps {
  agents: AgentRecord[];
  selectedAgentId: string;
  onSelectAgent(agentId: string): void;
}

export function AgentsPanel({ agents, selectedAgentId, onSelectAgent }: AgentsPanelProps) {
  return (
    <section id="agents" className="panel-section">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Agents</p>
          <h2>Runtime roster</h2>
        </div>
        <p className="panel-note">Click any agent to filter the session desk.</p>
      </div>

      <div className="stack-list">
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className={`stack-item ${selectedAgentId === agent.id ? 'is-active' : ''}`}
            onClick={() => onSelectAgent(selectedAgentId === agent.id ? 'all' : agent.id)}
          >
            <div className="stack-header">
              <div>
                <strong>{agent.name}</strong>
                <span>@{agent.slug}</span>
              </div>
              <span className={`badge badge-${agent.visibility}`}>{agent.visibility}</span>
            </div>

            <p className="stack-copy">{agent.description ?? agent.projectPath}</p>

            <div className="stack-meta">
              <span>{agent.runtimeType}</span>
              <span>{agent.sandbox ? 'Sandbox on' : 'Sandbox off'}</span>
              <span>{agent.sessionCount} sessions</span>
            </div>

            {agent.capabilities.length > 0 ? (
              <div className="tag-row">
                {agent.capabilities.slice(0, 4).map((capability) => (
                  <span key={capability} className="tag-chip">
                    {capability}
                  </span>
                ))}
              </div>
            ) : null}

            {agent.bindings.length > 0 ? (
              <p className="mini-copy">
                {agent.bindings.map((binding) => `${binding.provider}:${binding.status}`).join(' · ')}
              </p>
            ) : (
              <p className="mini-copy">No provider exposure configured yet.</p>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
