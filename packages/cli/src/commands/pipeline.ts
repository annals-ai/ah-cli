import type { Command } from 'commander';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadToken } from '../platform/auth.js';
import { createClient } from '../platform/api-client.js';
import { resolveAgentId } from '../platform/resolve-agent.js';
import { resolveLocalAgentRef, runLocalCall } from './local-runtime.js';
import { log } from '../utils/logger.js';
import { GRAY, RESET, BOLD, GREEN } from '../utils/table.js';

const DEFAULT_BASE_URL = 'https://agents.hot';

interface PipelineStep {
  agent: string;
  task: string;
}

/**
 * Parse pipeline arguments from process.argv
 * Format: ah pipeline run <agent1> "<task1>" --then <agent2> "<task2>" --then <agent3> "<task3>"
 */
function parsePipelineArgs(args: string[]): PipelineStep[] {
  const steps: PipelineStep[] = [];
  let i = 0;

  while (i < args.length) {
    const agent = args[i];
    i++;

    // Skip --then flag
    if (agent === '--then') {
      continue;
    }

    // Skip other flags
    if (agent.startsWith('--')) {
      // Skip flag value if it's not a boolean flag
      if (i < args.length && !args[i].startsWith('--') && args[i] !== '--then') {
        i++;
      }
      continue;
    }

    // Get task
    if (i >= args.length) {
      throw new Error(`Missing task for agent: ${agent}`);
    }
    const task = args[i];
    i++;

    // Skip --then flag after task
    if (i < args.length && args[i] === '--then') {
      i++;
    }

    steps.push({ agent, task });
  }

  return steps;
}

/**
 * Parse --stages string into pipeline steps
 * Format: "agent1:task1,agent2:task2,agent3:task3"
 * Example: "trend-analyst:分析AI趋势,idea-master:基于{prev}生成创意,writer:写SEO文章"
 */
function parseStagesString(stagesStr: string): PipelineStep[] {
  const steps: PipelineStep[] = [];
  
  // Split by comma, but need to handle commas inside task descriptions
  // We'll parse character by character to handle potential edge cases
  const segments = splitStages(stagesStr);
  
  for (const segment of segments) {
    const colonIndex = segment.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid stage format: "${segment}". Expected "agent:task" format.`);
    }
    
    const agent = segment.slice(0, colonIndex).trim();
    const task = segment.slice(colonIndex + 1).trim();
    
    if (!agent) {
      throw new Error(`Missing agent name in stage: "${segment}"`);
    }
    if (!task) {
      throw new Error(`Missing task description in stage: "${segment}"`);
    }
    
    steps.push({ agent, task });
  }
  
  return steps;
}

/**
 * Split stages string by comma, respecting potential edge cases
 */
function splitStages(stagesStr: string): string[] {
  const segments: string[] = [];
  let current = '';
  let depth = 0;
  
  for (let i = 0; i < stagesStr.length; i++) {
    const char = stagesStr[i];
    
    // Track nested braces/brackets/parens
    if (char === '{' || char === '[' || char === '(') depth++;
    if (char === '}' || char === ']' || char === ')') depth--;
    
    // Split on comma only when not inside nested structures
    if (char === ',' && depth === 0) {
      segments.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    segments.push(current.trim());
  }
  
  return segments;
}

/**
 * Replace {prev} placeholder with previous output
 */
function injectPrevOutput(task: string, prevOutput: string): string {
  return task.replace(/{prev}/g, prevOutput);
}

/**
 * Execute a single pipeline step (remote agent)
 */
async function executeRemoteStep(
  step: PipelineStep,
  prevOutput: string | null,
  token: string,
  outputFile?: string,
  json?: boolean,
): Promise<string> {
  const client = createClient();
  const { id, name } = await resolveAgentId(step.agent, client);

  const taskDescription = prevOutput
    ? injectPrevOutput(step.task, prevOutput)
    : step.task;

  if (!json) {
    log.info(`Calling ${BOLD}${name}${RESET}...`);
  }

  // Use async mode for pipeline (more reliable)
  const res = await fetch(`${DEFAULT_BASE_URL}/api/agents/${id}/call`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      task_description: taskDescription,
      mode: 'async',
    }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = (body as { message?: string; error?: string }).message || (body as { error?: string }).error || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const { request_id, call_id } = await res.json() as {
    request_id: string;
    call_id: string;
    status: string;
  };

  if (!json) {
    process.stderr.write(`${GRAY}[pipeline] call=${call_id.slice(0, 8)}... polling${RESET}`);
  }

  // Poll for result
  const pollInterval = 2000;
  const maxWaitMs = 300_000; // 5 minutes per step
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await sleep(pollInterval);

    const pollRes = await fetch(`${DEFAULT_BASE_URL}/api/agents/${id}/task-status/${request_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!pollRes.ok) {
      throw new Error(`Poll failed: HTTP ${pollRes.status}`);
    }

    const task = await pollRes.json() as {
      status: string;
      result?: string;
      error_message?: string;
      error_code?: string;
    };

    if (task.status === 'completed') {
      if (!json) {
        process.stderr.write(` done\n`);
      }
      const result = task.result || '';
      
      if (outputFile) {
        writeFileSync(outputFile, result);
        if (!json) log.info(`Saved to ${outputFile}`);
      }

      return result;
    }

    if (task.status === 'failed') {
      if (!json) {
        process.stderr.write(` failed\n`);
      }
      throw new Error(`Step failed: ${task.error_message || task.error_code}`);
    }

    if (!json) {
      process.stderr.write('.');
    }
  }

  throw new Error('Step timed out');
}

