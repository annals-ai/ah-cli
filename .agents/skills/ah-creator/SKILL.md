---
name: ah-creator
description: |
  Create, manage, and expose local agents with ah-cli.
  Use when setting up new agents, inspecting daemon state, exposing agents
  to the A2A network, managing skills/MCP, or troubleshooting local runtime.
version: 0.3.0
---

# ah-cli - Create, Manage, and Expose Agents

## Product Model

ah-cli is a local daemon that manages your AI agents:

1. One daemon per machine. It owns agents, sessions, task groups, and provider bindings.
2. `ah chat` / `ah call` hit the local daemon first.
3. Exposure to the open A2A network is optional:
   - `agents-hot` — hosted A2A endpoints with discovery and access control
   - `generic-a2a` — standard A2A HTTP endpoint from your daemon

The path: `daemon start → agent add → local test → (optional) expose`

Do not use old `connect`, `connect-ticket`, or web-first registration flows.

## Behavior

When this skill triggers:

1. First decide whether the user wants to create, inspect, update, expose, remove, or debug an agent.
2. Prefer executing commands and checking output instead of only explaining theory.
3. Always get the local path working before exposing an agent to the network.
4. Use `--json` when verification or follow-up automation depends on structured output.
5. If runtime support is unclear, check the code before promising it.

## Environment Check

Start with:

```bash
ah --version
ah status
ah doctor
```

If the CLI is missing:

```bash
pnpm add -g @annals/ah-cli
ah --version
```

If the daemon is not running:

```bash
ah daemon start
ah ui open
```

## Runtime Reality

Today the built-in runtime profiles live in `packages/cli/src/adapters/profiles.ts`.

Current real profiles:

- `claude`
- `codex`

`ah agent add` accepts `--runtime-type`, but anything beyond the built-in profiles should be treated as code work, not as a supported user path.

Workspace guidance:

- Claude-oriented projects should keep local instructions in `CLAUDE.md`.
- Codex-oriented projects should keep local instructions in `AGENTS.md`.
- Reusable local skills should live in `.agents/skills/`.
- `ah skills install` also mirrors installed skills into `.claude/skills/` when needed.

Install reality:

1. the primary local install target is `.agents/skills/`
2. client-specific mirrors such as `.claude/skills/` or `.codex/skills/` may exist, but do not assume every installer populates every mirror automatically
3. if install location matters, inspect the actual installed directories instead of guessing

## Workflow Routing

| Intent | Primary commands |
| --- | --- |
| Create a new agent | `ah agent add`, `ah agent quick` |
| Inspect local runtime state | `ah agent list`, `ah agent show`, `ah status`, `ah ui open` |
| Update metadata or runtime config | `ah agent update`, `ah config show`, `ah config runtime` |
| Test locally | `ah chat`, `ah call`, `ah session list`, `ah task list` |
| Expose online | `ah agent expose --provider agents-hot` |
| Expose as standard A2A | `ah agent expose --provider generic-a2a` |
| Duplicate an agent | `ah agent clone` |
| Remove or disable exposure | `ah agent unexpose`, `ah agent remove` |
| Package or publish skills | `ah skills ...` |
| Attach tool servers | `ah mcp add`, `ah mcp import`, `ah mcp list` |

## Current Command Surface

Use these commands as the current source of truth:

| Area | Primary commands |
| --- | --- |
| Create and register | `ah agent add`, `ah agent quick` |
| Inspect and test | `ah agent list`, `ah agent show`, `ah status`, `ah chat`, `ah call`, `ah ui open` |
| Update and duplicate | `ah agent update`, `ah agent clone`, `ah agent ping` |
| Exposure | `ah agent expose`, `ah agent unexpose` |
| Sessions and tasks | `ah session ...`, `ah task ...` |
| Skills | `ah skills init`, `ah skills pack`, `ah skills publish`, `ah skills install`, `ah skills installed` |
| MCP | `ah mcp import`, `ah mcp add`, `ah mcp list`, `ah mcp remove` |

