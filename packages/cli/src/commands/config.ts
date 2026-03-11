import { Command } from 'commander';
import { loadConfig, saveConfig, getConfigPath, getLogsDir, getPidsDir, resolveRuntimeConfig, DEFAULT_RUNTIME_CONFIG } from '../utils/config.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { log } from '../utils/logger.js';
import { requestDaemon } from '../daemon/client.js';
import { ensureDaemonRunning } from '../daemon/process.js';
import { BOLD, GRAY, GREEN, YELLOW, RESET } from '../utils/table.js';

interface AutoPruneConfig {
  enabled: boolean;
  olderThan: string;
  status: string;
  action: 'archive' | 'delete';
  limit: number;
}

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage CLI configuration');

  configCmd
    .command('show')
    .description('Show current configuration')
    .option('--json', 'Output as JSON')
    .option('--secrets', 'Show sensitive values (tokens)')
    .action((opts: { json?: boolean; secrets?: boolean }) => {
      const config = loadConfig();
      const configPath = getConfigPath();
      const runtime = resolveRuntimeConfig(config);

      if (opts.json) {
        const output = {
          configPath,
          logsDir: getLogsDir(),
          pidsDir: getPidsDir(),
          agentsCount: Object.keys(config.agents).length,
          hasToken: !!config.token,
          runtime,
        };
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Human-readable output
      console.log('\n📋 AH CLI Configuration\n');
      console.log(`📁 Config file: ${configPath}`);
      console.log(`📁 Logs directory: ${getLogsDir()}`);
      console.log(`📁 PIDs directory: ${getPidsDir()}`);
      console.log(`\n🔑 Platform token: ${config.token ? (opts.secrets ? config.token : '••••••••') : 'not set'}`);

      // Agents summary
      const agents = Object.entries(config.agents);
      console.log(`\n🤖 Agents (${agents.length}):`);
      if (agents.length === 0) {
        console.log('   No agents configured');
      } else {
        for (const [name, entry] of agents) {
          const status = entry.startedAt ? `started ${formatRelativeTime(entry.startedAt)}` : 'not started';
          console.log(`   • ${name} (${entry.agentType}) - ${status}`);
        }
      }

      // Runtime config
      console.log(`\n⚙️  Runtime configuration:`);
      console.log(`   max_active_requests: ${runtime.max_active_requests}`);
      console.log(`   queue_wait_timeout_ms: ${runtime.queue_wait_timeout_ms}`);
      console.log(`   queue_max_length: ${runtime.queue_max_length}`);

      // Config file status
      const configExists = existsSync(configPath);
      console.log(`\n📊 Status: ${configExists ? '✅ Config file exists' : '⚠️  No config file yet'}`);

      console.log('\n💡 Tips:');
      console.log('   • Use --secrets to show token values');
      console.log('   • Use --json for machine-readable output');
      console.log('   • Use "ah agent list" to see agent details\n');
    });

  configCmd
    .command('path')
    .description('Show configuration file path')
    .action(() => {
      console.log(getConfigPath());
    });

  configCmd
    .command('edit')
    .description('Open configuration file in editor')
    .option('--editor <editor>', 'Editor to use (defaults to $EDITOR or nano)')
    .action(async (opts: { editor?: string }) => {
      const configPath = getConfigPath();

      // Create default config if it doesn't exist
      if (!existsSync(configPath)) {
        log.info('Creating default configuration file...');
        saveConfig({ agents: {} });
        log.success(`Created: ${configPath}`);
      }

      // Determine editor
      const editor = opts.editor || process.env.EDITOR || process.env.VISUAL || 'nano';

      log.info(`Opening config in ${editor}...`);

      // Spawn editor and wait for it to exit
      const child = spawn(editor, [configPath], {
        stdio: 'inherit',
        shell: true,
      });

      await new Promise<void>((resolve, reject) => {
        child.on('exit', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Editor exited with code ${code}`));
          }
        });
        child.on('error', (err) => {
          reject(err);
        });
      });

      // Validate the edited config
      try {
        const config = loadConfig();
        const agentCount = Object.keys(config.agents || {}).length;
        log.success('Configuration saved successfully');
        console.log(`\n  ${agentCount} agent(s) configured`);
      } catch {
        log.error('Configuration file contains invalid JSON. Please fix it.');
        process.exit(1);
      }
    });

  configCmd
    .command('runtime')
    .description('Show runtime configuration')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      const config = loadConfig();
      const runtime = resolveRuntimeConfig(config);

      if (opts.json) {
        console.log(JSON.stringify(runtime, null, 2));
        return;
      }

      console.log('\n⚙️  Runtime Configuration\n');
      console.log(`   max_active_requests: ${runtime.max_active_requests}`);
      console.log(`   queue_wait_timeout_ms: ${runtime.queue_wait_timeout_ms} (${(runtime.queue_wait_timeout_ms / 60000).toFixed(1)} min)`);
      console.log(`   queue_max_length: ${runtime.queue_max_length}`);
      console.log('\n📝 Defaults:');
      console.log(`   max_active_requests: ${DEFAULT_RUNTIME_CONFIG.max_active_requests}`);
      console.log(`   queue_wait_timeout_ms: ${DEFAULT_RUNTIME_CONFIG.queue_wait_timeout_ms}`);
      console.log(`   queue_max_length: ${DEFAULT_RUNTIME_CONFIG.queue_max_length}\n`);
    });

  // Auto prune configuration
  const autoPruneCmd = configCmd
    .command('autoprun')
    .description('Configure automatic session cleanup on daemon start');

  autoPruneCmd
    .command('show')
    .description('Show current auto prune configuration')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      await ensureDaemonRunning();
      const result = await requestDaemon<{ config: AutoPruneConfig }>('config.autoPrune.get');
      const config = result.config;

      if (opts.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      console.log(`\n${BOLD}Auto Prune Configuration${RESET}\n`);
      console.log(`  ${GRAY}Enabled:${RESET}    ${config.enabled ? `${GREEN}yes${RESET}` : `${YELLOW}no${RESET}`}`);
      console.log(`  ${GRAY}Older than:${RESET} ${config.olderThan}`);
      console.log(`  ${GRAY}Status:${RESET}     ${config.status}`);
      console.log(`  ${GRAY}Action:${RESET}     ${config.action}`);
      console.log(`  ${GRAY}Limit:${RESET}      ${config.limit === 0 ? 'no limit' : config.limit}`);
      console.log('');

      if (!config.enabled) {
        console.log(`${GRAY}Auto prune is disabled. Enable with:${RESET}`);
        console.log(`  ${GREEN}ah config autoprun enable${RESET}\n`);
      }
    });

  autoPruneCmd
    .command('enable')
    .description('Enable auto prune')
    .option('--older-than <duration>', 'Prune sessions older than this duration (e.g., 7d, 24h, 1w)', '7d')
    .option('--status <statuses>', 'Comma-separated statuses to prune (e.g., failed,idle,completed)', 'failed,idle,completed')
    .option('--action <action>', 'Action to take: archive or delete', 'archive')
    .option('--limit <number>', 'Max sessions to prune per run (0 = no limit)', '100')
    .action(async (opts: { olderThan: string; status: string; action: string; limit: string }) => {
      await ensureDaemonRunning();
      
      const limit = parseInt(opts.limit, 10);
      if (isNaN(limit) || limit < 0) {
        log.error('Invalid limit value. Must be a non-negative integer.');
        process.exit(1);
      }

      if (opts.action !== 'archive' && opts.action !== 'delete') {
        log.error('Invalid action. Must be "archive" or "delete".');
        process.exit(1);
      }

      const result = await requestDaemon<{ config: AutoPruneConfig }>('config.autoPrune.set', {
        enabled: true,
        olderThan: opts.olderThan,
        status: opts.status,
        action: opts.action,
        limit,
      });

      log.success('Auto prune enabled');
      console.log(`\n  ${GRAY}Config:${RESET}`);
      console.log(`  ${GRAY}•${RESET} Older than: ${result.config.olderThan}`);
      console.log(`  ${GRAY}•${RESET} Status: ${result.config.status}`);
      console.log(`  ${GRAY}•${RESET} Action: ${result.config.action}`);
      console.log(`  ${GRAY}•${RESET} Limit: ${result.config.limit === 0 ? 'no limit' : result.config.limit}`);
      console.log(`\n  ${GRAY}Sessions will be cleaned when daemon starts.${RESET}\n`);
    });

  autoPruneCmd
    .command('disable')
    .description('Disable auto prune')
    .action(async () => {
      await ensureDaemonRunning();
      await requestDaemon('config.autoPrune.set', { enabled: false });
      log.success('Auto prune disabled');
      console.log(`\n  ${GRAY}Sessions will no longer be auto-cleaned on daemon start.${RESET}`);
      console.log(`  ${GRAY}Use ${GREEN}ah session prune${RESET} to manually clean sessions.\n`);
    });
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}