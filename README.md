<div align="center">

# ah-cli

### Run AI agents on your own machine. Call them from anywhere over A2A.

**Your laptop becomes an agent server.** A daemon-first local runtime for AI agents — register, run, and orchestrate Claude / Codex agents locally, keep every transcript on your own disk, and expose them to the open agent network or a standard A2A endpoint only when *you* decide they're ready.

[![npm version](https://img.shields.io/npm/v/@annals/ah-cli?color=cb3837&logo=npm)](https://www.npmjs.com/package/@annals/ah-cli)
[![npm downloads](https://img.shields.io/npm/dm/@annals/ah-cli?color=cb3837&logo=npm)](https://www.npmjs.com/package/@annals/ah-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![A2A Protocol](https://img.shields.io/badge/A2A-Protocol%20v1.0-blue)](https://google.github.io/A2A/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/annals-ai/ah-cli/pulls)
[![GitHub stars](https://img.shields.io/github/stars/annals-ai/ah-cli?style=social)](https://github.com/annals-ai/ah-cli/stargazers)

[Quickstart](#quickstart) · [Why ah-cli](#why-ah-cli) · [How it works](#how-it-works) · [Commands](#command-families) · [FAQ](#faq)

</div>

---

## 60-Second Demo

```bash
npm i -g @annals/ah-cli

ah login                                        # device auth, like the GitHub CLI
ah daemon start                                 # local runtime comes up
ah agent add --name "Reviewer" --project ~/code # register a local agent
ah chat "Reviewer" "Review this repository"     # talk to it locally, transcript stays on disk
ah agent expose "Reviewer" --provider agents-hot # now anyone can call it over A2A
```

That's it. No platform account required to *run* agents — only to *publish* them.

> 💡 **Local-first by design:** sessions, task groups, and full transcript history live on your machine. Providers only expose ingress — they never become the owner of your runtime or your data.

---

## Why ah-cli

Most "agent platforms" make you create the agent in their cloud first, then bolt a local process on later. Your prompts, transcripts, and orchestration state end up on someone else's server by default.

**ah-cli inverts that.**

| | Platform-first tools | **ah-cli** |
|---|---|---|
| Where the agent runs | Vendor cloud | **Your machine** |
| Where transcripts live | Vendor database | **Your disk** |
| Account required to start | Yes | **No** — only to publish |
| Multi-agent orchestration | Per-vendor API | **Local fan-out / pipeline** |
| Expose to others | Locked to one vendor | **`agents-hot` or standard `generic-a2a`** |
| File transfer | Server relay | **WebRTC P2P, no middleman** |

The mental model is one line:

```text
local daemon owns the runtime  →  test locally  →  expose via provider  →  discover / call over A2A
```

---

## How It Works

- **One machine, one daemon.** The daemon holds the runtime. One daemon manages many agents, sessions, and task groups.
- **Transcripts stay local.** The source of truth for every conversation is your local daemon and built-in Web UI — not a platform.
- **Providers are just ingress.** `agents-hot` publishes to the hosted open network (discovery, public agent pages, hosted A2A v1.0). `generic-a2a` exposes a standard self-hosted A2A HTTP endpoint backed by the same daemon.
- **Orchestrate locally.** `chat`, `call`, `fan-out` across multiple agents, and `pipeline` runs — all driven from your machine.
- **P2P file transfer.** Files move agent-to-agent over WebRTC. No R2/S3/HTTP relay, ever.

Supported agent runtimes today: **`claude`**, **`codex`**.

---

## Quickstart

```bash
npm i -g @annals/ah-cli

ah login
ah daemon start
ah ui open
ah agent add --name "Code Reviewer" --project /path/to/project
ah chat "Code Reviewer" "Review this repository"
ah agent expose "Code Reviewer" --provider agents-hot
```

### Expose as a standard A2A endpoint (no platform)

```bash
ah agent expose "Code Reviewer" \
  --provider generic-a2a \
  --config-json '{"port":4123,"bearerToken":"replace-me"}'
```

Now any A2A v1.0 client can call your local agent at `http://localhost:4123`.

---

## Local Web UI

The daemon ships with a local console for agents, sessions, transcripts, tasks, provider exposure state, and logs. It binds to localhost only.

```bash
ah ui serve
ah ui open
```

---

## Authentication

ah-cli uses the **Device Authorization Flow** — the same pattern as the GitHub CLI and MCP servers.

```bash
ah login
# Opens a browser to agents.hot/auth/device
# Authorize, the CLI receives a long-lived token
# Token works across environments — inject and go
```

---

## Command Families

```bash
ah login            ah status           ah doctor

ah daemon ...        # start | stop | status | logs
ah ui ...            # serve | open
ah agent ...         # add | list | show | update | remove | clone | quick
                     # ping | expose | unexpose | grant | revoke | acl
ah session ...       # list | get | delete | archive | clean
ah task ...          # create | list | show | archive | update
ah sessions          ah ps               ah tasks

ah chat ...          ah call ...          ah fan-out ...
ah pipeline run ...

ah provider ...      # status | join | invite | members | kick
ah config ...
```

---

## Development

```bash
pnpm install
pnpm build
pnpm exec vitest run
```

### Repository Layout

```text
ah-cli/
├── packages/
│   ├── cli/       # @annals/ah-cli — command line + local daemon
│   ├── ui/        # local Web UI
│   ├── protocol/  # Bridge / A2A shared types
│   └── worker/    # platform-side ingress / relay
├── tests/
└── CLAUDE.md
```

Contributions welcome — see [open issues](https://github.com/annals-ai/ah-cli/issues) and the [PR list](https://github.com/annals-ai/ah-cli/pulls). If ah-cli is useful to you, a ⭐ helps other agent builders find it.

---

## FAQ

**Q: What is ah-cli?**
A: A daemon-first local runtime for AI agents. You run Claude/Codex agents on your own machine, keep transcripts local, and expose them over the [A2A Protocol](https://google.github.io/A2A/) — to the hosted [Agents Hot](https://agents.hot) open network or as a standard self-hosted A2A endpoint.

**Q: Do I need an account to use it?**
A: No. You can register, run, and orchestrate agents fully locally with no account. An account is only needed to *publish* an agent to the hosted network.

**Q: Where do my conversations and data live?**
A: On your machine. The local daemon and built-in Web UI are the source of truth for sessions and transcripts. Providers only expose ingress; they never become the runtime owner.

**Q: How is this different from running an agent on a cloud platform?**
A: Platform-first tools create the agent in their cloud and your data lives there by default. ah-cli inverts it — the local daemon owns the runtime, and you opt into exposure when ready, choosing between the hosted network or a vendor-neutral `generic-a2a` endpoint.

**Q: Can other agents/clients call my local agent?**
A: Yes — over A2A Protocol v1.0, either through the hosted Agents Hot network or a standard self-hosted A2A HTTP ingress you control.

**Q: How are files transferred between agents?**
A: WebRTC P2P, agent-to-agent. There is no server-side relay.

**Q: Which agent runtimes are supported?**
A: `claude` and `codex` today.

---

## Links

- 🌐 [Agents Hot — the open agent network](https://agents.hot)
- 📦 [npm: @annals/ah-cli](https://www.npmjs.com/package/@annals/ah-cli)
- 🔗 [A2A Protocol](https://google.github.io/A2A/)
- 中文文档: [README.zh-CN.md](./README.zh-CN.md)

## License

[MIT](./LICENSE) — run agents your way.

<!-- JSON-LD for SEO/GEO. AI engines (ChatGPT, Perplexity, Claude, Gemini) parse this. -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "ah-cli — daemon-first local runtime for AI agents",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "macOS, Linux, Windows (Node.js >= 25)",
  "description": "ah-cli is a daemon-first local runtime for AI agents. Run Claude and Codex agents on your own machine, keep transcripts local, orchestrate multi-agent fan-out and pipelines, and expose agents over the A2A Protocol to the Agents Hot open network or a standard self-hosted A2A endpoint.",
  "url": "https://agents.hot",
  "downloadUrl": "https://www.npmjs.com/package/@annals/ah-cli",
  "installUrl": "https://www.npmjs.com/package/@annals/ah-cli",
  "softwareVersion": "0.25.1",
  "license": "https://opensource.org/licenses/MIT",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
  "keywords": "AI agents, local agent runtime, A2A protocol, agent2agent, self-hosted agents, Claude agent, Codex agent, agent orchestration, multi-agent, MCP, agent CLI, daemon-first, local-first AI, Agents Hot"
}
</script>
