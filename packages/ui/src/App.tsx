import { startTransition, useEffect, useState } from 'react';
import {
  archiveSession,
  forkSession,
  getDashboardData,
  getSessionMessages,
  stopSession,
  type DashboardData,
  type SessionMessage,
  type SessionStatus,
} from './api';
import { AppShell } from './components/AppShell';
import { AgentsPanel } from './components/AgentsPanel';
import { ExposurePanel } from './components/ExposurePanel';
import { LogsPanel } from './components/LogsPanel';
import { OverviewPanel } from './components/OverviewPanel';
import { SessionsPanel } from './components/SessionsPanel';
import { TasksPanel } from './components/TasksPanel';
import { TranscriptPanel } from './components/TranscriptPanel';

interface SessionFilters {
  agentId: string;
  taskGroupId: string;
  status: SessionStatus | 'all';
}

const DEFAULT_FILTERS: SessionFilters = {
  agentId: 'all',
  taskGroupId: 'all',
  status: 'all',
};

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [filters, setFilters] = useState<SessionFilters>(DEFAULT_FILTERS);
  const [forkTitle, setForkTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<'stop' | 'archive' | 'fork' | null>(null);

  async function refreshDashboard(preferredSessionId?: string | null): Promise<void> {
    setRefreshing(true);
    setError(null);

    try {
      const nextDashboard = await getDashboardData();
      startTransition(() => {
        setDashboard(nextDashboard);
        setSelectedSessionId((current) => {
          const candidate = preferredSessionId ?? current;
          if (candidate && nextDashboard.sessions.some((session) => session.id === candidate)) {
            return candidate;
          }
          return nextDashboard.sessions[0]?.id ?? null;
        });
      });
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshDashboard();
  }, []);

  const filteredSessions = dashboard
    ? dashboard.sessions.filter((session) => {
        const matchesAgent = filters.agentId === 'all' || session.agentId === filters.agentId;
        const matchesTask = filters.taskGroupId === 'all' || session.taskGroupId === filters.taskGroupId;
        const matchesStatus = filters.status === 'all' || session.status === filters.status;
        return matchesAgent && matchesTask && matchesStatus;
      })
    : [];

  useEffect(() => {
    if (!dashboard) return;

    if (filteredSessions.length === 0) {
      setSelectedSessionId(null);
      setMessages([]);
      return;
    }

    if (!selectedSessionId || !filteredSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(filteredSessions[0]?.id ?? null);
    }
  }, [dashboard, filteredSessions, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      setMessageError(null);
      return;
    }

    setMessagesLoading(true);
    setMessageError(null);

    void getSessionMessages(selectedSessionId)
      .then((nextMessages) => {
        startTransition(() => {
          setMessages(nextMessages);
        });
      })
      .catch((nextError) => {
        setMessageError((nextError as Error).message);
      })
      .finally(() => {
        setMessagesLoading(false);
      });
  }, [selectedSessionId]);

  const selectedSession = filteredSessions.find((session) => session.id === selectedSessionId) ?? null;

  async function handleStop(): Promise<void> {
    if (!selectedSession) return;

    setActionState('stop');
    try {
      await stopSession(selectedSession.id);
      await refreshDashboard(selectedSession.id);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setActionState(null);
    }
  }

  async function handleArchive(): Promise<void> {
    if (!selectedSession) return;

    setActionState('archive');
    try {
      await archiveSession(selectedSession.id);
      await refreshDashboard(selectedSession.id);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setActionState(null);
    }
  }

  async function handleFork(): Promise<void> {
    if (!selectedSession) return;

    setActionState('fork');
    try {
      const result = await forkSession(selectedSession.id, forkTitle.trim() || undefined);
      startTransition(() => {
        setForkTitle('');
        setSelectedSessionId(result.session.id);
        setMessages(result.messages);
      });
      await refreshDashboard(result.session.id);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setActionState(null);
    }
  }

  return (
    <AppShell
      uiBaseUrl={dashboard?.status.daemon.uiBaseUrl ?? null}
      startedAt={dashboard?.status.daemon.startedAt ?? new Date().toISOString()}
      refreshing={refreshing}
      onRefresh={() => {
        void refreshDashboard(selectedSessionId);
      }}
    >
      {error ? (
        <section className="panel-section empty-error">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Alert</p>
              <h2>Snapshot refresh failed</h2>
            </div>
          </div>
          <p>{error}</p>
        </section>
      ) : null}

      {loading && !dashboard ? (
        <section className="panel-section">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Loading</p>
              <h2>Collecting local daemon state</h2>
            </div>
          </div>
          <p className="panel-note">Fetching agents, sessions, tasks, providers, and recent logs.</p>
        </section>
      ) : null}

      {dashboard ? (
        <>
          <OverviewPanel status={dashboard.status} />

          <div className="panel-grid panel-grid-two">
            <AgentsPanel
              agents={dashboard.agents}
              selectedAgentId={filters.agentId}
              onSelectAgent={(agentId) => {
                setFilters((current) => ({ ...current, agentId }));
              }}
            />

            <SessionsPanel
              agents={dashboard.agents}
              tasks={dashboard.tasks}
              sessions={filteredSessions}
              filters={filters}
              selectedSessionId={selectedSessionId}
              onFiltersChange={setFilters}
              onSelectSession={setSelectedSessionId}
            />
          </div>

          <div className="panel-grid panel-grid-two transcript-layout">
            <TranscriptPanel
              session={selectedSession}
              messages={messages}
              loading={messagesLoading}
              error={messageError}
              actionState={actionState}
              forkTitle={forkTitle}
              onForkTitleChange={setForkTitle}
              onStop={() => {
                void handleStop();
              }}
              onArchive={() => {
                void handleArchive();
              }}
              onFork={() => {
                void handleFork();
              }}
            />

            <TasksPanel tasks={dashboard.tasks} />
          </div>

          <div className="panel-grid panel-grid-two">
            <ExposurePanel providers={dashboard.providers} />
            <LogsPanel logs={dashboard.logs} path={dashboard.logPath} />
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
