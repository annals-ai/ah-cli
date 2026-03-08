import { FileText } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useI18n } from '@/lib/i18n';

interface LogsPanelProps {
  logs: string[];
  path: string | null;
}

export function LogsPanel({ logs, path }: LogsPanelProps) {
  const { t } = useI18n();

  return (
    <Card id="logs">
      <CardHeader>
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{t('shell.nav.logs')}</p>
        <CardTitle>{t('logs.title')}</CardTitle>
        <CardDescription className="break-all">{path ?? t('logs.unavailable')}</CardDescription>
      </CardHeader>

      <CardContent>
        {logs.length === 0 ? (
          <EmptyState
            title={t('logs.emptyTitle')}
            description={t('logs.emptyDescription')}
            icon={<FileText className="size-5" />}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-zinc-950 px-4 py-3">
            <pre className="text-xs leading-6 whitespace-pre-wrap text-zinc-50">{logs.join('\n')}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
