# 智能体并发设计

版本：v1
日期：2026-07-07
适用范围：`centaurai-team`
状态：已批准进入计划阶段

## 1. 目的

CentaurAI Team 设备会被小团队共享使用。典型设备内存为 32GB 或 64GB，并具备用于 embedding、OCR、reranking 等小型本地任务的本地算力。它不在本地运行主要的大语言模型。主要推理请求会调用外部模型供应商或远程智能体后端。

产品必须支持约 20 名用户同时在线，同时避免多个并发智能体任务耗尽内存、拉起过多子进程，或导致整台设备不可用。

本设计在智能体运行、team run、WebUI 流量、文件操作、NAS 操作和本地向量任务周围增加并发与资源控制层。

## 2. 非目标

- 不为本地大模型推理做设计。
- 不要求通过高端 GPU 显存来支持 20 名在线用户。
- 不保证 32GB 或 64GB 设备可同时运行 20 个 active agent run。
- 不替换 aioncore 或现有 WebHost 代理架构。
- 不重新设计认证或用户管理。

## 3. 容量目标

系统必须区分在线用户数和 active run 数。

| 设备 profile | 在线用户 | 全局 active agent run | Active team run | 队列长度 |
| --- | ---: | ---: | ---: | ---: |
| `team-32g` | 20 | 4 | 1 | 30 |
| `team-64g` | 20-40 | 8 | 2 | 50 |

附加默认限制：

| 资源 | `team-32g` | `team-64g` |
| --- | ---: | ---: |
| 单用户 active run | 1 | 1 |
| 单会话 active run | 1 | 1 |
| 外部模型请求 | 6 | 12 |
| 重型工具调用 | 3 | 6 |
| 文件上传 | 2 | 4 |
| 向量搜索请求 | 6 | 8 |
| NAS 目录列表操作 | 2 | 4 |
| NAS 索引任务 | 1 | 1 |
| WebSocket 连接 | 100 | 150 |
| 最大 team run units | 3 | 4 |

这些是产品默认值。它们必须可配置，以便部署方根据更强硬件或更严格稳定性要求进行调优。

## 4. 架构

在高成本操作前增加资源控制路径：

```text
WebUI / distributed clients / channel bots
        |
        v
WebHost Gateway
        |
        v
Admission Controller
        |
        +-- reject: DEVICE_BUSY / QUEUE_FULL
        |
        +-- enqueue: queued run with position
        |
        v
Run Queue
        |
        v
Agent Runtime Pool
        |
        v
aioncore / ACP subprocesses / external model APIs / tools / files / vector DB
```

Admission Controller 负责管理资源 ticket。任何会启动高成本操作的请求，都必须先申请 ticket 才能继续执行。操作完成、失败、被取消或客户端断开时，ticket 必须释放。

## 5. 请求分类

Gateway 必须在转发请求或本地处理请求之前完成分类。

| 分类 | 路由 | 默认动作 |
| --- | --- | --- |
| `agent_run` | `POST /api/conversations/:id/messages` | 申请 run ticket 或进入队列 |
| `team_run` | `POST /api/teams/:id/messages` | 申请加权 run ticket 或进入队列 |
| `team_agent_run` | `POST /api/teams/:id/agents/:slot/messages` | 申请 run ticket 或进入队列 |
| `file_upload` | `/api/fs/upload`, `/api/shared-drive/upload`, `/api/nas/upload` | 申请 upload ticket |
| `nas_list` | `GET /api/nas/list` | 申请 NAS ticket |
| `vector_search` | `POST /api/vector-search` | 申请 vector ticket |
| `vector_image` | `GET /api/vector-image` | 申请 vector ticket 并流式返回响应 |
| `websocket` | `/ws` | 执行连接数上限 |
| `static` | 静态资源、SPA 路由 | 不需要 ticket |

Team run 会消耗多个 run unit。包含多个智能体的 team run 不能被当作一个轻量任务计算。默认成本为：

