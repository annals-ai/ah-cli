import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { createClient, PlatformApiError } from '../platform/api-client.js';
import { resolveAgentId } from '../platform/resolve-agent.js';
import { loadConfig } from '../utils/config.js';
import { spawnBackground, getLogPath, readPid, isProcessAlive, stopProcess } from '../utils/process-manager.js';
import {
  AgentMeshToolError,
  type AgentMeshToolResponse,
  errorResponse,
  successResponse,
  unauthorizedError,
  validationError,
  internalError,
} from './errors.js';
import { getMcpToken } from './auth.js';
import {
  assertExecutionSucceeded,
  commandRequiresAuth,
  executeCliCommand,
  getDefaultCommandTimeoutMs,
  type OutputParseMode,
  validatePassthroughArgs,
} from './cli-executor.js';
import { chatAgentViaApi } from './call-chat.js';

const DEFAULT_BASE_URL = 'https://agents.hot';

const TOOL_RESULT_SCHEMA = z.object({
  ok: z.boolean(),
  source: z.enum(['semantic', 'cli_passthrough']),
  command: z.string().optional(),
  data: z.any().optional(),
  events: z.array(z.any()).optional(),
  pagination: z.object({
    total_count: z.number().optional(),
    count: z.number().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    has_more: z.boolean().optional(),
    next_offset: z.number().optional(),
  }).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
  auth_required: z.boolean().optional(),
  suggestion: z.string().optional(),
});

export type ToolRegistryOptions = {
  cliScriptPath?: string;
  timeoutMs?: number;
  baseUrl?: string;
};

