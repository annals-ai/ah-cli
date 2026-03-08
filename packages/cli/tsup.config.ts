import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node25',
  shims: true,
  clean: true,
  dts: true,
  external: ['node:sqlite'],
  noExternal: ['@annals/bridge-protocol'],
  onSuccess: 'pnpm run build:ui-assets',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
