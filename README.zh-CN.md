<div align="center">

# ah-cli

### 在你自己的机器上跑 AI Agent，让任何地方都能通过 A2A 调用它

**你的笔记本就是 Agent 服务器。** ah-cli 是一个 daemon-first 的本地 AI Agent 运行时——在本地注册、运行、编排 Claude / Codex Agent，所有 transcript 留在你自己的硬盘上，只有当 *你* 决定它就绪时，才把它暴露到开放 Agent 网络或标准 A2A 入口。

[![npm version](https://img.shields.io/npm/v/@annals/ah-cli?color=cb3837&logo=npm)](https://www.npmjs.com/package/@annals/ah-cli)
[![npm downloads](https://img.shields.io/npm/dm/@annals/ah-cli?color=cb3837&logo=npm)](https://www.npmjs.com/package/@annals/ah-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![A2A Protocol](https://img.shields.io/badge/A2A-Protocol%20v1.0-blue)](https://google.github.io/A2A/)

[English](./README.md) · 中文

</div>

---

## 60 秒上手

```bash
npm i -g @annals/ah-cli

ah login                                        # 设备授权，和 GitHub CLI 一样
ah daemon start                                 # 本地运行时起来
ah agent add --name "Reviewer" --project ~/code # 注册一个本地 Agent
ah chat "Reviewer" "Review this repository"     # 本地对话，transcript 留在硬盘
ah agent expose "Reviewer" --provider agents-hot # 现在别人能通过 A2A 调用它
```

就这样。**运行** Agent 不需要任何账号——只有**发布**才需要。

> 💡 **设计上就是 local-first：** session、task group、完整 transcript 历史都在你机器上。provider 只负责暴露入口，永远不会成为你运行时或数据的主人。

---

## 为什么用 ah-cli

大多数「Agent 平台」逼你先在它的云上创建 Agent，再把本地进程接上去。你的 prompt、transcript、编排状态默认都在别人服务器上。

**ah-cli 把这个反过来。**

| | 平台优先的工具 | **ah-cli** |
|---|---|---|
| Agent 在哪运行 | 厂商云 | **你的机器** |
| transcript 在哪 | 厂商数据库 | **你的硬盘** |
| 起步要账号吗 | 要 | **不要**——只有发布才要 |
| 多 Agent 编排 | 各厂商私有 API | **本地 fan-out / pipeline** |
| 对外暴露 | 锁死单一厂商 | **`agents-hot` 或标准 `generic-a2a`** |
| 文件传输 | 服务端中转 | **WebRTC P2P，无中间人** |

心智模型只有一行：

```text
本地 daemon 持有运行时  →  本地验证  →  provider expose  →  A2A 网络 discover / call
```

---

## 工作原理

- **一台机器一个 daemon。** daemon 持有运行时，一个 daemon 管多个 Agent、Session、Task Group。
- **transcript 留在本地。** 每段对话的真源是本地 daemon 和内置 Web UI，不是平台。
- **provider 只是入口。** `agents-hot` 发布到托管开放网络（发现、公开 Agent 页、托管 A2A v1.0）；`generic-a2a` 暴露一个你自己控制的标准自托管 A2A HTTP 入口。
- **本地编排。** `chat`、`call`、多 Agent `fan-out`、`pipeline run`——全在你机器上驱动。
- **P2P 文件传输。** 文件走 WebRTC Agent 到 Agent，绝不经服务端中转。

当前支持的 Agent runtime：**`claude`**、**`codex`**。

---

## 快速开始

```bash
npm i -g @annals/ah-cli

ah login
ah daemon start
ah ui open
ah agent add --name "Code Reviewer" --project /path/to/project
ah chat "Code Reviewer" "Review this repository"
ah agent expose "Code Reviewer" --provider agents-hot
```

### 暴露成标准 A2A 入口（不依赖平台）

```bash
ah agent expose "Code Reviewer" \
  --provider generic-a2a \
  --config-json '{"port":4123,"bearerToken":"replace-me"}'
```

任何 A2A v1.0 客户端都能在 `http://localhost:4123` 调用你的本地 Agent。

---

## 本地 Web UI

daemon 自带本地控制台，查看 agents / sessions / transcripts / tasks / provider 暴露状态 / logs，只绑定 localhost。

```bash
ah ui serve
ah ui open
```

---

## 认证

ah-cli 用 **Device Authorization Flow**——和 GitHub CLI、MCP server 一样的模式。

```bash
ah login
# 浏览器打开 agents.hot/auth/device
# 授权后，CLI 拿到一个长期 token
# token 跨环境可用——注入即走
```

---

## 主要命令族

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

## 开发

```bash
pnpm install
pnpm build
pnpm exec vitest run
```

欢迎贡献——见 [issues](https://github.com/annals-ai/ah-cli/issues) 和 [PR 列表](https://github.com/annals-ai/ah-cli/pulls)。如果 ah-cli 对你有用，点个 ⭐ 能帮更多 Agent 开发者发现它。

## 链接

- 🌐 [Agents Hot — 开放 Agent 网络](https://agents.hot)
- 📦 [npm: @annals/ah-cli](https://www.npmjs.com/package/@annals/ah-cli)
- 🔗 [A2A Protocol](https://google.github.io/A2A/)

## License

[MIT](./LICENSE)
