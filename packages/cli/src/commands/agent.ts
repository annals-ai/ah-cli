import type { Command } from 'commander';
import { ensureDaemonRunning } from '../daemon/process.js';
import { requestDaemon } from '../daemon/client.js';
import { listProviders } from '../providers/index.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, YELLOW, RED, RESET, renderTable, type Column } from '../utils/table.js';
import { getDaemonLogPath } from '../daemon/paths.js';
import { readFileSync } from 'node:fs';

function parseCapabilities(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseJsonConfig(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

export function registerAgentCommand(program: Command): void {
  const agent = program
    .command('agent')
    .description('Manage local daemon-owned agents');

  agent
    .command('add')
    .description('Register a local agent')
    .requiredOption('--name <name>', 'Agent name')
    .requiredOption('--project <path>', 'Project directory for the agent')
    .option('--slug <slug>', 'Local slug')
    .option('--runtime-type <type>', 'Runtime type', 'claude')
    .option('--sandbox', 'Enable sandbox/workspace isolation for this agent')
    .option('--persona <text>', 'Persona/role prompt injected before each message')
    .option('--description <text>', 'Description')
    .option('--visibility <visibility>', 'public | private | unlisted', 'private')
    .option('--capabilities <caps>', 'Comma-separated capabilities')
    .action(async (opts: {
      name: string;
      project: string;
      slug?: string;
      runtimeType: string;
      sandbox?: boolean;
      persona?: string;
      description?: string;
      visibility: 'public' | 'private' | 'unlisted';
      capabilities?: string;
    }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{ agent: { id: string; slug: string; name: string } }>('agent.add', {
        name: opts.name,
        slug: opts.slug,
        runtimeType: opts.runtimeType,
        projectPath: opts.project,
        sandbox: opts.sandbox === true,
        persona: opts.persona,
        description: opts.description,
        visibility: opts.visibility,
        capabilities: parseCapabilities(opts.capabilities),
      });
      log.success(`Local agent added: ${BOLD}${result.agent.name}${RESET} (${result.agent.slug})`);
    });

  agent
    .command('list')
    .description('List local agents')
    .option('--json', 'Output JSON')
    .option('-r, --runtime <type>', 'Filter by runtime type')
    .option('-n, --name <pattern>', 'Filter by name (case-insensitive substring)')
    .option('-v, --visibility <vis>', 'Filter by visibility (public|private|unlisted)')
    .option('--sandboxed', 'Show only sandboxed agents')
    .option('--exposed', 'Show only agents with active provider bindings')
    .action(async (opts: { json?: boolean; runtime?: string; name?: string; visibility?: string; sandboxed?: boolean; exposed?: boolean }) => {
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
          console.log(`\n  ${GRAY}Tip: Run 'ah agent add --name <name> --project <path>' to register an agent.${RESET}`);
        } else {
          log.info('No agents match the specified filters.');
        }
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
        { key: 'visibility', label: 'Visibility', width: 10 },
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

        const visibilityColor = agent.visibility === 'public'
          ? GREEN
          : agent.visibility === 'unlisted'
            ? YELLOW
            : GRAY;

        return {
          id: agent.id.slice(0, 7),
          slug: truncate(agent.slug, 14),
          runtime: agent.runtimeType,
          name: truncate(agent.name, 18),
          sandbox: sandboxDisplay,
          visibility: `${visibilityColor}${agent.visibility}${RESET}`,
          providers: providerSummary,
        };
      });

      console.log('');
      console.log(renderTable(columns, rows));

      // Print summary
      const sandboxCount = filteredAgents.filter((a) => a.sandbox).length;
      const publicCount = filteredAgents.filter((a) => a.visibility === 'public').length;
      const activeBindings = result.bindings.filter((b) => b.status === 'active').length;
      const hasFilters = opts.runtime || opts.name || opts.visibility || opts.sandboxed || opts.exposed;
      console.log('');
      if (hasFilters && filteredAgents.length !== result.agents.length) {
        console.log(`  ${GRAY}Showing: ${filteredAgents.length} of ${result.agents.length} agents, ${sandboxCount} sandboxed, ${publicCount} public${RESET}`);
      } else {
        console.log(`  ${GRAY}Total: ${filteredAgents.length} agents, ${sandboxCount} sandboxed, ${publicCount} public, ${activeBindings} active bindings${RESET}`);
      }
      console.log('');
    });

  agent
    .command('show <ref>')
    .description('Show one local agent')
    .option('--json', 'Output JSON')
    .action(async (ref: string, opts: { json?: boolean }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{
        agent: Record<string, unknown>;
        bindings: Array<Record<string, unknown>>;
      }>('agent.get', { ref });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Human-readable output
      const agent = result.agent as {
        id: string;
        slug: string;
        name: string;
        runtimeType: string;
        projectPath: string;
        sandbox: boolean;
        persona?: string | null;
        description?: string | null;
        capabilities?: string[];
        visibility: string;
      };
      const bindings = result.bindings as Array<{ provider: string; status: string; remoteAgentId?: string }>;

      // Header
      console.log(`\n${BOLD}Agent Details${RESET}\n`);

      // Agent info
      console.log(`  ${GRAY}ID:${RESET}          ${agent.id}`);
      console.log(`  ${GRAY}Slug:${RESET}        ${agent.slug}`);
      console.log(`  ${GRAY}Name:${RESET}        ${agent.name}`);
      console.log(`  ${GRAY}Runtime:${RESET}     ${agent.runtimeType}`);
      console.log(`  ${GRAY}Project:${RESET}     ${agent.projectPath}`);
      console.log(`  ${GRAY}Sandbox:${RESET}     ${agent.sandbox ? `${GREEN}enabled${RESET}` : `${GRAY}disabled${RESET}`}`);

      const visibilityColor = agent.visibility === 'public' ? GREEN : agent.visibility === 'unlisted' ? YELLOW : GRAY;
      console.log(`  ${GRAY}Visibility:${RESET}  ${visibilityColor}${agent.visibility}${RESET}`);

      if (agent.description) {
        const descLines = agent.description.split('\n');
        const descPreview = descLines.length > 1 ? descLines[0].slice(0, 80) + '...' : agent.description;
        console.log(`  ${GRAY}Description:${RESET} ${descPreview}`);
      }

      if (agent.persona) {
        const personaLines = agent.persona.split('\n');
        const personaPreview = personaLines.length > 1 ? personaLines[0].slice(0, 80) + '...' : agent.persona.slice(0, 100);
        console.log(`  ${GRAY}Persona:${RESET}     ${personaPreview}${agent.persona.length > 100 ? '...' : ''}`);
      }

      if (agent.capabilities && agent.capabilities.length > 0) {
        console.log(`  ${GRAY}Capabilities:${RESET} ${agent.capabilities.join(', ')}`);
      }

      // Provider bindings
      if (bindings && bindings.length > 0) {
        console.log(`\n  ${BOLD}Provider Bindings${RESET}`);
        for (const binding of bindings) {
          const statusColor = binding.status === 'active' ? GREEN : binding.status === 'pending' ? YELLOW : GRAY;
          const statusStr = `${statusColor}${binding.status}${RESET}`;
          const remoteId = binding.remoteAgentId ? ` ${GRAY}(${binding.remoteAgentId})${RESET}` : '';
          console.log(`    ${GRAY}${binding.provider}:${RESET} ${statusStr}${remoteId}`);
        }
      }

      console.log();
    });

  agent
    .command('update <ref>')
    .description('Update a local agent')
    .option('--name <name>', 'Agent name')
    .option('--slug <slug>', 'Local slug')
    .option('--runtime-type <type>', 'Runtime type')
    .option('--project <path>', 'Project directory')
    .option('--sandbox', 'Enable sandbox')
    .option('--no-sandbox', 'Disable sandbox')
    .option('--persona <text>', 'Persona/role prompt injected before each message')
    .option('--description <text>', 'Description')
    .option('--visibility <visibility>', 'public | private | unlisted')
    .option('--capabilities <caps>', 'Comma-separated capabilities')
    .action(async (ref: string, opts: {
      name?: string;
      slug?: string;
      runtimeType?: string;
      project?: string;
      sandbox?: boolean;
      persona?: string;
      description?: string;
      visibility?: 'public' | 'private' | 'unlisted';
      capabilities?: string;
    }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{ agent: { slug: string; name: string } }>('agent.update', {
        ref,
        name: opts.name,
        slug: opts.slug,
        runtimeType: opts.runtimeType,
        projectPath: opts.project,
        sandbox: typeof opts.sandbox === 'boolean' ? opts.sandbox : undefined,
        persona: opts.persona,
        description: opts.description,
        visibility: opts.visibility,
        capabilities: parseCapabilities(opts.capabilities),
      });
      log.success(`Local agent updated: ${BOLD}${result.agent.name}${RESET} (${result.agent.slug})`);
    });

  agent
    .command('remove <ref>')
    .description('Remove a local agent')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (ref: string, opts: { yes?: boolean }) => {
      await ensureDaemonRunning();

      // Get agent info for confirmation message
      const result = await requestDaemon<{
        agent: { id: string; slug: string; name: string };
        bindings: Array<{ provider: string; status: string }>;
      }>('agent.get', { ref });

      const agent = result.agent;
      const activeBindings = result.bindings?.filter((b) => b.status !== 'inactive') ?? [];

      // Require confirmation unless --yes is passed
      if (!opts.yes) {
        const bindingWarning = activeBindings.length > 0
          ? `\n  ${YELLOW}Warning:${RESET} This agent has ${activeBindings.length} active provider binding(s).`
          : '';

        process.stderr.write(`\n  ${BOLD}Remove agent?${RESET}\n`);
        process.stderr.write(`  ${GRAY}Name:${RESET}  ${agent.name}\n`);
        process.stderr.write(`  ${GRAY}Slug:${RESET}  ${agent.slug}\n`);
        process.stderr.write(`  ${GRAY}ID:${RESET}    ${agent.id}${bindingWarning}\n\n`);

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

      await requestDaemon('agent.remove', { ref });
      log.success(`Local agent removed: ${BOLD}${agent.name}${RESET} (${agent.slug})`);
    });

  agent
    .command('expose <ref>')
    .description(`Expose a local agent through a provider (${listProviders().join(', ')})`)
    .requiredOption('--provider <provider>', 'Provider name')
    .option('--config-json <json>', 'Provider-specific JSON config')
    .action(async (ref: string, opts: { provider: string; configJson?: string }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{
        agent: { slug: string };
        binding: { provider: string; status: string; remoteAgentId?: string | null };
      }>('agent.expose', {
        ref,
        provider: opts.provider,
        config: parseJsonConfig(opts.configJson),
      });
      log.success(`Agent exposed via ${result.binding.provider}`);
      if (result.binding.remoteAgentId) {
        console.log(`  ${GRAY}remote id${RESET} ${result.binding.remoteAgentId}`);
      }
      console.log(`  ${GRAY}status${RESET}    ${result.binding.status}`);
    });

  agent
    .command('unexpose <ref>')
    .description('Disable a provider exposure for a local agent')
    .requiredOption('--provider <provider>', 'Provider name')
    .action(async (ref: string, opts: { provider: string }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{ binding: { provider: string; status: string } }>('agent.unexpose', {
        ref,
        provider: opts.provider,
      });
      log.success(`Agent exposure updated: ${result.binding.provider} -> ${result.binding.status}`);
    });

  agent
    .command('clone <ref>')
    .description('Clone an existing agent with a new name')
    .requiredOption('--name <name>', 'New agent name')
    .option('--slug <slug>', 'New local slug (defaults to name-based)')
    .option('--project <path>', 'Override project directory')
    .option('--reset-exposure', 'Do not copy provider bindings to the new agent')
    .action(async (ref: string, opts: { name: string; slug?: string; project?: string; resetExposure?: boolean }) => {
      await ensureDaemonRunning();

      // Get the existing agent
      const result = await requestDaemon<{
        agent: {
          id: string;
          slug: string;
          name: string;
          runtimeType: string;
          projectPath: string;
          sandbox: boolean;
          persona: string | null;
          description: string | null;
          capabilities: string[];
          visibility: string;
        };
        bindings: Array<{
          agentId: string;
          provider: string;
          status: string;
          config: Record<string, unknown>;
        }>;
      }>('agent.get', { ref });

      const sourceAgent = result.agent;

      // Create the new agent with copied config
      const newAgent = await requestDaemon<{ agent: { id: string; slug: string; name: string } }>('agent.add', {
        name: opts.name,
        slug: opts.slug,
        runtimeType: sourceAgent.runtimeType,
        projectPath: opts.project ?? sourceAgent.projectPath,
        sandbox: sourceAgent.sandbox,
        persona: sourceAgent.persona,
        description: sourceAgent.description,
        visibility: sourceAgent.visibility,
        capabilities: sourceAgent.capabilities,
      });

      log.success(`Agent cloned: ${BOLD}${newAgent.agent.name}${RESET} (${newAgent.agent.slug})`);

      // Copy provider bindings unless --reset-exposure is passed
      if (!opts.resetExposure && result.bindings && result.bindings.length > 0) {
        const activeBindings = result.bindings.filter((b) => b.status !== 'inactive');
        if (activeBindings.length > 0) {
          log.info(`Copying ${activeBindings.length} provider binding(s)...`);
          for (const binding of activeBindings) {
            try {
              await requestDaemon('agent.expose', {
                ref: newAgent.agent.slug,
                provider: binding.provider,
                config: binding.config,
              });
              console.log(`  ${GRAY}${binding.provider}${RESET}: copied`);
            } catch (err) {
              console.log(`  ${GRAY}${binding.provider}${RESET}: failed - ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }

      process.stderr.write(`\nOriginal: ${sourceAgent.name} (${sourceAgent.slug})\n`);
      process.stderr.write(`Clone:    ${newAgent.agent.name} (${newAgent.agent.slug})\n`);
    });
}