const READONLY_LOCAL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const READONLY_REMOTE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const MUTATION_REMOTE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const DESTRUCTIVE_REMOTE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const MUTATION_LOCAL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export function registerAgentMeshTools(server: McpServer, options: ToolRegistryOptions = {}): void {
  const timeoutMs = options.timeoutMs ?? getDefaultCommandTimeoutMs();
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

  server.registerTool('agent_mesh_discover_agents', {
    title: 'Discover Agents',
    description: 'Discover agents on the A2A network. Works without login for public discovery.',
    inputSchema: {
      capability: z.string().optional(),
      online: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: READONLY_REMOTE_ANNOTATIONS,
  }, async ({ capability, online, limit, offset }) => {
    return toMcpToolResult(async () => {
      const params = new URLSearchParams();
      if (capability) params.set('capability', capability);
      if (online) params.set('online', 'true');
      params.set('limit', String(limit));
      params.set('offset', String(offset));

      const token = getMcpToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`${baseUrl}/api/agents/discover?${params.toString()}`, { headers });
      if (!response.ok) {
        throw validationError(await readErrorMessage(response));
      }

      const payload = await response.json() as {
        agents: unknown[];
        total: number;
        limit: number;
        offset: number;
      };

      const pagination = {
        total_count: payload.total,
        count: payload.agents.length,
        limit: payload.limit,
        offset: payload.offset,
        has_more: payload.total > payload.offset + payload.agents.length,
        next_offset: payload.total > payload.offset + payload.agents.length
          ? payload.offset + payload.agents.length
          : undefined,
      };

      return successResponse({
        source: 'semantic',
        command: `GET ${baseUrl}/api/agents/discover`,
        data: payload,
        pagination,
      });
    }, { source: 'semantic', command: 'discover' });
  });

  server.registerTool('agent_mesh_call_agent', {
    title: 'Call Agent',
    description: 'Call an agent on the A2A network. Returns normalized JSONL events and final result.',
    inputSchema: {
      agent: z.string(),
      task: z.string(),
      stream: z.boolean().default(false),
      with_files: z.boolean().default(false),
      timeout_seconds: z.number().int().min(1).max(3600).default(300),
      rate: z.number().int().min(1).max(5).optional(),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: MUTATION_REMOTE_ANNOTATIONS,
  }, async ({ agent, task, stream, with_files: withFiles, timeout_seconds: timeoutSeconds, rate }) => {
    return toMcpToolResult(async () => {
      if (!getMcpToken()) {
        throw unauthorizedError();
      }

      const args = ['call', agent, '--task', task, '--json', '--timeout', String(timeoutSeconds)];
      if (stream) args.push('--stream');
      if (withFiles) args.push('--with-files');
      if (rate !== undefined) args.push('--rate', String(rate));

      return await runCliTool(args, {
        cliScriptPath: options.cliScriptPath,
        timeoutMs,
        parseMode: 'jsonl',
        source: 'semantic',
      });
    }, { source: 'semantic', command: 'call' });
  });

  server.registerTool('agent_mesh_chat_agent', {
    title: 'Chat Agent',
    description: 'Chat with an agent using stream or async mode. Returns normalized events and final text.',
    inputSchema: {
      agent: z.string(),
      message: z.string(),
      stream: z.boolean().default(true),
      session_key: z.string().optional(),
      timeout_seconds: z.number().int().min(1).max(3600).default(300),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: MUTATION_REMOTE_ANNOTATIONS,
  }, async ({ agent, message, stream, session_key: sessionKey, timeout_seconds: timeoutSeconds }) => {
    return toMcpToolResult(async () => {
      if (!getMcpToken()) {
        throw unauthorizedError();
      }

      const payload = await chatAgentViaApi({
        agent,
        message,
        stream,
        sessionKey,
        timeoutMs: timeoutSeconds * 1000,
      });

      return successResponse({
        source: 'semantic',
        command: `POST ${baseUrl}/api/agents/{id}/chat`,
        data: {
          mode: payload.mode,
          agent_id: payload.agent_id,
          agent_name: payload.agent_name,
          ...(payload.session_key ? { session_key: payload.session_key } : {}),
          final_text: payload.final_text,
        },
        events: payload.events,
      });
    }, { source: 'semantic', command: 'chat' });
  });

  server.registerTool('agent_mesh_agents_list', {
    title: 'List My Agents',
    description: 'List agents owned by the current authenticated user.',
    inputSchema: {},
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: READONLY_REMOTE_ANNOTATIONS,
  }, async () => {
    return toMcpToolResult(async () => {
      const client = requireClient(baseUrl);
      const payload = await client.get<{ agents: unknown[]; author_login: string | null }>('/api/developer/agents');

      return successResponse({
        source: 'semantic',
        command: `GET ${baseUrl}/api/developer/agents`,
        data: payload,
        pagination: {
          total_count: payload.agents.length,
          count: payload.agents.length,
        },
      });
    }, { source: 'semantic', command: 'agents list' });
  });

  server.registerTool('agent_mesh_agents_show', {
    title: 'Show Agent',
    description: 'Show detailed metadata for one owned agent by ID, alias, or exact name.',
    inputSchema: {
      agent: z.string(),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: READONLY_REMOTE_ANNOTATIONS,
  }, async ({ agent }) => {
    return toMcpToolResult(async () => {
      const client = requireClient(baseUrl);
      const resolved = await resolveAgentId(agent, client);
      const payload = await client.get<unknown>(`/api/developer/agents/${resolved.id}`);

      return successResponse({
        source: 'semantic',
        command: `GET ${baseUrl}/api/developer/agents/${resolved.id}`,
        data: payload,
      });
    }, { source: 'semantic', command: 'agents show' });
  });

  server.registerTool('agent_mesh_agents_create', {
    title: 'Create Agent',
    description: 'Create a new agent on Agents.Hot.',
    inputSchema: {
      name: z.string().min(1),
      type: z.enum(['claude']).default('claude'),
      description: z.string().optional(),
      visibility: z.enum(['public', 'private']).default('public'),
      capabilities: z.array(z.string()).optional(),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: MUTATION_REMOTE_ANNOTATIONS,
  }, async ({ name, type, description, visibility, capabilities }) => {
    return toMcpToolResult(async () => {
      const client = requireClient(baseUrl);
      const result = await client.post<{ success: boolean; agent: { id: string } }>('/api/developer/agents', {
        name,
        agent_type: type,
        ...(description ? { description } : {}),
        visibility,
        ...(capabilities && capabilities.length > 0 ? { capabilities } : {}),
      });

      const detail = await client.get<unknown>(`/api/developer/agents/${result.agent.id}`);

      return successResponse({
        source: 'semantic',
        command: `POST ${baseUrl}/api/developer/agents`,
        data: detail,
      });
    }, { source: 'semantic', command: 'agents create' });
  });

  server.registerTool('agent_mesh_agents_update', {
    title: 'Update Agent',
    description: 'Update one owned agent by ID, alias, or exact name.',
    inputSchema: {
      agent: z.string(),
      name: z.string().optional(),
      type: z.enum(['claude']).optional(),
      description: z.string().optional(),
      visibility: z.enum(['public', 'private']).optional(),
      capabilities: z.array(z.string()).optional(),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: MUTATION_REMOTE_ANNOTATIONS,
  }, async ({ agent, name, type, description, visibility, capabilities }) => {
    return toMcpToolResult(async () => {
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (type !== undefined) updates.agent_type = type;
      if (description !== undefined) updates.description = description;
      if (visibility !== undefined) updates.visibility = visibility;
      if (capabilities !== undefined) updates.capabilities = capabilities;

      if (Object.keys(updates).length === 0) {
        throw validationError('At least one update field is required.');
      }

      const client = requireClient(baseUrl);
      const resolved = await resolveAgentId(agent, client);
      const result = await client.put<unknown>(`/api/developer/agents/${resolved.id}`, updates);

      return successResponse({
        source: 'semantic',
        command: `PUT ${baseUrl}/api/developer/agents/${resolved.id}`,
        data: result,
      });
    }, { source: 'semantic', command: 'agents update' });
  });

  server.registerTool('agent_mesh_agents_publish', {
    title: 'Publish Agent',
    description: 'Publish an owned agent to the marketplace.',
    inputSchema: {
      agent: z.string(),
      visibility: z.enum(['public', 'private']).optional(),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: MUTATION_REMOTE_ANNOTATIONS,
  }, async ({ agent, visibility }) => {
    return toMcpToolResult(async () => {
      const client = requireClient(baseUrl);
      const resolved = await resolveAgentId(agent, client);
      const updates: Record<string, unknown> = { is_published: true };
      if (visibility) updates.visibility = visibility;
      const result = await client.put<unknown>(`/api/developer/agents/${resolved.id}`, updates);

      return successResponse({
        source: 'semantic',
        command: `PUT ${baseUrl}/api/developer/agents/${resolved.id}`,
        data: result,
      });
    }, { source: 'semantic', command: 'agents publish' });
  });

  server.registerTool('agent_mesh_agents_unpublish', {
    title: 'Unpublish Agent',
    description: 'Unpublish an owned agent from the marketplace.',
    inputSchema: {
      agent: z.string(),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: MUTATION_REMOTE_ANNOTATIONS,
  }, async ({ agent }) => {
    return toMcpToolResult(async () => {
      const client = requireClient(baseUrl);
      const resolved = await resolveAgentId(agent, client);
      const result = await client.put<unknown>(`/api/developer/agents/${resolved.id}`, { is_published: false });

      return successResponse({
        source: 'semantic',
        command: `PUT ${baseUrl}/api/developer/agents/${resolved.id}`,
        data: result,
      });
    }, { source: 'semantic', command: 'agents unpublish' });
  });

  server.registerTool('agent_mesh_agents_delete', {
    title: 'Delete Agent',
    description: 'Delete (soft-delete) an owned agent.',
    inputSchema: {
      agent: z.string(),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: DESTRUCTIVE_REMOTE_ANNOTATIONS,
  }, async ({ agent }) => {
    return toMcpToolResult(async () => {
      const client = requireClient(baseUrl);
      const resolved = await resolveAgentId(agent, client);
      const result = await client.del<unknown>(`/api/developer/agents/${resolved.id}`);

      return successResponse({
        source: 'semantic',
        command: `DELETE ${baseUrl}/api/developer/agents/${resolved.id}`,
        data: result,
      });
    }, { source: 'semantic', command: 'agents delete' });
  });

  server.registerTool('agent_mesh_skills_list', {
    title: 'List Published Skills',
    description: 'List published skills for the current authenticated user.',
    inputSchema: {},
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: READONLY_REMOTE_ANNOTATIONS,
  }, async () => {
    return toMcpToolResult(async () => {
      const client = requireClient(baseUrl);
      const payload = await client.get<unknown>('/api/user/skills');

      return successResponse({
        source: 'semantic',
        command: `GET ${baseUrl}/api/user/skills`,
        data: payload,
      });
    }, { source: 'semantic', command: 'skills list' });
  });

  server.registerTool('agent_mesh_skills_installed', {
    title: 'List Installed Skills',
    description: 'List locally installed skills from .agents/skills.',
    inputSchema: {
      check_updates: z.boolean().default(false),
      path: z.string().optional(),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: READONLY_LOCAL_ANNOTATIONS,
  }, async ({ check_updates: checkUpdates, path }) => {
    return toMcpToolResult(async () => {
      if (checkUpdates && !getMcpToken()) {
        throw unauthorizedError('Checking updates requires authentication.');
      }

      const args = ['skills', 'installed'];
      if (path) args.push(path);
      if (checkUpdates) args.push('--check-updates');

      return await runCliTool(args, {
        cliScriptPath: options.cliScriptPath,
        timeoutMs,
        parseMode: 'json',
        source: 'semantic',
      });
    }, { source: 'semantic', command: 'skills installed' });
  });

  server.registerTool('agent_mesh_skills_install', {
    title: 'Install Skill',
    description: 'Install a skill from agents.hot (author/slug).',
    inputSchema: {
      ref: z.string().min(3),
      path: z.string().optional(),
      force: z.boolean().default(false),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: MUTATION_REMOTE_ANNOTATIONS,
  }, async ({ ref, path, force }) => {
    return toMcpToolResult(async () => {
      if (!getMcpToken()) {
        throw unauthorizedError();
      }

      const args = ['skills', 'install', ref];
      if (path) args.push(path);
      if (force) args.push('--force');

      return await runCliTool(args, {
        cliScriptPath: options.cliScriptPath,
        timeoutMs,
        parseMode: 'json',
        source: 'semantic',
      });
    }, { source: 'semantic', command: 'skills install' });
  });

  server.registerTool('agent_mesh_files_list', {
    title: 'List Session Files',
    description: 'List generated files for a specific agent session key.',
    inputSchema: {
      agent: z.string(),
      session_key: z.string(),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: READONLY_REMOTE_ANNOTATIONS,
  }, async ({ agent, session_key: sessionKey }) => {
    return toMcpToolResult(async () => {
      const client = requireClient(baseUrl);
      const resolved = await resolveAgentId(agent, client);
      const payload = await client.get<{ files: unknown[]; updated_at?: string; session_key: string | null }>(
        `/api/agents/${resolved.id}/files?session_key=${encodeURIComponent(sessionKey)}`,
      );

      return successResponse({
        source: 'semantic',
        command: `GET ${baseUrl}/api/agents/${resolved.id}/files`,
        data: payload,
        pagination: {
          total_count: payload.files.length,
          count: payload.files.length,
        },
      });
    }, { source: 'semantic', command: 'files list' });
  });

  server.registerTool('agent_mesh_list_local_agents', {
    title: 'List Local Agents',
    description: 'List local agent registry entries and runtime process status.',
    inputSchema: {},
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: READONLY_LOCAL_ANNOTATIONS,
  }, async () => {
    return toMcpToolResult(async () => {
      const config = loadConfig();
      const agents = Object.entries(config.agents).map(([name, entry]) => {
        const pid = readPid(name);
        const running = pid !== null && isProcessAlive(pid);

        return {
          name,
          agent_id: entry.agentId,
          agent_type: entry.agentType,
          bridge_url: entry.bridgeUrl,
          project_path: entry.projectPath,
          sandbox: entry.sandbox ?? true,
          added_at: entry.addedAt,
          started_at: entry.startedAt,
          running,
          pid: running ? pid : null,
          log_path: getLogPath(name),
        };
      });

      return successResponse({
        source: 'semantic',
        command: 'local registry',
        data: {
          agents,
        },
        pagination: {
          total_count: agents.length,
          count: agents.length,
        },
      });
    }, { source: 'semantic', command: 'list local agents' });
  });

  server.registerTool('agent_mesh_start_agents', {
    title: 'Start Local Agents',
    description: 'Start one or all locally registered agents in background.',
    inputSchema: {
      name: z.string().optional(),
      all: z.boolean().default(false),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: MUTATION_LOCAL_ANNOTATIONS,
  }, async ({ name, all }) => {
    return toMcpToolResult(async () => {
      const config = loadConfig();
      const targets = resolveTargets(config.agents, name, all);

      const results: Array<Record<string, unknown>> = [];
      for (const target of targets) {
        const entry = config.agents[target];
        const existingPid = readPid(target);
        if (existingPid !== null && isProcessAlive(existingPid)) {
          results.push({ name: target, status: 'already_running', pid: existingPid, log_path: getLogPath(target) });
          continue;
        }

        const pid = spawnBackground(target, entry, config.token);
        await sleep(500);
        const running = isProcessAlive(pid);

        results.push({
          name: target,
          status: running ? 'started' : 'failed_to_start',
          pid: running ? pid : null,
          log_path: getLogPath(target),
        });
      }

      return successResponse({
        source: 'semantic',
        command: 'start',
        data: { results },
        pagination: {
          total_count: results.length,
          count: results.length,
        },
      });
    }, { source: 'semantic', command: 'start' });
  });

  server.registerTool('agent_mesh_stop_agents', {
    title: 'Stop Local Agents',
    description: 'Stop one or all locally registered agents.',
    inputSchema: {
      name: z.string().optional(),
      all: z.boolean().default(false),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: MUTATION_LOCAL_ANNOTATIONS,
  }, async ({ name, all }) => {
    return toMcpToolResult(async () => {
      const config = loadConfig();
      const targets = resolveTargets(config.agents, name, all);

      const results: Array<Record<string, unknown>> = [];
      for (const target of targets) {
        const stopped = await stopProcess(target);
        results.push({
          name: target,
          status: stopped ? 'stopped' : 'not_running',
        });
      }

      return successResponse({
        source: 'semantic',
        command: 'stop',
        data: { results },
        pagination: {
          total_count: results.length,
          count: results.length,
        },
      });
    }, { source: 'semantic', command: 'stop' });
  });

  server.registerTool('agent_mesh_restart_agents', {
    title: 'Restart Local Agents',
    description: 'Restart one or all locally registered agents.',
    inputSchema: {
      name: z.string().optional(),
      all: z.boolean().default(false),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: MUTATION_LOCAL_ANNOTATIONS,
  }, async ({ name, all }) => {
    return toMcpToolResult(async () => {
      const config = loadConfig();
      const targets = resolveTargets(config.agents, name, all);

      const results: Array<Record<string, unknown>> = [];
      for (const target of targets) {
        const entry = config.agents[target];
        await stopProcess(target);

        const pid = spawnBackground(target, entry, config.token);
        await sleep(500);
        const running = isProcessAlive(pid);

        results.push({
          name: target,
          status: running ? 'restarted' : 'failed_to_restart',
          pid: running ? pid : null,
          log_path: getLogPath(target),
        });
      }

      return successResponse({
        source: 'semantic',
        command: 'restart',
        data: { results },
        pagination: {
          total_count: results.length,
          count: results.length,
        },
      });
    }, { source: 'semantic', command: 'restart' });
  });

  server.registerTool('agent_mesh_connect_setup', {
    title: 'Connect Setup Ticket',
    description: 'Redeem a connect ticket and register/start the local agent using `agent-mesh connect --setup`.',
    inputSchema: {
      url: z.string().min(1),
      project: z.string().optional(),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: MUTATION_LOCAL_ANNOTATIONS,
  }, async ({ url, project }) => {
    return toMcpToolResult(async () => {
      const args = ['connect', '--setup', url];
      if (project) args.push('--project', project);

      return await runCliTool(args, {
        cliScriptPath: options.cliScriptPath,
        timeoutMs,
        parseMode: 'auto',
        source: 'semantic',
      });
    }, { source: 'semantic', command: 'connect --setup' });
  });

  server.registerTool('agent_mesh_cli_passthrough', {
    title: 'CLI Passthrough',
    description: 'Run a non-interactive `agent-mesh` CLI command for long-tail capability coverage.',
    inputSchema: {
      args: z.array(z.string()).min(1),
      parse_mode: z.enum(['none', 'json', 'jsonl', 'auto']).default('auto'),
      timeout_ms: z.number().int().min(1).max(3_600_000).optional(),
    },
    outputSchema: TOOL_RESULT_SCHEMA,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ args, parse_mode: parseMode, timeout_ms: timeoutOverride }) => {
    return toMcpToolResult(async () => {
      validatePassthroughArgs(args);

      if (commandRequiresAuth(args) && !getMcpToken()) {
        throw unauthorizedError('This CLI command requires authentication.');
      }

      return await runCliTool(args, {
        cliScriptPath: options.cliScriptPath,
        timeoutMs: timeoutOverride ?? timeoutMs,
        parseMode,
        source: 'cli_passthrough',
      });
    }, {
      source: 'cli_passthrough',
      command: args.join(' '),
    });
  });
}

function toMcpToolResult(
  fn: () => Promise<AgentMeshToolResponse>,
  fallback: { source: 'semantic' | 'cli_passthrough'; command?: string },
): Promise<{ content: Array<{ type: 'text'; text: string }>; structuredContent: AgentMeshToolResponse }> {
  return fn()
    .then((result) => toMcpResponse(result))
    .catch((error) => {
      const result = toErrorResult(error, fallback);
      return toMcpResponse(result);
    });
}

function toMcpResponse(result: AgentMeshToolResponse): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: AgentMeshToolResponse;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

function toErrorResult(
  error: unknown,
  fallback: { source: 'semantic' | 'cli_passthrough'; command?: string },
): AgentMeshToolResponse {
  if (error instanceof AgentMeshToolError) {
    return errorResponse({
      source: fallback.source,
      ...(fallback.command ? { command: fallback.command } : {}),
      code: error.code,
      message: error.message,
      authRequired: error.authRequired,
      suggestion: error.suggestion,
    });
  }

  if (error instanceof PlatformApiError) {
    const isUnauthorized = error.errorCode === 'unauthorized';
    const isForbidden = error.errorCode === 'forbidden' || error.errorCode === 'subscription_required';
    return errorResponse({
      source: fallback.source,
      ...(fallback.command ? { command: fallback.command } : {}),
      code: isUnauthorized ? 'unauthorized' : isForbidden ? 'forbidden' : error.errorCode,
      message: error.message,
      authRequired: isUnauthorized,
      suggestion: isUnauthorized
        ? 'Run `agent-mesh login` or set `AGENT_MESH_TOKEN` in MCP config.'
        : isForbidden
          ? 'Check account permissions, visibility, or subscribe to the author if the agent is private.'
          : undefined,
    });
  }

  const err = error as Error;
  return errorResponse({
    source: fallback.source,
    ...(fallback.command ? { command: fallback.command } : {}),
    code: 'internal_error',
    message: err?.message || 'Unknown MCP tool error.',
  });
}

async function runCliTool(args: string[], opts: {
  cliScriptPath?: string;
  timeoutMs: number;
  parseMode: OutputParseMode;
  source: 'semantic' | 'cli_passthrough';
}): Promise<AgentMeshToolResponse> {
  const result = await executeCliCommand({
    args,
    cliScriptPath: opts.cliScriptPath,
    timeoutMs: opts.timeoutMs,
    parseMode: opts.parseMode,
  });

  try {
    assertExecutionSucceeded(result);
  } catch {
    const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    if (/not authenticated|unauthorized|run `agent-mesh login`/i.test(detail)) {
      throw unauthorizedError('This command requires authentication.');
    }
    throw internalError(
      detail ? `Command failed: ${result.command}\n${detail}` : `Command failed: ${result.command}`,
    );
  }

  const parsed = normalizeParsedOutput(result.parsed, result.stdout);

  return successResponse({
    source: opts.source,
    command: result.command,
    ...(Array.isArray(parsed)
      ? {
          events: parsed,
          data: inferFinalData(parsed, result.stdout),
        }
      : {
          data: parsed,
        }),
  });
}

function normalizeParsedOutput(parsed: unknown, stdout: string): unknown {
  if (parsed !== undefined) {
    return parsed;
  }

  const trimmed = stdout.trim();
  if (!trimmed) return { message: 'Command completed.' };

  return { stdout: trimmed };
}

function inferFinalData(events: unknown[], stdout: string): unknown {
  if (events.length === 0) {
    return { stdout: stdout.trim() };
  }

  const last = events[events.length - 1];
  if (last && typeof last === 'object') {
    return last;
  }

  return { last_event: last };
}

function requireClient(baseUrl: string) {
  if (!getMcpToken()) {
    throw unauthorizedError();
  }

  return createClient(baseUrl);
}

function resolveTargets(
  agents: Record<string, unknown>,
  name: string | undefined,
  all: boolean,
): string[] {
  const names = Object.keys(agents);

  if (all) {
    if (names.length === 0) {
      throw validationError('No agents registered locally.');
    }
    return names;
  }

  if (!name) {
    throw validationError('Provide `name` or set `all=true`.');
  }

  if (!(name in agents)) {
    throw validationError(`Agent "${name}" not found in local registry.`);
  }

  return [name];
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.message === 'string') return body.message;
    if (typeof body.error === 'string') return body.error;
    return `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function listToolNamesForTests(server: McpServer): string[] {
  const registered = (server as unknown as { _registeredTools?: Map<string, unknown> })._registeredTools;
  if (!registered) return [];
  return Array.from(registered.keys());
}
