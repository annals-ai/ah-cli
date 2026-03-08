import type { TaskRecord } from '../api';

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function TasksPanel({ tasks }: { tasks: TaskRecord[] }) {
  return (
    <section id="tasks" className="panel-section">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Tasks</p>
          <h2>Task group watchlist</h2>
        </div>
        <p className="panel-note">Grouped sessions and owner source metadata.</p>
      </div>

      <div className="stack-list">
        {tasks.length === 0 ? (
          <div className="empty-state">
            <strong>No task groups are recorded yet.</strong>
            <p>Grouped work will appear here as sessions are tied together.</p>
          </div>
        ) : (
          tasks.map((task) => (
            <article key={task.id} className="stack-item">
              <div className="stack-header">
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.ownerPrincipal}</span>
                </div>
                <span className={`badge badge-status badge-${task.status}`}>{task.status}</span>
              </div>

              <p className="stack-copy">{task.source}</p>

              <div className="stack-meta">
                <span>{task.sessionCount} linked sessions</span>
                <span>{formatTimestamp(task.updatedAt)}</span>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
