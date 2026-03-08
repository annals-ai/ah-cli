import type { TaskRecord } from '../api';
import { Boxes, Link2 } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/lib/i18n';

export function TasksPanel({ tasks }: { tasks: TaskRecord[] }) {
  const { t, formatDateTime } = useI18n();

  return (
    <Card id="tasks">
      <CardHeader>
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{t('shell.nav.tasks')}</p>
        <CardTitle>{t('tasks.title')}</CardTitle>
        <CardDescription>{t('tasks.description')}</CardDescription>
      </CardHeader>

      <CardContent>
        {tasks.length === 0 ? (
          <EmptyState
            title={t('tasks.emptyTitle')}
            description={t('tasks.emptyDescription')}
            icon={<Boxes className="size-5" />}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('tasks.columns.taskGroup')}</TableHead>
                <TableHead>{t('tasks.columns.owner')}</TableHead>
                <TableHead>{t('tasks.columns.status')}</TableHead>
                <TableHead>{t('tasks.columns.sessions')}</TableHead>
                <TableHead>{t('tasks.columns.updated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <p className="font-medium">{task.title}</p>
                      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <Link2 className="size-3.5" />
                        {task.source}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{task.ownerPrincipal}</TableCell>
                  <TableCell>
                    <StatusBadge value={task.status} />
                  </TableCell>
                  <TableCell>{task.sessionCount}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(task.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
