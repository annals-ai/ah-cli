# ah-cli Protocol Reference

This is the current high-level map of protocol boundaries in `ah-cli`.
The main workflow now lives in `ah-dev/SKILL.md`; use this file as extra detail.

## Source of Truth

Read these files first:

- `packages/protocol/src/messages.ts`
- `packages/protocol/src/errors.ts`
- `packages/protocol/src/version.ts`
- `packages/worker/src/agent-session.ts`
- `packages/cli/src/bridge/manager.ts`

If this note and code disagree, the code wins.

## Boundary 1: CLI Runtime <-> Bridge Worker

The CLI runtime speaks bridge messages over WebSocket.

### CLI -> Worker messages

Current message families include:

- `register`
- `chunk`
- `done`
- `error`
- `heartbeat`
- `discover_agents`
- `call_agent`
- `rtc_signal`

### Worker -> CLI messages

Current message families include:

- `registered`
- `message`
- `cancel`
- `discover_agents_result`
- `call_agent_chunk`
- `call_agent_done`
- `call_agent_error`
- `rtc_signal_relay`

## Boundary 2: Platform <-> Worker Relay HTTP

The worker also exposes relay-style HTTP endpoints for platform traffic.

Important concepts:

- relay request body includes `agent_id`, `session_id`, `request_id`, `content`
- stream mode returns SSE events
- async mode returns early and later posts results back through callback flow
- keepalive and file-transfer events travel through the same logical path

## Boundary 3: External A2A

Do not confuse the bridge protocol with external A2A 1.0.

External A2A 1.0 behavior is implemented mainly in the main repo under:

- `src/lib/a2a/`
- `src/app/api/a2a/`

Use those paths when you are working from the `agents-hot` root checkout.
`ah-cli` participates in that flow through provider bindings and generic-a2a ingress, but it does not define the whole public A2A spec by itself.

## Boundary 4: Local Daemon RPC

Inside `packages/cli`, command handlers talk to the daemon through internal RPC-style method calls such as:

- `agent.*`
- `session.*`
- `task.*`
- `runtime.*`
- `config.*`
- `daemon.*`

If you change a daemon method contract, audit:

1. the CLI command
2. the daemon handler
3. any UI API route that depends on the same data

## Runtime Support Warning

The runtime/product surface is broader than some bridge protocol types today.

Example:

- runtime profiles now include `claude` and `codex`
- some protocol typings still hard-code older assumptions such as `agent_type: 'claude'`

If you change runtime support, do not stop at the CLI help text. Audit protocol types and worker logic too.

## File Transfer

WebRTC signaling is part of the bridge contract:

- `rtc_signal`
- `rtc_signal_relay`

This affects:

1. remote `--upload-file`
2. remote `--with-files`
3. caller/target coordination through the platform and worker

If file transfer breaks, check all three sides:

- CLI sender/receiver logic
- worker relay/buffering
- platform-facing signaling endpoints

## Change Safety Checklist

When editing protocol behavior:

1. update shared types first
2. update worker handling
3. update CLI bridge manager/runtime handling
4. update tests and docs
5. run an actual smoke flow, not only typecheck
