import type { ReactNode } from 'react';
import { Activity, Globe2, RefreshCw, Server } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { useI18n, type LanguagePreference } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface AppShellProps {
  uiBaseUrl: string | null;
  startedAt: string;
  refreshing: boolean;
  onRefresh(): void;
  children: ReactNode;
}

export function AppShell({ uiBaseUrl, startedAt, refreshing, onRefresh, children }: AppShellProps) {
  const { language, setLanguage, t, formatDateTime } = useI18n();
  const navItems = [
    { id: 'overview', label: t('shell.nav.overview') },
    { id: 'agents', label: t('shell.nav.agents') },
    { id: 'sessions', label: t('shell.nav.sessions') },
    { id: 'transcript', label: t('shell.nav.transcript') },
    { id: 'tasks', label: t('shell.nav.tasks') },
    { id: 'exposure', label: t('shell.nav.exposure') },
    { id: 'logs', label: t('shell.nav.logs') },
  ];

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto grid w-full max-w-[1680px] gap-6 px-4 py-4 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:px-6 lg:py-6">
        <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <Card className="h-full overflow-hidden">
            <CardContent className="flex h-full flex-col gap-6 p-5">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  <Activity className="size-3.5" />
                  {t('shell.localConsole')}
                </div>

                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight">Agent Mesh</h1>
                  <p className="text-muted-foreground text-sm leading-6">
                    {t('shell.description')}
                  </p>
                </div>
              </div>

              <div className="grid gap-2">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">
                  {t('common.language')}
                </span>
                <NativeSelect
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as LanguagePreference)}
                  aria-label={t('common.language')}
                >
                  <option value="system">{t('common.auto')}</option>
                  <option value="en">{t('common.english')}</option>
                  <option value="zh">{t('common.chinese')}</option>
                </NativeSelect>
              </div>

              <nav aria-label="Sections" className="grid gap-1">
                {navItems.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors"
                  >
                    <span>{item.label}</span>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">{t('common.jump')}</span>
                  </a>
                ))}
              </nav>

              <Button className="mt-auto w-full justify-center gap-2" onClick={onRefresh} disabled={refreshing}>
                <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
                {refreshing ? t('common.refreshingSnapshot') : t('common.refreshSnapshot')}
              </Button>

              <div className="grid gap-3">
                <div className="rounded-xl border bg-muted/35 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    <Globe2 className="size-3.5" />
                    {t('shell.uiOrigin')}
                  </div>
                  <p className="break-all text-sm font-medium">{uiBaseUrl ?? t('common.offline')}</p>
                </div>

                <div className="rounded-xl border bg-muted/35 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    <Server className="size-3.5" />
                    {t('shell.daemonStart')}
                  </div>
                  <p className="text-sm font-medium">{formatDateTime(startedAt)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>

        <main className="flex min-w-0 flex-col gap-6">{children}</main>
      </div>
    </div>
  );
}
