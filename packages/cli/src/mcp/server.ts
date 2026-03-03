import { basename, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAgentMeshTools } from './tool-registry.js';
import { getDefaultCommandTimeoutMs } from './cli-executor.js';
import { startHttpTransport, startStdioTransport } from './transports.js';

export type AgentMeshMcpServeOptions = {
  transport: 'stdio' | 'http';
  host: string;
  port: number;
  path: string;
  bearerToken?: string;
  cliScriptPath?: string;
  timeoutMs?: number;
  baseUrl?: string;
};

export function createAgentMeshMcpServer(options: {
  cliScriptPath?: string;
  timeoutMs?: number;
  baseUrl?: string;
} = {}): McpServer {
  const server = new McpServer({
    name: 'agent-mesh-mcp-server',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
  });

  registerAgentMeshTools(server, {
    cliScriptPath: options.cliScriptPath,
    timeoutMs: options.timeoutMs,
    baseUrl: options.baseUrl,
  });

  return server;
}

export async function startAgentMeshMcpServer(options: AgentMeshMcpServeOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? getDefaultCommandTimeoutMs();
  const cliScriptPath = resolveCliScriptPath(options.cliScriptPath);

  if (options.transport === 'stdio') {
    const server = createAgentMeshMcpServer({ cliScriptPath, timeoutMs, baseUrl: options.baseUrl });
    await startStdioTransport(server);
    return;
  }

  const runtime = await startHttpTransport({
    host: options.host,
    port: options.port,
    path: options.path,
    bearerToken: options.bearerToken,
    createServer: () => createAgentMeshMcpServer({ cliScriptPath, timeoutMs, baseUrl: options.baseUrl }),
  });
  await runtime.waitForShutdown();
}

function resolveCliScriptPath(input?: string): string {
  if (input) return input;

  const currentEntry = process.argv[1];
  if (!currentEntry) {
    return '';
  }

  if (basename(currentEntry) === 'mcp.js') {
    const siblingIndex = join(dirname(currentEntry), 'index.js');
    if (existsSync(siblingIndex)) {
      return siblingIndex;
    }
  }

  return currentEntry;
}
