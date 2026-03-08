import { useState } from 'react';
import type { TaskRecord } from '../api';
import { Archive, Boxes, Link2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/lib/i18n';

interface TasksPanelProps {
  tasks: TaskRecord[];
  onCreateTask(title: string, source: string): Promise<void>;
  onArchiveTask(taskGroupId: string): Promise<void>;
}

export function TasksPanel({ tasks, onCreateTask, onArchiveTask }: TasksPanelProps) {
  const { t, formatDateTime } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('ui');
  const [creating, setCreating] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(): Promise<void> {
    if (!title.trim()) {
      setError(t('tasks.nameRequired'));
      return;
    }

    setCreating(true);
    setError(null);

    try {
      await onCreateTask(title.trim(), source.trim() || 'ui');
      setTitle('');
      setSource('ui');
      setCreateOpen(false);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleArchive(taskGroupId: string): Promise<void> {
    setPendingTaskId(taskGroupId);
    try {
      await onArchiveTask(taskGroupId);
    } finally {
      setPendingTaskId(null);
    }
  }

  return (
    <>
      <Card id="tasks">
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{t('shell.nav.tasks')}</p>
              <CardTitle>{t('tasks.title')}</CardTitle>
              <CardDescription>{t('tasks.description')}</CardDescription>
            </div>

            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t('tasks.createTask')}
            </Button>
          </div>
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
                  <TableHead className="text-right">{t('tasks.columns.actions')}</TableHead>
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
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleArchive(task.id)}
                        disabled={task.status === 'archived' || pendingTaskId === task.id}
                      >
                        <Archive className="size-4" />
                        {pendingTaskId === task.id ? t('tasks.archivingTask') : t('tasks.archiveTask')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tasks.createTitle')}</DialogTitle>
            <DialogDescription>{t('tasks.formDescription')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">
                {t('tasks.titleLabel')}
              </span>
              <Input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('tasks.titlePlaceholder')}
                disabled={creating}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">
                {t('tasks.sourceLabel')}
              </span>
              <Input
                type="text"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={t('tasks.sourcePlaceholder')}
                disabled={creating}
              />
            </label>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <DialogFooter showCloseButton>
            <Button type="button" onClick={() => void handleCreate()} disabled={creating}>
              {creating ? t('tasks.creatingTask') : t('tasks.createTask')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
