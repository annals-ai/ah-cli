import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentMeshMcpServer } from '../../packages/cli/src/mcp/server.js';
import { startHttpTransport } from '../../packages/cli/src/mcp/transports.js';

const TEST_PROTOCOL_VERSION = '2025-11-25';

describe('Agent Mesh MCP Server', () => {
  let originalToken: string | undefined;

  beforeEach(() => {
    originalToken = process.env.AGENT_MESH_TOKEN;
    // Force "not logged in" regardless of local config token.
    process.env.AGENT_MESH_TOKEN = ' ';
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.AGENT_MESH_TOKEN;
      return;
    }
    process.env.AGENT_MESH_TOKEN = originalToken;
  });

  it('exposes only agent_mesh_* tools and includes annotations', async () => {
    const harness = await createInMemoryHarness();
    try {
      const listed = await harness.client.listTools();
      expect(listed.tools.length).toBeGreaterThan(0);

      for (const tool of listed.tools) {
        expect(tool.name.startsWith('agent_mesh_')).toBe(true);
        expect(tool.annotations).toBeDefined();
        expect(typeof tool.annotations?.readOnlyHint).toBe('boolean');
        expect(typeof tool.annotations?.destructiveHint).toBe('boolean');
        expect(typeof tool.annotations?.idempotentHint).toBe('boolean');
        expect(typeof tool.annotations?.openWorldHint).toBe('boolean');
      }
    } finally {
      await harness.close();
    }
  });

  it('supports anonymous discover but returns unauthorized for call tool', async () => {
    const api = await startMockApiServer();
    const harness = await createInMemoryHarness(api.baseUrl);

    try {
      const discover = await harness.client.callTool({
        name: 'agent_mesh_discover_agents',
        arguments: { limit: 1, offset: 0 },
      }) as { structuredContent?: Record<string, any> };

      const discoverPayload = discover.structuredContent ?? {};
      expect(discoverPayload.ok).toBe(true);
      expect(discoverPayload.pagination?.has_more).toBe(true);
      expect(discoverPayload.pagination?.next_offset).toBe(1);
      expect(discoverPayload.pagination?.total_count).toBe(2);

      const unauthorized = await harness.client.callTool({
        name: 'agent_mesh_call_agent',
        arguments: { agent: 'demo-agent', task: 'ping', stream: false },
      }) as { structuredContent?: Record<string, any> };

      const unauthorizedPayload = unauthorized.structuredContent ?? {};
      expect(unauthorizedPayload.ok).toBe(false);
      expect(unauthorizedPayload.error?.code).toBe('unauthorized');
      expect(unauthorizedPayload.auth_required).toBe(true);
      expect(String(unauthorizedPayload.suggestion ?? '')).toContain('agent-mesh login');
    } finally {
      await harness.close();
      await api.close();
    }
  });

  it('blocks interactive passthrough commands quickly', async () => {
    const harness = await createInMemoryHarness();
    try {
      const result = await harness.client.callTool({
        name: 'agent_mesh_cli_passthrough',
        arguments: { args: ['logs'] },
      }) as { structuredContent?: Record<string, any> };

      const payload = result.structuredContent ?? {};
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe('unsupported_interactive_command');
      expect(String(payload.suggestion ?? '')).toContain('agent_mesh_list_local_agents');
    } finally {
      await harness.close();
    }
  });

  it('handles stdio initialize -> list_tools -> call_tool', async () => {
    const server = createAgentMeshMcpServer();
    const input = new PassThrough();
    const output = new PassThrough();
    const transport = new StdioServerTransport(input, output);
    await server.connect(transport);

    const stdio = createStdioRpcPeer(input, output);

    try {
      stdio.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: TEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'vitest-stdio', version: '1.0.0' },
        },
      });

      const init = await stdio.waitForResponse(1);
      expect(init.result?.serverInfo?.name).toBe('agent-mesh-mcp-server');

      stdio.send({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      });

      stdio.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });
      const listed = await stdio.waitForResponse(2);
      expect(Array.isArray(listed.result?.tools)).toBe(true);
      expect((listed.result?.tools ?? []).length).toBeGreaterThan(0);

      stdio.send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'agent_mesh_list_local_agents',
          arguments: {},
        },
      });
      const called = await stdio.waitForResponse(3);
      expect(called.result?.structuredContent?.ok).toBe(true);
    } finally {
      await server.close();
      input.end();
      output.end();
    }
  });

  it('supports HTTP handshake with bearer auth and rejects unauthenticated requests', async () => {
    const port = await getFreePort();
    const runtime = await startHttpTransport({
      host: '127.0.0.1',
      port,
      path: '/mcp',
      bearerToken: 'test-secret',
      createServer: () => createAgentMeshMcpServer(),
    });

    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: TEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'raw-http', version: '1.0.0' },
      },
    };

    try {
      const unauthorized = await fetch(runtime.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(initRequest),
      });
      expect(unauthorized.status).toBe(401);

      const client = new Client({
        name: 'vitest-http',
        version: '1.0.0',
      });

      const clientTransport = new StreamableHTTPClientTransport(new URL(runtime.url), {
        requestInit: {
          headers: {
            Authorization: 'Bearer test-secret',
          },
        },
      });

      await client.connect(clientTransport);

      const listed = await client.listTools();
      expect(listed.tools.length).toBeGreaterThan(0);

      const called = await client.callTool({
        name: 'agent_mesh_list_local_agents',
        arguments: {},
      }) as { structuredContent?: Record<string, any> };
      expect(called.structuredContent?.ok).toBe(true);

      await client.close();
    } finally {
      await runtime.close();
      await runtime.waitForShutdown();
    }
  });

  it('rejects non-local HTTP bind hosts', async () => {
    await expect(startHttpTransport({
      host: '0.0.0.0',
      port: 3921,
      path: '/mcp',
      createServer: () => createAgentMeshMcpServer(),
    })).rejects.toThrow(/localhost-only/i);
  });
});

