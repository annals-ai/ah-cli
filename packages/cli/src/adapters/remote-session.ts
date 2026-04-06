import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  AgentAdapter,
  type AdapterConfig,
  type SessionHandle,
  type ToolEvent,
  type SessionDonePayload,
} from './base.js';
import type { CliProfile, OutputParser, ParsedEvent } from './profiles.js';
import { log } from '../utils/logger.js';

const DEFAULT_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Remote CLI session that executes Claude Code on a remote host via SSH.
 * Reuses the same CliProfile/OutputParser as local sessions — only the
 * transport layer changes (ssh instead of direct spawn).
 */
class RemoteCliSession implements SessionHandle {
  private chunkCallbacks: ((delta: string) => void)[] = [];
  private toolCallbacks: ((event: ToolEvent) => void)[] = [];
  private doneCallbacks: ((payload?: SessionDonePayload) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];
  private process: ChildProcess | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private doneFired = false;
  private parser: OutputParser;

  /** Claude Code session ID for --resume across messages */
  private claudeSessionId: string | undefined;

  constructor(
    private sessionId: string,
    private config: AdapterConfig,
    private profile: CliProfile,
    private remoteHost: string,
  ) {
    this.parser = profile.createParser();
    this.claudeSessionId = config.resumeSessionId;
  }

  send(message: string): void {
    this.resetIdleTimer();
    this.doneFired = false;

    const args = this.profile.buildArgs(message, this.claudeSessionId);
    const remoteCmd = [this.profile.command, ...args]
      .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
      .join(' ');

    // Build ssh command: ssh <host> "cd <projectPath> && <remoteCmd>"
    const cdAndRun = `cd '${this.config.project ?? '/tmp'}' && ${remoteCmd}`;
    const sshArgs = [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      this.remoteHost,
      cdAndRun,
    ];

    log.debug(`Remote exec: ssh ${this.remoteHost} "${cdAndRun}"`);

    const child = spawn('ssh', sshArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.process = child;

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      const event = this.parser.parseLine(line);
      if (!event) return;
      this.handleParsedEvent(event);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) log.debug(`Remote stderr: ${text}`);
    });

    child.on('close', (code) => {
      this.process = null;
      if (!this.doneFired) {
        this.doneFired = true;
        if (code !== 0 && code !== null) {
          for (const cb of this.errorCallbacks) cb(new Error(`Remote process exited with code ${code}`));
        } else {
          for (const cb of this.doneCallbacks) cb();
        }
      }
    });

    child.on('error', (error) => {
      this.process = null;
      if (!this.doneFired) {
        this.doneFired = true;
        for (const cb of this.errorCallbacks) cb(error);
      }
    });
  }

  private handleParsedEvent(event: ParsedEvent): void {
    switch (event.type) {
      case 'init':
        this.claudeSessionId = event.sessionId;
        break;
      case 'chunk':
        for (const cb of this.chunkCallbacks) cb(event.text);
        break;
      case 'tool':
        for (const cb of this.toolCallbacks) cb(event.event);
        break;
      case 'done':
        if (!this.doneFired) {
          this.doneFired = true;
          for (const cb of this.doneCallbacks) cb(event.attachments ? { attachments: event.attachments } : undefined);
        }
        break;
      case 'error':
        if (!this.doneFired) {
          this.doneFired = true;
          for (const cb of this.errorCallbacks) cb(new Error(event.message));
        }
        break;
    }
  }

  onChunk(cb: (delta: string) => void): void { this.chunkCallbacks.push(cb); }
  onToolEvent(cb: (event: ToolEvent) => void): void { this.toolCallbacks.push(cb); }
  onDone(cb: (payload?: SessionDonePayload) => void): void { this.doneCallbacks.push(cb); }
  onError(cb: (error: Error) => void): void { this.errorCallbacks.push(cb); }

  getResumeSessionId(): string | undefined {
    return this.claudeSessionId;
  }

  kill(): void {
    this.clearIdleTimer();
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      log.debug(`Remote session ${this.sessionId} idle timeout — killing`);
      this.kill();
    }, DEFAULT_IDLE_TIMEOUT);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

/**
 * Adapter for running Claude Code on a remote host via SSH.
 */
export class RemoteCliAdapter extends AgentAdapter {
  readonly type: string;
  readonly displayName: string;
  private sessions = new Map<string, RemoteCliSession>();

  constructor(
    private profile: CliProfile,
    private remoteHost: string,
    private defaultConfig: Partial<AdapterConfig> = {},
  ) {
    super();
    this.type = `remote:${profile.command}`;
    this.displayName = `Remote ${profile.displayName} (${remoteHost})`;
  }

  async isAvailable(): Promise<boolean> {
    // Check SSH connectivity with a quick test
    return new Promise((resolve) => {
      const child = spawn('ssh', [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=5',
        this.remoteHost,
        'echo ok',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let ok = false;
      child.stdout?.on('data', (data: Buffer) => {
        if (data.toString().trim() === 'ok') ok = true;
      });
      child.on('close', () => resolve(ok));
      child.on('error', () => resolve(false));
    });
  }

  createSession(id: string, config: AdapterConfig): SessionHandle {
    const merged = { ...this.defaultConfig, ...config };
    const session = new RemoteCliSession(id, merged, this.profile, this.remoteHost);
    this.sessions.set(id, session);
    return session;
  }

  destroySession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.kill();
      this.sessions.delete(id);
    }
  }
}
