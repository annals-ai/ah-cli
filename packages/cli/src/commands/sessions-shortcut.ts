import type { Command } from 'commander';
import { ensureDaemonRunning } from '../daemon/process.js';
import { requestDaemon } from '../daemon/client.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, RED, RESET, YELLOW, renderTable, type Column } from '../utils/table.js';
import { truncate, formatRelativeTime, SESSION_STATUS_CONFIG } from '../utils/formatting.js';

/**
 * Shortcut command: `ah sessions` - alias for `ah session list`
 * Provides a shorter, more intuitive command for listing sessions.
 */
export function registerSessionsShortcutCommand(program: Command): void {
  program
    .command('sessions')
    .description('List local sessions (shortcut for: ah session list)')
    .option('--agent <ref>', 'Filter by agent')
    .option('--task-group <id>', 'Filter by task group')
    .option('--status <status>', 'queued|active|idle|paused|completed|failed|archived|all', 'all')
    .option('--tag <tag>', 'Filter by tag')
    .option('--search <text>', 'Search in session title')
    .option('--limit <number>', 'Limit number of results', parseInt)
    .option('--json', 'Output JSON')
    .option('--short', 'Output only session IDs (one per line)')
    .action(async (opts: { agent?: string; taskGroup?: string; status: string; tag?: string; search?: string; limit?: number; json?: boolean; short?: boolean }) => {
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
        tag: opts.tag,
        search: opts.search,
        limit: opts.limit,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (opts.short) {
        for (const s of result.sessions) {
          console.log(s.id);
        }
        return;
      }

      if (result.sessions.length === 0) {
        const filters = [];
        if (opts.agent) filters.push(`agent: ${opts.agent}`);
        if (opts.taskGroup) filters.push(`task-group: ${opts.taskGroup}`);
        if (opts.status !== 'all') filters.push(`status: ${opts.status}`);
        if (opts.tag) filters.push(`tag: ${opts.tag}`);
        if (opts.search) filters.push(`search: "${opts.search}"`);

        if (filters.length > 0) {
          log.info(`No sessions found matching filters: ${filters.join(', ')}`);
          console.log(`\n  ${GRAY}Tip: Try removing some filters or use --status all${RESET}`);
        } else {
          log.info('No sessions found.');
          console.log(`\n  ${GRAY}Tip: Start a chat with 'ah chat <agent>' to create a session.${RESET}`);
        }
        return;
      }

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
        const config = SESSION_STATUS_CONFIG[s.status] || { color: GRAY, symbol: '○' };
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
          const config = SESSION_STATUS_CONFIG[status] || { color: GRAY, symbol: '○' };
          return `${config.color}${config.symbol}${RESET} ${count} ${status}`;
        })
        .join('  ');
      console.log(`\n${GRAY}Total: ${result.sessions.length} sessions${RESET}  ${summary}`);
    });
}