import type { Command } from 'commander';
import { ensureDaemonRunning } from '../daemon/process.js';
import { requestDaemon } from '../daemon/client.js';
import { log } from '../utils/logger.js';
import { GRAY, GREEN, YELLOW, RESET, renderTable, type Column } from '../utils/table.js';

/**
 * Shortcut command: `ah tasks` - alias for `ah task list`
 * Provides a shorter, more intuitive command for listing task groups.
 */
export function registerTasksShortcutCommand(program: Command): void {
  program
    .command('tasks')
    .description('List task groups (shortcut for: ah task list)')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{ taskGroups: Array<{
        id: string;
        title: string;
        status: string;
        createdAt: string;
        sessionCount: number;
      }> }>('task.list');
      
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      
      if (result.taskGroups.length === 0) {
        log.info('No task groups yet.');
        console.log(`\n  ${GRAY}Tip: Run 'ah task create --title \"My Task\"' to create one.${RESET}`);
        return;
      }

      // Define status color mapping
      const statusConfig: Record<string, { color: string; symbol: string }> = {
        active: { color: GREEN, symbol: '●' },
        completed: { color: GRAY, symbol: '✓' },
        archived: { color: GRAY, symbol: '◇' },
        paused: { color: YELLOW, symbol: '◐' },
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
        { key: 'status', label: 'Status', width: 12 },
        { key: 'sessions', label: 'Sessions', width: 10, align: 'right' },
        { key: 'created', label: 'Created', width: 10 },
        { key: 'title', label: 'Title', width: 40 },
      ];

      // Format rows
      const rows = result.taskGroups.map((tg) => {
        const config = statusConfig[tg.status] || { color: GRAY, symbol: '○' };
        return {
          id: tg.id.slice(0, 7),
          status: `${config.color}${config.symbol} ${tg.status}${RESET}`,
          sessions: String(tg.sessionCount ?? 0),
          created: formatRelativeTime(tg.createdAt),
          title: truncate(tg.title || '(no title)', 37),
        };
      });

      console.log('');
      console.log(renderTable(columns, rows));

      // Print summary
      const activeCount = result.taskGroups.filter((tg) => tg.status === 'active').length;
      console.log(`\n${GRAY}Total: ${result.taskGroups.length} task groups, ${activeCount} active${RESET}\n`);
    });
}