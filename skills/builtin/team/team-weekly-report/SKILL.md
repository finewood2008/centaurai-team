---
name: 团队周报
description: 'Use when generating structured weekly team reports from git commits, task boards, and meeting notes. Auto-aggregates work done, work planned, blockers, and metrics. Chinese output by default. Trigger on: weekly report, 周报, sprint review, 本周总结, team update, status report.'
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [team, weekly-report, 周报, sprint-review, git-log, automation]
    related_skills: [team-project-tracker, team-meeting-minutes]
---

# Team Weekly Report (团队周报)

Generate structured weekly team reports from git history, task boards, and meeting notes.

## Overview

Auto-aggregates work from multiple sources into a clean markdown weekly report:

- Git commit history per team member (from project repos)
- Task board status (from `team-project-tracker` board.md files)
- Meeting decisions and action items (from meeting minutes)
- Manual additions for non-code work

Output is a markdown file at `~/团队/周报/YYYY-WXX.md`, ready to paste into
钉钉/飞书/邮件.

## When to Use

- "生成这周的周报"
- "帮我写周报 / 团队周报"
- "summarize what we did this week"
- "sprint review summary"
- "weekly status update for the team"

## Report Structure

```markdown
# 半人马AI 团队周报 — 2026-W28 (7/6–7/12)

## 📊 概览

- 完成任务: 12 个
- 进行中: 5 个
- 代码提交: 47 commits across 4 repos
- 阻塞项: 2

## ✅ 本周完成

### 张三

- [T002] ComfyUI SDXL 工作流优化 — 显存占用降至7.8GB ✅
- [T005] Token管理中心暗色主题适配 — 已合并main ✅
- 修复 aioncore auth middleware JWT bypass (PR #142)

### 李四

- [T003] 团队版多用户权限系统 — 审核中, 预计下周一合并
- 客户演示环境部署 (demo.centaurloop.com)

## 🚧 进行中 / 下周计划

### 张三

- [T008] 向量数据库团队版RAG策略 (预计7/16完成)
- 竞品分析: Dify vs FastGPT vs 我们的差异点

### 李四

- [T003] 多用户权限系统合并 + 上线
- [T009] 团队版统一登录 (SSO方案调研)

## ⚠️ 风险与阻塞

1. **ComfyUI工作流兼容性** — 部分客户使用5060 8GB显卡, SDXL+LoRA刚好卡边, 需降级方案
2. **DeepSeek API近期不稳定** — 已切换到备用provider, 监控中

## 📈 数据

- 本周代码提交: 47 commits | 新增: +3,200行 | 删除: -1,100行
- Code Review: 8 PRs merged, 平均审核时间 4.2h
- 客户支持: 3 tickets resolved, 1 escalated

## 📝 会议 / 决策

- 7/9 产品评审: 决定团队版v1.5 优先做权限系统, 工作流编排推迟到v1.6
- 7/11 技术分享: 张三分享了 ComfyUI LoRA 训练最佳实践

## 🔗 相关链接

- Sprint Board: ~/团队/项目/centaurai-team/board.md
- 会议纪要: ~/团队/会议/2026-07-09-产品评审.md
```

## Data Sources

### Source 1: Git commits (auto)

For each team member's active repos, collect commits from this week:

```bash
# Collect commits for a repo
cd ~/project-repo
git log --since="last Monday" --until="today" \
  --author="张三\|Zhang San" \
  --format="%h %s" --no-merges
```

Use `git shortlog` for per-member summary:

```bash
git shortlog --since="last Monday" --until="today" \
  --format="%h %s" --no-merges -sn
```

### Source 2: Task boards (auto)

Parse `~/团队/项目/*/board.md` for:

- Completed this week: `status=done` with `completed=this_week`
- In progress: `status=in_progress`
- Blocked: task body contains "阻塞" or "blocked"

```bash
# Completed tasks this week
grep -B5 "completed=$(date +%Y-%m-%d)" ~/团队/项目/*/board.md
```

### Source 3: Meeting notes (auto)

Extract decisions and action items from meeting minutes in `~/团队/会议/`.
Look for `**决议:**` and `**待办:**` markers.

### Source 4: User input (manual)

Ask the user for:

- Non-code work (客户拜访、商务洽谈、方案撰写等)
- Blocker details
- Next week's priorities

## Workflow

1. **Collect data:** Run git queries across all active repos (centaurai-team, centaurai-decision, centaur-vector-db, etc.)
2. **Parse task boards:** Read `~/团队/项目/*/board.md` for status changes
3. **Check meetings:** Scan `~/团队/会议/` for this week's notes
4. **Ask for missing info:** Present what was found, ask for manual additions
5. **Generate report:** Write to `~/团队/周报/YYYY-WXX.md`
6. **Review with user:** Show the report, allow edits before finalizing

## Code Metrics (optional)

```bash
# LOC changes per repo
git diff --stat "$(git log --since='last Monday' --format=%H | tail -1)" HEAD

# Commit count per author
git shortlog --since="last Monday" --until="today" -sn --no-merges
```

## Common Pitfalls

1. **Wrong date range.** Verify "last Monday" resolves correctly. On Monday itself, the range should be the previous week. Use `date` to calculate:

   ```bash
   # Last Monday
   date -d "last Monday" +%Y-%m-%d
   # This Sunday (or today if generating mid-week)
   date +%Y-%m-%d
   ```

2. **Missing repos.** Team members may commit to repos outside the known list. Ask "any other repos to check?" before generating.

3. **Non-code work invisible.** Git logs only show code. Always ask about client meetings, proposals, research, and other non-commit work.

4. **Over-filtering commits.** Don't exclude merge commits by default — they may represent completed feature branches. Use `--no-merges` only for the detail view, keep merges for the count.

5. **Chinese names vs git author.** Git author name may differ from Chinese name (e.g., "Zhang San" vs "张三"). Map both variants when querying.

## Verification Checklist

- [ ] Date range is correct (last Monday to today)
- [ ] All active repos queried
- [ ] Per-member task summary from board.md
- [ ] User confirmed non-code work items
- [ ] Blockers are listed with context
- [ ] Report saved to `~/团队/周报/YYYY-WXX.md`
- [ ] Report is in Chinese (user preference)
