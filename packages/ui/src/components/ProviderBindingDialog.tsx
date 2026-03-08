import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRecord, ProviderBinding } from '../api';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n';

export interface ProviderBindingDialogDraft {
  agentId?: string;
  provider?: string;
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

interface ProviderBindingDialogProps {
  agents: AgentRecord[];
  providers: string[];
  open: boolean;
  draft: ProviderBindingDialogDraft | null;
  allowAgentChange?: boolean;
  title?: string;
  description?: string;
  onOpenChange(open: boolean): void;
  onSubmit(agentRef: string, provider: string, config: Record<string, unknown>): Promise<void>;
}

export function ProviderBindingDialog({
  agents,
  providers,
  open,
  draft,
  allowAgentChange = true,
  title,
  description,
  onOpenChange,
  onSubmit,
}: ProviderBindingDialogProps) {
  const { t } = useI18n();
  const [agentId, setAgentId] = useState('');
  const [provider, setProvider] = useState('');
  const [configText, setConfigText] = useState('{}');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionKeyRef = useRef('');

  const selectedAgent = useMemo(
    () => agents.find((entry) => entry.id === agentId) ?? null,
    [agentId, agents],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextAgentId = draft?.agentId ?? agents[0]?.id ?? '';
    const nextAgent = agents.find((entry) => entry.id === nextAgentId) ?? null;
    const nextProvider = draft?.provider ?? nextAgent?.bindings[0]?.provider ?? providers[0] ?? '';

    setAgentId(nextAgentId);
    setProvider(nextProvider);
    selectionKeyRef.current = `${nextAgentId}:${nextProvider}`;
    setConfigText(
      providerConfigTemplate(
        nextProvider,
        nextAgent?.visibility ?? 'private',
        nextAgent?.bindings.find((binding) => binding.provider === nextProvider),
      ),
    );
    setError(null);
  }, [draft, open]);

  useEffect(() => {
    if (!open || !provider) {
      return;
    }

    const nextSelectionKey = `${agentId}:${provider}`;
    if (selectionKeyRef.current === nextSelectionKey) {
      return;
    }

    const nextAgent = agents.find((entry) => entry.id === agentId) ?? null;
    selectionKeyRef.current = nextSelectionKey;
    setConfigText(
      providerConfigTemplate(
        provider,
        nextAgent?.visibility ?? 'private',
        nextAgent?.bindings.find((binding) => binding.provider === provider),
      ),
    );
  }, [agentId, open, provider]);

  async function handleSubmit(): Promise<void> {
    if (!selectedAgent || !provider) {
      setError(selectedAgent ? t('agents.chooseProvider') : t('exposure.chooseAgent'));
      return;
    }

    let parsedConfig: Record<string, unknown>;
    try {
      const parsed = JSON.parse(configText || '{}') as unknown;
      parsedConfig = typeof parsed === 'object' && parsed ? parsed as Record<string, unknown> : {};
    } catch {
      setError(t('agents.invalidConfigJson'));
      return;
    }

    setPending(true);
    setError(null);

    try {
      await onSubmit(selectedAgent.id, provider, parsedConfig);
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
          <DialogTitle>{title ?? t('agents.exposeTitle')}</DialogTitle>
          <DialogDescription>{description ?? t('exposure.bindDescription')}</DialogDescription>
        </DialogHeader>

        {allowAgentChange ? (
          <label className="grid gap-2">
            <span className="text-sm font-medium">{t('common.agent')}</span>
            <NativeSelect value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={agents.length === 0}>
              {agents.length === 0 ? <option value="">{t('transcript.noAgentsAvailable')}</option> : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}

        <label className="grid gap-2">
          <span className="text-sm font-medium">{t('common.provider')}</span>
          <NativeSelect value={provider} onChange={(event) => setProvider(event.target.value)} disabled={providers.length === 0}>
            {providers.length === 0 ? <option value="">{t('common.noProvidersAvailable')}</option> : null}
            {providers.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </NativeSelect>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">{t('common.configJson')}</span>
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
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={pending || !selectedAgent || !provider}>
            {pending ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
