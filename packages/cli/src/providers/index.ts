import { BridgeManager } from '../bridge/manager.js';
import type { DaemonRuntime } from '../daemon/runtime.js';
import type { DaemonStore } from '../daemon/store.js';
import type { DaemonAgent, ProviderBinding, ProviderExposureResult } from '../daemon/types.js';
import { createClient } from '../platform/api-client.js';
import { loadToken } from '../platform/auth.js';
import { BridgeWSClient } from '../platform/ws-client.js';
import { log } from '../utils/logger.js';
import { DaemonBridgeAdapter } from './daemon-bridge-adapter.js';

const DEFAULT_BRIDGE_URL = 'wss://bridge.agents.hot/ws';

export interface ProviderContext {
  agent: DaemonAgent;
  binding: ProviderBinding;
  store: DaemonStore;
  runtime: DaemonRuntime;
}

export interface ProviderRuntime {
  readonly name: string;
  registerAgent(input: { agent: DaemonAgent; binding: ProviderBinding | null; store: DaemonStore }): Promise<ProviderExposureResult>;
  updateAgent(input: { agent: DaemonAgent; binding: ProviderBinding; store: DaemonStore }): Promise<ProviderExposureResult>;
  unregisterAgent(input: { agent: DaemonAgent; binding: ProviderBinding; store: DaemonStore }): Promise<void>;
  startIngress(input: ProviderContext): Promise<void>;
  stopIngress(input: ProviderContext): Promise<void>;
  deliverInboundRequest(): Promise<never>;
  syncSessionState(): Promise<void>;
  streamResponse(): Promise<never>;
  shutdown?(): Promise<void>;
}

interface AgentsHotIngressRuntime {
  wsClient: BridgeWSClient;
  manager: BridgeManager;
}

export function buildPlatformPayload(agent: DaemonAgent): Record<string, unknown> {
  return {
    name: agent.name,
    slug: agent.slug,
    description: agent.description || undefined,
    agent_type: agent.runtimeType,
    visibility: agent.visibility === 'unlisted' ? 'private' : agent.visibility,
    capabilities: agent.capabilities,
    is_published: true,
  };
}

function normalizeProviderConfig(config: Record<string, unknown>): Record<string, unknown> {
  return { ...config };
}

class AgentsHotProvider implements ProviderRuntime {
  readonly name = 'agents-hot';
  private readonly activeIngresses = new Map<string, AgentsHotIngressRuntime>();

  async registerAgent(input: { agent: DaemonAgent; binding: ProviderBinding | null }): Promise<ProviderExposureResult> {
    const client = createClient();
    const payload = buildPlatformPayload(input.agent);

    if (input.binding?.remoteAgentId) {
      const result = await client.put<{ agent: { id: string } }>(
        `/api/developer/agents/${input.binding.remoteAgentId}`,
        payload,
      );
      return {
        remoteAgentId: result.agent.id,
        remoteSlug: input.binding.remoteSlug,
        status: 'registered',
        lastSyncedAt: new Date().toISOString(),
      };
    }

    const result = await client.post<{ agent: { id: string } }>('/api/developer/agents', payload);
    await client.put<{ agent: { id: string } }>(
      `/api/developer/agents/${result.agent.id}`,
      payload,
    );
    return {
      remoteAgentId: result.agent.id,
      remoteSlug: input.agent.slug,
      status: 'registered',
      lastSyncedAt: new Date().toISOString(),
    };
  }

  async updateAgent(input: { agent: DaemonAgent; binding: ProviderBinding }): Promise<ProviderExposureResult> {
    if (!input.binding.remoteAgentId) {
      return this.registerAgent({ agent: input.agent, binding: input.binding });
    }

    const client = createClient();
    const payload = buildPlatformPayload(input.agent);
    const result = await client.put<{ agent: { id: string } }>(
      `/api/developer/agents/${input.binding.remoteAgentId}`,
      payload,
    );
    return {
      remoteAgentId: result.agent.id,
      remoteSlug: input.binding.remoteSlug,
      status: 'registered',
      lastSyncedAt: new Date().toISOString(),
    };
  }

  async unregisterAgent(): Promise<void> {
    // Keep the remote agent record intact for now; unexpose only stops local ingress.
  }

