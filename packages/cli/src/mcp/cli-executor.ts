import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  timeoutError,
  unsupportedInteractiveCommandError,
  validationError,
} from './errors.js';

export type OutputParseMode = 'none' | 'json' | 'jsonl' | 'auto';

export type CliExecutionOptions = {
  args: string[];
  timeoutMs?: number;
  cwd?: string;
  cliScriptPath?: string;
  parseMode?: OutputParseMode;
  env?: NodeJS.ProcessEnv;
};

export type CliExecutionResult = {
  command: string;
  args: string[];
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  parsed?: unknown;
};

const DEFAULT_TIMEOUT_MS = 120_000;

export function getDefaultCommandTimeoutMs(): number {
  const raw = process.env.AGENT_MESH_MCP_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return parsed;
}

export function commandRequiresAuth(args: string[]): boolean {
  if (args.length === 0) return false;
  const [cmd, sub] = args;

  if (['agents', 'call', 'chat', 'rate', 'files', 'profile', 'subscribe', 'unsubscribe', 'subscriptions', 'stats'].includes(cmd)) {
    return true;
  }

  if (cmd === 'skills') {
    if (!sub) return false;
    if (['publish', 'info', 'list', 'ls', 'unpublish', 'install', 'update'].includes(sub)) {
      return true;
    }
    if (sub === 'installed' && args.includes('--check-updates')) {
      return true;
    }
    return false;
  }

  if (cmd === 'connect') {
    return !args.includes('--setup');
  }

  return false;
}

export function validatePassthroughArgs(args: string[]): void {
  if (args.length === 0) {
    throw validationError('`args` is required and must include at least one CLI command token.');
  }

  const [cmd] = args;

  if (cmd === 'mcp') {
    throw unsupportedInteractiveCommandError(
      'Recursive MCP invocation is not allowed via passthrough.',
      'Call semantic tools directly, or invoke a non-MCP CLI command.',
    );
  }

  if (cmd === 'logs') {
    throw unsupportedInteractiveCommandError(
      '`agent-mesh logs` tails indefinitely and is blocked in MCP passthrough.',
      'Use `agent_mesh_list_local_agents` to inspect log path metadata, then read files explicitly if needed.',
    );
  }

  if (cmd === 'connect' && !args.includes('--setup')) {
    throw unsupportedInteractiveCommandError(
      '`agent-mesh connect` without `--setup` is long-running and blocked in passthrough.',
      'Use `agent_mesh_connect_setup` or run `agent-mesh connect` directly in a terminal.',
    );
  }

  if (cmd === 'remove' && !args.includes('--force')) {
    throw unsupportedInteractiveCommandError(
      '`agent-mesh remove` requires interactive confirmation unless `--force` is provided.',
      'Retry with `--force`.',
    );
  }

  if (cmd === 'chat') {
    const nonFlagArgs = args.slice(1).filter((arg) => !arg.startsWith('-'));
    if (nonFlagArgs.length < 2) {
      throw unsupportedInteractiveCommandError(
        '`agent-mesh chat` without an inline message enters interactive REPL and is blocked.',
        'Provide both `<agent>` and `[message]`, or use `agent_mesh_chat_agent`.',
      );
    }
  }
}

export async function executeCliCommand(options: CliExecutionOptions): Promise<CliExecutionResult> {
  const cliScriptPath = resolveCliScriptPath(options.cliScriptPath);
  const timeoutMs = options.timeoutMs ?? getDefaultCommandTimeoutMs();
  const command = buildCommandDisplay(options.args);

  return await new Promise<CliExecutionResult>((resolve) => {
    const child = spawn(process.execPath, [cliScriptPath, ...options.args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');

      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 1_000).unref();
    }, timeoutMs);

    child.on('close', (exitCode) => {
      clearTimeout(timeout);

      const parsed = parseOutput(stdout, options.parseMode ?? 'auto');

      resolve({
        command,
        args: options.args,
        exitCode,
        timedOut,
        stdout,
        stderr,
        ...(parsed !== undefined ? { parsed } : {}),
      });
    });
  });
}

export function assertExecutionSucceeded(result: CliExecutionResult): void {
  if (result.timedOut) {
    throw timeoutError(
      `Command timed out: ${result.command}`,
      'Increase `AGENT_MESH_MCP_TIMEOUT_MS` or use a smaller task scope.',
    );
  }

  if (result.exitCode !== 0) {
    const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    throw validationError(
      detail ? `Command failed: ${result.command}\n${detail}` : `Command failed: ${result.command}`,
    );
  }
}

function resolveCliScriptPath(input?: string): string {
  if (input) return input;

  const argvEntry = process.argv[1];
  if (!argvEntry) {
    throw validationError('Unable to resolve CLI entry path for MCP command execution.');
  }

  const name = basename(argvEntry);
  if (name === 'mcp.js') {
    const siblingIndex = join(dirname(argvEntry), 'index.js');
    if (existsSync(siblingIndex)) {
      return siblingIndex;
    }
  }

  return argvEntry;
}

function parseOutput(stdout: string, mode: OutputParseMode): unknown | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;

  if (mode === 'none') return undefined;

  if (mode === 'json') {
    return parseJson(trimmed);
  }

  if (mode === 'jsonl') {
    return parseJsonLines(trimmed);
  }

  const json = parseJson(trimmed);
  if (json !== undefined) return json;

  const jsonl = parseJsonLines(trimmed);
  if (jsonl.length > 0) return jsonl;

  return undefined;
}

function parseJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseJsonLines(raw: string): unknown[] {
  const events: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Keep JSONL parser tolerant for mixed output.
    }
  }
  return events;
}

function buildCommandDisplay(args: string[]): string {
  const escaped = args.map((arg) => {
    if (/^[a-zA-Z0-9._\/-]+$/.test(arg)) {
      return arg;
    }
    return JSON.stringify(arg);
  });

  return `agent-mesh ${escaped.join(' ')}`.trim();
}
