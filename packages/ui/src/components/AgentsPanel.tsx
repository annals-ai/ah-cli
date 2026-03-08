import { useEffect, useState } from 'react';
import type { AgentMutationInput, AgentRecord, ProviderBinding } from '../api';
import { Bot, FolderTree, Lock, Pencil, PlugZap, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
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

interface ProviderDialogState {
  agent: AgentRecord;
  provider?: string;
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

function providerConfigTemplate(provider: string, visibility: AgentRecord['visibility'], current?: ProviderBinding): string {
  if (current) {
    return JSON.stringify(current.config, null, 2);
  }

  if (provider === 'generic-a2a') {
    return JSON.stringify(
      visibility === 'public'
        ? {}
        : {
            bearerToken: 'change-me',
          },
      null,
      2,
    );
  }

  if (provider === 'agents-hot') {
    return JSON.stringify(
      {
        bridgeUrl: 'wss://bridge.agents.hot/ws',
      },
      null,
      2,
    );
  }

  return '{}';
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
      setError('Name and project path are required.');
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
          <DialogTitle>{agent ? 'Edit agent' : 'Create agent'}</DialogTitle>
          <DialogDescription>Register a local daemon-owned agent or update its runtime metadata.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm font-medium">Name</span>
            <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Slug</span>
            <Input
              value={form.slug}
              onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
              placeholder="optional"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Runtime</span>
            <Input
              value={form.runtimeType}
              onChange={(event) => setForm((current) => ({ ...current, runtimeType: event.target.value }))}
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Visibility</span>
            <NativeSelect
              value={form.visibility}
              onChange={(event) =>
                setForm((current) => ({ ...current, visibility: event.target.value as AgentMutationInput['visibility'] }))
              }
            >
              <option value="public">public</option>
              <option value="private">private</option>
              <option value="unlisted">unlisted</option>
            </NativeSelect>
          </label>
        </div>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Project path</span>
          <Input
            value={form.projectPath}
            onChange={(event) => setForm((current) => ({ ...current, projectPath: event.target.value }))}
            placeholder="/absolute/path/to/project"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Capabilities</span>
          <Input
            value={form.capabilitiesText}
            onChange={(event) => setForm((current) => ({ ...current, capabilitiesText: event.target.value }))}
            placeholder="search, code, review"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Description</span>
          <Textarea
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="What this local agent is responsible for..."
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
          Enable sandbox / workspace isolation for this agent
        </label>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={pending}>
            {pending ? (agent ? 'Saving...' : 'Creating...') : agent ? 'Save changes' : 'Create agent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderBindingDialog({
  state,
  open,
  providers,
  onOpenChange,
  onSubmit,
}: {
  state: ProviderDialogState | null;
  open: boolean;
  providers: string[];
  onOpenChange(open: boolean): void;
  onSubmit(agentRef: string, provider: string, config: Record<string, unknown>): Promise<void>;
}) {
  const [provider, setProvider] = useState('');
  const [configText, setConfigText] = useState('{}');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !state) return;
    const nextProvider = state.provider ?? state.agent.bindings[0]?.provider ?? providers[0] ?? '';
    setProvider(nextProvider);
    setConfigText(providerConfigTemplate(nextProvider, state.agent.visibility, state.agent.bindings.find((binding) => binding.provider === nextProvider)));
    setError(null);
  }, [open, providers, state]);

  useEffect(() => {
    if (!open || !state || !provider) return;
    setConfigText(providerConfigTemplate(provider, state.agent.visibility, state.agent.bindings.find((binding) => binding.provider === provider)));
  }, [open, provider, state]);

  async function handleSubmit(): Promise<void> {
    if (!state || !provider) {
      setError('Choose a provider.');
      return;
    }

    let parsedConfig: Record<string, unknown>;
    try {
      const parsed = JSON.parse(configText || '{}') as unknown;
      parsedConfig = typeof parsed === 'object' && parsed ? parsed as Record<string, unknown> : {};
    } catch {
      setError('Config JSON is invalid.');
      return;
    }

    setPending(true);
    setError(null);

    try {
      await onSubmit(state.agent.id, provider, parsedConfig);
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
          <DialogTitle>Expose provider</DialogTitle>
          <DialogDescription>
            Connect {state?.agent.name ?? 'this agent'} to a local or remote provider binding.
          </DialogDescription>
        </DialogHeader>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Provider</span>
          <NativeSelect value={provider} onChange={(event) => setProvider(event.target.value)} disabled={providers.length === 0}>
            {providers.length === 0 ? <option value="">No providers available</option> : null}
              {providers.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
          </NativeSelect>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Config JSON</span>
          <Textarea
            value={configText}
            onChange={(event) => setConfigText(event.target.value)}
            className="min-h-56 font-mono text-xs"
            spellCheck={false}
          />
        </label>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={pending || !provider}>
            {pending ? 'Saving...' : 'Save binding'}
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
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentRecord | null>(null);
  const [providerState, setProviderState] = useState<ProviderDialogState | null>(null);

  async function handleAgentSubmit(ref: string | null, input: AgentMutationInput): Promise<void> {
    if (ref) {
      await onUpdateAgent(ref, input);
      return;
    }
    await onCreateAgent(input);
  }

  async function handleRemove(ref: string, name: string): Promise<void> {
    if (!window.confirm(`Remove agent "${name}"?`)) {
      return;
    }
    await onRemoveAgent(ref);
    if (selectedAgentId === ref) {
      onSelectAgent('all');
    }
  }

  async function handleUnexpose(ref: string, provider: string): Promise<void> {
    if (!window.confirm(`Disable ${provider} for this agent?`)) {
      return;
    }
    await onUnexposeAgent(ref, provider);
  }

  return (
    <>
      <Card id="agents" className="h-full">
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.16em]">Agents</p>
            <CardTitle>Runtime roster</CardTitle>
            <CardDescription>
              Monitor local agents, filter their sessions, and manage provider bindings without leaving the console.
            </CardDescription>
          </div>

          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Create agent
          </Button>
        </CardHeader>

        <CardContent>
          {agents.length === 0 ? (
            <EmptyState
              title="No local agents registered"
              description="Create the first agent here, then use provider bindings when you are ready to expose it."
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
                          {agent.sessionCount} sessions
                        </Badge>
                      </div>
                    </div>

                    <p className="mt-3 text-sm leading-6">{agent.description ?? agent.projectPath}</p>

                    <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-3 text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck className="size-3.5" />
                        {agent.sandbox ? 'Sandbox on' : 'Sandbox off'}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <FolderTree className="size-3.5" />
                        {agent.projectPath}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Lock className="size-3.5" />
                        {agent.bindings.length} provider bindings
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
                        {active ? 'Showing sessions' : 'Filter sessions'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingAgent(agent)}>
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setProviderState({ agent })}
                      >
                        <PlugZap className="size-4" />
                        Expose
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void handleRemove(agent.id, agent.name)}>
                        <Trash2 className="size-4" />
                        Remove
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
                                {binding.remoteSlug ?? binding.remoteAgentId ?? 'Local only'}
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setProviderState({ agent, provider: binding.provider })}
                              >
                                Configure
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void handleUnexpose(agent.id, binding.provider)}
                                disabled={binding.status === 'inactive'}
                              >
                                Disable
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-muted-foreground text-xs">No provider exposure configured yet.</p>
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
        state={providerState}
        open={Boolean(providerState)}
        providers={providerOptions}
        onOpenChange={(open) => {
          if (!open) setProviderState(null);
        }}
        onSubmit={onExposeAgent}
      />
    </>
  );
}
