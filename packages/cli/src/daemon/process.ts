import { spawn } from 'node:child_process';
import {
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { getDaemonLogPath, getDaemonPidPath, getDaemonSocketPath, ensureDaemonDirs } from './paths.js';
import { isDaemonReachable, requestDaemon } from './client.js';

export interface DaemonRuntimeInfo {
  startedAt: string;
  uiBaseUrl: string | null;
  uiPort: number | null;
  agents: number;
  sessions: number;
  taskGroups: number;
  providerBindings: number;
  onlineBindings: number;
}

export interface DaemonStartResult {
  pid: number;
  alreadyRunning: boolean;
  runtime: DaemonRuntimeInfo | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readDaemonPid(): number | null {
  try {
    const raw = readFileSync(getDaemonPidPath(), 'utf-8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function writeDaemonPid(pid: number): void {
  writeFileSync(getDaemonPidPath(), `${pid}\n`, { mode: 0o600 });
}

export function removeDaemonPid(): void {
  try {
    unlinkSync(getDaemonPidPath());
  } catch {}
}

export function removeDaemonSocket(): void {
  try {
    unlinkSync(getDaemonSocketPath());
  } catch {}
}

export async function getDaemonRuntimeInfo(): Promise<DaemonRuntimeInfo | null> {
  if (!await isDaemonReachable()) {
    return null;
  }

  try {
    return await requestDaemon<DaemonRuntimeInfo>('daemon.status');
  } catch {
    return null;
  }
}

export async function startDaemonBackgroundWithInfo(): Promise<DaemonStartResult> {
  ensureDaemonDirs();

  const existingPid = readDaemonPid();
  if (existingPid && isProcessAlive(existingPid) && await isDaemonReachable()) {
    return {
      pid: existingPid,
      alreadyRunning: true,
      runtime: await getDaemonRuntimeInfo(),
    };
  }

  if (existingPid && !isProcessAlive(existingPid)) {
    removeDaemonPid();
  }

  removeDaemonSocket();

  const logFd = openSync(getDaemonLogPath(), 'a', 0o600);
  const child = spawn(process.execPath, [process.argv[1], 'daemon', 'serve'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  closeSync(logFd);

  writeDaemonPid(child.pid!);
  await waitForDaemonReady();
  return {
    pid: child.pid!,
    alreadyRunning: false,
    runtime: await getDaemonRuntimeInfo(),
  };
}

export async function startDaemonBackground(): Promise<number> {
  const result = await startDaemonBackgroundWithInfo();
  return result.pid;
}

export async function ensureDaemonRunningWithInfo(): Promise<DaemonStartResult> {
  const pid = readDaemonPid();
  if (pid && isProcessAlive(pid) && await isDaemonReachable()) {
    return {
      pid,
      alreadyRunning: true,
      runtime: await getDaemonRuntimeInfo(),
    };
  }

  return startDaemonBackgroundWithInfo();
}

export async function ensureDaemonRunning(): Promise<number> {
  const result = await ensureDaemonRunningWithInfo();
  return result.pid;
}

export async function stopDaemonBackground(): Promise<boolean> {
  const pid = readDaemonPid();
  if (!pid) {
    removeDaemonSocket();
    return false;
  }

  if (!isProcessAlive(pid)) {
    removeDaemonPid();
    removeDaemonSocket();
    return false;
  }

  process.kill(pid, 'SIGTERM');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(100);
    if (!isProcessAlive(pid)) {
      removeDaemonPid();
      removeDaemonSocket();
      return true;
    }
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {}

  removeDaemonPid();
  removeDaemonSocket();
  return true;
}

export function scheduleDaemonRestartFromCurrentProcess(): void {
  ensureDaemonDirs();

  const entryPath = process.argv[1];
  if (!entryPath) {
    throw new Error('Unable to determine the agent-mesh CLI entrypoint for restart.');
  }

  const logPath = getDaemonLogPath();
  const supervisorCode = `
const { spawn } = require('node:child_process');
const { closeSync, openSync, unlinkSync, writeFileSync, appendFileSync } = require('node:fs');

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const pid = Number(process.env.AGENT_MESH_TARGET_PID || '0');
  const logPath = process.env.AGENT_MESH_LOG_PATH;
  const pidPath = process.env.AGENT_MESH_PID_PATH;
  const socketPath = process.env.AGENT_MESH_SOCKET_PATH;
  const entryPath = process.env.AGENT_MESH_ENTRY_PATH;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isAlive(pid)) break;
    await sleep(100);
  }

  try { unlinkSync(pidPath); } catch {}
  try { unlinkSync(socketPath); } catch {}

  const logFd = openSync(logPath, 'a', 0o600);
  const child = spawn(process.execPath, [entryPath, 'daemon', 'serve'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  closeSync(logFd);
  writeFileSync(pidPath, String(child.pid) + '\\n', { mode: 0o600 });
})().catch((error) => {
  try {
    appendFileSync(process.env.AGENT_MESH_LOG_PATH, '[restart-supervisor] ' + String(error) + '\\n');
  } catch {}
});
`;

  const supervisor = spawn(process.execPath, ['-e', supervisorCode], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      AGENT_MESH_ENTRY_PATH: entryPath,
      AGENT_MESH_LOG_PATH: logPath,
      AGENT_MESH_PID_PATH: getDaemonPidPath(),
      AGENT_MESH_SOCKET_PATH: getDaemonSocketPath(),
      AGENT_MESH_TARGET_PID: String(process.pid),
    },
  });
  supervisor.unref();
}

export async function waitForDaemonReady(timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isDaemonReachable()) {
      return;
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for agent-mesh daemon to start.');
}

export async function getDaemonStatus(): Promise<{
  running: boolean;
  pid: number | null;
  socketPath: string;
  logPath: string;
  reachable: boolean;
}> {
  const pid = readDaemonPid();
  const reachable = await isDaemonReachable();
  return {
    running: !!pid && isProcessAlive(pid) && reachable,
    pid,
    socketPath: getDaemonSocketPath(),
    logPath: getDaemonLogPath(),
    reachable,
  };
}
