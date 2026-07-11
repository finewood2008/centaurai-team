---
name: 竞品监控
description: "Use when researching or tracking competitors in the AI workstation and enterprise AI platform space. Maintains structured competitor profiles, feature matrices, battle cards for sales, and weekly market intelligence digests. Trigger on: competitor, 竞品, competitive analysis, Dify, FastGPT, market research."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [team, competitor, 竞品, market-research, competitive-analysis, strategy]
    related_skills: [team-knowledge-base, blogwatcher, team-client-proposal]
---

# Team Competitor Watch (竞品监控)

Systematic competitor tracking and analysis for the AI workstation/platform market.

## Overview

Structured competitive intelligence covering:
- Competitor profiles with feature matrices
- Battle cards for sales conversations
- Weekly market intelligence digests
- Strategy implications for product roadmap

All data at `~/团队/竞品/`.

## When to Use

- "research competitor Dify / FastGPT / Coze"
- "update the competitor feature matrix"
- "create a battle card for sales conversations"
- "what's new in the AI workstation space this week?"
- "competitor funding or product launch news"
- "how do we compare to X?"

## Competitor Landscape

### Direct Competitors (同类产品)

| Competitor | Type | Key Differentiator | Threat Level |
|------------|------|-------------------|-------------|
| Dify | SaaS AI platform | Open-source, visual workflow builder | 🔴 High |
| FastGPT | SaaS knowledge base | Out-of-box knowledge QA system | 🟡 Medium |
| 扣子(Coze) | ByteDance AI bot platform | ByteDance ecosystem, rich plugins | 🟡 Medium |
| AnythingLLM | Local AI desktop | Fully local deployment, multi-model | 🟢 Low |

### Adjacent Competitors (相邻领域)

| Competitor | Type | Overlap with CentaurAI |
|------------|------|----------------------|
| ComfyUI | Image generation tool | Image workflows (we embed it) |
| Ollama | Local LLM runner | Local inference (we aggregate it) |
| LangChain | AI dev framework | Dev tools (different audience) |

## Competitor Profile Template

Each competitor gets a profile at `~/团队/竞品/<name-slug>.md`:

```markdown
# <Competitor Name> — 竞品档案

> 最后更新: YYYY-MM-DD | 负责人: <github-username>
> 官网: <URL> | GitHub: <URL>

---

## 基本信息

| 项目 | 详情 |
|------|------|
| 公司/项目 | <名称> |
| 成立时间 | <年份> |
| 总部 | <地点> |
| 融资情况 | <轮次/金额> |
| 团队规模 | <估计人数> |
| 目标客户 | <客户画像> |
| 定价模式 | <开源/订阅/买断/免费增值> |

## 产品定位

**一句话:** <他们如何描述自己>

**核心能力:**
1. <核心功能1>
2. <核心功能2>
3. <核心功能3>

## 功能对比

| 功能 | CentaurAI | <Competitor> | 差异 |
|------|-----------|-------------|------|
| 本地AI推理 | ✅ 硬件+软件一体 | ? | <说明> |
| 多模型支持 | ✅ 5+ providers | ? | <说明> |
| 图像生成 | ✅ SDXL+ComfyUI | ? | <说明> |
| 向量知识库 | ✅ 双版本(单机/团队) | ? | <说明> |
| 团队协作 | ✅ 多用户+权限 | ? | <说明> |
| 私有化部署 | ✅ 开箱即用 | ? | <说明> |
| 企业LoRA训练 | ✅ GPU本地训练 | ? | **独家优势点** |
| 硬件一体化 | ✅ AI工作站 | ? | **独家优势点** |

## 优势 (他们的强项)

1. <优势1 — 诚实面对>
2. <优势2>

## 劣势 (我们的机会)

1. <弱点1 — 销售中可攻击的点>
2. <弱点2>

## 定价

| 版本 | 价格 | 包含功能 |
|------|------|----------|
| Free/Community | ¥X/月 | <功能> |
| Pro/Team | ¥X/月 | <功能> |
| Enterprise | ¥X/月 | <功能> |

## 近期动态

| 日期 | 事件 | 对我们影响 |
|------|------|-----------|
| 2026-07 | <更新内容> | <影响评估> |

## 我们的应对策略

- **差异化:** <我们独有的, 避免正面对比>
- **进攻点:** <利用他们的弱点>
- **防御:** <他们比我们强的地方, 如何弥补>
```

## Battle Card

Quick-reference for sales conversations — 1 page max:

