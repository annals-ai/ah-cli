import type { Command } from 'commander';
import { createInterface } from 'node:readline';
import { ensureDaemonRunning } from '../daemon/process.js';
import { requestDaemon } from '../daemon/client.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, RED, RESET, YELLOW, renderTable, type Column } from '../utils/table.js';
import { parseTagFlags, runLocalChat } from './local-runtime.js';

export function registerSessionCommand(program: Command): void {
  const session = program
    .command('session')
    .description('Inspect and manage local sessions');

  session
    .command('list')
    .description('List local sessions')
    .option('--agent <ref>', 'Filter by agent')
    .option('--task-group <id>', 'Filter by task group')
    .option('--status <status>', 'queued|active|idle|paused|completed|failed|archived|all', 'all')
    .option('--json', 'Output JSON')
    .action(async (opts: { agent?: string; taskGroup?: string; status: string; json?: boolean }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{ sessions: Array<{
        id: string;
        title: string | null;
        status: string;
        lastActiveAt: string;
        agentId: string;
        agentName?: string;
      }> }>('session.list', {
        agentRef: opts.agent,
        taskGroupId: opts.taskGroup,
        status: opts.status,
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.sessions.length === 0) {
        log.info('No sessions found.');
        return;
      }

      // Define status color mapping with symbols
      const statusConfig: Record<string, { color: string; symbol: string }> = {
        running: { color: GREEN, symbol: '●' },
        active: { color: GREEN, symbol: '●' },
        idle: { color: GRAY, symbol: '○' },
        paused: { color: YELLOW, symbol: '◐' },
        failed: { color: RED, symbol: '✗' },
        completed: { color: GRAY, symbol: '✓' },
        archived: { color: GRAY, symbol: '◇' },
        queued: { color: GRAY, symbol: '○' },
      };

      // Truncate helper
      const truncate = (str: string, maxLen: number): string => {
        if (!str) return '';
        return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
      };

      // Format relative time
      const formatRelativeTime = (dateStr: string): string => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m`;
        if (diffHours < 24) return `${diffHours}h`;
        return `${diffDays}d`;
      };

      // Define table columns
      const columns: Column[] = [
        { key: 'id', label: 'ID', width: 9 },
        { key: 'agent', label: 'Agent', width: 9 },
        { key: 'status', label: 'Status', width: 10 },
        { key: 'active', label: 'Active', width: 9 },
        { key: 'title', label: 'Title', width: 50 },
      ];

      // Format rows
      const rows = result.sessions.map((s) => {
        const config = statusConfig[s.status] || { color: GRAY, symbol: '○' };
        return {
          id: s.id.slice(0, 8),
          agent: s.agentName || s.agentId?.slice(0, 8) || '-',
          status: `${config.color}${config.symbol} ${s.status}${RESET}`,
          active: formatRelativeTime(s.lastActiveAt),
          title: truncate(s.title || '(no title)', 47),
        };
      });

      console.log(renderTable(columns, rows));

      // Print summary
      const statusCounts: Record<string, number> = {};
      for (const s of result.sessions) {
        statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
      }
      const summary = Object.entries(statusCounts)
        .map(([status, count]) => {
          const config = statusConfig[status] || { color: GRAY, symbol: '○' };
          return `${config.color}${config.symbol}${RESET} ${count} ${status}`;
        })
        .join('  ');
      console.log(`\n${GRAY}Total: ${result.sessions.length} sessions${RESET}  ${summary}`);
    });

  session
    .command('show <id>')
    .description('Show one session and its messages')
    .option('--json', 'Output JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon('session.show', { id });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(JSON.stringify(result, null, 2));
    });

  session
    .command('attach <id> [message]')
    .description('Attach to an existing local session; send a message when provided')
    .option('--json', 'Output JSON')
    .action(async (id: string, message: string | undefined, opts: { json?: boolean }) => {
      await ensureDaemonRunning();
      if (!message) {
        const result = await requestDaemon('session.attach', { id });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      await runLocalChat({
        sessionId: id,
        message,
        json: opts.json,
      });
    });

  session
    .command('fork <id>')
    .description('Fork a session into a new local branch session')
    .option('--task-group <id>', 'Bind the new session to a task group')
    .option('--title <title>', 'Title for the new session')
    .option('--tag <tag...>', 'Add tags to the forked session')
    .action(async (id: string, opts: { taskGroup?: string; title?: string; tag?: string[] }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{ session: { id: string; title: string | null } }>('session.fork', {
        id,
        taskGroupId: opts.taskGroup,
        title: opts.title,
        tags: parseTagFlags(opts.tag),
      });
      log.success(`Forked session: ${BOLD}${result.session.title || result.session.id}${RESET}`);
      console.log(`  ${GRAY}${result.session.id}${RESET}`);
    });

  session
    .command('stop <id>')
    .description('Stop the active work for a session')
    .action(async (id: string) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{ session: { status: string } }>('session.stop', { id });
      log.success(`Session updated: ${result.session.status}`);
    });

  session
    .command('archive <id>')
    .description('Archive a session')
    .action(async (id: string) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{ session: { id: string; status: string } }>('session.archive', { id });
      log.success(`Session archived: ${result.session.id}`);
      console.log(`  ${GRAY}status${RESET} ${result.session.status}`);
    });

  // --- Session restore: list recent sessions and optionally resume one ---
  session
    .command('restore [id]')
    .description('Restore a recent session to continue chatting (lists recent sessions if no id provided)')
    .option('--limit <number>', 'Number of recent sessions to show', '10')
    .action(async (id: string | undefined, opts: { limit?: string }) => {
      await ensureDaemonRunning();

      const limit = parseInt(opts.limit ?? '10', 10);

      // If session ID provided directly, restore it
      if (id) {
        const sessionInfo = await requestDaemon<{
          session: { id: string; title: string | null; status: string; lastActiveAt: string };
        }>('session.show', { id });

        log.info(`Resuming session: ${BOLD}${sessionInfo.session.title || sessionInfo.session.id}${RESET}`);
        console.log(`${GRAY}Session ID: ${sessionInfo.session.id}${RESET}`);
        console.log(`${GRAY}Status: ${sessionInfo.session.status}${RESET}\n`);

        // Start interactive chat with this session
        await interactiveSessionResume(id);
        return;
      }

      // Otherwise, list recent sessions for user to choose
      const result = await requestDaemon<{
        sessions: Array<{
          id: string;
          title: string | null;
          status: string;
          lastActiveAt: string;
          agentId: string;
        }>;
      }>('session.list', { status: 'active,idle,paused' });

      const recentSessions = result.sessions.slice(0, limit);

      if (recentSessions.length === 0) {
        log.info('No recent sessions found. Start a new chat with "ah chat <agent>"');
        return;
      }

      // Display sessions with numbers for selection
      console.log(`\n${BOLD}Recent Sessions${RESET} (showing ${recentSessions.length} most recent):\n`);
      console.log(`  ${GRAY}#  Status   Last Active            Title / ID${RESET}`);
      console.log(`  ${GRAY}-- -------- ---------------------- -----------------${RESET}`);

      const now = new Date();
      for (let i = 0; i < recentSessions.length; i++) {
        const s = recentSessions[i];
        const statusColor = s.status === 'active' ? GREEN : s.status === 'idle' ? YELLOW : GRAY;
        const statusStr = `${statusColor}${s.status.padEnd(8)}${RESET}`;

        // Format relative time
        const lastActive = new Date(s.lastActiveAt);
        const diffMs = now.getTime() - lastActive.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        let timeStr: string;
        if (diffMins < 1) timeStr = 'just now';
        else if (diffMins < 60) timeStr = `${diffMins}m ago`;
        else if (diffHours < 24) timeStr = `${diffHours}h ago`;
        else timeStr = `${diffDays}d ago`;

        const title = s.title || '(untitled)';
        const titleDisplay = title.length > 25 ? title.slice(0, 22) + '...' : title;

        console.log(`  ${GREEN}${(i + 1).toString().padStart(2)}${RESET}  ${statusStr}  ${GRAY}${timeStr.padEnd(8)}${RESET}  ${titleDisplay}`);
        console.log(`           ${GRAY}${s.id.slice(0, 40)}...${RESET}`);
      }

      console.log(`\n${GRAY}Enter the number to resume that session, or 'q' to quit.${RESET}`);

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${GREEN}> ${RESET}`,
      });

      rl.prompt();

      rl.on('line', async (line: string) => {
        const trimmed = line.trim().toLowerCase();

        if (trimmed === 'q' || trimmed === 'quit' || trimmed === 'exit') {
          rl.close();
          return;
        }

        const choiceNum = parseInt(trimmed, 10);

        if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > recentSessions.length) {
          console.log(`${YELLOW}Invalid choice. Enter a number between 1 and ${recentSessions.length}, or 'q' to quit.${RESET}`);
          rl.prompt();
          return;
        }

        const selectedSession = recentSessions[choiceNum - 1];
        rl.close();

        console.log(`\n${GRAY}Resuming session: ${BOLD}${selectedSession.title || selectedSession.id}${RESET}\n`);

        await interactiveSessionResume(selectedSession.id);
      });

      rl.on('close', () => {
        process.exit(0);
      });
    });
}

/**
 * Start interactive chat session to resume an existing session
 */
async function interactiveSessionResume(sessionId: string): Promise<void> {
  // Get session info first
  const sessionInfo = await requestDaemon<{
    session: { id: string; title: string | null; status: string };
    messages: Array<{ role: string; content: string }>;
  }>('session.show', { id: sessionId });

  // Show recent message history
  const recentMessages = sessionInfo.messages.slice(-6); // Last 3 exchanges

  if (recentMessages.length > 0) {
    console.log(`${GRAY}--- Recent conversation ---${RESET}\n`);
    for (const msg of recentMessages) {
      const roleDisplay = msg.role === 'user' ? `${GREEN}You:${RESET}` : `${GRAY}Agent:${RESET}`;
      const contentPreview = msg.content.length > 100 ? msg.content.slice(0, 100) + '...' : msg.content;
      console.log(`${roleDisplay} ${contentPreview}\n`);
    }
    console.log(`${GRAY}--- Continue conversation ---${RESET}\n`);
  }

  // Start the interactive chat
  await runLocalChat({
    sessionId,
    message: '', // Empty message triggers interactive mode
  });
}
