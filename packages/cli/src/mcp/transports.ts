import { createServer as createHttpServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { validationError } from './errors.js';

type ServerFactory = () => McpServer;
const LOCAL_BIND_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type HttpTransportOptions = {
  host: string;
  port: number;
  path: string;
  bearerToken?: string;
  createServer: ServerFactory;
  shutdownSignal?: AbortSignal;
};

export type HttpTransportRuntime = {
  url: string;
  waitForShutdown: () => Promise<void>;
  close: () => Promise<void>;
};

export async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[agent-mesh-mcp] stdio transport started\n');
}

export async function startHttpTransport(options: HttpTransportOptions): Promise<HttpTransportRuntime> {
  assertLocalHttpHost(options.host);

  const app = createMcpExpressApp({
    host: options.host,
    allowedHosts: buildAllowedHosts(options.host),
  });

  app.use((req, res, next) => {
    if (!isOriginAllowed(req.headers.origin, options.host, options.port)) {
      res.status(403).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Forbidden origin.',
        },
        id: null,
      });
      return;
    }

    if (!isAuthorized(req.headers.authorization, options.bearerToken)) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Unauthorized.',
        },
        id: null,
      });
      return;
    }

    next();
  });

  app.post(options.path, async (req, res) => {
    const server = options.createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      process.stderr.write(`[agent-mesh-mcp] HTTP request failed: ${(error as Error).message}\n`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error.',
          },
          id: null,
        });
      }
      await transport.close();
      await server.close();
    }
  });

  app.get(options.path, (req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  app.delete(options.path, (req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  const httpServer = createHttpServer(app);
  const url = `http://${options.host}:${options.port}${options.path}`;

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => {
      process.stderr.write(`[agent-mesh-mcp] HTTP transport listening on ${url}\n`);
      resolve();
    });
  });

  const shutdownPromise = waitForShutdown(httpServer, options.shutdownSignal);
  return {
    url,
    waitForShutdown: () => shutdownPromise,
    close: () => closeHttpServer(httpServer),
  };
}

function isAuthorized(authHeader: string | undefined, bearerToken: string | undefined): boolean {
  if (!bearerToken) return true;
  if (!authHeader) return false;
  return authHeader.trim() === `Bearer ${bearerToken}`;
}

function isOriginAllowed(origin: string | undefined, host: string, port: number): boolean {
  if (!origin) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const allowedHosts = new Set(buildAllowedHosts(host).map((item) => normalizeHost(item)));
  const originHost = normalizeHost(parsed.hostname);

  if (!allowedHosts.has(originHost)) return false;

  if (!parsed.port) return true;
  const originPort = Number.parseInt(parsed.port, 10);
  if (!Number.isFinite(originPort)) return false;

  return originPort === port;
}

function buildAllowedHosts(host: string): string[] {
  const normalized = normalizeHost(host);
  return Array.from(new Set([
    normalized,
    'localhost',
    '127.0.0.1',
    '::1',
    '[::1]',
  ]));
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

function assertLocalHttpHost(host: string): void {
  const normalized = normalizeHost(host);
  if (LOCAL_BIND_HOSTS.has(normalized)) {
    return;
  }

  throw validationError(
    `HTTP transport host must be localhost-only. Received "${host}".`,
    'Use --host 127.0.0.1 (default), localhost, or ::1.',
  );
}

async function closeHttpServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function waitForShutdown(server: ReturnType<typeof createHttpServer>, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      signal?.removeEventListener('abort', shutdown);
      resolve();
    };

    const shutdown = () => {
      server.close(() => {
        finish();
      });
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    signal?.addEventListener('abort', shutdown, { once: true });

    server.on('close', finish);
  });
}