```text
team_run_units = min(number_of_agents, profile.max_team_run_units)
```

v1 中，如果 gateway 无法在转发前低成本获知 team size，则 `team_run` 必须使用固定保守成本 3 units。

对于 CentaurAI Team edition，`/api/teams*` 不是受支持的 WebUI 功能，必须通过 `blockTeamRoutes` 阻断。本设计仍然保留 `team_run` 分类，因为 WebHost 代码会被允许 team/meeting 路由的 edition 或部署方式共享；在 Team edition 中，路由边界检查必须先于 admission 运行，并返回 `403 EDITION_DISABLED`。

## 6. 队列语义

Agent 和 team run 请求可以在有界队列中等待。其他高成本请求分类默认应快速失败并返回 `429 DEVICE_BUSY`，除非显式配置为允许等待。

队列规则：

- 默认 FIFO。
- 管理员优先级可以排在普通用户请求之前。
- 默认情况下，一个用户最多只能有一个 active run 和一个 queued run。
- 一个会话最多只能有一个 active 或 queued run。
- queued request 默认 120 秒超时。
- 队列溢出返回 `429 QUEUE_FULL`。
- 客户端断开会取消 queued request。
- 用户显式取消会移除 queued 或 active work。

UI 必须展示队列位置，并允许用户取消。

## 7. Agent Runtime Pool

即使主要模型在远端，智能体子进程和 ACP 风格运行时会话仍然对内存敏感。runtime pool 必须执行：

- 全局 active agent subprocess 上限。
- 每个 backend 的 subprocess 上限。
- 非活跃 session 的 idle timeout：3-5 分钟。
- 默认 hard run timeout：32GB 为 20 分钟，64GB 为 30 分钟。
- 取消、超时或内存违规时 kill 整个进程树。
- 只有 run 进入终态且已尝试清理后，才能释放 ticket。

默认 pool 限制：

| 设备 profile | 最大 agent subprocess | 单 subprocess 软 RSS | 单 subprocess 硬 RSS |
| --- | ---: | ---: | ---: |
| `team-32g` | 4 | 1.5GB | 2GB |
| `team-64g` | 8 | 2GB | 3GB |

如果当前进程边界位于 aioncore 内部，这些规则应在 aioncore 内实现。WebHost 仍然必须执行高层请求 admission，确保过量流量不会无界进入 aioncore。

## 8. Memory Guard

设备需要独立于请求数量的 memory guard。

| 内存压力 | 行为 |
| --- | --- |
| `< 70%` | 正常 admission |
| `70-80%` | 停止启动低优先级后台任务 |
| `80-90%` | 停止启动新的 agent run；只允许排队 |
| `> 90%` | 拒绝新的高成本请求；允许取消和状态 API |
| `> 95%` | 进入保护模式，并取消最低优先级后台任务 |

Memory guard 至少必须监控：

- WebHost process RSS。
- 可观测时的 aioncore process RSS。
- 可观测时的 Agent subprocess RSS。
- 系统内存使用百分比。
- 队列长度和 active ticket 数。

保护模式必须保留管理员访问、health API、cancellation API 和 status API。

## 9. 本地向量与文件任务

本地算力可用，但向量和文件任务必须让位于交互式 agent run。

规则：

- NAS indexing 是低优先级任务，并且每个 root single-flight。
- 内存压力达到 70% 或以上时，indexing 暂停或拒绝启动。
- 大文件必须流式处理或分块处理。不要为单个请求把数百 MB 数据读入 JS 内存。
- Vector image proxy response 必须流式返回，不能用 `arrayBuffer()` 缓冲。
- NAS directory listing 必须使用分页和有界 stat 并发。
- Upload routes 必须使用有界并发流，并在 client abort 时释放 ticket。

必须修复的现有风险点：

