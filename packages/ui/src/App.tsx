import { useEffect, useRef, useState } from 'react';
import {
  archiveSession,
  archiveTaskGroup,
  createAgent,
  createTaskGroup,
  exposeAgent,
  forkSession,
  getDashboardData,
  getSessionMessages,
  removeAgent,
  restartDaemon,
  sendLocalChatTurn,
  stopSession,
  stopDaemon,
  unexposeAgent,
  updateAgent,
  type AgentMutationInput,
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
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n';

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

const CONSOLE_TABS = [
  'overview',
  'agents',
  'sessions',
  'transcript',
  'tasks',
  'exposure',
  'logs',
] as const;

const DASHBOARD_REFRESH_INTERVAL_MS = 3_000;

type ConsoleTab = typeof CONSOLE_TABS[number];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTabFromHash(hash: string): ConsoleTab {
  const value = hash.replace(/^#/, '');
  return CONSOLE_TABS.includes(value as ConsoleTab) ? value as ConsoleTab : 'overview';
}

export default function App() {
  const { t } = useI18n();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [activeTab, setActiveTab] = useState<ConsoleTab>(() => {
    if (typeof window === 'undefined') {
      return 'overview';
    }
    return resolveTabFromHash(window.location.hash);
  });
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [filters, setFilters] = useState<SessionFilters>(DEFAULT_FILTERS);
  const [forkTitle, setForkTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [composerMessage, setComposerMessage] = useState('');
  const [composerAgentId, setComposerAgentId] = useState('');
  const [composerTaskGroupId, setComposerTaskGroupId] = useState('none');
  const [actionState, setActionState] = useState<'stop' | 'archive' | 'fork' | 'send' | null>(null);
  const [daemonActionState, setDaemonActionState] = useState<'stop' | 'restart' | null>(null);
  const refreshInFlightRef = useRef(false);

  async function refreshDashboard(
    preferredSessionId?: string | null,
    options: { background?: boolean } = {},
  ): Promise<void> {
    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    if (!options.background) {
      setRefreshing(true);
      setError(null);
    }

    try {
      const nextDashboard = await getDashboardData();
      setError(null);
      setDashboard(nextDashboard);
      setSelectedSessionId((current) => {
        const candidate = preferredSessionId ?? current;
        if (candidate && nextDashboard.sessions.some((session) => session.id === candidate)) {
          return candidate;
        }
        return nextDashboard.sessions[0]?.id ?? null;
      });
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
      if (!options.background) {
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void refreshDashboard();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const runRefresh = () => {
      if (document.visibilityState !== 'visible' || daemonActionState !== null) {
        return;
      }
      void refreshDashboard(selectedSessionId, { background: true });
    };

    const intervalId = window.setInterval(runRefresh, DASHBOARD_REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => runRefresh();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [daemonActionState, selectedSessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const applyHash = () => setActiveTab(resolveTabFromHash(window.location.hash));
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
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
        setMessages(nextMessages);
      })
      .catch((nextError) => {
        setMessageError((nextError as Error).message);
      })
      .finally(() => {
        setMessagesLoading(false);
      });
  }, [selectedSessionId]);

  const selectedSession = filteredSessions.find((session) => session.id === selectedSessionId) ?? null;
  const draftAgentId = selectedSession
    ? selectedSession.agentId
    : composerAgentId || (filters.agentId !== 'all' ? filters.agentId : dashboard?.agents[0]?.id ?? '');

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
      setForkTitle('');
      setSelectedSessionId(result.session.id);
      setMessages(result.messages);
      await refreshDashboard(result.session.id);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setActionState(null);
    }
  }

  async function handleCreateAgent(input: AgentMutationInput): Promise<void> {
    await createAgent(input);
    await refreshDashboard(selectedSessionId);
  }

  async function handleUpdateAgent(ref: string, input: Partial<AgentMutationInput>): Promise<void> {
    await updateAgent(ref, input);
    await refreshDashboard(selectedSessionId);
  }

  async function handleRemoveAgent(ref: string): Promise<void> {
    await removeAgent(ref);
    await refreshDashboard(selectedSessionId);
  }

  async function handleExposeAgent(ref: string, provider: string, config: Record<string, unknown>): Promise<void> {
    await exposeAgent(ref, provider, config);
    await refreshDashboard(selectedSessionId);
  }

  async function handleUnexposeAgent(ref: string, provider: string): Promise<void> {
    await unexposeAgent(ref, provider);
    await refreshDashboard(selectedSessionId);
  }

  async function handleCreateTask(title: string, source: string): Promise<void> {
    await createTaskGroup({ title, source });
    await refreshDashboard(selectedSessionId);
  }

  async function handleArchiveTask(taskGroupId: string): Promise<void> {
    await archiveTaskGroup(taskGroupId);
    await refreshDashboard(selectedSessionId);
  }

  async function handleSendMessage(): Promise<void> {
    const message = composerMessage.trim();
    if (!message) return;

    if (!selectedSession && !draftAgentId) {
      setError(t('transcript.selectAgentRequired'));
      return;
    }

    const draftTaskGroupId = !selectedSession && composerTaskGroupId !== 'none' ? composerTaskGroupId : undefined;

    setActionState('send');
    setError(null);

    try {
      if (!selectedSession && draftAgentId) {
        setFilters((current) => ({
          ...current,
          agentId: draftAgentId,
          taskGroupId: draftTaskGroupId ?? 'all',
          status: 'all',
        }));
      }

      const result = await sendLocalChatTurn({
        agentRef: selectedSession ? undefined : draftAgentId,
        sessionId: selectedSession?.id ?? undefined,
        taskGroupId: draftTaskGroupId,
        message,
      });

      setComposerMessage('');
      setSelectedSessionId(result.session.id);
      setMessages(result.messages);
      await refreshDashboard(result.session.id);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setActionState(null);
    }
  }

  async function waitForUiHealth(uiBaseUrl: string): Promise<void> {
    const deadline = Date.now() + 20_000;

    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${uiBaseUrl}/health`, {
          cache: 'no-store',
        });
        if (response.ok) {
          return;
        }
      } catch {}

      await sleep(500);
    }

    throw new Error(t('shell.restartTimeout'));
  }

  async function handleStopDaemon(): Promise<void> {
    setDaemonActionState('stop');
    setError(null);

    try {
      await stopDaemon();
      setError(t('shell.stopNotice'));
    } catch (nextError) {
      setError((nextError as Error).message);
      setDaemonActionState(null);
    }
  }

  async function handleRestartDaemon(): Promise<void> {
    setDaemonActionState('restart');
    setError(null);

    try {
      const response = await restartDaemon();
      const reconnectUrl = response.uiBaseUrl ?? dashboard?.status.daemon.uiBaseUrl;
      if (!reconnectUrl) {
        throw new Error(t('shell.restartUnavailable'));
      }

      await waitForUiHealth(reconnectUrl);
      await refreshDashboard(selectedSessionId);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setDaemonActionState(null);
    }
  }

  function handleTabChange(nextTab: string): void {
    const resolved = resolveTabFromHash(`#${nextTab}`);
    setActiveTab(resolved);

    if (typeof window !== 'undefined') {
      const nextHash = `#${resolved}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
      }
    }
  }

  return (
    <AppShell
      activeTab={activeTab}
      uiBaseUrl={dashboard?.status.daemon.uiBaseUrl ?? null}
      startedAt={dashboard?.status.daemon.startedAt ?? new Date().toISOString()}
      refreshing={refreshing}
      daemonActionState={daemonActionState}
      onTabChange={handleTabChange}
      onRefresh={() => {
        void refreshDashboard(selectedSessionId);
      }}
      onStopDaemon={() => {
        void handleStopDaemon();
      }}
      onRestartDaemon={() => {
        void handleRestartDaemon();
      }}
    >
      {error ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{t('app.alert')}</p>
            <CardTitle>{t('app.snapshotRefreshFailed')}</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {loading && !dashboard ? (
        <Card>
          <CardHeader>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{t('app.loading')}</p>
            <CardTitle>{t('app.collectingState')}</CardTitle>
            <CardDescription>{t('app.fetchingState')}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {dashboard ? (
        <>
          <TabsContent value="overview" className="mt-0">
            <OverviewPanel status={dashboard.status} />
          </TabsContent>

          <TabsContent value="agents" className="mt-0">
            <AgentsPanel
              agents={dashboard.agents}
              providerOptions={dashboard.providerCatalog}
              selectedAgentId={filters.agentId}
              onCreateAgent={handleCreateAgent}
              onExposeAgent={handleExposeAgent}
              onRemoveAgent={handleRemoveAgent}
              onSelectAgent={(agentId) => {
                setFilters((current) => ({ ...current, agentId }));
              }}
              onUnexposeAgent={handleUnexposeAgent}
              onUpdateAgent={handleUpdateAgent}
            />
          </TabsContent>

          <TabsContent value="sessions" className="mt-0">
            <SessionsPanel
              agents={dashboard.agents}
              tasks={dashboard.tasks}
              sessions={filteredSessions}
              filters={filters}
              selectedSessionId={selectedSessionId}
              onFiltersChange={setFilters}
              onSelectSession={setSelectedSessionId}
            />
          </TabsContent>

          <TabsContent value="transcript" className="mt-0">
            <TranscriptPanel
              agents={dashboard.agents}
              tasks={dashboard.tasks}
              session={selectedSession}
              messages={messages}
              loading={messagesLoading}
              error={messageError}
              actionState={actionState}
              forkTitle={forkTitle}
              composerAgentId={draftAgentId}
              composerTaskGroupId={composerTaskGroupId}
              composerMessage={composerMessage}
              onForkTitleChange={setForkTitle}
              onComposerAgentChange={setComposerAgentId}
              onComposerTaskGroupChange={setComposerTaskGroupId}
              onComposerMessageChange={setComposerMessage}
              onStop={() => {
                void handleStop();
              }}
              onArchive={() => {
                void handleArchive();
              }}
              onFork={() => {
                void handleFork();
              }}
              onSendMessage={() => {
                void handleSendMessage();
              }}
            />
          </TabsContent>

          <TabsContent value="tasks" className="mt-0">
            <TasksPanel
              tasks={dashboard.tasks}
              onCreateTask={handleCreateTask}
              onArchiveTask={handleArchiveTask}
            />
          </TabsContent>

          <TabsContent value="exposure" className="mt-0">
            <ExposurePanel providers={dashboard.providers} />
          </TabsContent>

          <TabsContent value="logs" className="mt-0">
            <LogsPanel logs={dashboard.logs} path={dashboard.logPath} />
          </TabsContent>
        </>
      ) : null}
    </AppShell>
  );
}
