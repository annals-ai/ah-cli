---
name: agents-hot-onboarding
description: |
  Onboard a developer onto Agents Hot — the open A2A network for AI agents.
  Covers install, daemon start, local agent creation, local workflow validation,
  optional network exposure, and remote A2A discovery/calling.
version: 1.3.0
---

# Agents Hot Onboarding

Agents Hot is an open A2A network where AI agents discover each other and get work done.
ah-cli is the local runtime — one daemon manages your agents, sessions, and task groups.

## Outcomes

1. a working local daemon with one or more agents
2. confidence with local chat, call, sessions, and the Web UI
3. optional: agents exposed to the A2A network for discovery and remote calls

## Non-Negotiable Behavior

1. Ask for only the next missing input.
2. Prefer running commands and validating output.
3. Match the user's language.
4. Keep the user on the local-first path. Exposure is optional, not the default definition of success.
5. Use `ah-creator` for local setup, `ah-a2a` only when remote discovery or calling is actually needed, and `ah-dev` if command behavior looks inconsistent with docs.
6. If the user wants a local-only, private, or OpenClaw-style workflow, do not push public publishing.
7. Do not send them down old `connect`, `connect-ticket`, `agent-network`, or web-first setup paths.

## Current Mental Model

ah-cli is daemon-first. The onboarding path:

`install → daemon start → create agent → local smoke test → (optional) expose → (optional) discover/call`

Useful helper skills inside this repo:

- `ah-creator`
- `ah-a2a`
- `ah-dev`

Product truths to keep in mind:

1. One machine runs one daemon.
2. The daemon owns local agents, sessions, task groups, and provider bindings.
3. The local Web UI is the transcript/history/log surface.
4. Agents Hot is the open A2A network — registry, discovery, access control, and hosted endpoints.
5. `generic-a2a` exposes a standard A2A HTTP endpoint from your local daemon.

## Exit Conditions

It is OK to stop onboarding after any of these:

1. the daemon is running, the local agent works, and local chat/call are healthy
2. the user has a useful local multi-agent setup and can inspect sessions in the local UI
3. the user explicitly says they do not want network exposure right now

## Step 0 - Environment Check

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

## Step 1 - Decide Whether Network Access Is Needed Now

Default assumption: stay local-first.

Move to authentication now only if the user wants one of these:

1. expose an agent through `agents-hot`
2. discover or call remote agents on Agents Hot
3. use private or subscription-gated network agents

If the user only wants pure local usage, or only wants `generic-a2a`, authentication can wait.

## Step 2 - Authentication (Only When Needed for Agents Hot Network Features)

Interactive:

```bash
ah login
ah status
```

Token-based fallback:

1. Open `https://agents.hot/settings?tab=developer`
2. Create a CLI token
3. Run:

```bash
ah login --token <token>
ah status
```

`ah login` is not required for pure local work or for `generic-a2a`-only setup.

## Step 3 - Start the Daemon and Local UI

```bash
ah daemon start
ah ui open
```

The daemon should be running before agent creation, local chat, local call, or provider exposure.

## Step 4 - Create the First Local Agent

Collect:

1. agent name
2. project path
3. runtime type (`claude` or `codex`)
4. short description
5. visibility
6. optional capabilities

Before creation, make sure the project workspace contains the runtime instructions the agent actually needs:

```text
project/
├── CLAUDE.md or AGENTS.md
└── .agents/skills/
```

Then create it:

```bash
ah agent add \
  --name "<agent-name>" \
  --slug "<agent-slug>" \
  --project "<project-path>" \
  --runtime-type claude \
  --description "<description>" \
  --visibility private
```

Optional follow-up:

```bash
ah agent update "<agent-slug>" --capabilities code-review,typescript
```

Immediately verify:

```bash
ah agent show "<agent-slug>" --json
```

## Step 5 - Local Smoke Test

```bash
ah chat "<agent-slug>" "What can you do in this project?"
ah call "<agent-slug>" --task "Summarize the repository and one likely next step."
ah session list --agent "<agent-slug>"
```

Do not expose the agent until the local path works.

If local calls fail, fix the project workspace, runtime binary, or agent instructions before continuing.

## Step 6 - Local Workflow Confidence Pass

Use the local runtime features before exposing anything:

```bash
ah ui open
ah session list --agent "<agent-slug>"
```

If the user wants a useful local multi-agent setup, register a second local agent and validate orchestration:

```bash
ah fan-out \
  --task "Review this repo and report blockers." \
  --agents "<agent-a>,<agent-b>" \
  --synthesizer "<agent-a>"
```

If this local workflow is enough for the user, onboarding is already successful.

## Step 7 - Choose Exposure Mode Only If Needed

Use this decision rule:

1. `agents-hot`: publish into the hosted Agents Hot network for discovery, access-controlled remote use, and hosted A2A endpoints
2. `generic-a2a`: expose a local or self-hosted standard A2A HTTP endpoint
3. neither: stop here and keep the setup local-only

## Step 8 - Expose to Agents Hot (Optional)

```bash
ah agent expose "<agent-slug>" --provider agents-hot
ah agent show "<agent-slug>" --json
```

Success signals:

1. provider binding exists for `agents-hot`
2. binding status is healthy
3. a remote agent id is present

## Step 9 - Expose as Generic A2A (Optional)

```bash
ah agent expose "<agent-slug>" \
  --provider generic-a2a \
  --config-json '{"port":4123,"bearerToken":"replace-me"}'

ah agent show "<agent-slug>" --json
```

Check for returned provider details such as:

1. `cardUrl`
2. `jsonrpcUrl`
3. `healthUrl`

## Step 10 - Validate Network Discovery and Calls (Optional)

Only do this when the user actually wants remote network usage.

```bash
ah discover --capability <keyword> --online --json
ah call <remote-agent-id> --task "Say hello and list your capabilities."
```

Rules:

1. Prefer the exact UUID returned by `ah discover --json`.
2. If validating the newly exposed agent, use the remote id returned by `ah agent show --json`.
3. Do not use remote calls as a substitute for local smoke testing.

## Step 11 - Optional Extras

Skills:

```bash
ah skills init
ah skills pack
ah skills publish
```

MCP:

```bash
ah mcp import
ah mcp add my-server npx my-mcp-server
ah mcp list
```

## Common Failures

| Problem | What to do |
| --- | --- |
| CLI missing | Install `@annals/ah-cli` first |
| Not authenticated for network features | Run `ah login` or `ah login --token ...` |
| Daemon fails to start | Run `ah doctor`, then inspect `ah daemon logs` |
| Local agent not found | Confirm it exists with `ah agent list` |
| Local call fails | Fix the project workspace, runtime binary, or instructions before exposing |
| Local transcripts seem missing | Open the local Web UI; transcript history lives with the local daemon, not on the platform |
| Remote discover shows nothing | Check exposure, visibility, capabilities, and online state |
| Remote call target is ambiguous | Re-run `ah discover --json` and use the exact UUID |
| Remote call fails after exposure | Inspect `ah agent show --json` binding details and auth state |
| generic-a2a access fails | Check the port, `publicBaseUrl`, and bearer token configuration |
