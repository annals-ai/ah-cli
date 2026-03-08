import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentMeshDaemonServer } from '../../packages/cli/src/daemon/server.js';
import { DaemonStore } from '../../packages/cli/src/daemon/store.js';

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<{ status: number; data: T }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    data: await response.json() as T,
  };
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

describe('AgentMeshDaemonServer UI', () => {
  let tempDir: string;
  let server: AgentMeshDaemonServer | null = null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agent-mesh-daemon-ui-'));
  });

  afterEach(async () => {
    await server?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('serves a local ui health endpoint', async () => {
    server = new AgentMeshDaemonServer({
      dbPath: join(tempDir, 'state.db'),
    });

    const address = await server.listenForTest();
    const response = await fetch(`${address.uiBaseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(address.uiPort).toBeGreaterThan(0);
  });

  it('routes daemon stop and restart actions through the local ui api', async () => {
    const stopHook = vi.fn();
    const restartHook = vi.fn();

    server = new AgentMeshDaemonServer({
      dbPath: join(tempDir, 'state.db'),
      uiControlHooks: {
        stop: stopHook,
        restart: restartHook,
      },
    });

    const address = await server.listenForTest();

    const stopped = await postJson<{ ok: boolean; action: string; uiBaseUrl: string | null }>(
      `${address.uiBaseUrl}/api/daemon/stop`,
      {},
    );
    const restarted = await postJson<{ ok: boolean; action: string; uiBaseUrl: string | null }>(
      `${address.uiBaseUrl}/api/daemon/restart`,
      {},
    );

    await Promise.resolve();

    expect(stopped.status).toBe(202);
    expect(stopped.data).toEqual({
      ok: true,
      action: 'stop',
      uiBaseUrl: address.uiBaseUrl,
    });
    expect(restarted.status).toBe(202);
    expect(restarted.data).toEqual({
      ok: true,
      action: 'restart',
      uiBaseUrl: address.uiBaseUrl,
    });
    expect(stopHook).toHaveBeenCalledTimes(1);
    expect(restartHook).toHaveBeenCalledTimes(1);
  });

  it('reuses the persisted ui port when the daemon starts again', async () => {
    const dbPath = join(tempDir, 'state.db');
    const preferredPort = await getFreePort();
    const store = new DaemonStore(dbPath);
    store.setDaemonSetting('ui.last_port', { value: preferredPort });
    store.close();

    server = new AgentMeshDaemonServer({ dbPath });
    const address = await server.listenForTest();

    expect(address.uiPort).toBe(preferredPort);
  });
});
