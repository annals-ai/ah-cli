import type { AgentRecord, SessionRecord, SessionStatus, TaskRecord } from '../api';
import { Funnel, History, Layers3 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { NativeSelect } from '@/components/ui/native-select';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';

interface SessionFilters {
  agentId: string;
  taskGroupId: string;
  status: SessionStatus | 'all';
}

interface SessionsPanelProps {
  agents: AgentRecord[];
  tasks: TaskRecord[];
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

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function SessionsPanel({
  agents,
  tasks,
  sessions,
  filters,
  selectedSessionId,
  onFiltersChange,
  onSelectSession,
}: SessionsPanelProps) {
  return (
    <Card id="sessions">
      <CardHeader>
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">Sessions</p>
        <CardTitle>Live desk</CardTitle>
        <CardDescription>Filter by agent, task group, or lifecycle state without losing your selected session.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-2">
            <span className="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em]">
              <Funnel className="size-3.5" />
              Agent
            </span>
            <NativeSelect
              value={filters.agentId}
              onChange={(event) => onFiltersChange({ ...filters, agentId: event.target.value })}
            >
              <option value="all">All agents</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
            </NativeSelect>
          </label>

          <label className="grid gap-2">
            <span className="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em]">
              <Layers3 className="size-3.5" />
              Task group
            </span>
            <NativeSelect
              value={filters.taskGroupId}
              onChange={(event) => onFiltersChange({ ...filters, taskGroupId: event.target.value })}
            >
              <option value="all">All task groups</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
            </NativeSelect>
          </label>

          <label className="grid gap-2">
            <span className="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em]">
              <History className="size-3.5" />
              Status
            </span>
            <NativeSelect
              value={filters.status}
              onChange={(event) => onFiltersChange({ ...filters, status: event.target.value as SessionFilters['status'] })}
            >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
            </NativeSelect>
          </label>
        </div>

        {sessions.length === 0 ? (
          <EmptyState
            title="No sessions match the current filters"
            description="Try another agent, task group, or lifecycle slice to reveal matching sessions."
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
                      <p className="font-medium">{session.title ?? 'Untitled session'}</p>
                      <p className="text-muted-foreground text-sm">{session.agent?.name ?? session.agentId}</p>
                    </div>
                    <StatusBadge value={session.status} />
                  </div>

                  <p className="mt-3 text-sm leading-6">{session.summary ?? `${session.origin} · ${session.principalType}`}</p>

                  <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-3 text-xs">
                    <span>{formatTimestamp(session.lastActiveAt)}</span>
                    <span>{session.taskGroupId ? 'Task linked' : 'Standalone'}</span>
                    <span>{session.tags.length} tags</span>
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
