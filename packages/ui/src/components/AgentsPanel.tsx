import { useEffect, useState } from 'react';
import type { AgentMutationInput, AgentRecord } from '../api';
import { Bot, FolderTree, Lock, Pencil, PlugZap, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ProviderBindingDialog } from '@/components/ProviderBindingDialog';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface AgentsPanelProps {
  agents: AgentRecord[];
  providerOptions: string[];
  selectedAgentId: string;
  onCreateAgent(input: AgentMutationInput): Promise<void>;
  onUpdateAgent(ref: string, input: Partial<AgentMutationInput>): Promise<void>;
  onRemoveAgent(ref: string): Promise<void>;
  onExposeAgent(ref: string, provider: string, config: Record<string, unknown>): Promise<void>;
  onUnexposeAgent(ref: string, provider: string): Promise<void>;
  onSelectAgent(agentId: string): void;
}

interface AgentFormState {
  slug: string;
  name: string;
  runtimeType: string;
  projectPath: string;
  sandbox: boolean;
  description: string;
  capabilitiesText: string;
  visibility: AgentMutationInput['visibility'];
}

const DEFAULT_AGENT_FORM: AgentFormState = {
  slug: '',
  name: '',
  runtimeType: 'claude',
  projectPath: '',
  sandbox: false,
  description: '',
  capabilitiesText: '',
  visibility: 'private',
};

function formStateFromAgent(agent?: AgentRecord): AgentFormState {
  if (!agent) {
    return DEFAULT_AGENT_FORM;
  }

  return {
    slug: agent.slug,
    name: agent.name,
    runtimeType: agent.runtimeType,
    projectPath: agent.projectPath,
    sandbox: agent.sandbox,
    description: agent.description ?? '',
    capabilitiesText: agent.capabilities.join(', '),
    visibility: agent.visibility,
  };
}

