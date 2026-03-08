import { getProvider, listProviders } from '../providers/index.js';
import type { DaemonRuntime } from './runtime.js';
import type { DaemonStore } from './store.js';
import type { CreateAgentInput, DaemonAgent, ProviderBinding, UpdateAgentInput } from './types.js';

interface AgentManagementContext {
  runtime: DaemonRuntime;
  store: DaemonStore;
}

function resolveAgentOrThrow(store: DaemonStore, ref: string): DaemonAgent {
  const agent = store.resolveAgentRef(ref);
  if (!agent) {
    throw new Error(`Local agent not found: ${ref}`);
  }
  return agent;
}

async function restartActiveBindings(context: AgentManagementContext, agent: DaemonAgent): Promise<void> {
  for (const binding of context.store.listProviderBindings(agent.id)) {
    if (binding.status === 'inactive') continue;
    const provider = getProvider(binding.provider);
    await provider.startIngress({ agent, binding, store: context.store, runtime: context.runtime });
  }
}

export function getProviderCatalog(): string[] {
  return listProviders();
}

export function createManagedAgent(context: AgentManagementContext, input: CreateAgentInput): DaemonAgent {
  return context.store.createAgent(input);
}

export async function updateManagedAgent(
  context: AgentManagementContext,
  ref: string,
  input: UpdateAgentInput,
): Promise<DaemonAgent> {
  const current = resolveAgentOrThrow(context.store, ref);
  const agent = context.store.updateAgent(current.id, input);
  await restartActiveBindings(context, agent);
  return agent;
}

export async function removeManagedAgent(
  context: AgentManagementContext,
  ref: string,
): Promise<{ ok: true; agentId: string }> {
  const agent = resolveAgentOrThrow(context.store, ref);
  for (const binding of context.store.listProviderBindings(agent.id)) {
    const provider = getProvider(binding.provider);
    await provider.stopIngress({ agent, binding, store: context.store, runtime: context.runtime });
  }
  context.store.removeAgent(agent.id);
  return { ok: true, agentId: agent.id };
}

export async function exposeManagedAgent(
  context: AgentManagementContext,
  ref: string,
  providerName: string,
  config: Record<string, unknown>,
): Promise<{ agent: DaemonAgent; binding: ProviderBinding }> {
  const agent = resolveAgentOrThrow(context.store, ref);
  const provider = getProvider(providerName);
  const current = context.store.getProviderBinding(agent.id, providerName);
  const result = current
    ? await provider.updateAgent({ agent, binding: current, store: context.store })
    : await provider.registerAgent({ agent, binding: current, store: context.store });

  const binding = context.store.upsertProviderBinding({
    agentId: agent.id,
    provider: providerName,
    remoteAgentId: result.remoteAgentId ?? current?.remoteAgentId ?? null,
    remoteSlug: result.remoteSlug ?? current?.remoteSlug ?? null,
    status: result.status,
    config: {
      ...(current?.config ?? {}),
      ...config,
      ...(result.config ?? {}),
    },
    lastSyncedAt: result.lastSyncedAt ?? new Date().toISOString(),
  });

  try {
    await provider.startIngress({ agent, binding, store: context.store, runtime: context.runtime });
  } catch (error) {
    const failed = context.store.upsertProviderBinding({
      agentId: agent.id,
      provider: providerName,
      remoteAgentId: binding.remoteAgentId,
      remoteSlug: binding.remoteSlug,
      status: 'error',
      config: binding.config,
      lastSyncedAt: new Date().toISOString(),
    });
    throw new Error(`${(error as Error).message} (binding status: ${failed.status})`);
  }

  return {
    agent,
    binding: context.store.getProviderBinding(agent.id, providerName) ?? binding,
  };
}

export async function unexposeManagedAgent(
  context: AgentManagementContext,
  ref: string,
  providerName: string,
): Promise<{ agent: DaemonAgent; binding: ProviderBinding }> {
  const agent = resolveAgentOrThrow(context.store, ref);
  const binding = context.store.getProviderBinding(agent.id, providerName);
  if (!binding) {
    throw new Error(`Provider binding not found: ${providerName}`);
  }

  const provider = getProvider(providerName);
  await provider.stopIngress({ agent, binding, store: context.store, runtime: context.runtime });
  await provider.unregisterAgent({ agent, binding, store: context.store });

  const nextBinding = context.store.upsertProviderBinding({
    agentId: agent.id,
    provider: providerName,
    remoteAgentId: binding.remoteAgentId,
    remoteSlug: binding.remoteSlug,
    status: 'inactive',
    config: binding.config,
    lastSyncedAt: new Date().toISOString(),
  });

  return { agent, binding: nextBinding };
}
