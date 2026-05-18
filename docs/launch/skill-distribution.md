# Skill Distribution

Same channel gingiris-opensource uses — puts ah-cli in front of agent / MCP
builders browsing the skills.sh leaderboard.

> `ah skills publish` is **dead** (platform skills table removed 2026-04-13).
> Distribution is now via the GitHub repo being installable by the
> `vercel-labs/skills` CLI and surfacing on skills.sh.

## How skills.sh actually works (verified 2026-05-18)

There is **no login, no submit form, no "Add skill" button**. Confirmed by
reading https://skills.sh/docs directly:

- skills.sh is a **leaderboard ranked by anonymous install telemetry** from the
  `npx skills` CLI. A skill appears once people install it via the CLI.
- Eligibility = a **public GitHub repo with a discoverable `SKILL.md`**. No
  account is ever involved. The earlier "sign in with GitHub / Add skill"
  plan was wrong — there is no such flow.
- The page `https://skills.sh/<owner>/<repo>` and search populate only after
  the leaderboard aggregates installs. One install will not show immediately
  on a board with ~389K total installs — it needs real install volume.

## Done in-repo

- ✅ Public skill at [`.agents/skills/ah-cli/SKILL.md`](../../.agents/skills/ah-cli/SKILL.md)
  (v1.0.0, MIT, trigger-rich, authoritative command surface).
- ✅ `npx skills add annals-ai/ah-cli` resolves and installs — telemetry fires.
- ✅ README badge uses the documented format:
  `[![skills.sh](https://skills.sh/b/annals-ai/ah-cli)](https://skills.sh/annals-ai/ah-cli)`

### Important caveat: `.agents/skills/` shadows root SKILL.md

The `vercel-labs/skills` CLI installs every skill under `.agents/skills/*`,
**not** a root `SKILL.md`, when both exist. So `npx skills add annals-ai/ah-cli`
pulls all of: `ah-cli` (the public usage skill — good), plus the internal
dev skills `ah-dev`, `ah-creator`, `ah-a2a`, `agents-hot-onboarding`.

Public installers therefore also get the internal dev tooling. Owner decision
(not done autonomously — affects skill architecture):

- Option A: accept it (dev skills are harmless, just noisy).
- Option B: mark the internal ones private (frontmatter `private: true`) or
  move them out of `.agents/skills/` so only `ah-cli` is publicly installable.
  Recommended before the launch push so skills.sh shows one clean entry.

## What actually drives skills.sh ranking

Install volume via `npx skills add annals-ai/ah-cli`. It rises with the same
launch motion as everything else — HN/Reddit/awesome-lists driving people to
install. There is no shortcut and nothing more to "register".

## Optional once it has volume

- Set repo homepage to the skills.sh page (gingiris does this):
  `gh repo edit annals-ai/ah-cli --homepage https://skills.sh/annals-ai/ah-cli`
- ClawHub (clawhub.ai, reachable) is a separate registry — mechanism
  unverified; revisit only if it proves to be a real traffic source.

## Keeping the skill fresh

Bump `version:` in `.agents/skills/ah-cli/SKILL.md` when the command surface
changes; keep the "no longer exists" list in sync with `CLAUDE.md`.
