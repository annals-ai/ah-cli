---
name: ah-cli
description: Run AI agents on your own machine and call them anywhere over A2A. Use when the user wants a local-first agent runtime — register/run Claude or Codex agents locally with transcripts kept on disk, orchestrate multi-agent fan-out and pipelines, or expose an agent over the A2A Protocol (hosted Agents Hot network or a vendor-neutral self-hosted endpoint). Triggers: "run an agent locally", "local agent runtime", "expose my agent over A2A", "self-hosted A2A", "agent2agent", "ah-cli", "Agents Hot".
version: 1.0.0
category: development
tags: [ai-agents, a2a, agent2agent, local-first, self-hosted, claude, codex, cli, orchestration]
license: MIT
private: false
---

# ah-cli

Daemon-first **local runtime** for AI agents. The runtime lives on the user's
machine; the network is opt-in. Use this skill to install, run, orchestrate,
and expose agents with `ah-cli`.

## Mental model (do not deviate)

```
local daemon owns the runtime  →  test locally  →  provider expose  →  discover / call over A2A
```

- One machine, one daemon. One daemon manages many agents, sessions, task groups.
- Transcripts + full history stay on the user's disk. The local Web UI is the source of truth — **not** any platform.
- Providers are ingress only. They never own the runtime or the data.
- No account needed to *run* agents. An account is only needed to *publish*.

## Install

```bash
npm i -g @annals/ah-cli
```

## Core workflow

```bash
ah login                                         # device auth (like GitHub CLI)
ah daemon start                                  # bring up the local runtime
ah ui open                                        # local console (localhost only)
ah agent add --name "Reviewer" --project /path    # register a local agent
ah chat "Reviewer" "Review this repository"       # local conversation, transcript on disk
ah agent expose "Reviewer" --provider agents-hot  # publish to the open network
```

Vendor-neutral exposure (no platform):

```bash
ah agent expose "Reviewer" \
  --provider generic-a2a \
  --config-json '{"port":4123,"bearerToken":"replace-me"}'
```

## Command surface (authoritative)

```
ah login | status | doctor
ah daemon  start|stop|status|logs
ah ui      serve|open
ah agent   add|list|show|update|remove|clone|quick|ping|expose|unexpose|grant|revoke|acl
ah session list|get|delete|archive|clean
ah task    create|list|show|archive|update
ah sessions | ps | tasks
ah chat | call | fan-out
ah pipeline run
ah provider status|join|invite|members|kick
ah config
```

Do **not** suggest these — they no longer exist: `connect-ticket`,
`connect --setup`, `ah install`/`ah uninstall`, `ah daemon ui`, `ah discover`,
`ah subscribe`, `ah skills`, `ah mcp`, `ah profile`.

## Providers

- `agents-hot` — publish to the hosted open network: discovery, public agent pages, hosted A2A v1.0.
- `generic-a2a` — standard self-hosted A2A v1.0 HTTP ingress backed by the local daemon. No vendor lock.

## Supported runtimes

`claude`, `codex`.

## When to use what

| Goal | Do this |
|------|---------|
| Try an agent privately | `agent add` → `chat`, never expose |
| Let other agents call it, no vendor | `expose --provider generic-a2a` |
| Public discovery + hosted endpoint | `expose --provider agents-hot` |
| Run many agents on one task | `fan-out` |
| Multi-step agent workflow | `pipeline run` |

## Links

- Repo: https://github.com/annals-ai/ah-cli
- npm: https://www.npmjs.com/package/@annals/ah-cli
- A2A Protocol: https://google.github.io/A2A/
- Agents Hot: https://agents.hot
