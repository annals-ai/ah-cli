import type { Command } from 'commander';
import { ensureDaemonRunning } from '../daemon/process.js';
import { requestDaemon } from '../daemon/client.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, YELLOW, RESET, renderTable, type Column } from '../utils/table.js';

/**
 * Shortcut command: `ah agents` - alias for `ah agent list`
 * Provides a shorter, more intuitive command for listing agents.
 */
export function registerAgentsShortcutCommand(program: Command): void {
  program
    .command('agents')
    .description('List local agents (shortcut for: ah agent list)')
    .option('--json', 'Output JSON')
    .option('-a, --all', 'Show all agents including archived')
    .action(async (opts: { json?: boolean; all?: boolean }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{
        agents: Array<{
          id: string;
          slug: string;
          name: string;
          runtimeType: string;
          projectPath: string;
          sandbox: boolean;
          visibility: string;
        }>;
        bindings: Array<{ agentId: string; provider: string; status: string }>;
      }>('agent.list');

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.agents.length === 0) {
        log.info('No local agents registered.');
        console.log(`\n  ${GRAY}Tip: Add an agent with 'ah agent add --name <name> --project <path>'${RESET}`);
        return;
      }

      // Truncate helper
      const truncate = (str: string, maxLen: number): string => {
        if (!str) return '';
        return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
      };

      // Define table columns
      const columns: Column[] = [
        { key: 'id', label: 'ID', width: 8 },
        { key: 'slug', label: 'Slug', width: 16 },
        { key: 'runtime', label: 'Runtime', width: 9 },
        { key: 'name', label: 'Name', width: 20 },
        { key: 'sandbox', label: 'Sandbox', width: 8 },
        { key: 'providers', label: 'Providers', width: 24 },
      ];

      // Format rows
      const rows = result.agents.map((agent) => {
        const bindings = result.bindings.filter((binding) => binding.agentId === agent.id);
        const providerSummary = bindings.length > 0
          ? bindings.map((b) => {
              const statusColor = b.status === 'active' ? GREEN : b.status === 'pending' ? YELLOW : GRAY;
              return `${b.provider}(${statusColor}${b.status}${RESET})`;
            }).join(' ')
          : '-';

        const sandboxDisplay = agent.sandbox
          ? `${GREEN}on${RESET}`
          : `${GRAY}off${RESET}`;

        return {
          id: agent.id.slice(0, 7),
          slug: truncate(agent.slug, 14),
          runtime: agent.runtimeType,
          name: truncate(agent.name, 18),
          sandbox: sandboxDisplay,
          providers: providerSummary,
        };
      });

      console.log('');
      console.log(renderTable(columns, rows));

      // Print summary
      const sandboxCount = result.agents.filter((a) => a.sandbox).length;
      const activeBindings = result.bindings.filter((b) => b.status === 'active').length;
      console.log('');
      console.log(`  ${GRAY}Total: ${result.agents.length} agents, ${sandboxCount} sandboxed, ${activeBindings} active bindings${RESET}`);
      console.log('');
    });
}