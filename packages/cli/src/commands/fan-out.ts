import type { Command } from 'commander';
import { ensureDaemonRunning } from '../daemon/process.js';
import { streamDaemon } from '../daemon/client.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, RESET } from '../utils/table.js';
import type { FanOutResult, RuntimeStreamEvent } from '../daemon/types.js';

export function registerFanOutCommand(program: Command): void {
  program
    .command('fan-out')
    .description('Run a task across multiple agents in parallel, optionally synthesize results')
    .requiredOption('--task <description>', 'Task description sent to all agents')
    .requiredOption('--agents <refs>', 'Comma-separated agent slugs or IDs')
    .option('--synthesizer <ref>', 'Agent to synthesize all results into a verdict')
    .option('--stream', 'Stream each agent\'s output in real-time')
    .option('--json', 'Output JSONL events')
    .option('--timeout <seconds>', 'Timeout in seconds', '600')
    .action(async (opts: {
      task: string;
      agents: string;
      synthesizer?: string;
      stream?: boolean;
      json?: boolean;
      timeout: string;
    }) => {
      await ensureDaemonRunning();

      const agentRefs = opts.agents.split(',').map((s) => s.trim()).filter(Boolean);
      if (agentRefs.length === 0) {
        log.error('No agents specified. Use --agents agent1,agent2,...');
        process.exit(1);
      }

      const timeoutMs = (parseInt(opts.timeout, 10) || 600) * 1000;

      const timer = setTimeout(() => {
        log.error('Fan-out timed out');
        process.exit(1);
      }, timeoutMs);

      try {
        const result = await streamDaemon<FanOutResult>(
          'runtime.fan-out',
          {
            task: opts.task,
            agentRefs,
            synthesizerRef: opts.synthesizer,
          },
          (event: unknown) => {
            const ev = event as RuntimeStreamEvent;

            if (opts.json) {
              console.log(JSON.stringify(ev));
              return;
            }

            if (ev.type === 'fan-out-progress') {
              if (ev.status === 'started') {
                console.log(`  ${BOLD}[${ev.agentSlug}]${RESET} ${GRAY}started${RESET}`);
              } else if (ev.status === 'chunk' && opts.stream && ev.delta) {
                process.stdout.write(`  ${GRAY}[${ev.agentSlug}]${RESET} ${ev.delta}`);
              } else if (ev.status === 'done') {
                console.log(`  ${BOLD}[${ev.agentSlug}]${RESET} done`);
              } else if (ev.status === 'error') {
                console.log(`  ${BOLD}[${ev.agentSlug}]${RESET} error: ${ev.error}`);
              }
            }

            if (ev.type === 'fan-out-verdict' && opts.stream) {
              process.stdout.write(ev.delta);
            }
          },
          { timeoutMs },
        );

        clearTimeout(timer);

        if (opts.json) {
          console.log(JSON.stringify({ type: 'result', ...result }));
          return;
        }

        console.log('');
        console.log(`  ${BOLD}Fan-Out Results${RESET}  task-group=${GRAY}${result.taskGroupId.slice(0, 8)}...${RESET}`);
        console.log('');

        for (const r of result.results) {
          if (r.error) {
            console.log(`  ${BOLD}${r.agentSlug}${RESET}  ${GRAY}ERROR${RESET}`);
            console.log(`  ${r.error}`);
          } else {
            console.log(`  ${BOLD}${r.agentSlug}${RESET}  ${GRAY}session=${r.sessionId.slice(0, 8)}...${RESET}`);
            const preview = r.result.length > 200 ? r.result.slice(0, 200) + '...' : r.result;
            console.log(`  ${preview}`);
          }
          console.log('');
        }

        if (result.verdict) {
          console.log(`  ${BOLD}Verdict${RESET}`);
          console.log(`  ${result.verdict}`);
          console.log('');
        }
      } catch (error) {
        clearTimeout(timer);
        log.error(`Fan-out failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
