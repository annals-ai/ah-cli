import { Command } from 'commander';
import { loadConfig, getConfigPath, getLogsDir, getPidsDir, resolveRuntimeConfig, DEFAULT_RUNTIME_CONFIG } from '../utils/config.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

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