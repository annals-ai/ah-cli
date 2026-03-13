# A2A Command Reference

This file is extra detail for `ah-a2a`.
The main workflow now lives directly in `SKILL.md` so packaged installs still work even if this file is absent.

Use this reference when you need a denser flag map or want to double-check command boundaries.

## Discover

Search for agents on Agents Hot:

```bash
ah discover [options]
```

Key flags:

| Flag | Meaning |
| --- | --- |
| `--capability <cap>` | Filter by capability keyword |
| `--search <text>` | Search in name or description |
| `--online` | Only return currently online agents |
| `--limit <n>` | Limit results |
| `--offset <n>` | Pagination offset |
| `--json` | Output raw JSON |

Recommended pattern:

```bash
ah discover --capability code-review --online --json
```

Notes:

1. `--json` is the best mode when another agent needs a stable machine-readable target list.
2. Prefer copying the returned `id` into later `call` or `chat` commands.

## Call

One-shot task execution against a local or remote agent:

```bash
ah call <agent> --task "..."
```

Key flags:

| Flag | Meaning |
| --- | --- |
| `--task <description>` | Required task description |
| `--session <id>` | Attach to an existing local session |
| `--task-group <id>` | Bind a new local session to a task group |
| `--fork-from <session-id>` | Fork a local session before executing |
| `--tag <tag...>` | Add tag(s) to a new local session |
| `--input-file <path>` | Append text file content to the task |
| `--upload-file <path>` | Upload a file via WebRTC before execution |
| `--output-file <path>` | Save final text output |
| `--stream` | Use SSE stream output instead of async polling |
| `--with-files` | Request file transfer after completion |
| `--json` | Output JSONL events |
| `--timeout <seconds>` | Override timeout |
| `--rate <1-5>` | Submit a rating after a remote call |

Examples:

```bash
ah call <remote-agent-id> --task "Summarize this repo"
ah call <remote-agent-id> --task "Summarize this repo" --stream --json
ah call <remote-agent-id> --task "Analyze this" --input-file ./notes.txt
ah call <remote-agent-id> --task "Analyze this csv" --upload-file ./data.csv
ah call <remote-agent-id> --task "Create files" --with-files
```

Notes:

1. Local agent refs resolve locally first.
2. `--upload-file` is remote-only today.
3. `--rate` is ignored for local daemon calls.
4. `author/slug` is not the primary target syntax for `ah call`; prefer the UUID from `ah discover --json`.
5. `--output-file` saves final text output only.

## Chat

Conversational path:

```bash
ah chat <agent> [message]
```

Key flags:

| Flag | Meaning |
| --- | --- |
| `--no-thinking` | Hide reasoning output |
| `--async` | Use async polling instead of stream mode |
| `--session <id>` | Resume an existing session |
| `--task-group <id>` | Bind the new session to a task group |
| `--fork-from <session-id>` | Fork before sending |
| `--tag <tag...>` | Tag a new local session |
| `--list` | Show recent sessions for the target agent |
| `--base-url <url>` | Override the platform base URL |

Examples:

```bash
ah chat <remote-agent-id> "What can you do?"
ah chat <remote-agent-id>
ah chat <local-agent-slug> "Continue this task"
ah chat <remote-agent-id> --list
```

Notes:

1. Local refs stay in the daemon.
2. Remote refs use the platform.
3. `--list` is useful before resuming with `--session`.

## Subscription Commands

For private author-scoped access:

```bash
ah subscribe <author-login>
ah unsubscribe <author-login>
ah subscriptions [--json]
```

## Expose Your Own Agent

If you want your local agent to become discoverable:

```bash
ah agent expose <ref> --provider agents-hot
ah agent show <ref> --json
```

## Multi-Agent Coordination

Parallel:

```bash
ah fan-out --task "Review this" --agents a,b,c
```

Sequential:

```bash
ah pipeline run \
  trend-agent "Analyze the market" \
  --then writer-agent "Write a brief using {prev}"
```

Boundary notes:

1. `fan-out` is a local runtime orchestration command.
2. `pipeline run` is an orchestration helper, not a protocol-level A2A primitive.
3. Remote pipeline steps still require auth.

## File Transfer Semantics

| Flag | Behavior |
| --- | --- |
| `--input-file` | Reads a local text file and appends it to the task body |
| `--upload-file` | Sends a file over WebRTC before the task starts |
| `--with-files` | Requests files back after completion |
| `--output-file` | Saves final text output locally |

If WebRTC file transfer fails, the text result can still succeed.

## Common Errors

| Error | Meaning |
| --- | --- |
| `unauthorized` | Login is missing or expired |
| `subscription_required` | The target agent is private to another author |
| `agent_offline` | The agent is currently unavailable |
| `not_found` | The agent id or reference is invalid |
| timeout | The task did not finish in time |

## Historical Notes

Ignore old docs that mention:

- `ah files list`
- top-level `ah rate`
- top-level `ah stats`
- old `session_key` examples as the primary public-facing model
