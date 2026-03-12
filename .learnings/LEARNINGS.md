# LEARNINGS.md

## 2026-03-12

### ah-cli 改进经验

1. **并行执行实现**：在 pipeline.ts 中使用 `Promise.all()` 实现并行执行，所有步骤同时运行，不传递 prevOutput

2. **自动修复 doctor --fix**：将 doctor --fix 从"显示建议"改为"真正执行修复"
   - Config 无效：删除并重建默认配置
   - 目录不可写：创建目录并修复权限
   - Daemon 未运行：自动启动 daemon

3. **模块导入注意**：daemon/process.ts 导出的是 `startDaemonBackground` 而不是 `startDaemon`，需要使用正确的函数名

4. **批量会话导出 session batch-export**：
   - 使用 `parseOlderThan()` 解析时间过滤参数（如 7d, 24h）
   - 使用 `session.list` 获取会话列表，然后逐个调用 `session.show` 获取详情
   - ZIP 打包使用现有的 `createZipBuffer()` 工具函数
   - 文件命名使用 safeTitle 清理特殊字符避免文件系统问题

5. **Session list 显示 agent names**：
   - 问题：session list 显示 truncated agent IDs（如 0498ba05）而不是 agent 名称
   - 原因：listSessions 函数只查询 sessions 表，没有 JOIN agents 表
   - 解决：
     - 在 SessionRecord 类型中添加 `agentName?: string` 和 `agentSlug?: string`
     - 修改 listSessions SQL：`SELECT s.*, a.name as agent_name, a.slug as agent_slug FROM sessions s LEFT JOIN agents a ON s.agent_id = a.id`
     - 添加 mapSessionWithAgent 函数处理带 agent 信息的行
   - 效果：session list 现显示 agent 名称（dev, strategist 等）

6. **⚠️ BUG：ah session archive 不支持 short ID**：
   - 问题：`ah session list` 显示 short ID（如 c2af0366），但 `ah session archive c2af0366` 报错 "Session not found"
   - 原因：session archive 命令不支持 short ID 解析，只接受完整 UUID
   - 临时方案：使用完整 UUID（如 c2af0366-01cf-4c84-b79d-c7396d7067ab）
   - 待修复：让 session archive 支持和 session list 一致的 short ID 格式session list 现在显示 `dev`、`strategist`、`twitter` 等有意义的 agent 名称

7. **ah session logs 不支持 short ID**（2026-03-12）：
   - 问题：`ah session list` 显示 short ID（如 733da7d1），但 `ah session logs 733da7d1` 报错 "Session not found"
   - 原因：session.show、session.attach、session.messages、session.fork、session.delete 等命令直接使用 getSession() 做精确匹配，不支持 short ID
   - 解决：在 daemon server.ts 中使用 store.resolveSessionRef() 方法解析 short ID 到完整 UUID
   - 已修复的命令：session.show、session.attach、session.messages、session.fork、session.delete
   - 验证：修复后 `ah session logs 733da7d1` 正常工作

### 测试结果

v0.24.0 功能测试：
- ✅ `ah session list` - 正确显示 agent 名称（dev, twitter, strategist）
- ✅ `ah session stats` - 显示按状态/agent 的统计信息
- ✅ `ah session logs <id>` - 修复后支持 short ID（之前报 "Session not found"）