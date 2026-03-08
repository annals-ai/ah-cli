import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentMeshDaemonServer } from '../../packages/cli/src/daemon/server.js';

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
});
