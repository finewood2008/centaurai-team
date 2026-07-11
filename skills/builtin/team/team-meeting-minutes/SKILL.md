---
name: 会议纪要
description: "Use when recording, structuring, or extracting action items from team meetings. Creates standardized meeting minutes with decisions, action items with owners and deadlines, and follow-up tracking. Trigger on: meeting notes, 会议纪要, meeting minutes, 开会记录, standup notes, decision log, 会议记录."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [team, meetings, 会议纪要, action-items, decision-log, templates]
    related_skills: [team-weekly-report, team-project-tracker]
---

# Team Meeting Minutes (团队会议纪要)

Record, structure, and track team meetings with actionable output.

## Overview

Standardized markdown meeting minutes format with:
- Decisions logged with rationale
- Action items with owner + deadline
- Follow-up tracking across meetings
- Integration with task board and weekly report

All minutes stored at `~/团队/会议/YYYY-MM-DD-<topic>.md`.

## When to Use

- "记录今天的会议"
- "generate meeting minutes from this transcript"
- "extract action items from the discussion"
- "what decisions did we make last meeting?"
- "find all open action items for 张三"
- "standup / daily sync notes"

## Minutes Template

```markdown
# <会议主题> — 会议纪要

> 日期: 2026-07-12 14:00–15:00 | 地点: 线上/会议室
> 参会: 张三, 李四, 王五 | 记录: 张三
> 缺席: 赵六 (请假)

---

## 🎯 议程

1. 上周遗留问题回顾
2. 团队版v1.5功能排期
3. 客户演示准备
4. 其他事项

## 💬 讨论要点

### 1. 上周遗留问题

- **问题:** ComfyUI SDXL在8GB显存上OOM
- **进展:** 张三已优化LoRA加载, 显存降至7.8GB
- **结论:** 继续压到7GB以下以确保5060兼容

### 2. 团队版v1.5排期

- 优先级确认: 权限系统 > 统一登录 > 工作流编排
- 李四负责权限系统, 目标7/20完成开发, 7/25上线
- 王五调研SSO方案(OIDC/SAML), 下周一汇报

## 📋 决议

| # | 决议 | 理由 | 提出人 |
|---|------|------|--------|
| R1 | v1.5优先做权限系统, 工作流编排推迟到v1.6 | 客户Demo急需权限功能 | 李四 |
| R2 | 统一登录采用OIDC协议, 先支持企业微信 | 客户多为企业微信用户 | 王五 |
| R3 | 每周五下午4点技术分享, 轮流主讲 | 团队知识沉淀需要 | 张三 |

## ✅ 待办事项

| # | 事项 | 负责人 | 截止 | 状态 |
|---|------|--------|------|------|
| A1 | ComfyUI显存优化到7GB | 张三 | 7/16 | ⏳ |
| A2 | 权限系统开发 | 李四 | 7/20 | ⏳ |
| A3 | SSO方案调研报告 | 王五 | 7/14 | ⏳ |
| A4 | 准备7/15客户Demo环境 | 张三 | 7/14 | ⏳ |
| A5 | 发会议纪要给全员 | 张三 | 7/12 | ⏳ |

## 📎 附件

- 权限系统原型: <链接>
- SSO调研参考: <链接>

---

> 下次会议: 2026-07-14 10:00 | 每日站会 (15min)
```

## From Raw Notes / Transcript

When given raw notes, a transcript, or a verbal summary:

1. **Extract topic clusters** — group related points under agenda items
2. **Identify decisions** — any sentence containing "决定/确定/就这样/agree/decide"
3. **Extract action items** — any sentence with owner + deadline pattern ("张三做X, 周五前")
4. **Flag unknowns** — mark unclear owners as "待确认", ask user to fill in
5. **Structure into template** — fill the template sections

### Extraction patterns

```
Decisions:
- "我们决定..." / "就这么定了" / "agreed that..."
- "最终方案是..." / "确认采用..."
- "Let's go with..."

Action items:
- "<name> 负责 <task>, <deadline>"
- "@<name> <task> by <date>"
- "todo: <task> @<name>"
- "<name> will <task>"
```

## Follow-up Tracking

### Find open action items

```bash
# All open (non-completed) action items across meetings
grep -h "⏳\|🔄" ~/团队/会议/*.md | grep "A[0-9]"

# Action items for specific person
grep -h "张三" ~/团队/会议/*.md | grep "A[0-9].*⏳"

# Overdue items (deadline before today)
# Manually review; markdown tables don't support date comparison in grep
```

### Link to task board

For significant action items that become sprint tasks, add a reference:
```markdown
**待办:** 权限系统开发 → 看板 [T003]
```

### Pre-meeting prep

Before the next meeting:
1. Open the previous meeting's minutes
2. Check which action items are still ⏳
3. Mark completed ones as ✅
4. Move unfinished items to this meeting's "遗留问题" agenda

## Meeting Series

For recurring meetings (站会, 周会), maintain a consistent filename pattern:

```
~/团队/会议/
  站会/
    2026-07-12-站会.md
    2026-07-13-站会.md
  周会/
    2026-W28-周会.md
  产品评审/
    2026-07-09-产品评审.md
  技术分享/
    2026-07-11-张三-ComfyUI训练.md
```

## Integration

- **team-weekly-report:** Meeting decisions feed into "会议/决策" section
- **team-project-tracker:** Major action items become board tasks
- **team-knowledge-base:** Technical decisions (ADR) archived to knowledge base

## Common Pitfalls

1. **Vague action items.** "讨论一下XX" is not actionable. Convert to: "张三输出XX方案草案, 周五前". Every action needs owner + deadline + deliverable.
2. **Missing decisions.** Discussions that end with "好, 那就这样" without explicit logging. Always confirm: "所以决议是... 对吧?"
3. **Stale action items.** Items from 3 meetings ago still marked ⏳. During pre-meeting prep, chase or close them.
4. **Too much detail.** Minutes are not a transcript. Capture decisions and actions, not every opinion.
5. **No follow-up.** The value of minutes is in the follow-up. Auto-check open items before the next meeting.

## Verification Checklist

- [ ] Date, attendees, recorder filled
- [ ] Each agenda item has discussion summary
- [ ] All decisions in 决议 table with rationale
- [ ] All action items have owner + deadline
- [ ] No "待确认" owners (or flagged for user)
- [ ] File saved to `~/团队/会议/YYYY-MM-DD-<topic>.md`
- [ ] Previous meeting's action items reviewed and updated