  async startIngress(input: ProviderContext): Promise<void> {
    const { agent, binding, store, runtime } = input;
    if (!binding.remoteAgentId) {
      throw new Error('agents-hot exposure requires a remote agent id');
    }

    const token = loadToken();
    if (!token) {
      throw new Error('Not authenticated. Run `agent-mesh login` before exposing agents-hot ingress.');
    }

    const existing = this.activeIngresses.get(agent.id);
    if (existing) {
      existing.manager.stop();
      existing.wsClient.close();
      this.activeIngresses.delete(agent.id);
    }

    const bridgeUrl = typeof binding.config.bridgeUrl === 'string'
      ? binding.config.bridgeUrl
      : DEFAULT_BRIDGE_URL;

    const wsClient = new BridgeWSClient({
      url: bridgeUrl,
      token,
      agentId: binding.remoteAgentId,
      agentType: agent.runtimeType,
      capabilities: agent.capabilities,
    });

    const adapter = new DaemonBridgeAdapter(agent, store, runtime);
    const manager = new BridgeManager({
      wsClient,
      adapter,
      adapterConfig: {
        project: agent.projectPath,
        sandboxEnabled: agent.sandbox,
        agentId: agent.id,
      },
    });

    manager.start();
    this.syncBinding(store, binding, 'connecting');

    try {
      await wsClient.connect();
    } catch (error) {
      manager.stop();
      wsClient.close();
      this.syncBinding(store, binding, 'error');
      throw error;
    }

    wsClient.on('disconnect', () => {
      this.syncBinding(store, binding, 'connecting');
    });

    wsClient.on('reconnect', () => {
      manager.reconnect();
      this.syncBinding(store, binding, 'online');
    });

    wsClient.on('replaced', () => {
      log.warn(`agents-hot ingress replaced for ${agent.slug}`);
      void this.stopIngress({ agent, binding, store, runtime }).finally(() => {
        this.syncBinding(store, binding, 'replaced');
      });
    });

    wsClient.on('token_revoked', () => {
      log.warn(`agents-hot ingress token revoked for ${agent.slug}`);
      void this.stopIngress({ agent, binding, store, runtime }).finally(() => {
        this.syncBinding(store, binding, 'auth_failed');
      });
    });

    this.activeIngresses.set(agent.id, { wsClient, manager });
    this.syncBinding(store, binding, 'online');
  }

  async stopIngress(input: ProviderContext): Promise<void> {
    const active = this.activeIngresses.get(input.agent.id);
    if (active) {
      active.manager.stop();
      active.wsClient.close();
      this.activeIngresses.delete(input.agent.id);
    }
  }

  async deliverInboundRequest(): Promise<never> {
    throw new Error('Agents Hot inbound delivery is managed by the live daemon ingress.');
  }

  async syncSessionState(): Promise<void> {
    // Session truth lives in the daemon store; platform only relays the daemon-owned id.
  }

  async streamResponse(): Promise<never> {
    throw new Error('Agents Hot streaming ingress is managed by the live daemon ingress.');
  }

  async shutdown(): Promise<void> {
    for (const [agentId, ingress] of this.activeIngresses.entries()) {
      ingress.manager.stop();
      ingress.wsClient.close();
      this.activeIngresses.delete(agentId);
    }
  }

  private syncBinding(store: DaemonStore, binding: ProviderBinding, status: string): void {
    store.upsertProviderBinding({
      agentId: binding.agentId,
      provider: binding.provider,
      remoteAgentId: binding.remoteAgentId,
      remoteSlug: binding.remoteSlug,
      status,
      config: normalizeProviderConfig(binding.config),
      lastSyncedAt: new Date().toISOString(),
    });
  }
}

class GenericA2AProvider implements ProviderRuntime {
  readonly name = 'generic-a2a';

  async registerAgent(input: { agent: DaemonAgent; binding: ProviderBinding | null }): Promise<ProviderExposureResult> {
    return {
      remoteAgentId: input.binding?.remoteAgentId ?? null,
      remoteSlug: input.binding?.remoteSlug ?? input.agent.slug,
      status: 'configured',
      config: input.binding?.config ?? {},
      lastSyncedAt: new Date().toISOString(),
    };
  }

  async updateAgent(input: { agent: DaemonAgent; binding: ProviderBinding }): Promise<ProviderExposureResult> {
    return {
      remoteAgentId: input.binding.remoteAgentId,
      remoteSlug: input.binding.remoteSlug ?? input.agent.slug,
      status: 'configured',
      config: input.binding.config,
      lastSyncedAt: new Date().toISOString(),
    };
  }

  async unregisterAgent(): Promise<void> {}
  async startIngress(): Promise<void> {}
  async stopIngress(): Promise<void> {}

  async deliverInboundRequest(): Promise<never> {
    throw new Error('Generic A2A inbound delivery is not wired into the daemon yet.');
  }

  async syncSessionState(): Promise<void> {}

  async streamResponse(): Promise<never> {
    throw new Error('Generic A2A streaming ingress is not wired into the daemon yet.');
  }
}

const PROVIDERS: Record<string, ProviderRuntime> = {
  'agents-hot': new AgentsHotProvider(),
  'generic-a2a': new GenericA2AProvider(),
};

export function getProvider(name: string): ProviderRuntime {
  const provider = PROVIDERS[name];
  if (!provider) {
    const supported = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown provider: ${name}. Supported: ${supported}`);
  }
  return provider;
}

export function listProviders(): string[] {
  return Object.keys(PROVIDERS);
}

export async function shutdownProviders(): Promise<void> {
  for (const provider of Object.values(PROVIDERS)) {
    await provider.shutdown?.();
  }
}
