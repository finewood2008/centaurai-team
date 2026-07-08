# 智能体并发验证方案

版本：v1
日期：2026-07-08
适用范围：`centaurai-team`
关联设计：`docs/superpowers/specs/2026-07-07-agent-concurrency-design.md`

## 1. 目标

验证 CentaurAI Team 在 32GB/64GB 设备上支持约 20 人同时在线时，不会因为多个智能体任务、NAS 操作、向量任务或文件操作导致 WebHost/aioncore 无界并发、内存占满或整机不可用。

本验证不以真实大模型吞吐为核心。主模型请求可以走远端供应商；本地主要验证 admission、队列、资源 ticket 释放、WebHost 内存风险点和 UI 错误展示。

## 2. 验证分层

### 2.1 自动化回归测试

每次修改并发控制、WebHost 路由或 renderer 错误展示后运行：

```bash
npm test --workspace=@aionui/web-host
npm exec -- vitest run tests/unit/renderer/buildSendFailureError.test.ts
npm exec -- vitest run tests/unit/load/webhostConcurrencyLoad.test.ts
npm exec -- tsc -p tsconfig.json --noEmit
```

覆盖点：

- 路由分类：`agent_run`、`team_run`、`team_agent_run`、`nas_list`、`vector_search`、`vector_image`、`file_upload`。
- Admission Controller：global active run、per-user、per-conversation、per-class limit。
- 队列行为：FIFO、queue limit、ticket release。
- Team edition：`/api/teams*` 返回 `403 EDITION_DISABLED`。
- 状态接口：`GET /api/system/concurrency-status` 返回 active、queue、profile、limits。
- Renderer：`DEVICE_BUSY`、`QUEUE_FULL`、`RUN_QUEUED` 等不会被误判为内部错误。
- Vector image：必须 streaming，不允许 `arrayBuffer()` 缓冲。
- NAS listing：必须有界 stat 并发。

### 2.2 本地并发集成测试

使用 mock backend 模拟 aioncore，不调用真实模型。mock backend 对 `POST /api/conversations/:id/messages` sleep 一段时间，模拟长智能体任务。

命令：

```bash
npm exec -- tsx tests/load/webhost-concurrency-load.ts \
  --profile team-32g \
  --users 20 \
  --duration-ms 30000 \
  --run-delay-ms 3000 \
  --repeat-clicks 1 \
  --poll-ms 250
```

预期：

- `team-32g` 的 `maxActiveRunUnits <= 4`。
- 20 个用户请求中，多余请求进入队列，队列峰值可观测。
- 无 5xx。
- 脚本退出码为 0。

示例短时 smoke 输出：

```json
{
  "summary": {
    "ok": true,
    "totalRequests": 20,
    "statusCounts": { "200": 20 },
    "maxActiveRunUnits": 4,
    "maxQueuedRuns": 16
  }
}
```

可选参数：

- `--profile team-32g|team-64g`
- `--users <number>`
- `--duration-ms <number>`
- `--run-delay-ms <number>`
- `--repeat-clicks <number>`
- `--poll-ms <number>`
- `--queue-limit <number>`
- `--report <path>`

参数说明：

- `--users`：虚拟用户数量。
- `--run-delay-ms`：mock backend 每个 agent run 的耗时，用来模拟长任务。
- `--repeat-clicks`：每个用户对同一个 conversation 并发点击发送的次数，用于验证 `PER_USER_LIMIT`/重复点击保护。
- `--queue-limit`：覆盖 profile 默认队列长度，用于快速验证 `QUEUE_FULL`。
- `--report`：将 JSON 结果写入文件，便于归档。

重复点击验证：

```bash
npm exec -- tsx tests/load/webhost-concurrency-load.ts \
  --profile team-32g \
  --users 2 \
  --duration-ms 1000 \
  --run-delay-ms 200 \
  --repeat-clicks 2 \
  --queue-limit 30
```

预期输出中包含：

```json
{
  "statusCounts": { "200": 2, "429": 2 },
  "codeCounts": { "PER_USER_LIMIT": 2 }
}
```

队列溢出验证：

```bash
npm exec -- tsx tests/load/webhost-concurrency-load.ts \
  --profile team-32g \
  --users 20 \
  --duration-ms 1000 \
  --run-delay-ms 3000 \
  --repeat-clicks 1 \
  --queue-limit 2
```

预期会看到 `QUEUE_FULL` 或 `DEVICE_BUSY`，并且脚本在检测到 queue 峰值超过指定 `--queue-limit` 时返回非 0。

### 2.3 压测与稳定性测试

先使用 mock backend 做 smoke，再做 soak。

32GB profile：

```bash
npm exec -- tsx tests/load/webhost-concurrency-load.ts \
  --profile team-32g \
  --users 20 \
  --duration-ms 7200000 \
  --run-delay-ms 30000 \
  --repeat-clicks 1 \
  --poll-ms 1000
```

64GB profile：

```bash
npm exec -- tsx tests/load/webhost-concurrency-load.ts \
  --profile team-64g \
  --users 40 \
  --duration-ms 7200000 \
  --run-delay-ms 30000 \
  --repeat-clicks 1 \
  --poll-ms 1000
```

