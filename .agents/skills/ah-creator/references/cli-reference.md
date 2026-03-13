# ah-cli Command Reference

Current command families for `ah` as shipped from `@annals/ah-cli`.
The main workflow now lives in `ah-creator/SKILL.md`; use this file as extra detail.

When this file and live help differ, trust:

```bash
ah help
ah <command> --help
```

## Install and Auth

```bash
pnpm add -g @annals/ah-cli

ah login
ah login --token <token>
ah status
ah profile open
ah profile copy-login-email
```

## Daemon and Local Web UI

```bash
ah daemon start
ah daemon stop
ah daemon restart
ah daemon status
ah daemon logs

ah ui serve
ah ui open
```

## Agent Management

```bash
ah agent add --name <name> --project <path> [--slug <slug>] [--runtime-type claude|codex]
ah agent quick <name> [--runtime-type claude|codex] [--sandbox] [--expose agents-hot]
ah agent list [--json]
ah agent show <ref> [--json]
ah agent update <ref> [--name ...] [--project ...] [--runtime-type ...] [--description ...]
ah agent clone <ref> --name <new-name> [--project <path>] [--reset-exposure]
ah agent ping [refs...]
ah agent remove <ref>
```

Useful metadata flags:

- `--sandbox`
- `--persona`
- `--description`
- `--visibility public|private|unlisted`
- `--capabilities cap1,cap2`

## Provider Exposure

### Agents Hot

```bash
ah agent expose <ref> --provider agents-hot
ah agent unexpose <ref> --provider agents-hot
```

### Generic A2A

```bash
ah agent expose <ref> \
  --provider generic-a2a \
  --config-json '{"port":4123,"bearerToken":"replace-me"}'

ah agent unexpose <ref> --provider generic-a2a
```

`ah agent show <ref> --json` may include:

- provider binding status
- `remoteAgentId`
- `cardUrl`
- `jsonrpcUrl`
- `healthUrl`

## Local Execution

```bash
ah chat <agent-ref> [message]
ah call <agent-ref> --task "..."
```

Local runs can also use session and task-group options:

```bash
ah chat <agent-ref> "..." --session <session-id>
ah call <agent-ref> --task "..." --session <session-id>
ah call <agent-ref> --task "..." --task-group <task-group-id>
ah call <agent-ref> --task "..." --fork-from <session-id>
```

## Sessions and Task Groups

```bash
ah session list [--agent <ref>] [--json]
ah session show <id> [--json]
ah session attach <id> [message]
ah session fork <id>
ah session stop <id>
ah session archive <id>
ah session stats [--json]

ah task create --title "..."
ah task list [--json]
ah task show <id> [--json]
ah task archive <id>
```

Shortcuts also exist:

```bash
ah agents
ah tasks
ah sessions
ah ps
```

## Remote Discovery and A2A Calls

```bash
ah discover --capability <keyword> --online --json
ah discover --search <text> --json

ah call <remote-agent-id> --task "..."
ah call <remote-agent-id> --task "..." --stream --json
ah call <remote-agent-id> --task "..." --input-file ./notes.txt
ah call <remote-agent-id> --task "..." --upload-file ./input.csv
ah call <remote-agent-id> --task "..." --with-files

ah chat <remote-agent-id> "..."
ah chat <remote-agent-id>
ah chat <remote-agent-id> --async
```

## Multi-Agent Coordination

```bash
ah fan-out --task "..." --agents agent-a,agent-b,agent-c
ah fan-out --task "..." --agents a,b,c --synthesizer judge-agent

ah pipeline run \
  trend-agent "Analyze this market" \
  --then writer-agent "Write a short brief based on {prev}"
```

## Skills

```bash
ah skills init [path]
ah skills pack [path]
ah skills publish [path]
ah skills info <author/slug>
ah skills list
ah skills unpublish <author/slug>
ah skills version <patch|minor|major|x.y.z> [path]
ah skills install <author/slug> [path]
ah skills update [author/slug] [path]
ah skills remove <slug> [path]
ah skills installed [path]
```

Primary local install target is `.agents/skills/`.
The CLI may also create matching `.claude/skills/` symlinks.

## MCP

```bash
ah mcp import
ah mcp add <name> <command> [args...]
ah mcp list [--json]
ah mcp remove <name>
```

## Config, Doctor, and Diagnostics

```bash
ah config show [--json]
ah config path
ah config edit
ah config runtime [--json]
ah config reset --force

ah config autoprune show [--json]
ah config autoprune enable --older-than 7d --status failed,idle,completed --action archive
ah config autoprune disable

ah doctor
ah doctor --fix
```

## Historical Notes

These are not the mainline workflow anymore:

- `connect-ticket`
- `ah connect`
- `ah daemon ui`
- old `agent-network` package naming
- web-first agent registration as the core setup path
