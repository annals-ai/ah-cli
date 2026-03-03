export type AgentMeshToolSource = 'semantic' | 'cli_passthrough';

export type AgentMeshToolErrorPayload = {
  code: string;
  message: string;
};

export type AgentMeshToolPagination = {
  total_count?: number;
  count?: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  next_offset?: number;
};

export type AgentMeshToolResponse = {
  ok: boolean;
  source: AgentMeshToolSource;
  command?: string;
  data?: unknown;
  events?: unknown[];
  pagination?: AgentMeshToolPagination;
  error?: AgentMeshToolErrorPayload;
  auth_required?: boolean;
  suggestion?: string;
};

export class AgentMeshToolError extends Error {
  readonly code: string;
  readonly authRequired: boolean;
  readonly suggestion?: string;

  constructor(code: string, message: string, options?: { authRequired?: boolean; suggestion?: string }) {
    super(message);
    this.name = 'AgentMeshToolError';
    this.code = code;
    this.authRequired = options?.authRequired ?? false;
    this.suggestion = options?.suggestion;
  }
}

export function unauthorizedError(message = 'Not authenticated.', suggestion?: string): AgentMeshToolError {
  return new AgentMeshToolError('unauthorized', message, {
    authRequired: true,
    suggestion: suggestion ?? 'Run `agent-mesh login` or set `AGENT_MESH_TOKEN` in MCP config.',
  });
}

export function forbiddenError(message = 'Forbidden.', suggestion?: string): AgentMeshToolError {
  return new AgentMeshToolError('forbidden', message, {
    suggestion: suggestion ?? 'Check account permissions, visibility, or subscription requirements.',
  });
}

export function validationError(message: string, suggestion?: string): AgentMeshToolError {
  return new AgentMeshToolError('validation_error', message, { suggestion });
}

export function timeoutError(message: string, suggestion?: string): AgentMeshToolError {
  return new AgentMeshToolError('timeout', message, { suggestion });
}

export function unsupportedInteractiveCommandError(message: string, suggestion?: string): AgentMeshToolError {
  return new AgentMeshToolError('unsupported_interactive_command', message, { suggestion });
}

export function internalError(message: string, suggestion?: string): AgentMeshToolError {
  return new AgentMeshToolError('internal_error', message, { suggestion });
}

export function successResponse(payload: Omit<AgentMeshToolResponse, 'ok'>): AgentMeshToolResponse {
  return {
    ok: true,
    ...payload,
  };
}

export function errorResponse(payload: {
  source: AgentMeshToolSource;
  command?: string;
  code: string;
  message: string;
  authRequired?: boolean;
  suggestion?: string;
}): AgentMeshToolResponse {
  return {
    ok: false,
    source: payload.source,
    ...(payload.command ? { command: payload.command } : {}),
    error: {
      code: payload.code,
      message: payload.message,
    },
    ...(payload.authRequired ? { auth_required: true } : {}),
    ...(payload.suggestion ? { suggestion: payload.suggestion } : {}),
  };
}
