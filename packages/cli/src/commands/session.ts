import type { Command } from 'commander';
import { createInterface } from 'node:readline';
import { ensureDaemonRunning } from '../daemon/process.js';
import { requestDaemon } from '../daemon/client.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, RED, RESET, YELLOW, BLUE, renderTable, type Column } from '../utils/table.js';
import { parseTagFlags, runLocalChat } from './local-runtime.js';

/**
 * Parse duration string like "7d", "24h", "1w" into milliseconds.
 * Supports: d (days), h (hours), w (weeks).
 */
function parseOlderThan(duration: string): number | null {
  const match = duration.match(/^(\d+)([dhw])$/);
  if (!match) return null;
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

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
    .option('--active', 'Show only active/idle/paused sessions (shortcut for --status active,idle,paused)')
    .option('--tag <tag>', 'Filter by tag')
    .option('--search <text>', 'Search in session title')
    .option('--older-than <duration>', 'Filter sessions older than duration (e.g., 7d, 24h, 1w)')
    .option('--newer-than <duration>', 'Filter sessions newer than duration (e.g., 7d, 24h, 1w)')
    .option('--sort <field>', 'Sort by field: created_at, updated_at, last_active_at, title (default: last_active_at)')
    .option('--limit <number>', 'Limit number of results', parseInt)
    .option('--json', 'Output JSON')
    .option('--short', 'Output only session IDs (one per line)')
    .action(async (opts: { agent?: string; taskGroup?: string; status: string; active?: boolean; tag?: string; search?: string; olderThan?: string; newerThan?: string; sort?: string; limit?: number; json?: boolean; short?: boolean }) => {
      await ensureDaemonRunning();
      
      // --active is a shortcut for --status active,idle,paused
      const statusFilter = opts.active ? 'active,idle,paused' : opts.status;
      
      // Parse --older-than duration
      const olderThanMs = opts.olderThan ? parseOlderThan(opts.olderThan) : null;
      if (olderThanMs !== null && olderThanMs <= 0) {
        log.error(`Invalid --older-than duration: ${opts.olderThan}`);
        console.log(`  ${GRAY}Examples: 7d, 24h, 1w, 30d, 2w${RESET}`);
        process.exit(1);
      }
      
      // Parse --newer-than duration
      const newerThanMs = opts.newerThan ? parseOlderThan(opts.newerThan) : null;
      if (newerThanMs !== null && newerThanMs <= 0) {
        log.error(`Invalid --newer-than duration: ${opts.newerThan}`);
        console.log(`  ${GRAY}Examples: 7d, 24h, 1w, 30d, 2w${RESET}`);
        process.exit(1);
      }
      
      const result = await requestDaemon<{ sessions: Array<{
        id: string;
        title: string | null;
        status: string;
        lastActiveAt: string;
        createdAt: string;
        updatedAt: string;
        agentId: string;
        agentName?: string;
      }> }>('session.list', {
        agentRef: opts.agent,
        taskGroupId: opts.taskGroup,
        status: statusFilter,
        tag: opts.tag,
        search: opts.search,
        limit: opts.limit,
      });
      
      // Apply --older-than and --newer-than filters on the client side
      let filteredSessions = result.sessions;
      if (olderThanMs !== null) {
        const cutoff = Date.now() - olderThanMs;
        filteredSessions = filteredSessions.filter((s) => {
          const lastActive = new Date(s.lastActiveAt).getTime();
          return lastActive < cutoff;
        });
      }
      if (newerThanMs !== null) {
        const cutoff = Date.now() - newerThanMs;
        filteredSessions = filteredSessions.filter((s) => {
          const lastActive = new Date(s.lastActiveAt).getTime();
          return lastActive > cutoff;
        });
      }

      // Apply sorting
      const sortField = opts.sort || 'last_active_at';
      const validSortFields = ['created_at', 'updated_at', 'last_active_at', 'title'];
      if (!validSortFields.includes(sortField)) {
        log.error(`Invalid --sort value: ${sortField}`);
        console.log(`  ${GRAY}Valid options: ${validSortFields.join(', ')}${RESET}`);
        process.exit(1);
      }

      filteredSessions.sort((a, b) => {
        if (sortField === 'title') {
          const titleA = a.title || '';
          const titleB = b.title || '';
          return titleA.localeCompare(titleB);
        } else if (sortField === 'created_at') {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        } else if (sortField === 'last_active_at') {
          return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
        } else {
          // updated_at (default fallback)
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        }
      });
      
      if (opts.json) {
        console.log(JSON.stringify({ sessions: filteredSessions }, null, 2));
        return;
      }

      if (opts.short) {
        for (const s of filteredSessions) {
          console.log(s.id);
        }
        return;
      }

      if (filteredSessions.length === 0) {
        const filters = [];
        if (opts.agent) filters.push(`agent: ${opts.agent}`);
        if (opts.taskGroup) filters.push(`task-group: ${opts.taskGroup}`);
        if (opts.active) filters.push(`status: active/idle/paused (--active)`);
        else if (opts.status !== 'all') filters.push(`status: ${opts.status}`);
        if (opts.tag) filters.push(`tag: ${opts.tag}`);
        if (opts.search) filters.push(`search: "${opts.search}"`);
        if (opts.olderThan) filters.push(`older than: ${opts.olderThan}`);
        if (opts.newerThan) filters.push(`newer than: ${opts.newerThan}`);

        if (filters.length > 0) {
          log.info(`No sessions found matching filters: ${filters.join(', ')}`);
          console.log(`\n  ${GRAY}Tip: Try removing some filters or use --status all${RESET}`);
        } else {
          log.info('No sessions found.');
          console.log(`\n  ${GRAY}Tip: Start a chat with 'ah chat <agent>' to create a session.${RESET}`);
        }
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
      const rows = filteredSessions.map((s) => {
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
      for (const s of filteredSessions) {
        statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
      }
      const summary = Object.entries(statusCounts)
        .map(([status, count]) => {
          const config = statusConfig[status] || { color: GRAY, symbol: '○' };
          return `${config.color}${config.symbol}${RESET} ${count} ${status}`;
        })
        .join('  ');
      
      // Show filter info if --older-than or --newer-than was applied
      const olderThanInfo = opts.olderThan 
        ? ` (older than ${opts.olderThan})` 
        : '';
      const newerThanInfo = opts.newerThan
        ? ` (newer than ${opts.newerThan})`
        : '';
      console.log(`\n${GRAY}Total: ${filteredSessions.length} sessions${olderThanInfo}${newerThanInfo}${RESET}  ${summary}`);
    });

  session
    .command('show <id>')
    .description('Show one session and its messages')
    .option('--json', 'Output JSON')
    .option('--messages', 'Show recent messages')
    .option('--limit <number>', 'Number of messages to show', '20')
    .action(async (id: string, opts: { json?: boolean; messages?: boolean; limit?: string }) => {
      await ensureDaemonRunning();
      try {
        const result = await requestDaemon<{
          session: {
            id: string;
            title: string | null;
            status: string;
            lastActiveAt: string;
            agentId: string;
            agentName?: string;
            createdAt?: string;
            tags?: string[];
          };
          messages?: Array<{ role: string; content: string; createdAt?: string }>;
        }>('session.show', { id });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Human-readable output
      const session = result.session;
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
      const config = statusConfig[session.status] || { color: GRAY, symbol: '○' };

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

      // Header
      console.log(`\n${BOLD}Session Details${RESET}\n`);

      // Session info table
      console.log(`  ${GRAY}ID:${RESET}      ${session.id}`);
      console.log(`  ${GRAY}Title:${RESET}   ${session.title || '(no title)'}`);
      console.log(`  ${GRAY}Status:${RESET}  ${config.color}${config.symbol} ${session.status}${RESET}`);
      console.log(`  ${GRAY}Agent:${RESET}   ${session.agentName || session.agentId?.slice(0, 12) || '-'}`);
      if (session.createdAt) {
        console.log(`  ${GRAY}Created:${RESET} ${formatRelativeTime(session.createdAt)}`);
      }
      console.log(`  ${GRAY}Active:${RESET}  ${formatRelativeTime(session.lastActiveAt)}`);
      if (session.tags && session.tags.length > 0) {
        console.log(`  ${GRAY}Tags:${RESET}    ${session.tags.join(', ')}`);
      }

      // Messages section
      const messages = result.messages || [];
      if (opts.messages && messages.length > 0) {
        const limit = parseInt(opts.limit ?? '20', 10);
        const displayMessages = messages.slice(-limit);

        console.log(`\n${BOLD}Recent Messages${RESET} (${displayMessages.length}/${messages.length})\n`);

        for (const msg of displayMessages) {
          const roleLabel = msg.role === 'user' ? `${GREEN}You${RESET}` : `${BLUE}Agent${RESET}`;
          const contentLines = msg.content.split('\n');
          const preview = contentLines.length > 1
            ? contentLines[0].slice(0, 100) + '...'
            : msg.content.slice(0, 200) + (msg.content.length > 200 ? '...' : '');

          console.log(`  ${GRAY}[${roleLabel}${GRAY}]${RESET}`);
          console.log(`  ${preview}`);
          console.log();
        }
      } else if (messages.length > 0) {
        console.log(`\n  ${GRAY}(${messages.length} messages, use --messages to view)${RESET}`);
      }
      console.log();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('not found')) {
          log.error(`Session not found: ${BOLD}${id}${RESET}`);
          console.log(`\n  ${GRAY}Tip: Use 'ah session list' to see available sessions.${RESET}`);
        } else {
          log.error(`Failed to show session: ${message}`);
        }
        process.exit(1);
      }
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
    .command('stop <ids...>')
    .description('Stop one or more sessions (space-separated IDs)')
    .action(async (ids: string[]) => {
      await ensureDaemonRunning();
      const results = [];
      for (const id of ids) {
        try {
          const result = await requestDaemon<{ session: { status: string } }>('session.stop', { id });
          results.push({ id, status: result.session.status, error: null });
        } catch (err) {
          results.push({ id, status: null, error: err instanceof Error ? err.message : String(err) });
        }
      }

      // Output results
      for (const r of results) {
        if (r.error) {
          console.log(`${RED}✗${RESET} ${BOLD}${r.id}${RESET} ${RED}${r.error}${RESET}`);
        } else {
          console.log(`${GREEN}✓${RESET} ${BOLD}${r.id}${RESET} ${GRAY}→ ${r.status}${RESET}`);
        }
      }

      const errors = results.filter(r => r.error).length;
      if (errors > 0) {
        log.error(`Stopped ${results.length - errors}/${results.length} sessions, ${errors} error(s)`);
      } else {
        log.success(`Stopped ${results.length} session(s)`);
      }
    });

  // --- Session start: start one or more agent sessions in parallel ---
  session
    .command('start <agents...>')
    .description('Start sessions for one or more agents in parallel (space-separated agent refs)')
    .option('--parallel <number>', 'Max concurrent sessions', '4')
    .option('--task-group <id>', 'Bind all sessions to a task group')
    .option('--tag <tag...>', 'Add tags to all sessions')
    .option('--json', 'Output JSON')
    .action(async (agents: string[], opts: { parallel?: string; taskGroup?: string; tag?: string[]; json?: boolean }) => {
      await ensureDaemonRunning();

      if (agents.length === 0) {
        log.error('Agent reference(s) required');
        console.log(`  ${GRAY}Usage: ah session start <agent1> <agent2> ...${RESET}`);
        process.exit(1);
      }

      const maxParallel = Math.max(1, Math.min(parseInt(opts.parallel ?? '4', 10) || 4, 20));

      // Call daemon to start agents in parallel (creates idle sessions)
      const result = await requestDaemon<{
        results: Array<{
          index: number;
          agentRef: string;
          sessionId?: string;
          status: string;
          error?: string;
        }>;
      }>('session.startAgents', {
        agentRefs: agents,
        maxParallel,
        taskGroupId: opts.taskGroup,
        tags: parseTagFlags(opts.tag),
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Display results
      console.log(`\n${BOLD}Starting Agent Sessions${RESET}\n`);

      for (const r of result.results) {
        if (r.status === 'error') {
          console.log(`${RED}✗${RESET} ${BOLD}${r.agentRef}${RESET} ${RED}${r.error}${RESET}`);
        } else {
          console.log(`${GREEN}✓${RESET} ${BOLD}${r.agentRef}${RESET} ${GRAY}→ session: ${r.sessionId?.slice(0, 8)}...${RESET} ${YELLOW}(idle)${RESET}`);
        }
      }

      const success = result.results.filter(r => r.status !== 'error').length;
      const errors = result.results.filter(r => r.status === 'error').length;
      console.log(`\n${GRAY}Started: ${success}, Errors: ${errors}${RESET}`);
    });

  session
    .command('archive [id]')
    .description('Archive a session or batch archive sessions by status')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--status <status>', 'Batch archive: filter by status (failed, idle, completed, etc.)')
    .option('--all', 'Batch archive: archive all sessions matching --status filter')
    .option('--dry-run', 'Batch archive: preview sessions to be archived without archiving')
    .option('--limit <number>', 'Batch archive: limit number of sessions to archive', parseInt)
    .action(async (id: string | undefined, opts: { yes?: boolean; status?: string; all?: boolean; dryRun?: boolean; limit?: number }) => {
      await ensureDaemonRunning();

      // Batch archive mode: --status and --all
      if (opts.status && opts.all) {
        // Get sessions matching the status filter
        const result = await requestDaemon<{
          sessions: Array<{
            id: string;
            title: string | null;
            status: string;
            lastActiveAt: string;
            agentId: string;
            agentName?: string;
          }>;
        }>('session.list', { status: opts.status, limit: opts.limit });

        const sessions = result.sessions;

        if (sessions.length === 0) {
          log.info(`No sessions found with status: ${opts.status}`);
          return;
        }

        // Dry run: just show what would be archived
        if (opts.dryRun) {
          console.log(`\n${BOLD}Sessions to archive (${sessions.length}):${RESET}\n`);
          for (const s of sessions) {
            const title = s.title || '(no title)';
            console.log(`  ${GRAY}${s.id.slice(0, 8)}${RESET}  ${title.slice(0, 50)}${title.length > 50 ? '...' : ''}`);
          }
          console.log(`\n  ${GRAY}Run without --dry-run to archive these sessions.${RESET}`);
          return;
        }

        // Require confirmation unless --yes
        if (!opts.yes) {
          console.log(`\n${BOLD}Archive ${sessions.length} session(s) with status: ${opts.status}?${RESET}\n`);
          console.log(`  ${GRAY}Sessions:${RESET}`);
          for (const s of sessions.slice(0, 5)) {
            const title = s.title || '(no title)';
            console.log(`    ${GRAY}${s.id.slice(0, 8)}${RESET}  ${title.slice(0, 40)}`);
          }
          if (sessions.length > 5) {
            console.log(`    ${GRAY}... and ${sessions.length - 5} more${RESET}`);
          }
          console.log();

          const rl = require('node:readline').createInterface({
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

        // Archive all matching sessions
        let archived = 0;
        let errors = 0;
        for (const s of sessions) {
          try {
            await requestDaemon('session.archive', { id: s.id });
            archived++;
          } catch {
            errors++;
          }
        }

        log.success(`Archived ${archived} session(s)${errors > 0 ? `, ${errors} error(s)` : ''}`);
        return;
      }

      // Single session archive mode
      if (!id) {
        log.error('Session ID required. Use --status and --all for batch archive.');
        console.log(`  ${GRAY}Examples:${RESET}`);
        console.log(`    ${GRAY}ah session archive <id>${RESET}`);
        console.log(`    ${GRAY}ah session archive --status failed --all${RESET}`);
        console.log(`    ${GRAY}ah session archive --status failed --all --dry-run${RESET}`);
        process.exit(1);
      }

      // Get session info for confirmation message
      const info = await requestDaemon<{
        session: { id: string; title: string | null; status: string; agentName?: string };
      }>('session.show', { id });

      const session = info.session;

      // Require confirmation unless --yes is passed
      if (!opts.yes) {
        process.stderr.write(`\n  ${BOLD}Archive session?${RESET}\n`);
        process.stderr.write(`  ${GRAY}Title:${RESET}   ${session.title || '(no title)'}\n`);
        process.stderr.write(`  ${GRAY}ID:${RESET}      ${session.id}\n`);
        if (session.agentName) {
          process.stderr.write(`  ${GRAY}Agent:${RESET}   ${session.agentName}\n`);
        }
        process.stderr.write(`  ${GRAY}Status:${RESET}  ${session.status}\n\n`);

        const rl = require('node:readline').createInterface({
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

      await requestDaemon('session.archive', { id });
      log.success(`Session archived: ${BOLD}${session.title || session.id}${RESET}`);
    });

  // --- Session delete: permanently delete sessions ---
  session
    .command('delete [id]')
    .description('Permanently delete a session (cannot be undone)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--status <status>', 'Batch delete: filter by status (archived, failed, completed, etc.)')
    .option('--all', 'Batch delete: delete all sessions matching --status filter')
    .option('--dry-run', 'Batch delete: preview sessions to be deleted without deleting')
    .option('--limit <number>', 'Batch delete: limit number of sessions to delete', parseInt)
    .action(async (id: string | undefined, opts: { yes?: boolean; status?: string; all?: boolean; dryRun?: boolean; limit?: number }) => {
      await ensureDaemonRunning();

      // Batch delete mode: --status and --all
      if (opts.status && opts.all) {
        // Get sessions matching the status filter
        const result = await requestDaemon<{
          sessions: Array<{
            id: string;
            title: string | null;
            status: string;
            lastActiveAt: string;
            agentId: string;
            agentName?: string;
          }>;
        }>('session.list', { status: opts.status, limit: opts.limit });

        const sessions = result.sessions;

        if (sessions.length === 0) {
          log.info(`No sessions found with status: ${opts.status}`);
          return;
        }

        // Dry run: just show what would be deleted
        if (opts.dryRun) {
          console.log(`\n${BOLD}${RED}Sessions to delete (${sessions.length}):${RESET}\n`);
          for (const s of sessions) {
            const title = s.title || '(no title)';
            console.log(`  ${GRAY}${s.id.slice(0, 8)}${RESET}  ${title.slice(0, 50)}${title.length > 50 ? '...' : ''}`);
          }
          console.log(`\n  ${RED}Warning: This is permanent and cannot be undone!${RESET}`);
          console.log(`  ${GRAY}Run without --dry-run to delete these sessions.${RESET}`);
          return;
        }

        // Require confirmation unless --yes
        if (!opts.yes) {
          console.log(`\n${BOLD}${RED}Permanently delete ${sessions.length} session(s) with status: ${opts.status}?${RESET}\n`);
          console.log(`  ${RED}Warning: This cannot be undone!${RESET}\n`);
          console.log(`  ${GRAY}Sessions:${RESET}`);
          for (const s of sessions.slice(0, 5)) {
            const title = s.title || '(no title)';
            console.log(`    ${GRAY}${s.id.slice(0, 8)}${RESET}  ${title.slice(0, 40)}`);
          }
          if (sessions.length > 5) {
            console.log(`    ${GRAY}... and ${sessions.length - 5} more${RESET}`);
          }
          console.log();

          const rl = require('node:readline').createInterface({
            input: process.stdin,
            output: process.stderr,
          });

          const answer = await new Promise<string>((resolve) => {
            rl.question(`  ${RED}Are you sure? Type 'yes' to confirm:${RESET} `, (ans: string) => {
              rl.close();
              resolve(ans.trim().toLowerCase());
            });
          });

          if (answer !== 'yes') {
            log.info('Aborted.');
            return;
          }
        }

        // Delete all matching sessions
        let deleted = 0;
        let errors = 0;
        for (const s of sessions) {
          try {
            await requestDaemon('session.delete', { id: s.id });
            deleted++;
          } catch {
            errors++;
          }
        }

        log.success(`Deleted ${deleted} session(s)${errors > 0 ? `, ${errors} error(s)` : ''}`);
        return;
      }

      // Single session delete mode
      if (!id) {
        log.error('Session ID required. Use --status and --all for batch delete.');
        console.log(`  ${GRAY}Examples:${RESET}`);
        console.log(`    ${GRAY}ah session delete <id>${RESET}`);
        console.log(`    ${GRAY}ah session delete --status archived --all${RESET}`);
        console.log(`    ${GRAY}ah session delete --status archived --all --dry-run${RESET}`);
        process.exit(1);
      }

      // Get session info for confirmation message
      const info = await requestDaemon<{
        session: { id: string; title: string | null; status: string; agentName?: string };
      }>('session.show', { id });

      const session = info.session;

      // Require confirmation unless --yes is passed
      if (!opts.yes) {
        process.stderr.write(`\n  ${BOLD}${RED}Permanently delete session?${RESET}\n`);
        process.stderr.write(`  ${RED}Warning: This cannot be undone!${RESET}\n\n`);
        process.stderr.write(`  ${GRAY}Title:${RESET}   ${session.title || '(no title)'}\n`);
        process.stderr.write(`  ${GRAY}ID:${RESET}      ${session.id}\n`);
        if (session.agentName) {
          process.stderr.write(`  ${GRAY}Agent:${RESET}   ${session.agentName}\n`);
        }
        process.stderr.write(`  ${GRAY}Status:${RESET}  ${session.status}\n\n`);

        const rl = require('node:readline').createInterface({
          input: process.stdin,
          output: process.stderr,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`  ${RED}Are you sure? Type 'yes' to confirm:${RESET} `, (ans: string) => {
            rl.close();
            resolve(ans.trim().toLowerCase());
          });
        });

        if (answer !== 'yes') {
          log.info('Aborted.');
          return;
        }
      }

      await requestDaemon('session.delete', { id });
      log.success(`Session deleted: ${BOLD}${session.title || session.id}${RESET}`);
    });

  // --- Session restore: list recent sessions and optionally resume one ---
  session
    .command('restore [id]')
    .description('Restore a recent session to continue chatting (lists recent sessions if no id provided)')
    .option('--limit <number>', 'Number of recent sessions to show', '10')
    .option('--last', 'Restore the most recent session automatically (no prompt)')
    .option('--json', 'Output JSON')
    .action(async (id: string | undefined, opts: { limit?: string; last?: boolean; json?: boolean }) => {
      await ensureDaemonRunning();

      const limit = parseInt(opts.limit ?? '10', 10);

      // If session ID provided directly, restore it
      if (id) {
        const sessionInfo = await requestDaemon<{
          session: { id: string; title: string | null; status: string; lastActiveAt: string };
        }>('session.show', { id });

        if (opts.json) {
          console.log(JSON.stringify(sessionInfo, null, 2));
          return;
        }

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

      // If --last flag provided, auto-restore most recent session
      if (opts.last && result.sessions.length > 0) {
        const mostRecent = result.sessions[0];
        if (opts.json) {
          console.log(JSON.stringify({ session: mostRecent }, null, 2));
          return;
        }
        log.info(`Restoring most recent session: ${BOLD}${mostRecent.title || mostRecent.id}${RESET}`);
        console.log(`${GRAY}Session ID: ${mostRecent.id}${RESET}`);
        console.log(`${GRAY}Status: ${mostRecent.status}${RESET}\n`);
        await interactiveSessionResume(mostRecent.id);
        return;
      }

      if (opts.last && result.sessions.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ session: null, error: 'No sessions found' }, null, 2));
          return;
        }
        log.info('No recent sessions found. Start a new chat with "ah chat <agent>"');
        return;
      }

      const recentSessions = result.sessions.slice(0, limit);

      if (recentSessions.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ sessions: [] }, null, 2));
          return;
        }
        log.info('No recent sessions found. Start a new chat with "ah chat <agent>"');
        return;
      }

      // JSON output
      if (opts.json) {
        console.log(JSON.stringify({ sessions: recentSessions }, null, 2));
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

      let isResuming = false;

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

        console.log(`\n${GRAY}Resuming session: ${BOLD}${selectedSession.title || selectedSession.id}${RESET}\n`);

        // Mark that we're resuming so the close handler doesn't exit
        isResuming = true;
        rl.close();

        // Resume the session (this takes over the terminal)
        await interactiveSessionResume(selectedSession.id);
      });

      rl.on('close', () => {
        // Only exit if we're NOT resuming a session
        // (i.e., user pressed 'q' to quit)
        if (!isResuming) {
          process.exit(0);
        }
      });
    });

  // --- Session export: export session to JSON or markdown ---
  session
    .command('export <id>')
    .description('Export a session to JSON or markdown format')
    .option('-f, --format <format>', 'Output format: json or markdown (default: json)', 'json')
    .option('-o, --output <file>', 'Write output to file instead of stdout')
    .option('--messages', 'Include full message history (default: include all)')
    .option('--no-messages', 'Exclude message history (metadata only)')
    .action(async (id: string, opts: { format: string; output?: string; messages?: boolean }) => {
      await ensureDaemonRunning();

      // Validate format
      const format = opts.format.toLowerCase();
      if (format !== 'json' && format !== 'markdown' && format !== 'md') {
        log.error(`Invalid format: ${opts.format}. Use 'json' or 'markdown'.`);
        process.exit(1);
      }
      const isMarkdown = format === 'markdown' || format === 'md';

      // Get session data
      // --no-messages sets opts.messages to false; default is to include messages
      const includeMessages = opts.messages !== false;
      const result = await requestDaemon<{
        session: {
          id: string;
          title: string | null;
          status: string;
          lastActiveAt: string;
          agentId: string;
          agentName?: string;
          createdAt?: string;
          tags?: string[];
        };
        messages?: Array<{ 
          role: string; 
          content: string; 
          createdAt?: string;
        }>;
      }>('session.show', { id });

      const session = result.session;
      // Only include messages if requested (--no-messages not passed)
      const messages = includeMessages ? (result.messages || []) : [];

      // Format output
      let output: string;

      if (isMarkdown) {
        output = formatSessionMarkdown(session, messages);
      } else {
        output = JSON.stringify({
          session: {
            id: session.id,
            title: session.title,
            status: session.status,
            agentId: session.agentId,
            agentName: session.agentName,
            createdAt: session.createdAt,
            lastActiveAt: session.lastActiveAt,
            tags: session.tags || [],
          },
          messages: includeMessages ? messages : undefined,
          exportedAt: new Date().toISOString(),
        }, null, 2);
      }

      // Write to file or stdout
      if (opts.output) {
        const fs = await import('node:fs');
        const outputPath = opts.output;
        try {
          fs.writeFileSync(outputPath, output, 'utf-8');
          log.success(`Session exported to: ${BOLD}${outputPath}${RESET}`);
          console.log(`  ${GRAY}Format: ${isMarkdown ? 'markdown' : 'json'}${RESET}`);
          console.log(`  ${GRAY}Messages: ${messages.length}${RESET}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error(`Failed to write file: ${message}`);
          process.exit(1);
        }
      } else {
        console.log(output);
      }
    });

  // --- Session run: parallel session execution ---
  session
    .command('run')
    .description('Run multiple sessions in parallel')
    .requiredOption('--agent <ref>', 'Agent reference (slug or ID)')
    .option('-m, --messages <text>', 'Messages to send (comma-separated or use multiple -m flags)')
    .option('--parallel <number>', 'Max number of concurrent sessions', '4')
    .option('--task-group <id>', 'Bind all sessions to a task group')
    .option('--tag <tag...>', 'Add tags to all sessions')
    .option('--stream', 'Stream output from all sessions in real-time')
    .option('--json', 'Output JSON')
    .option('--timeout <seconds>', 'Timeout per session', '300')
    .action(async (opts: {
      agent: string;
      messages: string;
      parallel: string;
      taskGroup?: string;
      tag?: string[];
      stream?: boolean;
      json?: boolean;
      timeout: string;
    }) => {
      await ensureDaemonRunning();

      // Parse messages - support both comma-separated and multiple -m flags
      // commander returns string for single -m, or array for multiple -m usage
      let messages: string[];
      if (Array.isArray(opts.messages)) {
        messages = opts.messages;
      } else if (typeof opts.messages === 'string') {
        messages = opts.messages.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        messages = [];
      }

      if (messages.length === 0) {
        log.error('No messages provided. Use -m "msg1,msg2" or -m msg1 -m msg2');
        process.exit(1);
      }

      const maxParallel = Math.max(1, Math.min(parseInt(opts.parallel, 10) || 4, 20));
      const timeoutSecs = parseInt(opts.timeout, 10) || 300;
      const taskGroupId = opts.taskGroup;
      const tags = parseTagFlags(opts.tag);

      // Request daemon to run sessions in parallel
      const result = await requestDaemon<{
        taskGroupId: string;
        sessions: Array<{
          sessionId: string;
          message: string;
          status: 'started' | 'completed' | 'error';
          error?: string;
          result?: string;
        }>;
      }>('session.run', {
        agentRef: opts.agent,
        messages,
        maxParallel,
        taskGroupId,
        tags,
        stream: opts.stream ?? false,
        timeoutMs: timeoutSecs * 1000,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Summary output
      console.log(`\n${BOLD}Parallel Session Results${RESET}  task-group=${GRAY}${result.taskGroupId.slice(0, 8)}...${RESET}`);
      console.log(`  ${GRAY}Total: ${result.sessions.length} sessions, max parallel: ${maxParallel}${RESET}\n`);

      for (const s of result.sessions) {
        const statusIcon = s.status === 'completed' ? GREEN : s.status === 'error' ? RED : YELLOW;
        const statusText = s.status === 'completed' ? 'done' : s.status === 'error' ? 'error' : 'started';
        console.log(`  ${statusIcon}${s.status === 'completed' ? '✓' : s.status === 'error' ? '✗' : '◐'}${RESET} ${BOLD}session=${GRAY}${s.sessionId.slice(0, 8)}...${RESET} ${statusIcon}${statusText}${RESET}`);
        if (s.status === 'error' && s.error) {
          console.log(`    ${RED}${s.error}${RESET}`);
        } else if (s.status === 'completed' && s.result) {
          const preview = s.result.length > 150 ? s.result.slice(0, 150) + '...' : s.result;
          console.log(`    ${GRAY}${preview}${RESET}`);
        }
        console.log('');
      }

      // Stats
      const completed = result.sessions.filter(s => s.status === 'completed').length;
      const errors = result.sessions.filter(s => s.status === 'error').length;
      console.log(`${GRAY}Completed: ${completed}${RESET}  ${errors > 0 ? RED + `Errors: ${errors}` + RESET : ''}`);
    });

  // --- Session prune: clean up old/unused sessions ---
  session
    .command('prune')
    .description('Clean up old or unused sessions (archive or delete in one step)')
    .option('--status <status>', 'Filter by status (comma-separated: failed,idle,completed,archived)', 'failed,idle')
    .option('--older-than <duration>', 'Only prune sessions older than duration (e.g., 7d, 24h, 1w)', '7d')
    .option('--action <action>', 'Action to take: archive or delete', 'archive')
    .option('--limit <number>', 'Limit number of sessions to prune', parseInt)
    .option('--dry-run', 'Preview sessions to be pruned without making changes')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output JSON')
    .action(async (opts: {
      status: string;
      olderThan: string;
      action: string;
      limit?: number;
      dryRun?: boolean;
      yes?: boolean;
      json?: boolean;
    }) => {
      await ensureDaemonRunning();

      // Validate action
      const action = opts.action.toLowerCase();
      if (action !== 'archive' && action !== 'delete') {
        log.error(`Invalid action: ${opts.action}. Use 'archive' or 'delete'.`);
        process.exit(1);
      }

      // Parse --older-than duration
      const olderThanMs = parseOlderThan(opts.olderThan);
      if (olderThanMs === null || olderThanMs <= 0) {
        log.error(`Invalid --older-than duration: ${opts.olderThan}`);
        console.log(`  ${GRAY}Examples: 7d, 24h, 1w, 30d, 2w${RESET}`);
        process.exit(1);
      }

      const cutoff = Date.now() - olderThanMs;

      // Get sessions matching the status filter
      const result = await requestDaemon<{
        sessions: Array<{
          id: string;
          title: string | null;
          status: string;
          lastActiveAt: string;
          agentId: string;
          agentName?: string;
        }>;
      }>('session.list', { status: opts.status, limit: opts.limit });

      // Filter by --older-than
      const sessionsToPrune = result.sessions.filter((s) => {
        const lastActive = new Date(s.lastActiveAt).getTime();
        return lastActive < cutoff;
      });

      if (sessionsToPrune.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ pruned: 0, action, sessions: [] }, null, 2));
          return;
        }
        log.info(`No sessions match the criteria (status: ${opts.status}, older than: ${opts.olderThan})`);
        return;
      }

      // Dry run: just show what would be pruned
      if (opts.dryRun) {
        if (opts.json) {
          console.log(JSON.stringify({
            action,
            olderThan: opts.olderThan,
            status: opts.status,
            count: sessionsToPrune.length,
            sessions: sessionsToPrune.map(s => ({
              id: s.id,
              title: s.title,
              status: s.status,
              lastActiveAt: s.lastActiveAt,
              agentName: s.agentName,
            })),
          }, null, 2));
          return;
        }

        console.log(`\n${BOLD}Sessions to ${action} (${sessionsToPrune.length}):${RESET}\n`);
        for (const s of sessionsToPrune) {
          const title = s.title || '(no title)';
          const lastActive = new Date(s.lastActiveAt);
          const now = new Date();
          const diffDays = Math.floor((now.getTime() - lastActive.getTime()) / (24 * 60 * 60 * 1000));
          console.log(`  ${GRAY}${s.id.slice(0, 8)}${RESET}  ${s.status.padEnd(10)}  ${GRAY}${diffDays}d ago${RESET}  ${title.slice(0, 40)}`);
        }
        console.log(`\n  ${GRAY}Run without --dry-run to ${action} these sessions.${RESET}`);
        return;
      }

      // JSON output for non-dry-run
      if (opts.json) {
        const results = [];
        for (const s of sessionsToPrune) {
          try {
            if (action === 'archive') {
              await requestDaemon('session.archive', { id: s.id });
            } else {
              await requestDaemon('session.delete', { id: s.id });
            }
            results.push({ id: s.id, status: 'success' });
          } catch (err) {
            results.push({ id: s.id, status: 'error', error: err instanceof Error ? err.message : String(err) });
          }
        }
        console.log(JSON.stringify({
          action,
          olderThan: opts.olderThan,
          status: opts.status,
          total: sessionsToPrune.length,
          results,
        }, null, 2));
        return;
      }

      // Require confirmation unless --yes
      if (!opts.yes) {
        console.log(`\n${BOLD}${action === 'delete' ? RED : YELLOW}${action.toUpperCase()} ${sessionsToPrune.length} session(s)?${RESET}`);
        if (action === 'delete') {
          console.log(`  ${RED}Warning: This cannot be undone!${RESET}`);
        }
        console.log(`\n  ${GRAY}Criteria:${RESET}`);
        console.log(`    ${GRAY}Status:${RESET}      ${opts.status}`);
        console.log(`    ${GRAY}Older than:${RESET} ${opts.olderThan}`);
        console.log(`\n  ${GRAY}Sessions:${RESET}`);
        for (const s of sessionsToPrune.slice(0, 5)) {
          const title = s.title || '(no title)';
          console.log(`    ${GRAY}${s.id.slice(0, 8)}${RESET}  ${title.slice(0, 40)}`);
        }
        if (sessionsToPrune.length > 5) {
          console.log(`    ${GRAY}... and ${sessionsToPrune.length - 5} more${RESET}`);
        }
        console.log();

        const rl = require('node:readline').createInterface({
          input: process.stdin,
          output: process.stderr,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`  ${action === 'delete' ? RED : YELLOW}Are you sure?${RESET} [y/N] `, (ans: string) => {
            rl.close();
            resolve(ans.trim().toLowerCase());
          });
        });

        if (answer !== 'y' && answer !== 'yes') {
          log.info('Aborted.');
          return;
        }
      }

      // Perform the action
      let success = 0;
      let errors = 0;

      for (const s of sessionsToPrune) {
        try {
          if (action === 'archive') {
            await requestDaemon('session.archive', { id: s.id });
          } else {
            await requestDaemon('session.delete', { id: s.id });
          }
          success++;
        } catch {
          errors++;
        }
      }

      if (errors > 0) {
        log.warn(`${action}d ${success}/${sessionsToPrune.length} sessions, ${errors} error(s)`);
      } else {
        log.success(`${action}d ${success} session(s)`);
      }
    });
}

/**
 * Format session as markdown
 */
function formatSessionMarkdown(
  session: {
    id: string;
    title: string | null;
    status: string;
    lastActiveAt: string;
    agentId: string;
    agentName?: string;
    createdAt?: string;
    tags?: string[];
  },
  messages: Array<{ role: string; content: string; createdAt?: string }>
): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${session.title || 'Untitled Session'}`);
  lines.push('');

  // Metadata
  lines.push('## Session Info');
  lines.push('');
  lines.push(`- **Session ID:** ${session.id}`);
  if (session.agentName) {
    lines.push(`- **Agent:** ${session.agentName}`);
  }
  lines.push(`- **Status:** ${session.status}`);
  if (session.createdAt) {
    lines.push(`- **Created:** ${session.createdAt}`);
  }
  lines.push(`- **Last Active:** ${session.lastActiveAt}`);
  if (session.tags && session.tags.length > 0) {
    lines.push(`- **Tags:** ${session.tags.join(', ')}`);
  }
  lines.push('');

  // Messages
  if (messages.length > 0) {
    lines.push('## Conversation');
    lines.push('');

    for (const msg of messages) {
      const role = msg.role === 'user' ? '**User**' : '**Agent**';
      const timestamp = msg.createdAt ? ` _(${msg.createdAt})_` : '';
      lines.push(`### ${role}${timestamp}`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`_Exported from ah-cli on ${new Date().toISOString()}_`);
  lines.push('');

  return lines.join('\n');
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