```markdown
# Battle Card: CentaurAI vs <Competitor>

## 定位差异
CentaurAI = AI工作站硬件+软件一体化, 开箱即用
<Competitor> = <他们的定位>

## 为什么选CentaurAI (3个杀手锏)
1. **私有化部署, 数据不出门** — 他们需自购服务器自行安装
2. **GPU本地出图** — 他们依赖云端API, 速度慢且按量计费
3. **企业LoRA定制** — 他们不支持品牌风格模型训练

## 他们比我们强的地方 + 回应
1. <对方优势> → 回应: <话术>

## 什么时候会输
- 客户预算极低, 只要免费开源方案
- 客户不需要图像生成, 纯文本对话即可
- 客户已有自建基础设施和运维团队

## 30秒电梯演讲
<一句话说清为什么选CentaurAI>
```

### CentaurAI's Unique Strengths (always emphasize)

1. **硬件+软件一体化** — competitors are SaaS-only or software-only
2. **GPU本地出图** — SDXL on RTX 5070, no cloud dependency
3. **企业LoRA训练** — brand-specific model fine-tuning on local GPU
4. **开箱即用** — plug in and work, zero setup complexity
5. **私有化部署** — data never leaves the office network

## Monitoring Routine

### Weekly (每周)

```bash
# Check for recent competitor updates
grep -r "融资\|funding\|launch\|release\|v[0-9]" ~/团队/竞品/ --include="*.md" -l
```

Tasks:
- [ ] Check competitor changelogs / release notes
- [ ] Scan social media for product announcements
- [ ] Read competitor blog RSS feeds (use blogwatcher skill)
- [ ] Write weekly digest: `~/团队/竞品/weekly/YYYY-WXX.md`

### Monthly (每月)

- [ ] Update feature comparison matrix for all active competitors
- [ ] Review threat levels — any changes?
- [ ] Deep-dive on one competitor (rotate: Dify → FastGPT → Coze → new entrant)
- [ ] Update battle cards if positioning shifted

### Quarterly (每季度)

- [ ] Full competitive landscape review
- [ ] Identify new entrants in the space
- [ ] Strategy implications report for team
- [ ] Output: `~/团队/竞品/季度报告-YYYY-QX.md`

## Data Sources

### Primary sources (they say)
- Competitor official websites and documentation
- GitHub repos: README, releases, issues
- Product changelogs and blog posts
- Pricing pages (check for changes monthly)

### Secondary sources (others say)
- Hacker News / Reddit (r/LocalLLaMA, r/selfhosted)
- 知乎 / 小红书 user reviews and discussions
- G2 / Product Hunt reviews
- Tech media: 36氪, 机器之心, 量子位

### Collection Commands

```bash
# Add competitor blogs to RSS monitor
blogwatcher add https://dify.ai/blog
blogwatcher add https://blog.fastgpt.in

# Check GitHub releases
gh api repos/langgenius/dify/releases --jq '.[0:3] | .[] | {tag: .tag_name, date: .published_at}'

# Check GitHub stars (growth indicator)
gh api repos/langgenius/dify --jq '.stargazers_count'
```

## Weekly Digest Template

```markdown
# 竞品动态周报 — 2026-WXX

## 🔥 重点关注

### <Competitor> — <事件标题>
- **日期:** <date>
- **要点:** <what happened, key details>
- **影响:** <how this affects us — market, product, sales>
- **应对:** <what we should do differently>

## 📰 其他动态

| 竞品 | 动态 | 影响等级 |
|------|------|----------|
| Dify | <update> | 低/中/高 |
| FastGPT | <update> | 低/中/高 |

## 🆕 新进入者

<Any new projects or companies entering the space>

## 📊 竞争格局变化

- Dify威胁等级: 保持/升级/降级 (理由)
- 其他无明显变化
```

## Common Pitfalls

1. **Fixating on one competitor.** Easy to obsess over the loudest name. Monitor the full landscape, rotate focus.
2. **Feature parity trap.** "They have X, we need X too" leads to copycat products. Focus on unique strengths: hardware integration, GPU本地出图, 企业LoRA.
3. **Stale data.** A 6-month-old competitor profile is harmful — outdated pricing and features mislead sales conversations. Set calendar reminders for regular updates.
4. **No actionable output.** Collecting intelligence without adjusting strategy is wasted effort. Every report must answer: "so what do we do differently?"
5. **Public leaks.** Competitive intelligence is sensitive. Keep `~/团队/竞品/` private. Never reference internal competitor analysis in public channels.
6. **Confirmation bias.** Looking for evidence we're better and ignoring genuine competitor advantages. Be honest about their strengths in every profile.

## Verification Checklist

- [ ] Competitor profiles follow the template (all sections filled)
- [ ] Feature comparison matrix is current (within 30 days)
- [ ] Battle cards ready for all active competitors
- [ ] Weekly digest published to `~/团队/竞品/weekly/`
- [ ] Threat level changes documented with rationale
- [ ] Strategy implications flagged for team discussion
- [ ] Data directory structure: profiles/, weekly/, quarterly/
