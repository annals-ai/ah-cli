import type { AgentRecord, SessionRecord, SessionStatus } from '../api';
import { Funnel, History } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { NativeSelect } from '@/components/ui/native-select';
import { StatusBadge } from '@/components/ui/status-badge';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface SessionFilters {
  agentId: string;
  status: SessionStatus | 'all';
}

interface SessionsPanelProps {
  agents: AgentRecord[];
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

export function SessionsPanel({
  agents,
  sessions,
  filters,
  selectedSessionId,
  onFiltersChange,
  onSelectSession,
}: SessionsPanelProps) {
  const { t, formatDateTime } = useI18n();

  return (
    <Card id="sessions">
      <CardHeader>
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{t('shell.nav.sessions')}</p>
        <CardTitle>{t('sessions.title')}</CardTitle>
        <CardDescription>{t('sessions.description')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em]">
              <Funnel className="size-3.5" />
              {t('sessions.agentFilter')}
            </span>
            <NativeSelect
              value={filters.agentId}
              onChange={(event) => onFiltersChange({ ...filters, agentId: event.target.value })}
            >
              <option value="all">{t('sessions.allAgents')}</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
            </NativeSelect>
          </label>

          <label className="grid gap-2">
            <span className="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em]">
              <History className="size-3.5" />
              {t('sessions.statusFilter')}
            </span>
            <NativeSelect
              value={filters.status}
              onChange={(event) => onFiltersChange({ ...filters, status: event.target.value as SessionFilters['status'] })}
            >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
            </NativeSelect>
          </label>
        </div>

        {sessions.length === 0 ? (
          <EmptyState
            title={t('sessions.emptyTitle')}
            description={t('sessions.emptyDescription')}
          />
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => {
              const active = selectedSessionId === session.id;

              return (
                <button
                  key={session.id}
                  type="button"
                  className={cn(
                    'w-full rounded-xl border p-4 text-left transition-colors',
                    active ? 'border-primary bg-accent/40 shadow-sm' : 'bg-background hover:bg-accent/35',
                  )}
                  onClick={() => onSelectSession(session.id)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{session.title ?? t('sessions.untitled')}</p>
                      <p className="text-muted-foreground text-sm">{session.agent?.name ?? session.agentId}</p>
                    </div>
                    <StatusBadge value={session.status} />
                  </div>

                  <p className="mt-3 text-sm leading-6">{session.summary ?? `${session.origin} · ${session.principalType}`}</p>

                  <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-3 text-xs">
                    <span>{formatDateTime(session.lastActiveAt)}</span>
                    <span>{t('sessions.tagsCount', { count: session.tags.length })}</span>
                  </div>

                  {session.tags.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {session.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="rounded-full font-normal">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
