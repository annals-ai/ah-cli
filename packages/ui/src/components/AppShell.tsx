import type { ReactNode } from 'react';
import { Activity, Globe2, Power, RefreshCw, RotateCcw, Server } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n, type LanguagePreference } from '@/lib/i18n';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface AppShellProps {
  activeTab: string;
  uiBaseUrl: string | null;
  startedAt: string;
  refreshing: boolean;
  daemonActionState: 'stop' | 'restart' | null;
  onTabChange(tabId: string): void;
  onRefresh(): void;
  onStopDaemon(): void;
  onRestartDaemon(): void;
  children: ReactNode;
}

export function AppShell({
  activeTab,
  uiBaseUrl,
  startedAt,
  refreshing,
  daemonActionState,
  onTabChange,
  onRefresh,
  onStopDaemon,
  onRestartDaemon,
  children,
}: AppShellProps) {
  const { language, setLanguage, t, formatDateTime } = useI18n();
  const { theme, setTheme } = useTheme();
  const navItems = [
    { id: 'overview', label: t('shell.nav.overview') },
    { id: 'agents', label: t('shell.nav.agents') },
    { id: 'sessions', label: t('shell.nav.sessions') },
    { id: 'transcript', label: t('shell.nav.transcript') },
    { id: 'exposure', label: t('shell.nav.exposure') },
    { id: 'logs', label: t('shell.nav.logs') },
  ];

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="min-h-screen bg-muted/30">
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
                  <h1 className="text-3xl font-semibold tracking-tight">ah-cli</h1>
                  <p className="text-muted-foreground text-sm leading-6">
                    {t('shell.description')}
                  </p>
                </div>
              </div>

              <div className="grid gap-4">
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

                <div className="grid gap-2">
                  <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">
                    {t('common.theme')}
                  </span>
                  <NativeSelect
                    value={theme}
                    onChange={(event) => setTheme(event.target.value as ThemePreference)}
                    aria-label={t('common.theme')}
                  >
                    <option value="system">{t('common.system')}</option>
                    <option value="light">{t('common.light')}</option>
                    <option value="dark">{t('common.dark')}</option>
                  </NativeSelect>
                </div>
              </div>

              <div className="mt-auto grid gap-2">
                <Button className="w-full justify-center gap-2" onClick={onRefresh} disabled={refreshing || daemonActionState !== null}>
                  <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
                  {refreshing ? t('common.refreshingSnapshot') : t('common.refreshSnapshot')}
                </Button>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-center gap-2"
                    onClick={onRestartDaemon}
                    disabled={daemonActionState !== null}
                  >
                    <RotateCcw className={cn('size-4', daemonActionState === 'restart' && 'animate-spin')} />
                    {daemonActionState === 'restart' ? t('shell.restartingDaemon') : t('shell.restartDaemon')}
                  </Button>

                  <Button
                    type="button"
                    variant="destructive"
                    className="justify-center gap-2"
                    onClick={onStopDaemon}
                    disabled={daemonActionState !== null}
                  >
                    <Power className="size-4" />
                    {daemonActionState === 'stop' ? t('shell.stoppingDaemon') : t('shell.stopDaemon')}
                  </Button>
                </div>
              </div>

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

        <main className="flex min-w-0 flex-col gap-6">
          <div className="overflow-hidden rounded-2xl border bg-background/90 p-2 shadow-xs">
            <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto bg-transparent p-0">
              {navItems.map((item) => (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  className="min-w-fit rounded-xl border border-transparent px-4 py-2"
                >
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {children}
        </main>
      </div>
    </Tabs>
  );
}