## Create a Local Agent

### Quick path

If the current directory already is the agent workspace:

```bash
ah daemon start
ah agent quick "My Agent" --runtime-type claude --description "What it does"
```

### Explicit path

```bash
ah daemon start
ah agent add \
  --name "My Agent" \
  --slug my-agent \
  --project /absolute/path/to/project \
  --runtime-type claude \
  --description "What it does" \
  --visibility private \
  --capabilities code-review,typescript
```

Useful optional flags:

- `--sandbox`
- `--persona`
- `--visibility public|private|unlisted`

Immediately verify:

```bash
ah agent show my-agent --json
```

## Prepare the Workspace

Before testing the agent, make sure the project directory contains the instructions and assets the runtime actually needs.

Typical setup:

```text
project/
├── CLAUDE.md or AGENTS.md
├── .agents/
│   └── skills/
└── project files...
```

Rules:

1. The runtime instruction file must exist in the project root.
2. Any slash-command or workflow mentioned in the description should exist in local docs or skills.
3. Keep agent-specific instructions in the project, not only in a developer's global home directory.

## Local Smoke Test

Use the local daemon path before exposing:

```bash
ah chat my-agent "What can you do in this project?"
ah call my-agent --task "Summarize the repository and propose one improvement."
```

Useful follow-up checks:

```bash
ah session list --agent my-agent
ah session show <session-id>
ah task list
ah ui open
```

If the agent should work inside an existing context:

```bash
ah session attach <session-id> "Continue"
ah session fork <session-id>
```

## Expose Through Agents Hot

```bash
ah agent expose my-agent --provider agents-hot
ah agent show my-agent --json
```

Check for:

1. A provider binding for `agents-hot`
2. A healthy binding status
3. A remote agent id in the JSON output

Then validate from the network side:

```bash
ah discover --capability code-review --online --json
ah call <remote-agent-id> --task "Say hello and list your capabilities."
```

## Expose Through Generic A2A

```bash
ah agent expose my-agent \
  --provider generic-a2a \
  --config-json '{"port":4123,"bearerToken":"replace-me"}'

ah agent show my-agent --json
```

Check for returned provider details such as:

- `cardUrl`
- `jsonrpcUrl`
- `healthUrl`

## Manage Existing Agents

```bash
ah agent list
ah agent show <ref> --json
ah agent update <ref> --description "Updated description"
ah agent update <ref> --runtime-type codex
ah agent clone <ref> --name "My Agent Copy"
ah agent ping <ref>
ah agent unexpose <ref> --provider agents-hot
ah agent remove <ref>
```

## Skills and MCP

For local skill lifecycle:

```bash
ah skills init
ah skills pack
ah skills publish
ah skills install <author/slug>
ah skills installed
```

For MCP server management:

```bash
ah mcp import
ah mcp add my-server npx my-mcp-server
ah mcp list
ah mcp remove my-server
```

## Skill Install Reality

When someone asks where a skill ended up, use this order:

1. check `.agents/skills/` first
2. then check client mirrors such as `.claude/skills/` or `.codex/skills/`
3. if the install came from a packaged source, do not assume every optional reference file was installed unless you verify

## Troubleshooting

| Problem | What to do |
| --- | --- |
| `Local agent not found` | Run `ah agent list` and confirm the daemon registry contains the ref |
| Daemon will not start | Run `ah doctor`, then inspect `ah daemon logs` |
| Runtime command is missing | Confirm the runtime executable exists (`claude` or `codex`) |
| Local chat works, remote calls fail | Check auth, provider binding status, and exposure visibility |
| Discover returns nothing | Broaden the capability/search term, or confirm the agent is exposed and online |
| Skill install path is confusing | Check `.agents/skills/` first, then `.claude/skills/` mirrors |
| generic-a2a exposure fails | Confirm `--config-json` is valid JSON and includes required auth when private |

## Deep References

This file is intentionally usable on its own.

If the source tree is available, extra detail lives in:

- `references/cli-reference.md`
- `references/skill-publishing.md`
