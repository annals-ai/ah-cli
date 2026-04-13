# Self-Hosted A2A Provider

企业内网部署：**数据不出公司网络**，零第三方依赖。
把本地 CLI agent 暴露为标准 [A2A](https://google.github.io/A2A/) HTTP 端点。

## 快速开始

```bash
npm install
npm start
```

启动后控制台会打印自动生成的 API token。用它调用：

```bash
curl -X POST http://127.0.0.1:8080/a2a \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <your-token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tasks/send","params":{"message":{"role":"user","parts":[{"type":"text","text":"ping"}]}}}'
```

## 安全模型

| 措施 | 默认值 | 说明 |
|------|--------|------|
| Bearer token | 自动生成 64 字符 | 每次请求必须携带，常量时间比较 |
| 监听地址 | `127.0.0.1` | 默认只接受本机请求 |
| 速率限制 | 30 req/min | 滑动窗口 |
| 请求超时 | 5 分钟 | 超时自动 kill 子进程 |
| 请求体大小 | 1 MB | 超过直接断开连接 |
| 审计日志 | stdout JSON | 每次调用记录 event/taskId/时间戳 |

## 配置

全部通过环境变量：

```bash
# 认证
API_TOKEN=my-company-secret   # 不设则自动生成

# 网络
HOST=0.0.0.0                  # 监听所有接口（内网部署用）
PORT=8080                     # 监听端口

# Agent 后端
AGENT_CMD=claude              # CLI 命令（claude / codex / node my-agent.js）
AGENT_NAME=our-agent          # Agent Card 中的名称
AGENT_DESCRIPTION="..."       # Agent Card 中的描述
AGENT_PROJECT=/path/to/repo   # Agent 工作目录

# 限制
REQUEST_TIMEOUT_MS=300000     # 请求超时（毫秒）
RATE_LIMIT_RPM=30             # 每分钟最大请求数
MAX_BODY_BYTES=1048576        # 请求体大小限制（字节）
```

## 典型部署

### 1. 内网单机

```bash
# 只有本机能访问，最安全
npm start
```

### 2. 内网共享

```bash
# 允许同网段其他机器访问
HOST=0.0.0.0 API_TOKEN=team-shared-secret npm start
```

### 3. 用 systemd 持久化

```ini
# /etc/systemd/system/a2a-agent.service
[Unit]
Description=Self-Hosted A2A Agent
After=network.target

[Service]
Type=simple
User=agent
WorkingDirectory=/opt/a2a-agent
Environment=HOST=0.0.0.0
Environment=API_TOKEN=your-secret
Environment=AGENT_PROJECT=/path/to/repo
ExecStart=/usr/bin/npx tsx server.ts
Restart=always

[Install]
WantedBy=multi-user.target
```

## A2A 端点

| 端点 | 认证 | 说明 |
|------|------|------|
| `GET /.well-known/agent.json` | 不需要 | Agent Card |
| `POST /a2a` | Bearer token | JSON-RPC 2.0 |
| `GET /health` | 不需要 | 健康检查 |

### JSON-RPC 方法

- `tasks/send` — 同步执行
- `tasks/sendSubscribe` — SSE 流式
- `tasks/get` — 查询 task
- `tasks/cancel` — 取消 task

## 审计日志

每次调用输出结构化 JSON 到 stdout：

```json
{"ts":"2026-04-13T06:00:00.000Z","event":"task_start","taskId":"...","method":"tasks/send","messageLength":42}
{"ts":"2026-04-13T06:00:05.000Z","event":"task_done","taskId":"...","state":"completed","responseLength":128}
{"ts":"2026-04-13T06:00:10.000Z","event":"auth_rejected","ip":"192.168.1.50"}
{"ts":"2026-04-13T06:00:15.000Z","event":"rate_limited","ip":"192.168.1.50"}
```

用 `jq` 过滤：

```bash
npm start 2>/dev/null | jq 'select(.event == "auth_rejected")'
```

## 架构

```
内网调用者 (Bearer token)
    │
    ▼
HTTP Server (127.0.0.1:8080)
    │  ← 认证 → 速率限制 → 大小检查
    │
    ├── GET  /.well-known/agent.json → Agent Card
    ├── POST /a2a (tasks/send)       → spawn CLI → 等结果 → JSON
    ├── POST /a2a (tasks/sendSubscribe)→ spawn CLI → SSE 流
    └── GET  /health                  → { status: "ok" }
    │
    ▼  ← 超时 5min 自动 kill
本地 CLI 进程 (claude --print ...)
    │
    ▼
审计日志 → stdout (JSON)
```
