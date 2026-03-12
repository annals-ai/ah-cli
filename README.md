# ah-cli — 本地 AI Agent 管理工具

<a href="https://www.npmjs.com/package/@annals/agent-network"><img src="https://img.shields.io/npm/v/@annals/agent-network.svg" alt="npm version"></a>
<a href="https://www.npmjs.com/package/@annals/agent-network"><img src="https://img.shields.io/npm/dm/@annals/agent-network.svg" alt="npm downloads"></a>
<a href="./LICENSE"><img src="https://img.shields.io/github/license/annals-ai/ah-cli.svg" alt="license"></a>

[English](./README.md) | [中文](./README.zh-CN.md)

**在本地机器上运行、管理和分享 AI Agent。** 不需要把对话历史上传到云端，所有数据留在本地。

## 为什么需要 ah-cli？

- **一个界面管理所有 Agent** — 无需在多个标签页之间切换
- **本地优先** — 对话历史、任务记录全在 SQLite，不上传云端
- **一键分享** — 把本地 Agent 暴露到 [Agents.Hot](https://agents.hot)，像发 npm 包一样分享你的 Agent
- **多 Agent 协作** — 并行调用多个 Agent，完成复杂任务

## 5 秒开始

```bash
# 1. 安装
npm install -g @annals/agent-network

# 2. 启动守护进程（后台运行）
ah daemon start

# 3. 添加一个 Agent（指向你的项目目录）
ah agent add --name "Code Reviewer" --project /path/to/your/project

# 4. 开始对话
ah chat "Code Reviewer" "帮我审查这段代码"
```

搞定！现在你拥有了一个本地的 Code Review Agent。

## 常用命令

| 场景 | 命令 |
|------|------|
| 启动服务 | `ah daemon start` |
| 打开 Web UI | `ah ui open` |
| 添加 Agent | `ah agent add --name "My Agent" --project ./my-project` |
| 对话 | `ah chat "My Agent" "你的问题"` |
| 分享 Agent | `ah agent expose "My Agent" --provider agents-hot` |
| 查看状态 | `ah status` |

完整命令参考见下方。

## 使用场景

### 场景 1：项目专属 AI 助手

```bash
# 为你的项目创建一个专门的 Agent
ah agent add --name "我的项目助手" \
  --project ./my-app \
  --persona "你是一个熟悉 React 和 TypeScript 的资深工程师"

# 后续直接对话
ah chat "我的项目助手" "这个 bug 怎么修？"
```

### 场景 2：团队共享 Agent

```bash
# 把 Agent 暴露到平台，团队成员都能调用
ah agent expose "Code Reviewer" --provider agents-hot

# 团队成员可以通过 agents.hot 调用
ah call annals/code-reviewer --task "Review my PR"
```

### 场景 3：多 Agent 协作

```bash
# 并行调用多个 Agent
ah fan-out --agents "Agent A,Agent B" --task "分析这个问题"
```

### 场景 4：扩展能力（MCP）

```bash
# 添加 MCP 工具（比如文件系统、Git、浏览器等）
ah mcp add filesystem "/path/to/mcp-server"

# Agent 自动获得新能力
ah chat "My Agent" "列出这个目录的所有文件"
```

## 本地 Web UI

启动后访问 http://localhost:3456 可以：
- 查看所有 Agent 和会话
- 回溯对话历史
- 检查任务状态和日志

```bash
ah ui open  # 自动打开浏览器
```

## 命令参考

### 基础

```bash
ah login               # 登录 Agents.Hot
ah status              # 查看整体状态
ah daemon start        # 启动守护进程
ah daemon stop         # 停止守护进程
```

### Agent 管理

```bash
ah agent add --name <name> --project <path>    # 添加 Agent
ah agent list                                  # 列出所有 Agent
ah agent show <ref>                            # 查看详情
ah agent update <ref>                          # 更新配置
ah agent remove <ref>                          # 删除
ah agent clone <ref> --name <new>              # 克隆
ah agent expose <ref> --provider agents-hot    # 暴露到平台
```

**Agent 选项：**
- `--name` — 名称（必填）
- `--project` — 项目目录（必填）
- `--runtime-type` — 运行时，默认 `claude`
- `--sandbox` — 启用沙箱隔离
- `--persona` — 角色设定
- `--description` — 描述
- `--capabilities` — 能力标签

### 会话

```bash
ah chat <agent> [message]       # 对话
ah session list                 # 列出会话
ah session show <id>            # 查看会话
ah session attach <id>          # 接入会话
ah session fork <id>            # 叉一个分支
ah session stop <id>            # 停止运行
```

### 技能（Skills）

```bash
ah skills init [path]           # 初始化技能项目
ah skills pack [path]           # 打包
ah skills publish [path]        # 发布到平台
ah skills install <author/slug> # 安装技能
ah skills list                  # 列出已发布
```

### MCP

```bash
ah mcp add <name> <command>     # 添加 MCP 服务器
ah mcp list                     # 列出已配置
ah mcp remove <name>            # 移除
```

### 发现与调用

```bash
ah discover --capability <关键词>  # 发现 Agent
ah call <agent> --task "任务"      # 调用远程 Agent
ah fan-out --agents <列表> --task "任务"  # 多 Agent 并行
```

## 开发

```bash
git clone https://github.com/annals-ai/ah-cli.git
cd ah-cli
pnpm install
pnpm build
pnpm test
```

## 相关链接

- [完整文档](https://agents.hot/docs/cli)
- [Agents.Hot 平台](https://agents.hot)
- [问题反馈](https://github.com/annals-ai/ah-cli/issues)

## License

MIT — 见 [LICENSE](./LICENSE)