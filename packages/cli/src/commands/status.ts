import type { Command } from 'commander';
import { hasToken, loadToken } from '../platform/auth.js';
import { requestDaemon } from '../daemon/client.js';
import { getDaemonStatus } from '../daemon/process.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, RESET, YELLOW } from '../utils/table.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show daemon, local agent, and auth status')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      if (!opts.json) {
        log.banner('AH Status');
      }

      const daemon = await getDaemonStatus();
      const result: {
        daemon: {
          running: boolean;
          socketPath: string;
          logPath: string;
        };
        runtime?: {
          startedAt: string;
          agents: number;
          sessions: number;
          taskGroups: number;
          activeBindings: number;
        };
        auth: {
          loggedIn: boolean;
          token?: string;
        };
      } = {
        daemon: {
          running: daemon.running,
          socketPath: daemon.socketPath,
          logPath: daemon.logPath,
        },
        auth: {
          loggedIn: hasToken(),
        },
      };

      if (daemon.reachable) {
        const runtime = await requestDaemon<{
          agents: number;
          sessions: number;
          taskGroups: number;
          startedAt: string;
        }>('daemon.status');

        const agentListing = await requestDaemon<{
          agents: Array<{ id: string }>;
          bindings: Array<{ status: string }>;
        }>('agent.list');

        const activeBindings = agentListing.bindings.filter((binding) => binding.status !== 'inactive').length;

        result.runtime = {
          startedAt: runtime.startedAt,
          agents: runtime.agents,
          sessions: runtime.sessions,
          taskGroups: runtime.taskGroups,
          activeBindings,
        };

        if (!opts.json) {
          console.log(`Daemon: ${daemon.running ? `${GREEN}running${RESET}` : `${YELLOW}stopped${RESET}`}`);
          console.log(`Socket: ${daemon.socketPath}`);
          console.log(`Log:    ${daemon.logPath}`);
          console.log(`Started:${runtime.startedAt}`);
          console.log(`Agents: ${runtime.agents}`);
          console.log(`Tasks:  ${runtime.taskGroups}`);
          console.log(`Sessions: ${runtime.sessions}`);
          console.log(`Expose: ${activeBindings}`);
        }
      } else {
        if (!opts.json) {
          console.log(`Daemon: ${daemon.running ? `${GREEN}running${RESET}` : `${YELLOW}stopped${RESET}`}`);
          console.log(`Socket: ${daemon.socketPath}`);
          console.log(`Log:    ${daemon.logPath}`);
          console.log('');
          console.log(`${GRAY}Tip: Run 'ah daemon start' to start the daemon.${RESET}`);
        }
      }

      if (!hasToken()) {
        if (!opts.json) {
          console.log('Auth:   not logged in');
          console.log('');
          console.log('Run `ah login` to enable provider sync/expose.');
        }
      } else {
        const token = loadToken()!;
        result.auth.token = token.slice(0, 8) + '...' + token.slice(-4);

        if (!opts.json) {
          console.log(`Auth:   logged in (${result.auth.token})`);
          console.log('');
          console.log(`  ${BOLD}Primary Flow${RESET}`);
          console.log(`  ${GRAY}1.${RESET} ah daemon start`);
          console.log(`  ${GRAY}2.${RESET} ah agent add --name ... --project ...`);
          console.log(`  ${GRAY}3.${RESET} ah chat <local-agent> "..."`);
          console.log(`  ${GRAY}4.${RESET} ah agent expose <local-agent> --provider agents-hot`);
        }
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      }
    });
}
