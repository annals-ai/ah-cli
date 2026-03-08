import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT_DIR = join(homedir(), '.agent-mesh');
const DAEMON_DIR = join(ROOT_DIR, 'daemon');
const LOG_DIR = join(DAEMON_DIR, 'logs');
const DAEMON_UI_HOST = '127.0.0.1';
const DAEMON_UI_DEFAULT_PORT = 4848;

function ensureDir(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  return path;
}

export function ensureDaemonDirs(): void {
  ensureDir(ROOT_DIR);
  ensureDir(DAEMON_DIR);
  ensureDir(LOG_DIR);
}

export function getAgentMeshRootDir(): string {
  ensureDaemonDirs();
  return ROOT_DIR;
}

export function getDaemonRootDir(): string {
  ensureDaemonDirs();
  return DAEMON_DIR;
}

export function getDaemonDbPath(): string {
  ensureDaemonDirs();
  return join(DAEMON_DIR, 'state.db');
}

export function getDaemonSocketPath(): string {
  ensureDaemonDirs();
  return join(DAEMON_DIR, 'daemon.sock');
}

export function getDaemonPidPath(): string {
  ensureDaemonDirs();
  return join(DAEMON_DIR, 'daemon.pid');
}

export function getDaemonLogPath(): string {
  ensureDaemonDirs();
  return join(LOG_DIR, 'daemon.log');
}

export function getDaemonUiHost(): string {
  return DAEMON_UI_HOST;
}

export function getDaemonUiDefaultPort(): number {
  return DAEMON_UI_DEFAULT_PORT;
}
