---
name: 知识库
description: "Use when creating, organizing, or searching the team's internal knowledge base. Manages architecture docs, coding standards, ADRs (Architecture Decision Records), FAQs, on-call runbooks, and tech sharing notes. Trigger on: knowledge base, 知识库, wiki, architecture doc, ADR, decision record, 技术决策, FAQ, 开发规范, runbook."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [team, knowledge-base, wiki, ADR, 知识库, documentation, architecture, runbook]
    related_skills: [team-onboarding, team-meeting-minutes, centaurai]
---

# Team Knowledge Base (团队知识库)

Structured internal knowledge management for the CentaurAI team.

## Overview

A markdown-based knowledge base at `~/团队/知识库/` covering:
- System architecture and design decisions
- Development standards and conventions
- On-call runbooks and troubleshooting guides
- Frequently asked questions
- Tech sharing and learning notes

Keeps institutional knowledge accessible even as team members come and go.

## When to Use

- "document this architecture decision"
- "add to the FAQ: how to fix X"
- "create an on-call runbook for the vector DB"
- "what's our convention for X?"
- "search knowledge base for deployment guide"
- "update the architecture doc after the refactor"
- "record today's tech sharing notes"

## Directory Structure

```
~/团队/知识库/
  README.md                  — 知识库索引和导航
  技术架构.md                — 系统整体架构
  开发规范.md                — 编码规范、Git工作流、Review标准
  产品策略.md                — 产品定位、路线图、竞品分析
  常见问题.md                — FAQ, 按产品分类
  ADR/                       — Architecture Decision Records
    0001-使用ChromaDB作为向量引擎.md
    0002-采用ACP协议实现Agent互操作.md
    0003-选择Rust重写aioncore后端.md
  Runbook/                   — On-call运维手册
    数据库迁移回滚.md
    aioncore崩溃恢复.md
    DNS污染处理流程.md
    GPU显存OOM排查.md
  技术分享/                  — Tech sharing session notes
    2026-07-11-ComfyUI-LoRA训练最佳实践.md
    2026-06-28-向量数据库RAG策略对比.md
  工具链/                    — Tool documentation
    Clash-Verge代理配置.md
    Tailscale远程访问.md
    Hermes-Agent技能开发.md
    cc-switch模型切换.md
```

## Architecture Decision Records (ADR)

When making a significant technical decision, create an ADR:

```markdown
# ADR-0004: <简短标题>

> 状态: 提议 | 已采纳 | 已废弃 | 已替代
> 日期: 2026-07-12
> 决策者: 张三, 李四
> 替代: ADR-0002 (if superseding)

## 背景

描述需要做决策的技术问题、约束条件和相关因素。

## 决策

描述我们决定做什么——"我们将使用X来实现Y, 因为..."

## 考虑的方案

### 方案A: <名称>
- 优点: ...
- 缺点: ...
- 风险: ...

### 方案B: <名称>
- 优点: ...
- 缺点: ...
- 风险: ...

## 后果

这个决策会带来什么影响？正面和负面。

- [ ] 需要更新的文档
- [ ] 需要的代码变更
- [ ] 团队成员需要了解的内容
```

### When to create an ADR

- Choosing between 2+ architectural approaches
- Adopting or dropping a major dependency
- Changing a core convention (API design, database schema, protocol)
- Any decision that future teammates will ask "why did we do it this way?"

### When NOT to create an ADR

- Trivial implementation details
- Standard practices without alternatives
- Reversible decisions with low impact

## Coding Standards

`~/团队/知识库/开发规范.md` should cover:

```markdown
# 半人马AI 开发规范

## 语言与框架
- 后端: Rust (aioncore), Python (ML/向量服务)
- 前端: TypeScript + React + Arco Design
- 桌面: Electron + Bun
- 禁止: 新代码用JavaScript(用TS), 新服务用Node.js(用Bun)

## Git 工作流
- 主分支: main (保护分支, 禁止直接push)
- 功能分支: feature/<描述> 或 fix/<描述>
- Commit: 遵循 Conventional Commits
- PR: 至少1人审核, CI全绿才能合并

## 代码风格
- Rust: cargo fmt + cargo clippy (0 warnings)
- TypeScript: oxfmt + ESLint (0 errors)
- Python: ruff format + ruff check

## 命名规范
- 文件: kebab-case (user-management.ts)
- 组件: PascalCase (UserManagement.tsx)
- 函数: camelCase (getUserById)
- 常量: UPPER_SNAKE_CASE (MAX_RETRY_COUNT)
```

