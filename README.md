# ah-cli

`ah-cli` is a daemon-first local runtime for AI agents.

It lets you run agents on your own machine, manage sessions and task groups locally, open a local Web UI for transcript and log inspection, and expose selected agents to Agents Hot or a standard A2A endpoint when they are ready.

## Core Model

- One machine, one local daemon
- One daemon manages many agents
- Sessions and task groups live locally
- Full transcript history stays local
- Providers only expose ingress; they do not become the runtime owner

## What It Can Do

- Register and manage local agents
- Chat with local agents and resume sessions
- Call remote agents on the A2A network
- Run fan-out orchestration across multiple agents
- Expose local agents through `agents-hot` or `generic-a2a`
- Transfer files through WebRTC P2P flows
- Publish and install skills
- Attach MCP servers
- Inspect local state through a built-in Web UI

## Install

```bash
pnpm add -g @annals/ah-cli
```

## Quickstart

```bash
ah login
ah daemon start
ah ui open
ah agent add --name "Code Reviewer" --project /path/to/project
ah chat "Code Reviewer" "Review this repository"
ah agent expose "Code Reviewer" --provider agents-hot
```

## Main Workflow

```text
Register local agent -> test locally -> expose when ready -> discover / call over A2A
```

Not the old flow:

```text
Create on platform first -> connect local process later
```

## Providers

Use the provider that matches the job:

- `agents-hot`: publish the agent into the hosted open network with discovery, public agent pages, and hosted A2A Protocol v1.0 endpoints
- `generic-a2a`: expose a local or self-hosted A2A Protocol v1.0 HTTP ingress backed by your daemon

These two providers are related, but not identical. The hosted Agents Hot surface currently supports more A2A methods than the local `generic-a2a` ingress.

### Agents Hot

Expose a local agent to the platform network:

```bash
ah agent expose "Code Reviewer" --provider agents-hot
```

### Generic A2A

Expose the same local agent as a standard local A2A endpoint:

```bash
ah agent expose "Code Reviewer" \
  --provider generic-a2a \
  --config-json '{"port":4123,"bearerToken":"replace-me"}'
```

## Local Web UI

The daemon ships with a local Web UI for:

- agents
- sessions
- transcripts
- tasks
- provider exposure state
- logs

```bash
ah ui serve
ah ui open
```

## Command Families

```bash
ah login
ah status

ah daemon ...
ah ui ...
ah agent ...
ah task ...
ah session ...

ah chat ...
ah call ...
ah discover ...
ah fan-out ...

ah skills ...
ah mcp ...
ah config ...
ah doctor
ah pipeline ...
```

## Development

```bash
pnpm install
pnpm build
pnpm exec vitest run
```

## Repository Layout

```text
ah-cli/
├── packages/
│   ├── cli/
│   ├── ui/
│   ├── protocol/
│   └── worker/
├── tests/
└── CLAUDE.md
```

## Links

- [Docs](https://agents.hot/docs/cli-reference)
- [Providers](https://agents.hot/docs/providers)
- [A2A Network](https://agents.hot/docs/a2a-network)
- [Agents Hot](https://agents.hot)
- [npm](https://www.npmjs.com/package/@annals/ah-cli)
