# Awesome-List Submission Plan

Permanent discovery surface. Each accepted PR is evergreen inbound. Format and
entry text below are pre-matched to each list's existing style — copy-paste ready.

## Status (2026-05-18)

- ✅ **Submitted — [ai-boost/awesome-a2a#109](https://github.com/ai-boost/awesome-a2a/pull/109)** (593★, best fit)
- ✅ **Submitted — [pab1it0/awesome-a2a#58](https://github.com/pab1it0/awesome-a2a/pull/58)** (171★, legend markers matched)
- ❌ **Skipped — questflowai/awesome-a2a-hub** — not a real tools list; it's a vendor
  catalog where every entry is an agent hosted on a2a.build. ah-cli is a runtime,
  not a hosted agent → off-topic, would be rejected. Don't force it.
- ⏳ Pending owner action: e2b-dev / Shubhamsaboo / kyrolabs / bulk lists (see gating below).

## Priority order & gating

| List | Stars | Submit when | Why |
|------|-------|-------------|-----|
| **ai-boost/awesome-a2a** | 593 | **Now** | Perfect niche fit (A2A is ah-cli's core protocol). Format allows new entries. |
| **pab1it0/awesome-a2a** | 171 | Now | Same niche, mirror entry. |
| **questflowai/awesome-a2a-hub** | 26 | Now | Low bar, niche-relevant. |
| e2b-dev/awesome-ai-agents | 27.9k | After ≥1 demo + readme polish | High traffic, lenient format. |
| Shubhamsaboo/awesome-llm-apps | 110k | After a runnable example app | Requires a "you can actually run" app dir. |
| **kyrolabs/awesome-agents** | 2.3k | **Hold — needs traction** | Auto-closes brand-new repos with no history/stars. Resubmit at ~50+ stars. |
| slavakurilyak / jim-schwoebel lists | 1.4k / 1.7k | Now (issue or PR per their rules) | Bulk resource lists, low bar. |

> ⚠️ kyrolabs explicitly auto-closes "brand new repo without demonstrated
> traction". Submitting ah-cli (1 star) there now wastes the shot. Wait.

---

## ai-boost/awesome-a2a — exact entry

Section: `## 🛠️ Tools & Utilities` → `* **Other Utilities**` (bottom of that
sub-list, matching autoa2a / a2a-wrapper which also "turn agents into A2A servers").

```markdown
    *   ⚙️ [ah-cli](https://github.com/annals-ai/ah-cli) by [@annals-ai](https://github.com/annals-ai) [![Stars](https://img.shields.io/github/stars/annals-ai/ah-cli?style=social)](https://github.com/annals-ai/ah-cli) - Daemon-first local runtime for AI agents. One local daemon runs many Claude/Codex agents with sessions and transcripts kept on your own disk; expose any agent over A2A Protocol v1.0 either to a hosted open network or as a vendor-neutral self-hosted HTTP endpoint. Local multi-agent fan-out and pipelines; WebRTC P2P file transfer between agents. MIT licensed, `npm i -g @annals/ah-cli`.
```

**PR title:** `Add ah-cli (daemon-first local agent runtime, expose over A2A)`

**PR body:**
```
Adds ah-cli to Tools & Utilities → Other Utilities.

ah-cli is a daemon-first local runtime: agents and transcripts stay on the
user's machine, and any agent can be exposed over A2A Protocol v1.0 — to a
hosted open network or as a standard vendor-neutral self-hosted endpoint.
Closest neighbors in the list are autoa2a and a2a-wrapper (turning agents
into A2A servers); ah-cli adds the local-first runtime + multi-agent
orchestration angle.

- Repo: https://github.com/annals-ai/ah-cli
- npm: https://www.npmjs.com/package/@annals/ah-cli
- License: MIT
- Entry placed at the bottom of the relevant sub-list, format matched.
```

---

## pab1it0/awesome-a2a & questflowai/awesome-a2a-hub

Same entry text; check each README for the closest section heading
(Implementations / Tools) and match its bullet style before submitting.

---

## e2b-dev/awesome-ai-agents — entry (submit post-polish)

This list groups by category with a name + one-liner + links. Draft:

```markdown
- [ah-cli](https://github.com/annals-ai/ah-cli) - Daemon-first local runtime for AI agents: run Claude/Codex agents on your own machine with transcripts kept local, orchestrate multi-agent fan-out, and expose over A2A to an open network or a self-hosted endpoint.
```

---

## Submission workflow (per list)

```
1. Fork the list repo:        gh repo fork <owner>/<repo> --clone
2. Branch:                     git checkout -b add-ah-cli
3. Insert entry at the BOTTOM of the correct section, exact format match
4. Commit:                     git commit -m "Add ah-cli"
5. Push + PR:                  gh pr create --title "..." --body "..."
6. One list per PR. Never bundle. Never edit unrelated lines.
```

> These PRs open under the maintainer's GitHub identity and are public.
> Submit the 3 A2A-niche ones first (highest accept odds, exact fit),
> hold the big general lists until the repo has a demo GIF + early stars.
