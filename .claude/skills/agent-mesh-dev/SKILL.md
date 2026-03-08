---
name: agent-mesh-dev
description: |
  Agent Mesh (Bridge Worker / CLI / Protocol) code development guide.
  Use when modifying code, adapters, Worker, protocol, provider ingress,
  daemon runtime, or platform integration in the agent-mesh sub-repo.
version: 0.0.6
---

# Agent Mesh Dev — Code Development Guide

## How Agent Mesh Works Now

Agent Mesh 已经不是 “`connect` 把单个 agent 连上平台” 的模型了，而是：

1. **CLI / Daemon** (`packages/cli/`)
   - 一台机器一个 daemon
   - 管理多个 agent、多个 session、多个 task group
   - 本地 `chat/call` 先命中 daemon
   - daemon 同时启动本地 Web UI backend
   - transcript 真源和历史查看面都在本地 daemon / Web UI
2. **Local Web UI** (`packages/ui/`)
   - 提供 transcript、task、provider exposure、日志查看与基础管理动作
   - 只绑定本机，不是公开入口
   - 未来可被 Electron/Tauri 包装，但 v1 先走本地 Web UI
3. **Providers**
   - `agents-hot`: 通过 Bridge Worker 把本地 agent 暴露到平台
   - `generic-a2a`: 在本地 daemon 上起标准 A2A HTTP ingress
4. **Bridge Worker** (`packages/worker/`)
   - 继续负责 Agents Hot 线上 ingress 和转发
5. **Protocol** (`packages/protocol/`)
   - Bridge / relay / A2A 相关消息类型

核心心智：

`daemon 拥有本地 session 与 transcript 主权 -> 本地 Web UI 负责查看与管理 -> provider 负责暴露入口 -> 平台只做入口、权限和发现`

## Behavior

当此 skill 触发时：

1. 先读 `agent-mesh/CLAUDE.md`
2. 判断改动属于哪一层：
   - daemon / local runtime
   - provider / ingress
   - worker / bridge
   - protocol
3. 不要再按旧的 `connect-ticket/connect` 架构去设计新能力

## Sub-repo Location

```text
agents-hot/
└── agent-mesh/
    ├── packages/
    │   ├── cli/
    │   ├── ui/
    │   ├── protocol/
    │   └── worker/
    ├── tests/
    └── CLAUDE.md
```

## Development

```bash
cd agent-mesh
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Deployment

### Bridge Worker

```bash
cd agent-mesh
npx wrangler deploy --config packages/worker/wrangler.toml
```

### CLI Publishing

```bash
cd agent-mesh/packages/cli
pnpm version patch --no-git-tag-version
cd ../..

VERSION=$(node -p "require('./packages/cli/package.json').version")
git add packages/cli/package.json
git commit -m "release: v${VERSION}"
git tag "v${VERSION}"
git push origin main
git push origin "v${VERSION}"
```

## Main Project Integration Points

| Main project file | Purpose |
|-------------------|---------|
| `src/lib/mesh-client.ts` | Platform -> bridge relay client |
| `src/lib/agent-session-service.ts` | 平台侧 `session_id` / `user_sessions` 索引逻辑 |
| `src/app/api/agents/[id]/chat/route.ts` | Chat 入口 |
| `src/app/api/agents/[id]/call/route.ts` | Call 入口 |
| `src/app/api/developer/agents/[id]/sessions/sync/route.ts` | owner 本地 session 同步 |

## Verification Order

1. `cd agent-mesh && pnpm test`
2. `cd agent-mesh && pnpm build`
3. `cd .. && pnpm test`
4. `cd .. && pnpm run lint`
5. 改本地 Web UI / daemon 文案边界时，确认口径一致：完整 transcript 留在本地，Agents Hot 不是 transcript surface
6. 改 provider / ingress 时，补本地 smoke 或 Mac Mini 实机验证

## Further Reading

- `agent-mesh/CLAUDE.md`
- `references/architecture.md`
- `references/protocol-reference.md`
- `.claude/skills/agent-mesh-creator/references/cli-reference.md`
