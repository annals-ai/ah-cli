# ah-cli — Development Guide

`ah-cli` 现在是 Agents Hot 配套的 **本地 daemon-first Agent 运行时**。

不要再把它理解成“把单个 Agent connect 到平台”的旧式桥接工具。当前正确心智是：

`本地 daemon 持有运行时 -> 本地验证 -> provider expose -> 平台 / A2A 网络调用`

## 1. Repo Shape

```text
ah-cli/
├── packages/
│   ├── cli/       # @annals/ah-cli，命令行和本地 daemon
│   ├── ui/        # 本地 Web UI
│   ├── protocol/  # Bridge / A2A 相关类型
│   └── worker/    # Cloudflare Worker / Durable Objects
├── tests/         # Vitest
└── CLAUDE.md
```

## 2. Product Truths

1. 一台机器一个 daemon。
2. daemon 管多个本地 Agent、多个 Session、多个 Task Group。
3. transcript 真源在本地 daemon / 本地 Web UI，不在平台。
4. 平台负责公开入口、权限、发现、A2A 兼容和任务索引。
5. `agents-hot` 和 `generic-a2a` 是当前主 provider。
6. `ah-cli` 的对外 npm 包名是 `@annals/ah-cli`，命令是 `ah`。

## 3. Current Command Surface

主命令族以 `packages/cli/src/index.ts` 为准：

- `login`, `status`, `doctor`
- `daemon start|stop|status|logs`
- `ui serve|open`
- `agent add|list|update|remove|show|clone|quick|ping|expose|unexpose|grant|revoke|acl`
- `session list|get|delete|archive|clean`
- `sessions`, `ps`
- `task create|list|show|archive|update`
- `tasks`
- `chat`, `call`
- `fan-out`
- `pipeline run`
- `provider status|join|invite|members|kick`
- `config`, `help`

不要再往文档里写旧的：

- `connect-ticket`
- `connect --setup`
- `ah install` / `ah uninstall`
- `ah daemon ui`
- `ah discover`
- `ah subscribe` / `ah unsubscribe` / `ah subscriptions`
- `ah skills` / `ah mcp`
- `ah profile`

平台数据库已精简（2026-04-13）：只保留 authors、agents、cli_tokens、device_codes、connect_tickets、author_subscriptions、membership_requests、agent_registration_attempts、token_rate_limits 共 9 张表。packages、orders、skills、a2a_tasks、user_sessions、agent_calls 等 11 张表已删除。cli_tokens 永不过期，无 expires_at/revoked_at 列。

本地 UI 的当前入口是：

- `ah ui serve`
- `ah ui open`

## 4. Architecture

### 4.1 CLI / Daemon

`packages/cli/` 负责：

- 本地 daemon 生命周期
- Agent 注册与管理
- Session / Task Group 生命周期
- 本地 chat / call
- provider expose / unexpose / status / join / invite / members / kick
- agent access control (grant / revoke / acl)
- config / doctor / pipeline

### 4.2 Local Web UI

`packages/ui/` 是 daemon 附带的本地控制台：

- 查看 agent / session / transcript / task / provider / log
- 只绑定本机
- 是 transcript 的本地查看面

### 4.3 Providers

当前主 provider：

1. `agents-hot`
   - 将本地 Agent 暴露到平台网络
2. `generic-a2a`
   - 在本地 daemon 上起标准 A2A HTTP 入口

### 4.4 Worker

`packages/worker/` 负责平台侧 ingress 和 relay：

- 接收平台请求
- 转发到本地 Agent 对应链路
- 处理平台侧状态和 Durable Object 协调

### 4.5 Protocol

`packages/protocol/` 持有 Bridge / A2A 相关共享类型和错误语义。

## 5. Supported Runtime Model

当前本地 Agent 的常见 runtime 是：

- `claude`
- `codex`

如果要新增 runtime，先按现有 daemon-first 模型接进去，不要引回旧 connect 架构。

## 6. Development Rules

1. 先判断你改的是哪一层：
   - CLI / daemon
   - local UI
   - provider / ingress
   - worker
   - protocol
2. 先改最小闭环，不要顺手重写无关模块。
3. 不要把平台当 transcript source of truth。
4. 不要再设计以 `connect-ticket` 为中心的新流程。
5. 文档、README、skill 名称必须和当前命令面一致。

## 7. Verification

### 7.1 子仓最小验证

```bash
pnpm build
pnpm exec vitest run
```

如需额外检查：

```bash
pnpm lint
```

如果 lint 失败，先判断是不是当前改动引入的，还是仓库里已有的 lint debt。

### 7.2 改了 provider / A2A / bridge

除了子仓验证，还要回主仓做平台联调，并在需要时跑 Mac Mini 远端验证。

常用路径：

```bash
ssh mac-mini 'zsh -lc "cd /Users/yan/agents-hot/ah-cli && node scripts/e2e-a2a-call.mjs"'
```

## 8. Release Facts

### CLI Publish

- npm package: `@annals/ah-cli`
- command: `ah`
- repo: `annals-ai/ah-cli`

### Worker Deploy

```bash
npx wrangler deploy --config packages/worker/wrangler.toml
```

## 9. Mac Mini Paths

- ah-cli: `/Users/yan/agents-hot/ah-cli`
- main repo: `/Users/yan/agents-hot/repo`

## 10. Further Reading

- `.agents/skills/ah-dev/SKILL.md`
- `.agents/skills/ah-creator/SKILL.md`
- `.agents/skills/ah-a2a/SKILL.md`
- `packages/cli/src/index.ts`