- `packages/web-host/src/static-server.ts` 会把 vector image 缓冲进内存。
- `packages/web-host/src/nas-drive.ts` 对 NAS directory stat operation 使用无界 `Promise.all`。
- `packages/web-host/src/nas-drive.ts` 在上传到 vector DB 前会把可索引文件读入内存。
- `blockTeamRoutes` 已存在于 `static-server.ts`，但 WebUI startup path 没有在 Team edition 中传入它。

## 10. WebUI 与 Team 路由边界

Team edition 从 UI 中移除了 decision meeting 功能，但 bundled backend 仍可能暴露 `/api/teams*`。WebHost proxy 已经包含 `blockTeamRoutes`，Team edition 启动 WebHost 时必须传入它。

必要行为：

- Team edition WebUI 对 `/api/teams*` 返回 `403 EDITION_DISABLED`。
- Decision edition 和 full edition 行为保持不变。
- 有意绕过 WebHost 的 desktop/admin 路径不受该 proxy 规则影响。

## 11. 错误契约

高成本请求被拒绝时必须使用结构化错误。

```json
{
  "success": false,
  "code": "DEVICE_BUSY",
  "error": "Device is busy. Please wait or try again later.",
  "details": {
    "reason": "active_run_limit",
    "profile": "team-32g",
    "active": 4,
    "limit": 4,
    "queued": 12,
    "queue_limit": 30
  }
}
```

必需错误码：

- `DEVICE_BUSY`
- `QUEUE_FULL`
- `RUN_QUEUED`
- `RUN_CANCELLED`
- `RUN_TIMEOUT`
- `MEMORY_PRESSURE`
- `PER_USER_LIMIT`
- `PER_CONVERSATION_LIMIT`
- `EDITION_DISABLED`

Renderer 必须把这些错误码翻译成用户可见信息，并保留现有 generic backend error fallback，用于处理未知错误。

## 12. 可观测性

暴露一个管理员可读的并发状态 endpoint：

```text
GET /api/system/concurrency-status
```

响应必须包含：

- 按分类统计的 active tickets。
- 队列长度和最老 queued request 的等待时间。
- 按原因统计的 rejected counter。
- 当前 memory pressure state。
- 生效中的 profile 和 limits。
- WebSocket connection count。
- Active agent run count。
- Active team run count。

日志必须为 admission decision、queue entry、queue start、release、timeout 和 cancellation 记录 request id 或 run id。

## 13. 测试与验收

单元测试：

- Route classifier 将高成本路由映射到正确分类。
- Admission Controller 执行 global、per-user、per-conversation 和 per-class limits。
- Queue 保持 FIFO 和 priority 行为。
- Ticket 会在 success、failure、timeout 和 client abort 时释放。
- Memory guard 会在定义好的阈值切换 admission mode。

集成测试：

- Team edition 通过 WebHost 阻断 `/api/teams*`。
- Vector image proxy 使用 streaming，而不是 buffering。
- NAS listing 返回分页结果，且不会启动无界 stat work。
- Queued agent request 会暴露 queue metadata。

压测：

- `team-32g`：20 online users，4 active runs，30 queued runs，连续 2 小时无 out-of-memory。
- `team-64g`：20 online users，8 active runs，50 queued runs，连续 2 小时无 out-of-memory。
- 同一用户重复点击最多只能创建一个 active run 和一个 queued run。
- Team run 过载时按 profile 进入队列或拒绝。
- 内存压力达到 85% 时阻止新的 active run。

## 14. Rollout

阶段顺序：

1. 通过接入 `blockTeamRoutes` 阻止隐藏的 Team API 暴露。
2. 添加 WebHost Admission Controller 和 request classification。
3. 添加 renderer 对 queue 和 busy state 的支持。
4. 添加 memory guard 和 concurrency status endpoint。
5. 修复 vector image、NAS listing 和 NAS indexing 的内存风险。
6. 在 aioncore 或 agent subprocess 边界添加 runtime pool enforcement。
7. 添加 load tests，并调优 32GB/64GB profiles。

前三个阶段是最小发布边界，用于防止共享设备在普通多用户负载下变得不可用。