function parseCapabilities(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function AgentFormDialog({
  agent,
  open,
  onOpenChange,
  onSubmit,
}: {
  agent?: AgentRecord;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSubmit(ref: string | null, input: AgentMutationInput): Promise<void>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<AgentFormState>(DEFAULT_AGENT_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(formStateFromAgent(agent));
    setError(null);
  }, [agent, open]);

  async function handleSubmit(): Promise<void> {
    if (!form.name.trim() || !form.projectPath.trim()) {
      setError(t('agents.nameRequired'));
      return;
    }

    setPending(true);
    setError(null);

    try {
      await onSubmit(agent?.id ?? null, {
        slug: form.slug.trim() || undefined,
        name: form.name.trim(),
        runtimeType: form.runtimeType.trim() || 'claude',
        projectPath: form.projectPath.trim(),
        sandbox: form.sandbox,
        description: form.description.trim(),
        capabilities: parseCapabilities(form.capabilitiesText),
        visibility: form.visibility,
      });
      onOpenChange(false);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{agent ? t('agents.editTitle') : t('agents.createTitle')}</DialogTitle>
          <DialogDescription>{t('agents.formDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm font-medium">{t('common.name')}</span>
            <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium">{t('common.slug')}</span>
            <Input
              value={form.slug}
              onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
              placeholder={t('agents.slugPlaceholder')}
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium">{t('common.runtime')}</span>
            <Input
              value={form.runtimeType}
              onChange={(event) => setForm((current) => ({ ...current, runtimeType: event.target.value }))}
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium">{t('common.visibility')}</span>
            <NativeSelect
              value={form.visibility}
              onChange={(event) =>
                setForm((current) => ({ ...current, visibility: event.target.value as AgentMutationInput['visibility'] }))
              }
            >
              <option value="public">{t('status.public')}</option>
              <option value="private">{t('status.private')}</option>
              <option value="unlisted">{t('status.unlisted')}</option>
            </NativeSelect>
          </label>
        </div>

        <label className="grid gap-2">
          <span className="text-sm font-medium">{t('common.projectPath')}</span>
          <Input
            value={form.projectPath}
            onChange={(event) => setForm((current) => ({ ...current, projectPath: event.target.value }))}
            placeholder={t('agents.projectPathPlaceholder')}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">{t('common.capabilities')}</span>
          <Input
            value={form.capabilitiesText}
            onChange={(event) => setForm((current) => ({ ...current, capabilitiesText: event.target.value }))}
            placeholder={t('agents.capabilitiesPlaceholder')}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">{t('common.description')}</span>
          <Textarea
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            placeholder={t('agents.descriptionPlaceholder')}
            className="min-h-24"
          />
        </label>

        <label className="flex items-center gap-3 rounded-xl border bg-muted/25 px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={form.sandbox}
            onChange={(event) => setForm((current) => ({ ...current, sandbox: event.target.checked }))}
            className="size-4"
          />
          {t('agents.sandboxLabel')}
        </label>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={pending}>
            {pending ? (agent ? t('common.saving') : t('common.creatingAgent')) : agent ? t('common.saveChanges') : t('common.createAgent')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentsPanel({
  agents,
  providerOptions,
  selectedAgentId,
  onCreateAgent,
  onUpdateAgent,
  onRemoveAgent,
  onExposeAgent,
  onUnexposeAgent,
  onSelectAgent,
}: AgentsPanelProps) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentRecord | null>(null);
  const [providerState, setProviderState] = useState<{ agentId: string; provider?: string } | null>(null);

  async function handleAgentSubmit(ref: string | null, input: AgentMutationInput): Promise<void> {
    if (ref) {
      await onUpdateAgent(ref, input);
      return;
    }
    await onCreateAgent(input);
  }

  async function handleRemove(ref: string, name: string): Promise<void> {
    if (!window.confirm(t('agents.removeConfirm', { name }))) {
      return;
    }
    await onRemoveAgent(ref);
    if (selectedAgentId === ref) {
      onSelectAgent('all');
    }
  }

  async function handleUnexpose(ref: string, provider: string): Promise<void> {
    if (!window.confirm(t('agents.disableConfirm', { provider }))) {
      return;
    }
    await onUnexposeAgent(ref, provider);
  }

  return (
    <>
      <Card id="agents" className="h-full">
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">{t('shell.nav.agents')}</p>
            <CardTitle>{t('agents.title')}</CardTitle>
            <CardDescription>
              {t('agents.description')}
            </CardDescription>
          </div>

          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t('common.createAgent')}
          </Button>
        </CardHeader>

        <CardContent>
          {agents.length === 0 ? (
            <EmptyState
              title={t('agents.emptyTitle')}
              description={t('common.createFirstAgent')}
              icon={<Bot className="size-5" />}
            />
          ) : (
            <div className="space-y-3">
              {agents.map((agent) => {
                const active = selectedAgentId === agent.id;

                return (
                  <article
                    key={agent.id}
                    className={cn(
                      'rounded-xl border p-4 transition-colors',
                      active ? 'border-primary bg-accent/40 shadow-sm' : 'bg-background',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{agent.name}</p>
                          <StatusBadge value={agent.visibility} />
                        </div>
                        <p className="text-muted-foreground text-sm">@{agent.slug}</p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="rounded-full">
                          {agent.runtimeType}
                        </Badge>
                        <Badge variant="outline" className="rounded-full">
                          {t('common.sessionsCount', { count: agent.sessionCount })}
                        </Badge>
                      </div>
                    </div>

                    <p className="mt-3 text-sm leading-6">{agent.description ?? agent.projectPath}</p>

                    <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-3 text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck className="size-3.5" />
                        {agent.sandbox ? t('common.sandboxOn') : t('common.sandboxOff')}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <FolderTree className="size-3.5" />
                        {agent.projectPath}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Lock className="size-3.5" />
                        {t('common.providerBindings', { count: agent.bindings.length })}
                      </span>
                    </div>

                    {agent.capabilities.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {agent.capabilities.slice(0, 6).map((capability) => (
                          <Badge key={capability} variant="outline" className="rounded-full font-normal">
                            {capability}
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        onClick={() => onSelectAgent(active ? 'all' : agent.id)}
                      >
                        {active ? t('common.showingSessions') : t('common.filterSessions')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingAgent(agent)}>
                        <Pencil className="size-4" />
                        {t('common.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setProviderState({ agentId: agent.id })}
                      >
                        <PlugZap className="size-4" />
                        {t('common.expose')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void handleRemove(agent.id, agent.name)}>
                        <Trash2 className="size-4" />
                        {t('common.remove')}
                      </Button>
                    </div>

                    <div className="mt-4 space-y-2">
                      {agent.bindings.length > 0 ? (
                        agent.bindings.map((binding) => (
                          <div
                            key={binding.id}
                            className="flex flex-col gap-2 rounded-lg border bg-muted/20 px-3 py-3 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium">{binding.provider}</p>
                                <StatusBadge value={binding.status} />
                              </div>
                              <p className="text-muted-foreground text-xs">
                                {binding.remoteSlug ?? binding.remoteAgentId ?? t('common.localOnly')}
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setProviderState({ agentId: agent.id, provider: binding.provider })}
                              >
                                {t('common.configure')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void handleUnexpose(agent.id, binding.provider)}
                                disabled={binding.status === 'inactive'}
                              >
                                {t('common.disable')}
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-muted-foreground text-xs">{t('common.noProviderExposure')}</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AgentFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleAgentSubmit}
      />

      <AgentFormDialog
        agent={editingAgent ?? undefined}
        open={Boolean(editingAgent)}
        onOpenChange={(open) => {
          if (!open) setEditingAgent(null);
        }}
        onSubmit={handleAgentSubmit}
      />

      <ProviderBindingDialog
        open={Boolean(providerState)}
        draft={providerState}
        agents={agents}
        providers={providerOptions}
        allowAgentChange={false}
        description={
          providerState
            ? t('agents.exposeDescription', {
                agent: agents.find((agent) => agent.id === providerState.agentId)?.name ?? t('common.agent'),
              })
            : undefined
        }
        onOpenChange={(open) => {
          if (!open) setProviderState(null);
        }}
        onSubmit={onExposeAgent}
      />
    </>
  );
}
