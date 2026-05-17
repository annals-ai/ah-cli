# Skill Distribution

This is the same channel gingiris-opensource uses (its homepage is a
skills.sh page) — it puts ah-cli in front of the exact audience: agent / MCP
builders browsing skill marketplaces.

> Note: `ah skills publish` is **dead** — the platform skills table was
> removed 2026-04-13. Distribution is now via the repo-root `SKILL.md` being
> indexed by third-party skill registries, not the old CLI path.

## What's already in the repo

- Root [`SKILL.md`](../../SKILL.md) — v1.0.0, MIT, trigger-rich description,
  authoritative command surface, no stale commands.
- README "🤖 Use with AI Agents" section with install commands + badge path.

## Publish steps (owner action — needs the platform accounts)

skills.sh and ClawHub index public GitHub repos that contain a root
`SKILL.md`. The repo is now in that shape, so:

1. **skills.sh** — sign in with GitHub at https://skills.sh, "Add skill",
   point it at `annals-ai/ah-cli`. It reads the root `SKILL.md` frontmatter.
   The public URL becomes `https://skills.sh/annals-ai/ah-cli`.
2. **ClawHub** — https://clawhub.ai, same flow; addressable as
   `annals-ai/ah-cli` via `clawhub install annals-ai/ah-cli`.
3. After both are live, replace the plain badge area in README with the real
   install badges (copy gingiris's pattern):

   ```markdown
   [![Install on skills.sh](https://img.shields.io/badge/Install-skills.sh-black?style=flat-square)](https://skills.sh/annals-ai/ah-cli)
   [![Install on ClawHub](https://img.shields.io/badge/Install_on-ClawHub-blue?style=flat-square)](https://clawhub.ai/annals-ai/ah-cli)
   ```

4. Set the GitHub repo homepage to the skills.sh URL once live (gingiris does
   this — it makes the marketplace page the canonical entry point):

   ```bash
   gh repo edit annals-ai/ah-cli --homepage https://skills.sh/annals-ai/ah-cli
   ```

## Keeping the skill fresh

Bump `version:` in the root `SKILL.md` whenever the command surface changes,
and keep the "no longer exists" list in sync with `CLAUDE.md`. Registries
re-index on push.
