import type { Command } from 'commander';
import { ensureDaemonRunning } from '../daemon/process.js';
import { requestDaemon } from '../daemon/client.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, YELLOW, RED, CYAN, RESET, renderTable, type Column } from '../utils/table.js';
import { truncate, formatRelativeTime, SESSION_STATUS_CONFIG } from '../utils/formatting.js';

/**
 * Shortcut command: `ah ps` - show running sessions (like Unix `ps`)
 * Provides a quick overview of active sessions and agents.
 */
export function registerPsShortcutCommand(program: Command): void {
  program
    .command('ps')
    .description('Show running sessions (like Unix ps)')
    .option('--json', 'Output JSON')
    .option('--all', 'Show all sessions including idle/completed')
    .action(async (opts: { json?: boolean; all?: boolean }) => {
      await ensureDaemonRunning();

      // Get sessions - use 'all' and filter client-side since daemon doesn't support comma-separated status
      const sessionResult = await requestDaemon<{
        sessions: Array<{
          id: string;
          title: string | null;
          status: string;
          lastActiveAt: string;
          agentId: string;
          agentName?: string;
        }>;
      }>('session.list', {
        status: 'all',
      });

      // Get agents
      const agentResult = await requestDaemon<{
        agents: Array<{
          id: string;
          slug: string;
          name: string;
          runtimeType: string;
        }>;
        bindings: Array<{ agentId: string; provider: string; status: string }>;
      }>('agent.list');

      if (opts.json) {
        console.log(JSON.stringify({
          sessions: sessionResult.sessions,
          agents: agentResult.agents,
          bindings: agentResult.bindings,
        }, null, 2));
        return;
      }

      // Filter to only running/active sessions by default
      const runningSessions = opts.all
        ? sessionResult.sessions
        : sessionResult.sessions.filter((s) =>
            s.status === 'active' || s.status === 'running' || s.status === 'paused'
          );

      // Banner
      console.log('');
      console.log(`${CYAN}┌${'─'.repeat(60)}┐${RESET}`);
      console.log(`${CYAN}│${RESET}  ${BOLD}AH Process Status${RESET}${' '.repeat(42)}${CYAN}│${RESET}`);
      console.log(`${CYAN}├${'─'.repeat(60)}┤${RESET}`);

      // Sessions section
      if (runningSessions.length === 0) {
        console.log(`${CYAN}│${RESET}  ${GRAY}No running sessions${RESET}${' '.repeat(40)}${CYAN}│${RESET}`);
      } else {
        console.log(`${CYAN}│${RESET}  ${BOLD}SESSIONS${RESET}${' '.repeat(51)}${CYAN}│${RESET}`);
        console.log(`${CYAN}│${RESET}  ${GRAY}ID        Agent      Status      Active   Title${RESET}${' '.repeat(12)}${CYAN}│${RESET}`);
        console.log(`${CYAN}│${RESET}  ${GRAY}${'─'.repeat(58)}${RESET}${CYAN}│${RESET}`);

        for (const s of runningSessions.slice(0, 10)) {
          const config = SESSION_STATUS_CONFIG[s.status] || { color: GRAY, symbol: '○' };
          const id = s.id.slice(0, 8).padEnd(9);
          const agent = truncate(s.agentName || s.agentId?.slice(0, 8) || '-', 9).padEnd(10);
          const status = `${config.symbol} ${s.status}`.padEnd(11);
          const active = formatRelativeTime(s.lastActiveAt).padEnd(8);
          const title = truncate(s.title || '(no title)', 26);

          console.log(`${CYAN}│${RESET}  ${id} ${agent} ${config.color}${status}${RESET} ${active} ${title}${' '.repeat(Math.max(0, 27 - title.length - 1))}${CYAN}│${RESET}`);
        }

        if (runningSessions.length > 10) {
          console.log(`${CYAN}│${RESET}  ${GRAY}... and ${runningSessions.length - 10} more${RESET}${' '.repeat(42)}${CYAN}│${RESET}`);
        }
      }

      // Agents section
      console.log(`${CYAN}├${'─'.repeat(60)}┤${RESET}`);
      if (agentResult.agents.length === 0) {
        console.log(`${CYAN}│${RESET}  ${GRAY}No agents registered${RESET}${' '.repeat(39)}${CYAN}│${RESET}`);
      } else {
        console.log(`${CYAN}│${RESET}  ${BOLD}AGENTS${RESET}${' '.repeat(53)}${CYAN}│${RESET}`);
        console.log(`${CYAN}│${RESET}  ${GRAY}ID      Name                 Runtime    Providers${RESET}${' '.repeat(12)}${CYAN}│${RESET}`);
        console.log(`${CYAN}│${RESET}  ${GRAY}${'─'.repeat(58)}${RESET}${CYAN}│${RESET}`);

        for (const a of agentResult.agents.slice(0, 5)) {
          const id = a.id.slice(0, 7).padEnd(7);
          const name = truncate(a.name, 19).padEnd(20);
          const runtime = a.runtimeType.padEnd(9);

          const bindings = agentResult.bindings.filter((b) => b.agentId === a.id);
          const activeBindings = bindings.filter((b) => b.status === 'active');
          const providersStr = activeBindings.length > 0
            ? activeBindings.map((b) => b.provider).join(', ')
            : '-';

          const providers = truncate(providersStr, 20);

          console.log(`${CYAN}│${RESET}  ${id} ${name} ${runtime} ${providers}${' '.repeat(Math.max(0, 21 - providers.length))}${CYAN}│${RESET}`);
        }

        if (agentResult.agents.length > 5) {
          console.log(`${CYAN}│${RESET}  ${GRAY}... and ${agentResult.agents.length - 5} more${RESET}${' '.repeat(43)}${CYAN}│${RESET}`);
        }
      }

      // Footer with summary
      console.log(`${CYAN}├${'─'.repeat(60)}┤${RESET}`);
      const activeSessions = sessionResult.sessions.filter((s) => s.status === 'active' || s.status === 'running').length;
      const activeBindings = agentResult.bindings.filter((b) => b.status === 'active').length;
      const summary = `Total: ${agentResult.agents.length} agents, ${runningSessions.length} sessions, ${activeBindings} active bindings`;
      console.log(`${CYAN}│${RESET}  ${GRAY}${summary}${' '.repeat(Math.max(0, 58 - summary.length))}${CYAN}│${RESET}`);
      console.log(`${CYAN}└${'─'.repeat(60)}┘${RESET}`);
      console.log('');

      // Tips
      if (runningSessions.length === 0 && agentResult.agents.length > 0) {
        console.log(`${GRAY}Tip: Start a chat with 'ah chat <agent>' to create a session.${RESET}`);
        console.log('');
      }
    });
}