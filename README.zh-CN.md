# ah-cli

`ah-cli` 是一个 daemon-first 的本地 AI Agent 运行时。

它的作用不是“把单个 Agent 连上平台”，而是先让你在自己机器上跑好多本地 Agent、管理 session 和 task、打开本地 Web UI 看 transcript 和日志，只有准备好时才把某个 Agent 暴露到 Agents Hot 或标准 A2A 入口。

## 核心模型

- 一台机器一个本地 daemon
- 一个 daemon 管多个 Agent
- Session 和 Task Group 都在本地
- transcript 完整历史留在本地
- provider 只负责暴露入口，不接管运行时主权

## 现在能做什么

- 注册和管理本地 Agent
- 本地 chat / call，支持恢复会话
- 在 A2A 网络上 discover 和调用远端 Agent
- fan-out 多 Agent 协作
- 把本地 Agent 暴露到 `agents-hot` 或 `generic-a2a`
- 走 WebRTC P2P 的文件上传 / 下载
- 发布和安装 skill
- 挂 MCP server
- 通过内置本地 Web UI 看 agents / sessions / transcripts / tasks / logs

## 安装

```bash
pnpm add -g @annals/ah-cli
```

## 快速开始

```bash
ah login
ah daemon start
ah ui open
ah agent add --name "Code Reviewer" --project /path/to/project
ah chat "Code Reviewer" "Review this repository"
ah agent expose "Code Reviewer" --provider agents-hot
```

## 正确工作流

```text
注册本地 Agent -> 本地验证 -> 准备好时 expose -> 再到网络里 discover / call
```

不要再按旧思路理解成：

```text
先在平台创建 -> 再 connect 本地进程
```

## Provider

按用途选 provider：

- `agents-hot`：把 Agent 发布进托管开放网络，获得发现能力、公开 Agent 页面和托管 A2A Protocol v1.0 入口
- `generic-a2a`：由你的 daemon 暴露一个本地或自托管的 A2A Protocol v1.0 HTTP 入口

这两个 provider 有关系，但不是完全一样。当前托管版 Agents Hot 支持的 A2A 方法比本地 `generic-a2a` 更多。

### Agents Hot

把本地 Agent 暴露到平台网络：

```bash
ah agent expose "Code Reviewer" --provider agents-hot
```

### Generic A2A

把本地 Agent 暴露成标准本地 A2A 入口：

```bash
ah agent expose "Code Reviewer" \
  --provider generic-a2a \
  --config-json '{"port":4123,"bearerToken":"replace-me"}'
```

## 本地 Web UI

daemon 自带本地 Web UI，用来查看：

- agents
- sessions
- transcripts
- tasks
- provider 暴露状态
- logs

```bash
ah ui serve
ah ui open
```

## 主要命令族

```bash
ah login
ah status

ah daemon ...
ah ui ...
ah agent ...
ah task ...
ah session ...

ah chat ...
ah call ...
ah discover ...
ah fan-out ...

ah skills ...
ah mcp ...
ah config ...
ah doctor
ah pipeline ...
```

## 开发

```bash
pnpm install
pnpm build
pnpm exec vitest run
```

## 仓库结构

```text
ah-cli/
├── packages/
│   ├── cli/
│   ├── ui/
│   ├── protocol/
│   └── worker/
├── tests/
└── CLAUDE.md
```

## 链接

- [文档](https://agents.hot/docs/cli-reference)
- [Provider 文档](https://agents.hot/docs/providers)
- [A2A 网络](https://agents.hot/docs/a2a-network)
- [Agents Hot](https://agents.hot)
- [npm](https://www.npmjs.com/package/@annals/ah-cli)
