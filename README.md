# Agent Mesh

[![npm version](https://img.shields.io/npm/v/@annals/agent-mesh.svg)](https://www.npmjs.com/package/@annals/agent-mesh)
[![npm downloads](https://img.shields.io/npm/dm/@annals/agent-mesh.svg)](https://www.npmjs.com/package/@annals/agent-mesh)
[![license](https://img.shields.io/github/license/annals-ai/agent-mesh.svg)](./LICENSE)

[English](./README.md) | [中文](./README.zh-CN.md)

Agent Mesh is now a daemon-first local runtime for managing many agents and many sessions on one machine, with optional provider exposure such as Agents Hot. It also ships a local Web UI, started by the daemon, so owners can inspect transcripts, tasks, exposure state, and logs without pushing full history to the platform.

## Install

```bash
pnpm add -g @annals/agent-mesh
```

## Quickstart

```bash
agent-mesh login
agent-mesh daemon start
agent-mesh ui open
agent-mesh agent add --name "Code Reviewer" --project /path/to/project --runtime-type claude
agent-mesh chat "Code Reviewer" "Review this repo"
agent-mesh agent expose "Code Reviewer" --provider agents-hot
agent-mesh agent expose "Code Reviewer" --provider generic-a2a --config-json '{"port":4123,"bearerToken":"replace-me"}'
```

## Core Model

- One local daemon per machine
- Many local agents
- Many sessions per agent
- Task groups to organize related work
- Optional provider bindings for online ingress
- A local Web UI for transcript, task, provider, and log inspection

The daemon owns local state in SQLite. Full transcript history stays local to the daemon and is surfaced through the local Web UI. Local `chat` and `call` go through the daemon first. Exposed providers forward traffic into the same session core instead of bypassing it. Agents Hot is the gateway, discovery, and auth layer; it is not the long-term transcript surface.

## Local History Surface

- `agent-mesh daemon start` starts both the daemon and the local Web UI backend
- `agent-mesh ui open` opens the current local Web UI in your browser
- `agent-mesh ui serve` ensures the daemon-backed Web UI is running and prints the URL
- On the first successful interactive daemon launch, Agent Mesh opens the Web UI automatically
- Electron or Tauri can wrap this local Web UI later, but that is not part of v1

## Main Commands

```bash
agent-mesh login
agent-mesh status

agent-mesh daemon start|stop|status|logs
agent-mesh ui serve|open

agent-mesh agent add --name --project [--sandbox]
agent-mesh agent list
agent-mesh agent show <ref>
agent-mesh agent update <ref>
agent-mesh agent remove <ref>
agent-mesh agent expose <ref> --provider agents-hot|generic-a2a [--config-json '{}']
agent-mesh agent unexpose <ref> --provider agents-hot|generic-a2a

agent-mesh task create --title "..."
agent-mesh task list
agent-mesh task show <id>
agent-mesh task archive <id>

agent-mesh session list
agent-mesh session show <id>
agent-mesh session attach <id> [message]
agent-mesh session fork <id>
agent-mesh session stop <id>
agent-mesh session archive <id>

agent-mesh chat <agent> [message]
agent-mesh call <agent> --task "..."
agent-mesh discover --capability <keyword>
agent-mesh skills ...
agent-mesh subscribe ...
agent-mesh profile ...
```

## Sandbox

Sandbox is now explicit and optional.

- Without sandbox: the agent works directly inside `--project`
- With sandbox: Agent Mesh creates an isolated workspace and enables file-oriented flows

Session ownership does not depend on sandbox mode.

## Provider Examples

```bash
# Agents Hot ingress
agent-mesh agent expose "Code Reviewer" --provider agents-hot

# Generic A2A ingress on a local HTTP port
agent-mesh agent expose "Code Reviewer" \
  --provider generic-a2a \
  --config-json '{"port":4123,"bearerToken":"replace-me"}'

# Inspect generated URLs
agent-mesh agent show "Code Reviewer" --json
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Repository Layout

```txt
agent-mesh/
├── packages/
│   ├── cli/       # daemon-first CLI
│   ├── ui/        # local Web UI workspace
│   ├── protocol/  # bridge protocol types
│   └── worker/    # bridge worker / durable objects
├── tests/
└── CLAUDE.md
```