/**
 * Execute a single pipeline step (local agent)
 */
async function executeLocalStep(
  step: PipelineStep,
  prevOutput: string | null,
  outputFile?: string,
  json?: boolean,
): Promise<string> {
  const taskDescription = prevOutput
    ? injectPrevOutput(step.task, prevOutput)
    : step.task;

  if (!json) {
    log.info(`Calling local agent ${BOLD}${step.agent}${RESET}...`);
  }

  const result = await runLocalCall({
    agentRef: step.agent,
    message: taskDescription,
    json,
  });

  if (outputFile && result.result) {
    writeFileSync(outputFile, result.result);
    if (!json) log.info(`Saved to ${outputFile}`);
  }

  return result.result || '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerPipelineCommand(program: Command): void {
  const pipelineCmd = program
    .command('pipeline')
    .description('Chain multiple agent calls in a pipeline');

  pipelineCmd
    .command('run')
    .description('Run a pipeline: each step\'s output is passed to the next via {prev}')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .option('--stages <spec>', 'Pipeline stages: "agent1:task1,agent2:task2 with {prev},agent3:task3"')
    .option('--output-file <path>', 'Save final result to file')
    .option('--json', 'Output JSON for each step')
    .option('--timeout <seconds>', 'Timeout per step in seconds', '300')
    .option('-p, --parallel', 'Run all steps in parallel (ignore {prev} dependencies)')
    .option('-n, --dry-run', 'Preview pipeline without executing')
    .action(async (opts: {
      stages?: string;
      outputFile?: string;
      json?: boolean;
      timeout?: string;
      parallel?: boolean;
      dryRun?: boolean;
    }) => {
      let steps: PipelineStep[];

      // Check if --stages is provided
      if (opts.stages) {
        // Parse stages string
        steps = parseStagesString(opts.stages);
      } else {
        // Parse pipeline steps from raw args (legacy --then syntax)
        const rawArgs = process.argv.slice(process.argv.indexOf('run') + 1);
        
        // Filter out known options
        const stepArgs: string[] = [];
        for (let i = 0; i < rawArgs.length; i++) {
          const arg = rawArgs[i];
          if (arg === '--stages') {
            i++; // Skip value
            continue;
          }
          if (arg === '--output-file') {
            i++; // Skip value
            continue;
          }
          if (arg === '--json' || arg === '--parallel' || arg === '-p' || arg === '--dry-run' || arg === '-n') {
            continue;
          }
          if (arg === '--timeout') {
            i++; // Skip value
            continue;
          }
          stepArgs.push(arg);
        }

        steps = parsePipelineArgs(stepArgs);
      }

      if (steps.length === 0) {
        log.error('No pipeline steps provided');
        console.error('');
        console.error('Usage:');
        console.error('  ah pipeline run --stages "agent1:task1,agent2:task2,agent3:task3"');
        console.error('  ah pipeline run <agent1> "<task1>" --then <agent2> "<task2>"');
        console.error('');
        console.error('Examples:');
        console.error('  # New --stages syntax:');
        console.error('  ah pipeline run --stages "trend-analyst:分析AI趋势,idea-master:基于{prev}生成创意,writer:写SEO文章"');
        console.error('');
        console.error('  # Parallel execution (all steps run simultaneously):');
        console.error('  ah pipeline run --stages "agent1:task1,agent2:task2,agent3:task3" --parallel');
        console.error('');
        console.error('  # Dry-run (preview without executing):');
        console.error('  ah pipeline run --stages "agent1:task1,agent2:task2" --dry-run');
        console.error('');
        console.error('  # Legacy --then syntax:');
        console.error('  ah pipeline run trend-analyst "/trend AI tools" --then idea-master "/brainstorm {prev}"');
        console.error('');
        process.exit(1);
      }

      if (!opts.json) {
        const mode = opts.parallel ? 'parallel' : 'sequential';
        log.info(`Running pipeline with ${steps.length} step(s) [${mode}]...`);
        steps.forEach((step, i) => {
          console.log(`  ${GRAY}${i + 1}.${RESET} ${BOLD}${step.agent}${RESET}: "${step.task.slice(0, 50)}${step.task.length > 50 ? '...' : ''}"`);
        });
        console.log('');
      }

      // Dry-run mode: just show the plan
      if (opts.dryRun) {
        log.success('Dry run complete. No agents were called.');
        console.log('\n  Use without --dry-run to execute.');
        return;
      }

      try {
        // Check auth
        const token = loadToken();
        const hasAuth = !!token;
        const startTime = Date.now();

        let prevOutput: string | null = null;
        let results: string[] = [];

        if (opts.parallel) {
          // Parallel execution: run all steps simultaneously
          if (!opts.json) {
            log.info('Running all steps in parallel...');
          }

          // Create execution promises for all steps
          const executionPromises = steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            const stepOutputFile = isLast ? opts.outputFile : undefined;
            const isLocal = resolveLocalAgentRef(step.agent);

            if (isLocal) {
              return executeLocalStep(step, null, stepOutputFile, opts.json);
            } else if (hasAuth) {
              return executeRemoteStep(step, null, token!, stepOutputFile, opts.json);
            } else {
              log.error(`Agent not found locally and not authenticated: ${step.agent}`);
              log.error('Run `ah login` to call remote agents');
              process.exit(1);
            }
          });

          // Execute all in parallel
          results = await Promise.all(executionPromises);
          prevOutput = results[results.length - 1] || '';

          if (!opts.json) {
            steps.forEach((step, i) => {
              log.success(`Step ${i + 1} (${step.agent}) completed (${results[i].length} chars)`);
            });
          }
        } else {
          // Sequential execution (default)
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const isLast = i === steps.length - 1;
            const stepOutputFile = isLast ? opts.outputFile : undefined;

            const isLocal = resolveLocalAgentRef(step.agent);

            if (isLocal) {
              prevOutput = await executeLocalStep(step, prevOutput, stepOutputFile, opts.json);
            } else if (hasAuth) {
              prevOutput = await executeRemoteStep(step, prevOutput, token!, stepOutputFile, opts.json);
            } else {
              log.error(`Agent not found locally and not authenticated: ${step.agent}`);
              log.error('Run `ah login` to call remote agents');
              process.exit(1);
            }

            if (!opts.json && !isLast) {
              log.success(`Step ${i + 1} completed (${prevOutput.length} chars)`);
              console.log('');
            }
          }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        if (opts.json) {
          console.log(JSON.stringify({
            status: 'completed',
            steps: steps.length,
            mode: opts.parallel ? 'parallel' : 'sequential',
            elapsed_seconds: parseFloat(elapsed),
            results: opts.parallel ? results : [prevOutput],
            result: prevOutput,
          }));
        } else {
          log.success(`Pipeline completed in ${elapsed}s (${opts.parallel ? 'parallel' : 'sequential'})`);
          if (!opts.outputFile && prevOutput) {
            console.log('');
            console.log(prevOutput);
          }
        }
      } catch (err) {
        const msg = (err as Error).message;
        log.error(`Pipeline failed: ${msg}`);
        process.exit(1);
      }
    });
}