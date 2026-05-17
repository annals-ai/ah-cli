# ah-cli Launch Pack

Ready-to-paste copy for a coordinated launch. Pick a launch day, fire these
within the same 2-hour window, then sustain for 7 days. Audience is the
local-agent / A2A / MCP / self-hosted-LLM crowd — not generic devs.

> Replace `DEMO_URL` with an asciinema or 20s GIF before posting. A CLI launch
> without a demo loses ~half its conversion. Record:
> `ah login → daemon start → agent add → chat → agent expose` in one take.

---

## 1. Show HN

**Title** (keep under 80 chars, no "Show HN:" if HN auto-prefixes):

```
Show HN: ah-cli – run AI agents on your machine, call them anywhere over A2A
```

**Body:**

```
I kept hitting the same wall with agent platforms: you create the agent in
their cloud first, and your prompts + transcripts live on their servers by
default. I wanted the inverse — the runtime on my machine, data on my disk,
and the network as something I opt into.

ah-cli is a daemon-first local runtime. One daemon on your machine manages
many agents, sessions, and task groups. Transcripts never leave your disk.
When an agent is ready you expose it — either to the hosted Agents Hot open
network, or as a plain self-hosted A2A v1.0 HTTP endpoint with no vendor lock.

  npm i -g @annals/ah-cli
  ah login
  ah daemon start
  ah agent add --name Reviewer --project ~/code
  ah chat Reviewer "Review this repo"
  ah agent expose Reviewer --provider generic-a2a

Supported runtimes today: claude, codex. Multi-agent fan-out and pipelines
run locally. File transfer between agents is WebRTC P2P — no server relay.

Demo: DEMO_URL
Repo: https://github.com/annals-ai/ah-cli
npm:  https://www.npmjs.com/package/@annals/ah-cli

Happy to answer anything about the daemon model or the A2A exposure path.
```

**HN timing:** submit 8:00–9:30am ET on a Tue/Wed/Thu. Be at the keyboard for
the next 90 minutes — answer every comment within minutes. The first hour
determines front page vs. page 3.

---

## 2. Reddit — r/LocalLLaMA (primary)

**Title:**

```
ah-cli: a local-first runtime for AI agents — your machine owns the runtime, expose over A2A only when you choose
```

**Body:**

```
Built this because I wanted agents that run on my own hardware with
transcripts staying local, but still callable by other agents/tools over a
standard protocol.

- One local daemon manages many agents/sessions/task groups
- Transcripts + history stay on your disk (local Web UI is the source of truth)
- Expose via the hosted open network OR a vendor-neutral A2A v1.0 endpoint
- Local multi-agent fan-out + pipelines
- P2P (WebRTC) file transfer between agents, no relay
- Runtimes: claude, codex

npm i -g @annals/ah-cli — repo: https://github.com/annals-ai/ah-cli

Would love feedback from people self-hosting agents: what would you want
exposed over A2A vs. kept strictly local?
```

> Also cross-post (separately, reworded) to: r/AI_Agents, r/programming
> (only if you have a real "Show HN"-style story), r/selfhosted.

---

## 3. Product Hunt

- **Name:** ah-cli
- **Tagline (60 char max):** `Run AI agents on your machine, call them anywhere over A2A`
- **Description:**

```
ah-cli is a daemon-first local runtime for AI agents. Register and run
Claude/Codex agents on your own machine, keep every transcript local, and
orchestrate multi-agent fan-out and pipelines — all without an account.
Expose an agent only when you're ready: to the Agents Hot open network or as
a standard self-hosted A2A v1.0 endpoint with no vendor lock-in.
```

- **First comment (maker):** reuse the Show HN body, drop the last line.
- **Topics:** Developer Tools, Artificial Intelligence, Open Source

---

## 4. dev.to / blog article

**Title:** `Your laptop is enough: a local-first runtime for AI agents`

**Outline:**
1. The problem — platform-first agent tools put your runtime + transcripts in someone's cloud by default.
2. The inversion — local daemon owns the runtime; network is opt-in.
3. Walkthrough — install → login → agent add → chat → expose (with the 60s demo embedded).
4. `agents-hot` vs `generic-a2a` — when to use which; the no-vendor-lock angle.
5. Multi-agent: local fan-out + pipeline example.
6. Why P2P file transfer (no relay) matters for privacy.
7. Call to action: try it, star, what should be exposable vs. local-only.

Canonical the post back to the repo. Cross-post to Hashnode + Medium with
`canonical_url` set to the dev.to version.

---

## 5. X / Twitter thread

```
1/ Most "AI agent platforms" make you create the agent in their cloud first.
Your prompts and transcripts live on their servers by default.

I wanted the opposite. So: ah-cli 🧵

2/ Daemon-first. One daemon on YOUR machine runs many agents, sessions,
task groups. Transcripts never leave your disk.

  npm i -g @annals/ah-cli

3/ Run + orchestrate fully local — no account needed. Multi-agent fan-out
and pipelines run on your box. File transfer between agents is WebRTC P2P,
zero server relay.

4/ Expose an agent only when YOU decide it's ready:
- hosted Agents Hot open network, or
- a plain self-hosted A2A v1.0 endpoint (no vendor lock)

5/ Runtimes: claude, codex today.
Demo: DEMO_URL
Repo: github.com/annals-ai/ah-cli
⭐ if local-first agents are your thing.
```

---

## 6. KOL / warm-network DM template

```
Hey [Name] — saw your work on [their agent/MCP/A2A project], really liked
[specific thing].

Just shipped ah-cli: a daemon-first LOCAL runtime for AI agents. Runtime +
transcripts stay on your machine; you expose over A2A (hosted or vendor-
neutral) only when ready. Feels adjacent to what you're doing with [X].

Repo: github.com/annals-ai/ah-cli — would love your read, and happy to
return the favor on anything you're launching.
```

Target 3–5 people whose audience *is* agent/MCP builders. Quality over spray.

---

## 7. Launch-week cadence (T+0 → T+7)

| Day | Action |
|-----|--------|
| T+0 | Show HN (morning ET) + r/LocalLLaMA + PH + X thread + warm-network DMs |
| T+1 | dev.to article + Hashnode/Medium canonical cross-post |
| T+2 | r/AI_Agents + r/selfhosted (reworded), reply to all HN/Reddit threads |
| T+3 | Second-wave DMs to slower responders; post the demo GIF standalone |
| T+4 | awesome-list PRs go in (see awesome-lists.md) |
| T+5 | Recap thread on X with early metrics + 1 user quote |
| T+7 | dev.to "what I learned launching" follow-up, link back to repo |
