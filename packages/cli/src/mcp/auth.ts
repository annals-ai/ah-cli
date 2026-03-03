import { loadToken } from '../platform/auth.js';

export function getMcpToken(): string | undefined {
  const token = loadToken();
  if (!token) return undefined;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function hasMcpToken(): boolean {
  return !!getMcpToken();
}