async function createInMemoryHarness(baseUrl?: string): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const server = createAgentMeshMcpServer(
    baseUrl
      ? { baseUrl }
      : {},
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({
    name: 'vitest-inmemory',
    version: '1.0.0',
  });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

type MockApiServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

async function startMockApiServer(): Promise<MockApiServer> {
  const server = createHttpServer((req, res) => {
    handleMockApiRequest(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock API server failed to bind to a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function handleMockApiRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/api/agents/discover') {
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
    const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);

    const agents = [
      { id: 'ag_1', name: 'Alpha Agent', capabilities: ['code'] },
      { id: 'ag_2', name: 'Beta Agent', capabilities: ['seo'] },
    ];
    const sliced = agents.slice(offset, offset + limit);

    const payload = {
      agents: sliced,
      total: agents.length,
      limit,
      offset,
    };

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'not_found' }));
}

function createStdioRpcPeer(input: PassThrough, output: PassThrough): {
  send: (payload: Record<string, unknown>) => void;
  waitForResponse: (id: number) => Promise<Record<string, any>>;
} {
  let buffer = '';
  const queue: Array<Record<string, any>> = [];
  let waiter: ((message: Record<string, any>) => void) | null = null;

  const flush = (message: Record<string, any>) => {
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(message);
      return;
    }
    queue.push(message);
  };

  output.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;

      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);

      if (!line) continue;
      flush(JSON.parse(line) as Record<string, any>);
    }
  });

  const send = (payload: Record<string, unknown>) => {
    input.write(`${JSON.stringify(payload)}\n`);
  };

  const nextMessage = async (): Promise<Record<string, any>> => {
    if (queue.length > 0) {
      return queue.shift() as Record<string, any>;
    }

    return await new Promise<Record<string, any>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (waiter === onMessage) {
          waiter = null;
        }
        reject(new Error('Timed out waiting for stdio response frame.'));
      }, 2_000);

      const onMessage = (message: Record<string, any>) => {
        clearTimeout(timeout);
        resolve(message);
      };

      waiter = onMessage;
    });
  };

  const waitForResponse = async (id: number): Promise<Record<string, any>> => {
    // Responses can interleave with notifications; keep reading until id matches.
    while (true) {
      const message = await nextMessage();
      if (message.id === id) {
        return message;
      }
    }
  };

  return { send, waitForResponse };
}

async function getFreePort(): Promise<number> {
  const server = createHttpServer((_, res) => {
    res.statusCode = 200;
    res.end('ok');
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to allocate an ephemeral port.');
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  return address.port;
}
