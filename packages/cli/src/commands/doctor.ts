import type { Command } from 'commander';
import { existsSync, accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getDaemonStatus } from '../daemon/process.js';
import { requestDaemon } from '../daemon/client.js';
import { hasToken, loadToken } from '../platform/auth.js';
import { loadConfig, getConfigPath, getLogsDir, getPidsDir } from '../utils/config.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, RED, YELLOW, RESET, CYAN } from '../utils/table.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  detail?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose common issues with ah CLI setup')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      const results: CheckResult[] = [];

      // Check 1: Config file exists and is valid
      const configPath = getConfigPath();
      try {
        const config = loadConfig();
        results.push({
          name: 'Config',
          status: 'ok',
          message: `Valid config at ${configPath}`,
        });
        
        // Check agents count
        const agentCount = Object.keys(config.agents || {}).length;
        if (agentCount === 0) {
          results.push({
            name: 'Agents',
            status: 'warn',
            message: 'No agents configured',
            detail: 'Run "ah agent add --name <name> --project <path>" to add an agent',
          });
        }
      } catch (err) {
        if (existsSync(configPath)) {
          results.push({
            name: 'Config',
            status: 'error',
            message: 'Config file exists but is invalid JSON',
            detail: configPath,
          });
        } else {
          results.push({
            name: 'Config',
            status: 'warn',
            message: 'No config file found (will be created on first use)',
            detail: configPath,
          });
        }
      }

      // Check 2: Directories are writable
      const logsDir = getLogsDir();
      const pidsDir = getPidsDir();
      
      try {
        accessSync(logsDir, constants.W_OK);
        results.push({ name: 'Logs dir', status: 'ok', message: `Writable: ${logsDir}` });
      } catch {
        results.push({ name: 'Logs dir', status: 'error', message: `Not writable: ${logsDir}` });
      }

      try {
        accessSync(pidsDir, constants.W_OK);
        results.push({ name: 'PIDs dir', status: 'ok', message: `Writable: ${pidsDir}` });
      } catch {
        results.push({ name: 'PIDs dir', status: 'error', message: `Not writable: ${pidsDir}` });
      }

      // Check 3: Daemon status
      const daemonStatus = await getDaemonStatus();
      if (daemonStatus.running && daemonStatus.reachable) {
        results.push({
          name: 'Daemon',
          status: 'ok',
          message: `Running (PID ${daemonStatus.pid})`,
        });

        // Check runtime info
        try {
          const runtime = await requestDaemon<{
            agents: number;
            sessions: number;
            taskGroups: number;
          }>('daemon.status');
          results.push({
            name: 'Runtime',
            status: 'ok',
            message: `${runtime.agents} agents, ${runtime.sessions} sessions, ${runtime.taskGroups} tasks`,
          });
        } catch {
          results.push({
            name: 'Runtime',
            status: 'warn',
            message: 'Could not fetch runtime info',
          });
        }
      } else if (daemonStatus.running && !daemonStatus.reachable) {
        results.push({
          name: 'Daemon',
          status: 'error',
          message: 'Running but not reachable (socket issue?)',
          detail: `Socket: ${daemonStatus.socketPath}`,
        });
      } else {
        results.push({
          name: 'Daemon',
          status: 'warn',
          message: 'Not running',
          detail: 'Run "ah daemon start" to start the daemon',
        });
      }

      // Check 4: Authentication
      if (hasToken()) {
        const token = loadToken()!;
        results.push({
          name: 'Auth',
          status: 'ok',
          message: `Logged in (token: ${token.slice(0, 8)}...${token.slice(-4)})`,
        });
      } else {
        results.push({
          name: 'Auth',
          status: 'warn',
          message: 'Not logged in',
          detail: 'Run "ah login" to enable provider sync/expose features',
        });
      }

      // Check 5: Node.js version
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
      if (majorVersion >= 20) {
        results.push({
          name: 'Node.js',
          status: 'ok',
          message: `${nodeVersion} (recommended: 20+)`,
        });
      } else {
        results.push({
          name: 'Node.js',
          status: 'warn',
          message: `${nodeVersion} (recommended: 20+)`,
          detail: 'Some features may not work correctly on older Node.js versions',
        });
      }

      // Output results
      if (opts.json) {
        console.log(JSON.stringify({
          checks: results,
          summary: {
            ok: results.filter(r => r.status === 'ok').length,
            warn: results.filter(r => r.status === 'warn').length,
            error: results.filter(r => r.status === 'error').length,
          },
        }, null, 2));
        return;
      }

      console.log(`\n${BOLD}${CYAN}AH Doctor - Diagnostics${RESET}\n`);

      for (const result of results) {
        const icon = result.status === 'ok' ? '✅' : result.status === 'warn' ? '⚠️' : '❌';
        const statusColor = result.status === 'ok' ? GREEN : result.status === 'warn' ? YELLOW : RED;
        console.log(`  ${icon}  ${BOLD}${result.name}:${RESET} ${statusColor}${result.message}${RESET}`);
        if (result.detail) {
          console.log(`      ${GRAY}${result.detail}${RESET}`);
        }
      }

      // Summary
      const okCount = results.filter(r => r.status === 'ok').length;
      const warnCount = results.filter(r => r.status === 'warn').length;
      const errorCount = results.filter(r => r.status === 'error').length;

      console.log('');
      if (errorCount > 0) {
        console.log(`  ${RED}${BOLD}Found ${errorCount} error(s)${RESET} that need attention.`);
      } else if (warnCount > 0) {
        console.log(`  ${YELLOW}${warnCount} warning(s)${RESET}. All systems operational.`);
      } else {
        console.log(`  ${GREEN}All systems healthy!${RESET}`);
      }
      console.log('');
    });
}