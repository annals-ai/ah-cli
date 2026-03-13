---
name: ah-dev
description: |
  Development guide for the ah-cli sub-repo. Use when modifying the CLI,
  daemon runtime, local Web UI, worker bridge, provider ingress, runtime
  profiles, or protocol packages inside ah-cli.
version: 0.2.0
---

# ah-cli Development Guide

## Read This First

If you are inside an `ah-cli` checkout, start with:

1. `CLAUDE.md`
2. the relevant package directory
3. the small reference files in this skill if they are available

Do not design against old `connect` or `connect-ticket` assumptions.

## Repo Shape

```text
ah-cli/
├── packages/
│   ├── cli/
│   ├── ui/
│   ├── protocol/
│   └── worker/
├── tests/
├── README.md
└── CLAUDE.md
```

## Current Product Truths

1. `packages/cli/` is the local daemon runtime and command surface.
2. `packages/ui/` is the local Web UI, not a public hosted control plane.
3. `packages/worker/` is the Bridge Worker for provider traffic.
4. `packages/protocol/` owns the bridge message contracts.
5. Providers connect the daemon to the outside world:
   - `agents-hot`
   - `generic-a2a`

## Routing by Change Type

### Daemon or local runtime

Look in:

- `packages/cli/src/daemon/`
- `packages/cli/src/providers/`
- `packages/cli/src/commands/`
- `packages/cli/src/adapters/`

### Local Web UI

Look in:

- `packages/ui/`
- `packages/cli/src/ui/`

### Bridge Worker

Look in:

- `packages/worker/src/`
- `packages/protocol/src/`

### Runtime profiles

Look in:

- `packages/cli/src/adapters/profiles.ts`
- `packages/cli/src/daemon/runtime.ts`
- `packages/protocol/src/messages.ts`

If you widen runtime support, audit the protocol too. Some bridge-level types still assume older runtime shapes.

### External A2A behavior

If the change affects actual A2A 1.0 semantics, also inspect the main repo:

- `src/lib/a2a/`
- `src/app/api/a2a/`

Use those paths when you are working from the `agents-hot` root checkout.
`ah-cli` is only one part of the end-to-end A2A system.

## Development Workflow

From the `ah-cli` root:

```bash
pnpm install
pnpm build
pnpm exec vitest run
```

From the parent `agents-hot` repo:

```bash
pnpm -C ah-cli build
pnpm -C ah-cli exec vitest run
pnpm -C ah-cli lint
```

Treat lint debt carefully. Distinguish pre-existing failures from regressions introduced by your change.

## Current Command Surface

When the skill is being used as a development manual, these are the main live areas to keep in mind:

| Area | Main commands or code surface |
| --- | --- |
| Local runtime | `ah daemon`, `ah agent`, `ah chat`, `ah call`, `ah session`, `ah task` |
| Network and exposure | `ah discover`, `ah subscribe`, `ah agent expose`, provider bindings |
| Skill lifecycle | `ah skills init`, `ah skills pack`, `ah skills publish`, `ah skills install` |
| Tool wiring | `ah mcp import`, `ah mcp add`, `ah mcp list`, `ah mcp remove` |
| Diagnostics | `ah status`, `ah doctor`, `ah config`, `ah daemon logs` |

## Integration Checks

If you touched CLI behavior, verify with real commands:

```bash
node packages/cli/dist/index.js help --json
node packages/cli/dist/index.js daemon start
node packages/cli/dist/index.js agent list
node packages/cli/dist/index.js chat <local-agent> "hello"
```

If you touched provider or bridge behavior, also verify:

1. local daemon path
2. provider exposure path
3. network path or remote smoke test

## Deployment Notes

### CLI package

- npm package name: `@annals/ah-cli`
- executable: `ah`

### Mac Mini runtime

If the user asks to update the remote runtime, use the `publish` and `macmini` workflows from the main repo context instead of hardcoding a machine-specific path in this skill.

## Deep References

This file is intentionally usable on its own.

If the source tree is available, extra detail lives in:

- `references/architecture.md`
- `references/protocol-reference.md`
- `../ah-creator/references/cli-reference.md`
