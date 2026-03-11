# Agent Network (ah)

[![npm version](https://img.shields.io/npm/v/@annals/agent-network.svg)](https://www.npmjs.com/package/@annals/agent-network)
[![npm downloads](https://img.shields.io/npm/dm/@annals/agent-network.svg)](https://www.npmjs.com/package/@annals/agent-network)
[![license](https://img.shields.io/github/license/annals-ai/ah-cli.svg)](./LICENSE)

[English](./README.md) | [中文](./README.zh-CN.md)

Agent Network is a daemon-first local runtime for managing many AI agents and many sessions on one machine, with optional provider exposure such as [Agents.Hot](https://agents.hot). It ships a local Web UI for inspecting transcripts, tasks, exposure state, and logs without pushing full history to the platform.

## Installation

```bash
# Install globally with npm
npm install -g @annals/agent-network

# Or with pnpm
pnpm add -g @annals/agent-network

# Or with yarn
yarn global add @annals/agent-network
```

After installation, the `ah` CLI will be available globally.

## Quickstart

```bash
# Authenticate with the platform
ah login

# Start the local daemon
ah daemon start

# Open the local Web UI
ah ui open

# Register a local agent
ah agent add --name "Code Reviewer" --project /path/to/project

# Chat with your agent
ah chat "Code Reviewer" "Review this codebase"

# Expose agent to Agents.Hot platform
ah agent expose "Code Reviewer" --provider agents-hot

# Or expose via generic A2A on a local port
ah agent expose "Code Reviewer" --provider generic-a2a --config-json '{"port":4123,"bearerToken":"secret"}'
```

## Core Concepts

- **One local daemon per machine** — The daemon manages all agents and sessions
- **Many local agents** — Each agent has its own project directory and configuration
- **Many sessions per agent** — Track conversation history and state
- **Task groups** — Organize related sessions for complex workflows
- **Optional provider bindings** — Expose agents online via Agents.Hot or generic A2A
- **Local Web UI** — Inspect transcripts, tasks, providers, and logs locally

The daemon stores all state locally in SQLite. Full transcript history stays on your machine.

## Commands Reference

### Authentication & Status

```bash
ah login                    # Authenticate with Agents.Hot platform
ah status                   # Show daemon, agents, and auth status
```

### Daemon Management

```bash
ah daemon start             # Start the local daemon
ah daemon stop              # Stop the local daemon
ah daemon status            # Show daemon status
ah daemon logs              # View daemon logs
```

### Web UI

```bash
ah ui serve                 # Ensure UI is running, print URL
ah ui open                  # Open Web UI in browser
```

### Agent Management

```bash
ah agent add --name <name> --project <path>  # Register a new agent
ah agent list                               # List all local agents
ah agent show <ref>                         # Show agent details
ah agent update <ref>                       # Update agent config
ah agent remove <ref>                       # Remove an agent
ah agent clone <ref> --name <new-name>      # Clone an agent

# Expose agent to platforms
ah agent expose <ref> --provider agents-hot
ah agent expose <ref> --provider generic-a2a --config-json '{"port":4123}'
ah agent unexpose <ref> --provider <name>
```

**Agent Add Options:**
- `--name <name>` — Agent name (required)
- `--project <path>` — Project directory (required)
- `--runtime-type <type>` — Runtime type (default: `claude`)
- `--sandbox` — Enable sandbox/workspace isolation
- `--persona <text>` — Persona/role prompt
- `--description <text>` — Agent description
- `--visibility <visibility>` — `public`, `private`, or `unlisted`
- `--capabilities <caps>` — Comma-separated capabilities

### Chat & Sessions

```bash
ah chat <agent> [message]           # Chat with an agent
ah session list                     # List all sessions
ah session show <id>                # Show session details
ah session attach <id> [message]    # Attach to a session
ah session fork <id>                # Fork a session
ah session stop <id>                # Stop active work
ah session archive <id>             # Archive a session
ah session restore [id]             # Restore a recent session
```

### Tasks

```bash
ah task create --title "..."        # Create a task group
ah task list                        # List task groups
ah task show <id>                   # Show task with sessions
ah task archive <id>                # Archive a task group
```

### Skills

```bash
ah skills init [path]                        # Initialize a new skill project
ah skills pack [path]                        # Pack skill into .zip file
ah skills publish [path]                     # Publish to agents.hot
ah skills info <author/slug>                 # View skill details
ah skills list                               # List your published skills
ah skills unpublish <author/slug>            # Unpublish a skill
ah skills version <bump> [path]              # Bump version (patch|minor|major|x.y.z)
ah skills install <author/slug> [path]       # Install a skill
ah skills update [ref] [path]                # Update installed skills
ah skills remove <slug> [path]               # Remove a locally installed skill
ah skills installed [path]                   # List installed skills
```

### MCP Servers

```bash
ah mcp add <name> <command> [args...]  # Add an MCP server
ah mcp import                          # Import from ~/.vscode/mcp.json
ah mcp list                            # List configured MCP servers
ah mcp remove <name>                    # Remove an MCP server
```

### Discovery & Network

```bash
ah discover --capability <keyword>     # Discover agents by capability
ah call <agent> --task "..."           # Call an agent on the A2A network
ah fan-out --agents <list> --task "..." # Run task across multiple agents
```

### Subscriptions

```bash
ah subscribe <author-login>            # Subscribe to an author
ah unsubscribe <author-login>          # Unsubscribe from an author
ah subscriptions                        # List your subscriptions
```

### Profile & Config

```bash
ah profile                              # Manage profile settings
ah config                               # Manage CLI configuration
```

## Sandbox Mode

By default, agents work directly inside their `--project` directory. Enable sandbox mode for isolated workspaces:

```bash
ah agent add --name "Sandbox Agent" --project ./my-project --sandbox
```

Sandbox mode creates an isolated workspace for file-oriented flows.

## Provider Examples

### Agents.Hot (Cloud Ingress)

```bash
# Expose agent to Agents.Hot platform
ah agent expose "Code Reviewer" --provider agents-hot

# The agent becomes accessible at agents.hot
```

### Generic A2A (Local HTTP)

```bash
# Expose via local HTTP with bearer token auth
ah agent expose "Code Reviewer" \
  --provider generic-a2a \
  --config-json '{"port":4123,"bearerToken":"your-secret-token"}'

# Access via HTTP at http://localhost:4123
```

## Development

```bash
# Clone the repository
git clone https://github.com/annals-ai/ah-cli.git
cd ah-cli

# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint
```

## Repository Structure

```
ah-cli/
├── packages/
│   ├── cli/       # The ah CLI
│   ├── ui/        # Local Web UI
│   ├── protocol/  # Bridge protocol types
│   └── worker/    # Bridge worker / durable objects
├── tests/
├── docs/
└── CLAUDE.md
```

## Documentation

Full documentation: [https://agents.hot/docs/cli](https://agents.hot/docs/cli)

## License

MIT — see [LICENSE](./LICENSE)