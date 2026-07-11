---
name: 项目任务看板
description: "Use when managing team projects, tasks, or sprint tracking with a lightweight markdown kanban board. Create, update, assign, and track tasks across team members without external tools. Trigger on: task board, kanban, sprint planning, assign task, task status, project progress."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [team, project-management, kanban, task-tracking, markdown, sprint]
    related_skills: [team-weekly-report]
---

# Team Project Tracker

Manage team tasks with a lightweight markdown kanban board — no external tools needed.

## Overview

A markdown-based kanban system for 5-8 person teams. Each project gets a `board.md` with
four columns (Backlog / 进行中 / 审核 / 完成), and each task is a structured markdown
entry with assignee, priority, status, and deadline. The board is human-readable AND
machine-parseable.

## When to Use

- "create a task board for project X"
- "add task to board / assign to 张三"
- "what's 李四 working on?"
- "move task to done / update status"
- "sprint review / what's blocked?"
- "show me all high-priority tasks across projects"

Don't use for: git issues (use github-issues), Notion task DB (use notion), or
formal Jira-style workflows with custom fields.

## Board File Format

Each project board lives at `~/团队/项目/<project-slug>/board.md`:

```markdown
# <Project Name> — 任务看板

> 最后更新: 2026-07-12 | Sprint: #3 (7/14–7/25)

## 🔙 Backlog

<!-- TASK: id=T001 status=backlog priority=P2 assignee=未分配 -->

### [T001] 用户反馈收集页面

**描述:** 在WebUI增加用户反馈入口，支持文本+截图提交
**负责人:** 未分配
**优先级:** P2
**截止:** 2026-08-01
**标签:** feature, frontend

---

## 🚧 进行中

<!-- TASK: id=T002 status=in_progress priority=P1 assignee=张三 -->

### [T002] ComfyUI SDXL 工作流优化

**描述:** 优化默认SDXL工作流，减少显存占用到8GB以内
**负责人:** 张三
**优先级:** P1
**截止:** 2026-07-20
**标签:** feature, comfyui, gpu
**进度:** LoRA加载逻辑已优化，待测试

---

## 👀 审核

<!-- TASK: id=T003 status=review priority=P1 assignee=李四 reviewer=王五 -->

### [T003] 团队版多用户权限系统

**描述:** 实现角色（管理员/成员/访客）和权限控制
**负责人:** 李四
**审核人:** 王五
**优先级:** P1
**截止:** 2026-07-15
**标签:** feature, backend, auth

---

## ✅ 完成 (本周)

<!-- TASK: id=T004 status=done priority=P1 assignee=张三 completed=2026-07-10 -->

### [T004] Token管理中心暗色主题

**负责人:** 张三 | 完成: 2026-07-10
```

### HTML Comment Metadata

Every task MUST have an HTML comment line right before its `###` heading:
```
<!-- TASK: id=TXXX status=<status> priority=<P0|P1|P2|P3> assignee=<name> -->
```

This makes the board parseable by `grep`:
```bash
# All in-progress tasks
grep "status=in_progress" ~/团队/项目/*/board.md

# Tasks assigned to 张三
grep "assignee=张三" ~/团队/项目/*/board.md

# High priority across all projects
grep -h "priority=P[01]" ~/团队/项目/*/board.md
```

### Task ID Convention

`T` + 3-digit sequential number, scoped per project. Reset per sprint if desired.

### Priority Levels

| Level | Meaning | Example |
|-------|---------|---------|
| P0 | 紧急阻塞 | 生产环境宕机、客户交付Deadline今天 |
| P1 | 本迭代必须 | Sprint承诺、本周Deadline |
| P2 | 应该做 | 下个迭代、有规避方案 |
| P3 | 锦上添花 | 有空再做、技术债清理 |

### Status Flow

```
Backlog → 进行中 → 审核 → 完成
  ↑                    ↓
  └──── 退回（rejected）─┘
```

## Operations

### Create a project board

Create the directory and write `board.md` from the template above.

### Add a task

Add to the Backlog section:
1. Insert `<!-- TASK: ... -->` comment
2. Add `### [TXXX] Title` heading
3. Fill in description, assignee, priority, deadline, tags

### Move a task between columns

1. Find the task's `### [TXXX]` block
2. Cut the entire block
3. Update the `status=` in the HTML comment
4. Paste into target column
5. If moving to 完成, add `completed=<today>` to metadata

### Quick queries

```bash
# All in-progress across projects
grep -B1 "status=in_progress" ~/团队/项目/*/board.md | grep "TASK:"

# Blocked tasks
grep -l "阻塞\|blocked" ~/团队/项目/*/board.md

# Tasks without assignee
grep "assignee=未分配" ~/团队/项目/*/board.md
```

### Sprint summary (for weekly-report)

```bash
for status in backlog in_progress review done; do
  count=$(grep -r "status=$status" ~/团队/项目/*/board.md 2>/dev/null | wc -l)
  echo "$status: $count"
done
```

## Integration with Weekly Report

The `team-weekly-report` skill reads board.md files to auto-populate:
- "本周完成" from tasks with `status=done` and `completed=this_week`
- "进行中" from tasks with `status=in_progress`
- Blockers from task body containing "阻塞" or "blocked"

## Common Pitfalls

1. **Forgetting the HTML comment.** Without `<!-- TASK: ... -->`, the task is invisible to programmatic queries. Always add it BEFORE the `###` heading.
2. **Status drift.** Moving a task between columns without updating the HTML comment's `status=` field. Visual position and metadata diverge. Always update both.
3. **Duplicate task IDs.** Check with `grep -r "T00" ~/团队/项目/ | sort` before committing.
4. **Unassigned 进行中 tasks.** A task in 进行中 with `assignee=未分配` — run the unassigned query before sprints.
5. **Stale 审核 tasks.** Tasks sitting in 审核 >3 days need a nudge. Check during daily standup.

## Verification Checklist

- [ ] Board file at `~/团队/项目/<slug>/board.md` with 4 columns
- [ ] Every task has `<!-- TASK: id=... status=... priority=... assignee=... -->`
- [ ] No duplicate task IDs
- [ ] All 进行中 tasks have real assignees (not "未分配")
- [ ] Sprint header has current dates
