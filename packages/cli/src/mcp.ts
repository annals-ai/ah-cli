import { program } from 'commander';
import { startAgentMeshMcpServer } from './mcp/server.js';
import { validationError } from './mcp/errors.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3920;
const DEFAULT_PATH = '/mcp';

program
  .name('agent-mesh-mcp')
  .description('Official Agent Mesh MCP server')
  .option('--transport <transport>', 'Transport: stdio or http', 'stdio')
  .option('--host <host>', 'HTTP host (http transport only)', DEFAULT_HOST)
  .option('--port <port>', 'HTTP port (http transport only)', String(DEFAULT_PORT))
  .option('--path <path>', 'HTTP endpoint path (http transport only)', DEFAULT_PATH)
  .option('--bearer-token <token>', 'Optional Bearer token for HTTP auth')
  .action(async (opts: {
    transport: string;
    host: string;
    port: string;
    path: string;
    bearerToken?: string;
  }) => {
    try {
      const transport = parseTransport(opts.transport);
      const port = parsePort(opts.port);

      await startAgentMeshMcpServer({
        transport,
        host: opts.host,
        port,
        path: opts.path,
        bearerToken: opts.bearerToken ?? process.env.AGENT_MESH_MCP_BEARER_TOKEN,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[agent-mesh-mcp] ${message}\n`);
      process.exit(1);
    }
  });

program.parse();

function parseTransport(value: string): 'stdio' | 'http' {
  if (value === 'stdio' || value === 'http') return value;
  throw validationError('--transport must be one of: stdio, http');
}

function parsePort(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw validationError('--port must be a valid TCP port (1-65535).');
  }
  return parsed;
}
