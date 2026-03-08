import type { DaemonStatusResponse } from '../api';
import { Activity, Boxes, Cable, Clock3, Gauge, Globe2, Link2, Radar } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useI18n } from '@/lib/i18n';

interface OverviewPanelProps {
  status: DaemonStatusResponse;
}

function formatDuration(milliseconds: number, t: (path: string, params?: Record<string, string | number>) => string): string {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) {
    return t('overview.queueWindowMinutes', { count: minutes });
  }
  const hours = Math.round(minutes / 60);
  return t('overview.queueWindowHours', { count: hours });
}

export function OverviewPanel({ status }: OverviewPanelProps) {
  const { t } = useI18n();
  const runtimeMetrics = [
    {
      label: t('shell.nav.agents'),
      value: status.counts.agents,
      detail: t('overview.agentsDetail'),
    },
    {
      label: t('shell.nav.sessions'),
      value: status.counts.sessions,
      detail: t('overview.sessionsDetail'),
    },
    {
      label: t('tasks.columns.taskGroup'),
      value: status.counts.taskGroups,
      detail: t('overview.tasksDetail'),
    },
    {
      label: t('overview.bindingsLabel'),
      value: status.counts.providerBindings,
      detail: t('overview.bindingsDetail'),
    },
  ];

  return (
    <Card id="overview">
      <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{t('shell.nav.overview')}</p>
          <CardTitle className="text-2xl">{t('overview.title')}</CardTitle>
          <CardDescription>
            {t('overview.description')}
          </CardDescription>
        </div>

        <div className="grid min-w-0 gap-3 md:min-w-64">
          <div className="rounded-xl border bg-muted/35 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <Globe2 className="size-3.5" />
              {t('overview.uiEndpoint')}
            </div>
            <p className="text-sm font-medium">{t('overview.port', { port: status.daemon.uiPort ?? 'n/a' })}</p>
            <p className="text-muted-foreground break-all text-xs">{status.daemon.uiBaseUrl ?? t('common.offline')}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {runtimeMetrics.map((metric) => (
            <article key={metric.label} className="rounded-xl border bg-muted/25 p-4">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{metric.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight">{metric.value}</p>
              <p className="text-muted-foreground mt-2 text-sm leading-6">{metric.detail}</p>
            </article>
          ))}
        </div>

        <Separator />

        <div className="grid gap-4 md:grid-cols-3">
          <article className="rounded-xl border bg-background p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Gauge className="text-muted-foreground size-4" />
              {t('overview.queueLoad')}
            </div>
            <p className="text-2xl font-semibold tracking-tight">{t('overview.activeCount', { count: status.runtime.queue.active })}</p>
            <p className="text-muted-foreground mt-1 text-sm">{t('overview.queuedCount', { count: status.runtime.queue.queued })}</p>
          </article>

          <article className="rounded-xl border bg-background p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Radar className="text-muted-foreground size-4" />
              {t('overview.managedSessions')}
            </div>
            <p className="text-2xl font-semibold tracking-tight">{status.runtime.managedSessions}</p>
            <p className="text-muted-foreground mt-1 text-sm">{t('overview.streamingCount', { count: status.runtime.activeExecutions })}</p>
          </article>

          <article className="rounded-xl border bg-background p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Clock3 className="text-muted-foreground size-4" />
              {t('overview.concurrencyBudget')}
            </div>
            <p className="text-2xl font-semibold tracking-tight">{status.runtime.queue.config.maxActiveRequests}</p>
            <p className="text-muted-foreground mt-1 text-sm">{formatDuration(status.runtime.queue.config.queueWaitTimeoutMs, t)}</p>
          </article>
        </div>

        <div className="grid gap-3 rounded-xl border bg-muted/25 p-4 md:grid-cols-4">
          <div className="flex items-center gap-2 text-sm">
            <Boxes className="text-muted-foreground size-4" />
            <span>{t('overview.trackedAgents', { count: status.counts.agents })}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Cable className="text-muted-foreground size-4" />
            <span>{t('overview.providerBindings', { count: status.counts.providerBindings })}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Activity className="text-muted-foreground size-4" />
            <span>{t('overview.activeExecutions', { count: status.runtime.activeExecutions })}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link2 className="text-muted-foreground size-4" />
            <span>{t('overview.taskGroups', { count: status.counts.taskGroups })}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
