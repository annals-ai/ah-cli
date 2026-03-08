import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getDaemonUiDefaultPort, getDaemonUiHost } from '../daemon/paths.js';
import { loadUiAsset } from './assets.js';

export interface UiHttpRequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
}

export type UiHttpRequestHandler = (context: UiHttpRequestContext) => Promise<boolean> | boolean;

export interface UiHttpServerOptions {
  host?: string;
  preferredPort?: number;
  handleRequest?: UiHttpRequestHandler;
}

export interface UiHttpServerHandle {
  host: string;
  port: number;
  baseUrl: string;
  close(): Promise<void>;
}

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

async function bindServer(server: ReturnType<typeof createServer>, host: string, preferredPort: number): Promise<number> {
  try {
    return await new Promise<number>((resolve, reject) => {
      const handleError = (error: Error) => {
        server.off('listening', handleListening);
        reject(error);
      };
      const handleListening = () => {
        server.off('error', handleError);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to resolve local UI server address.'));
          return;
        }
        resolve((address as AddressInfo).port);
      };

      server.once('error', handleError);
      server.once('listening', handleListening);
      server.listen({ host, port: preferredPort });
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
      throw error;
    }

    return new Promise<number>((resolve, reject) => {
      const handleError = (listenError: Error) => {
        server.off('listening', handleListening);
        reject(listenError);
      };
      const handleListening = () => {
        server.off('error', handleError);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to resolve fallback local UI server address.'));
          return;
        }
        resolve((address as AddressInfo).port);
      };

      server.once('error', handleError);
      server.once('listening', handleListening);
      server.listen({ host, port: 0 });
    });
  }
}

export async function startUiHttpServer(options: UiHttpServerOptions = {}): Promise<UiHttpServerHandle> {
  const host = options.host ?? getDaemonUiHost();

  const server = createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${host}`);

    try {
      if (method === 'GET' && url.pathname === '/health') {
        writeJson(response, 200, { ok: true });
        return;
      }

      if (options.handleRequest) {
        const handled = await options.handleRequest({
          request,
          response,
          method,
          pathname: url.pathname,
          searchParams: url.searchParams,
        });
        if (handled) return;
      }

      if (method === 'GET' || method === 'HEAD') {
        const asset = loadUiAsset(url.pathname);
        if (asset) {
          response.statusCode = 200;
          response.setHeader('Content-Type', asset.contentType);
          response.setHeader('Cache-Control', asset.cacheControl);
          if (method === 'HEAD') {
            response.end();
            return;
          }
          response.end(asset.body);
          return;
        }
      }

      writeJson(response, 404, { error: 'not_found' });
    } catch (error) {
      writeJson(response, 500, {
        error: 'internal_error',
        message: (error as Error).message,
      });
    }
  });

  const port = await bindServer(server, host, options.preferredPort ?? getDaemonUiDefaultPort());

  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}
