import type { Command } from 'commander';
import { ensureDaemonRunning } from '../daemon/process.js';
import { requestDaemon } from '../daemon/client.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, YELLOW, RESET, renderTable, type Column } from '../utils/table.js';
import { truncate } from '../utils/formatting.js';

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
    .option('-r, --runtime <type>', 'Filter by runtime type')
    .option('-n, --name <pattern>', 'Filter by name (case-insensitive substring)')
    .option('-v, --visibility <vis>', 'Filter by visibility (public|private|unlisted)')
    .option('--sandboxed', 'Show only sandboxed agents')
    .option('--exposed', 'Show only agents with active provider bindings')
    .action(async (opts: { json?: boolean; all?: boolean; runtime?: string; name?: string; visibility?: string; sandboxed?: boolean; exposed?: boolean }) => {
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

      // Apply filters
      let filteredAgents = result.agents;
      
      if (opts.runtime) {
        filteredAgents = filteredAgents.filter((a) => 
          a.runtimeType.toLowerCase() === opts.runtime!.toLowerCase()
        );
      }
      
      if (opts.name) {
        const pattern = opts.name.toLowerCase();
        filteredAgents = filteredAgents.filter((a) => 
          a.name.toLowerCase().includes(pattern) || 
          a.slug.toLowerCase().includes(pattern)
        );
      }
      
      if (opts.visibility) {
        filteredAgents = filteredAgents.filter((a) => 
          a.visibility.toLowerCase() === opts.visibility!.toLowerCase()
        );
      }
      
      if (opts.sandboxed) {
        filteredAgents = filteredAgents.filter((a) => a.sandbox);
      }
      
      if (opts.exposed) {
        const exposedAgentIds = new Set(
          result.bindings
            .filter((b) => b.status === 'active')
            .map((b) => b.agentId)
        );
        filteredAgents = filteredAgents.filter((a) => exposedAgentIds.has(a.id));
      }

      if (opts.json) {
        console.log(JSON.stringify({ agents: filteredAgents, bindings: result.bindings }, null, 2));
        return;
      }

      if (filteredAgents.length === 0) {
        if (result.agents.length === 0) {
          log.info('No local agents registered.');
          console.log(`\n  ${GRAY}Tip: Add an agent with 'ah agent add --name <name> --project <path>'${RESET}`);
        } else {
          log.info('No agents match the specified filters.');
        }
        return;
      }

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
      const rows = filteredAgents.map((agent) => {
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
      const sandboxCount = filteredAgents.filter((a) => a.sandbox).length;
      const activeBindings = result.bindings.filter((b) => b.status === 'active').length;
      const hasFilters = opts.runtime || opts.name || opts.visibility || opts.sandboxed || opts.exposed;
      console.log('');
      if (hasFilters && filteredAgents.length !== result.agents.length) {
        console.log(`  ${GRAY}Showing: ${filteredAgents.length} of ${result.agents.length} agents, ${sandboxCount} sandboxed${RESET}`);
      } else {
        console.log(`  ${GRAY}Total: ${filteredAgents.length} agents, ${sandboxCount} sandboxed, ${activeBindings} active bindings${RESET}`);
      }
      console.log('');
    });
}