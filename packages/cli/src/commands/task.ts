import type { Command } from 'commander';
import { createInterface } from 'node:readline';
import { ensureDaemonRunning } from '../daemon/process.js';
import { requestDaemon } from '../daemon/client.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, YELLOW, RED, RESET, renderTable, type Column } from '../utils/table.js';

export function registerTaskCommand(program: Command): void {
  const task = program
    .command('task')
    .description('Manage task groups that organize many sessions');

  task
    .command('create')
    .description('Create a task group')
    .requiredOption('--title <title>', 'Task group title')
    .option('--source <source>', 'Source label', 'cli')
    .action(async (opts: { title: string; source: string }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{ taskGroup: { id: string; title: string } }>('task.create', {
        title: opts.title,
        source: opts.source,
      });
      log.success(`Task group created: ${BOLD}${result.taskGroup.title}${RESET}`);
      console.log(`  ${GRAY}${result.taskGroup.id}${RESET}`);
    });

  task
    .command('list')
    .description('List task groups')
    .option('--status <status>', 'Filter by status (active|archived|paused|all)', 'all')
    .option('--json', 'Output JSON')
    .action(async (opts: { status?: string; json?: boolean }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{ taskGroups: Array<{
        id: string;
        title: string;
        status: string;
        createdAt: string;
        sessionCount: number;
      }> }>('task.list', { status: opts.status });
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

  task
    .command('show <id>')
    .description('Show one task group with its sessions')
    .option('--json', 'Output JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{
        taskGroup: {
          id: string;
          title: string;
          status: string;
          createdAt: string;
          source?: string;
        };
        sessions: Array<{
          id: string;
          title: string | null;
          status: string;
          lastActiveAt: string;
          agentName?: string;
        }>;
      }>('task.show', { id });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const tg = result.taskGroup;

      // Define status color mapping
      const statusConfig: Record<string, { color: string; symbol: string }> = {
        active: { color: GREEN, symbol: '●' },
        completed: { color: GRAY, symbol: '✓' },
        archived: { color: GRAY, symbol: '◇' },
        paused: { color: YELLOW, symbol: '◐' },
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
        if (diffMins < 60) return `${diffMins} minutes ago`;
        if (diffHours < 24) return `${diffHours} hours ago`;
        if (diffDays === 1) return 'yesterday';
        return `${diffDays} days ago`;
      };

      const config = statusConfig[tg.status] || { color: GRAY, symbol: '○' };

      // Header
      console.log(`\n${BOLD}Task Group Details${RESET}\n`);

      // Task info
      console.log(`  ${GRAY}ID:${RESET}        ${tg.id}`);
      console.log(`  ${GRAY}Title:${RESET}     ${tg.title || '(no title)'}`);
      console.log(`  ${GRAY}Status:${RESET}    ${config.color}${config.symbol} ${tg.status}${RESET}`);
      console.log(`  ${GRAY}Created:${RESET}   ${formatRelativeTime(tg.createdAt)}`);
      if (tg.source) {
        console.log(`  ${GRAY}Source:${RESET}    ${tg.source}`);
      }

      // Sessions section
      const sessions = result.sessions || [];
      if (sessions.length > 0) {
        console.log(`\n  ${BOLD}Sessions (${sessions.length})${RESET}\n`);

        const sessionStatusConfig: Record<string, { color: string; symbol: string }> = {
          running: { color: GREEN, symbol: '●' },
          active: { color: GREEN, symbol: '●' },
          idle: { color: GRAY, symbol: '○' },
          paused: { color: YELLOW, symbol: '◐' },
          failed: { color: RED, symbol: '✗' },
          completed: { color: GRAY, symbol: '✓' },
          archived: { color: GRAY, symbol: '◇' },
        };

        // Truncate helper
        const truncate = (str: string, maxLen: number): string => {
          if (!str) return '';
          return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
        };

        // Define session table columns
        const columns: Column[] = [
          { key: 'id', label: 'ID', width: 9 },
          { key: 'status', label: 'Status', width: 12 },
          { key: 'agent', label: 'Agent', width: 12 },
          { key: 'active', label: 'Active', width: 12 },
          { key: 'title', label: 'Title', width: 35 },
        ];

        const rows = sessions.map((s) => {
          const sConfig = sessionStatusConfig[s.status] || { color: GRAY, symbol: '○' };
          return {
            id: s.id.slice(0, 8),
            status: `${sConfig.color}${sConfig.symbol} ${s.status}${RESET}`,
            agent: truncate(s.agentName || '-', 10),
            active: formatRelativeTime(s.lastActiveAt),
            title: truncate(s.title || '(no title)', 32),
          };
        });

        console.log(renderTable(columns, rows));
      } else {
        console.log(`\n  ${GRAY}No sessions in this task group.${RESET}`);
      }
      console.log();
    });

  task
    .command('archive <id>')
    .description('Archive a task group')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (id: string, opts: { yes?: boolean }) => {
      await ensureDaemonRunning();

      // Get task group info for confirmation message
      const result = await requestDaemon<{
        taskGroup: { id: string; title: string; status: string; sessionCount: number };
      }>('task.show', { id });

      const tg = result.taskGroup;

      // Require confirmation unless --yes is passed
      if (!opts.yes) {
        process.stderr.write(`\n  ${BOLD}Archive task group?${RESET}\n`);
        process.stderr.write(`  ${GRAY}Title:${RESET}     ${tg.title || '(no title)'}\n`);
        process.stderr.write(`  ${GRAY}ID:${RESET}        ${tg.id}\n`);
        process.stderr.write(`  ${GRAY}Sessions:${RESET}  ${tg.sessionCount ?? 0}\n\n`);

        const rl = createInterface({
          input: process.stdin,
          output: process.stderr,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`  Are you sure? [y/N] `, (ans: string) => {
            rl.close();
            resolve(ans.trim().toLowerCase());
          });
        });

        if (answer !== 'y' && answer !== 'yes') {
          log.info('Aborted.');
          return;
        }
      }

      await requestDaemon('task.archive', { id });
      log.success(`Task group archived: ${BOLD}${tg.title || tg.id}${RESET}`);
    });

  task
    .command('update <id>')
    .description('Update a task group')
    .option('--title <title>', 'New title for the task group')
    .option('--status <status>', 'New status (active|archived|paused|completed)')
    .action(async (id: string, opts: { title?: string; status?: string }) => {
      await ensureDaemonRunning();

      if (!opts.title && !opts.status) {
        log.error('Please specify at least one field to update (--title or --status)');
        process.exit(1);
      }

      const result = await requestDaemon<{
        taskGroup: { id: string; title: string; status: string };
      }>('task.update', {
        id,
        title: opts.title,
        status: opts.status,
      });

      const tg = result.taskGroup;
      const changes: string[] = [];
      if (opts.title) changes.push(`title: "${tg.title}"`);
      if (opts.status) changes.push(`status: ${tg.status}`);

      log.success(`Task group updated: ${BOLD}${tg.id.slice(0, 7)}${RESET}`);
      console.log(`  ${GRAY}${changes.join(', ')}${RESET}`);
    });
}
