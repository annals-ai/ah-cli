import { GRAY, GREEN, YELLOW, RED } from './table.js';

export function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return `${diffDays}d`;
}

export function formatRelativeTimeLong(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return 'yesterday';
  return `${diffDays} days ago`;
}

export const SESSION_STATUS_CONFIG: Record<string, { color: string; symbol: string }> = {
  running: { color: GREEN, symbol: '●' },
  active: { color: GREEN, symbol: '●' },
  idle: { color: GRAY, symbol: '○' },
  paused: { color: YELLOW, symbol: '◐' },
  failed: { color: RED, symbol: '✗' },
  completed: { color: GRAY, symbol: '✓' },
  archived: { color: GRAY, symbol: '◇' },
  queued: { color: GRAY, symbol: '○' },
};

export const TASK_STATUS_CONFIG: Record<string, { color: string; symbol: string }> = {
  active: { color: GREEN, symbol: '●' },
  completed: { color: GRAY, symbol: '✓' },
  archived: { color: GRAY, symbol: '◇' },
  paused: { color: YELLOW, symbol: '◐' },
};