## FAQ Management

`~/团队/知识库/常见问题.md` — structured by product/category:

```markdown
# 常见问题 (FAQ)

## CentaurAI 超级工作台

### Q: 新用户登录后看不到历史对话？
A: 这是AionCore的auth middleware bug — 在local模式下JWT被绕过。
已修复，确保aioncore版本 >= 0.1.25。

### Q: ACP Agent显示"未安装"？
A: PATH缺少 `~/.hermes/node/bin`。在启动脚本(centaurai-team.sh)中添加。

## 向量数据库

### Q: 检索结果为空？
A: 1) 确认服务运行: `curl 127.0.0.1:8618/api/health`
   2) 确认文档已入库: `curl 127.0.0.1:8618/api/stats`
   3) 检查CORS: Electron需设置 `webSecurity: false`
```

## On-Call Runbooks

Each runbook follows this structure:

```markdown
# <场景>: <故障现象>

## 触发条件
- 告警关键词: ...
- 监控指标: ...

## 影响范围
- 受影响的服务/用户: ...

## 排查步骤

### Step 1: 确认问题
```bash
# 检查命令
```

### Step 2: 定位根因
```bash
# 诊断命令
```

### Step 3: 修复
```bash
# 修复命令
```

### Step 4: 验证
```bash
# 验证命令
```

## 回滚方案 (如果修复失败)
...

## 事后跟进
- [ ] 创建issue跟踪根因修复
- [ ] 更新监控告警规则
- [ ] 补充自动化测试
```

## Search and Navigation

### Quick search

```bash
# Full-text search across knowledge base
grep -r "关键词" ~/团队/知识库/ --include="*.md" -l

# Find all ADRs about a topic
grep -r "向量数据库" ~/团队/知识库/ADR/ -l

# List recent updates
find ~/团队/知识库/ -name "*.md" -mtime -7
```

### Knowledge base health check

```bash
# Count documents
find ~/团队/知识库/ -name "*.md" | wc -l

# Find stale docs (not updated in 6 months)
find ~/团队/知识库/ -name "*.md" -mtime +180

# Find orphaned docs (not linked from README)
# Manual review — check README.md index
```

## Maintenance

### Quarterly review

- [ ] Archive deprecated ADRs (move to `ADR/archived/`)
- [ ] Update FAQ with new common issues
- [ ] Review runbooks against recent incidents
- [ ] Prune outdated tech sharing notes
- [ ] Verify all links in README.md still resolve

### After incidents

- [ ] Create or update relevant runbook
- [ ] Add to FAQ if a common question emerged
- [ ] Create ADR if a new architectural decision was made

### After feature launches

- [ ] Update architecture doc if system design changed
- [ ] Update FAQ if new features generate support questions

## Common Pitfalls

1. **Knowledge silos.** One person is the only one who knows how X works. Always document it — bus factor = 1 is dangerous.
2. **README is stale.** The index doesn't list new documents. Update README.md every time you add a new doc.
3. **ADR without context.** "We chose X" is not an ADR. An ADR explains WHY, what alternatives were considered, and the consequences.
4. **Runbook never tested.** The runbook says "run this command" but the command requires a tool that's not installed. Test runbooks during fire drills.
5. **Over-documenting.** Not everything needs a doc. If a convention is obvious, a code comment is enough. Focus on non-obvious decisions and hard-to-discover knowledge.
6. **No ownership.** Nobody is responsible for keeping the knowledge base current. Assign a rotating "KB maintainer" each sprint.

## Verification Checklist

- [ ] README.md has up-to-date index with all documents
- [ ] ADRs follow the template (背景 → 决策 → 方案 → 后果)
- [ ] Runbooks have been tested (commands execute successfully)
- [ ] FAQ entries are specific and actionable
- [ ] No broken internal links
- [ ] Stale documents (>6 months) reviewed and updated or archived
