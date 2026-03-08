import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface UiAssetPayload {
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function getCandidateUiAssetDirs(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(moduleDir, 'ui-assets'),
    resolve(moduleDir, '../ui-assets'),
    resolve(moduleDir, '../../ui-assets'),
    resolve(moduleDir, '../../../ui/dist'),
    resolve(process.cwd(), 'packages/ui/dist'),
    resolve(process.cwd(), 'packages/cli/dist/ui-assets'),
  ];
}

export function getUiAssetsDir(): string | null {
  for (const candidate of getCandidateUiAssetDirs()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getContentType(assetPath: string): string {
  return CONTENT_TYPES[extname(assetPath).toLowerCase()] ?? 'application/octet-stream';
}

function resolveUiAssetPath(assetsDir: string, pathname: string): string | null {
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const relativePath = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
  const safeRelativePath = decodeURIComponent(relativePath || 'index.html');
  const assetPath = resolve(assetsDir, safeRelativePath);
  const normalizedRoot = assetsDir.endsWith(sep) ? assetsDir : `${assetsDir}${sep}`;

  if (assetPath !== assetsDir && !assetPath.startsWith(normalizedRoot)) {
    return null;
  }

  if (existsSync(assetPath)) {
    return assetPath;
  }

  if (!extname(safeRelativePath)) {
    const fallbackPath = resolve(assetsDir, 'index.html');
    if (existsSync(fallbackPath)) {
      return fallbackPath;
    }
  }

  return null;
}

export function loadUiAsset(pathname: string): UiAssetPayload | null {
  const assetsDir = getUiAssetsDir();
  if (!assetsDir) return null;

  const assetPath = resolveUiAssetPath(assetsDir, pathname);
  if (!assetPath) return null;

  return {
    body: readFileSync(assetPath),
    contentType: getContentType(assetPath),
    cacheControl: assetPath.endsWith('.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  };
}