验收指标：

- `team-32g`：20 online users，active run 峰值不超过 4。
- `team-64g`：20-40 online users，active run 峰值不超过 8。
- 队列长度不超过 profile queue limit。
- 无 OOM。
- WebHost RSS 不持续上涨。
- 无无限 pending request。
- 错误码集中在预期的 `DEVICE_BUSY`、`QUEUE_FULL`、`PER_USER_LIMIT`、`PER_CONVERSATION_LIMIT`。
- 不出现大量 500。

### 2.4 真机验收

真机阶段接真实远程模型和真实智能体后端。

必测场景：

- 20 个真实用户或虚拟用户同时在线。
- 4 个或 8 个 active agent run 长时间运行。
- 用户重复点击发送。
- 同一 conversation 重复发送。
- 客户端中途断开。
- 混合 NAS list、vector search、vector image、file upload。
- Team edition 直接访问 `/api/teams*`。

真机通过标准：

- 32GB 设备：20 人在线，4 active runs，30 queued runs，连续 2 小时无 out-of-memory。
- 64GB 设备：20-40 人在线，8 active runs，50 queued runs，连续 2 小时无 out-of-memory。
- 同一用户最多 1 active run 和 1 queued run。
- 同一 conversation 最多 1 active 或 queued run。
- `GET /api/system/concurrency-status` 中 active/queue 与压测脚本统计一致。
- Team edition 的 `/api/teams*` 始终返回 `403 EDITION_DISABLED`。
- Vector image 和 NAS 大目录不会导致 WebHost RSS 暴涨。

## 3. 观测方法

压测过程中轮询：

```bash
curl http://127.0.0.1:25808/api/system/concurrency-status
```

重点观察：

- `profile`
- `limits.activeRunUnits`
- `activeRunUnits`
- `queues.total`
- `queues.oldestWaitMs`
- `active.agent_run`
- `active.team_run`

设备侧同时观察：

```bash
ps -o pid,rss,command -p <webhost-pid>
```

或使用系统监控查看：

- WebHost RSS。
- aioncore RSS。
- agent subprocess RSS。
- 系统内存使用率。
- CPU load。
- 打开的文件句柄和 socket 数。

## 4. 失败判定

以下任一情况视为失败：

- active run 峰值超过 profile 限制。
- 队列长度超过 profile 限制。
- 5xx 大量出现。
- 请求结束、失败或客户端断开后 ticket 未释放。
- WebHost RSS 持续上涨且无法回落。
- NAS 大目录 listing 导致明显卡顿或内存激增。
- vector image 请求使 WebHost 缓冲大图。
- Team edition 可绕过 WebHost 调用 `/api/teams*`。
- Renderer 将 `DEVICE_BUSY` 等预期并发错误展示成内部错误或建议反馈。

## 5. 发布门禁

最小发布前必须通过：

```bash
npm test --workspace=@aionui/web-host
npm exec -- vitest run tests/unit/renderer/buildSendFailureError.test.ts
npm exec -- vitest run tests/unit/load/webhostConcurrencyLoad.test.ts
npm exec -- tsx tests/load/webhost-concurrency-load.ts --profile team-32g --users 20 --duration-ms 30000 --run-delay-ms 3000 --repeat-clicks 1
npm exec -- tsc -p tsconfig.json --noEmit
```

正式交付前必须增加 2 小时真机 soak，并保存：

- 压测命令。
- 压测脚本 JSON 输出。
- `/api/system/concurrency-status` 抽样。
- WebHost/aioncore RSS 曲线。
- 错误码统计。

## 6. 验收记录模板

每次正式压测建议保存一份记录：

```text
测试日期：
测试人员：
设备规格：32GB / 64GB
CPU / GPU / NPU：
系统版本：
代码分支：
提交 SHA：

压测命令：

压测时长：
profile：
虚拟用户数：
run delay：
repeat clicks：
queue limit：

脚本结果：
- ok：
- totalRequests：
- statusCounts：
- codeCounts：
- maxActiveRunUnits：
- maxQueuedRuns：

系统观测：
- WebHost RSS 起始 / 峰值 / 结束：
- aioncore RSS 起始 / 峰值 / 结束：
- 系统内存起始 / 峰值 / 结束：
- CPU load 峰值：

异常：
- 5xx：
- OOM：
- 请求无限 pending：
- 客户端断开后 ticket 未释放：

结论：通过 / 不通过
后续动作：
```

## 7. 当前脚本边界

`tests/load/webhost-concurrency-load.ts` 是 admission/load smoke 工具，不是完整端到端用户行为模拟。

它已经覆盖：

- 真实 WebHost static-server。
- mock backend 长 agent run。
- active run 峰值校验。
- queue 峰值校验。
- 重复点击导致的 per-user admission reject。
- 状态码和错误码统计。
- JSON 报告输出。

它暂不覆盖：

- 真实远程模型供应商延迟和错误。
- 真实 aioncore agent subprocess RSS。
- WebSocket 长连接压测。
- NAS upload 大文件流式写入。
- vector DB 实际查询和图片读取。
- memory guard 的真实系统内存压力注入。

这些需要在真机验收和专项压测中补充。
