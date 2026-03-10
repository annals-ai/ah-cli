import { randomUUID } from 'node:crypto';
import { createInterface, type Interface } from 'node:readline';
import { Socket, createConnection } from 'node:net';
import type { DaemonEnvelope, DaemonRequest } from './protocol.js';
import { getDaemonSocketPath } from './paths.js';

export async function isDaemonReachable(socketPath = getDaemonSocketPath()): Promise<boolean> {
  try {
    await requestDaemon('ping', {}, { socketPath, timeoutMs: 750 });
    return true;
  } catch {
    return false;
  }
}

export async function requestDaemon<T>(
  method: string,
  params: Record<string, unknown> = {},
  options: {
    socketPath?: string;
    timeoutMs?: number;
    onEvent?: (event: unknown) => void;
  } = {},
): Promise<T> {
  const socketPath = options.socketPath ?? getDaemonSocketPath();
  const requestId = randomUUID();
  const request: DaemonRequest = {
    id: requestId,
    method,
    params,
  };

  return new Promise<T>((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let rl: Interface | null = null;
    let settled = false;
    const timeoutMs = options.timeoutMs ?? (method.startsWith('runtime.') ? 10 * 60_000 : 30_000);
    let timeout: ReturnType<typeof setTimeout>;
    const armTimeout = (): void => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        settled = true;
        rl?.close();
        socket.destroy();
        reject(new Error(`Timed out waiting for daemon response (${method})`));
      }, timeoutMs);
    };
    armTimeout();

    const closeWithError = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rl?.close();
      closeSocketQuietly(socket);
      reject(error);
    };

    socket.once('error', (error) => {
      closeWithError(new Error(`Failed to connect to agent-network daemon: ${error.message}`));
    });

    socket.once('connect', () => {
      rl = createInterface({ input: socket });
      rl.on('line', (line) => {
        let envelope: DaemonEnvelope;
        try {
          envelope = JSON.parse(line) as DaemonEnvelope;
        } catch {
          return;
        }

        if (envelope.id !== requestId) return;

        if (envelope.type === 'event') {
          armTimeout(); // Reset timeout on any event (including keepalive)
          options.onEvent?.(envelope.event);
          return;
        }

        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        rl?.close();
        closeSocketQuietly(socket);

        if (envelope.type === 'error') {
          reject(new Error(envelope.error.message));
          return;
        }

        resolve(envelope.result as T);
      });

      socket.write(JSON.stringify(request) + '\n');
    });

    socket.once('close', (hadError) => {
      if (settled || hadError) return;
      settled = true;
      clearTimeout(timeout);
      rl?.close();
      reject(new Error(`Daemon connection closed before responding to ${method}`));
    });
  });
}

export async function streamDaemon<T>(
  method: string,
  params: Record<string, unknown>,
  onEvent: (event: unknown) => void,
  options: { socketPath?: string; timeoutMs?: number } = {},
): Promise<T> {
  return requestDaemon<T>(method, params, {
    ...options,
    onEvent,
  });
}

export function closeSocketQuietly(socket: Socket): void {
  try {
    socket.end();
  } catch {}
  try {
    socket.destroy();
  } catch {}
}
