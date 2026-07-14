---
name: 客户方案
description: 'Use when creating client-facing proposals, solution briefs, or quotations for AI products and services. Generates structured proposals with problem analysis, solution design, pricing, timeline, and case studies. Trigger on: proposal, 方案, 提案, 报价, solution brief, 客户方案, project proposal, RFP response.'
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [team, proposal, 方案, 报价, client, sales, solution-design]
    related_skills: [officecli-docx, officecli-pptx, team-translation]
---

# Team Client Proposal (客户方案/报价)

Create professional AI solution proposals and quotations for CentaurAI clients.

## Overview

Structured proposal generation for AI product sales scenarios:

- AI workstation deployment
- AI model customization (LoRA)
- Technical consulting
- Product customization

All proposals stored at `~/团队/客户/<client-name>/`.

## When to Use

- "写一份AI工作站部署方案给XX公司"
- "generate a proposal for a 10-person AI team"
- "create a quotation for enterprise LoRA training"
- "draft an RFP response"
- "需要一份客户演示用的方案文档"

## Proposal Structure

### Full Proposal (正式方案书)

The proposal follows a 6-section structure:

```markdown
# <项目名称> — AI解决方案建议书

> 版本: v1.0 | 日期: 2026-07-12
> 客户: <公司名称> | 联系人: <姓名>
> 编制: 半人马人工智能（深圳）有限公司

---

## 1. 项目背景与需求分析

### 1.1 客户现状

<客户当前AI能力、痛点、业务场景>

### 1.2 核心需求

1. **需求:** <描述>

### 1.3 预期目标

- 目标: <量化指标>

---

## 2. 解决方案

### 2.1 方案概述

<一句话描述方案核心思路>

### 2.2 技术架构
```

┌─────────────────────────────────────────┐
│ 应用层 │
│ CentaurAI 超级工作台 (Web/Desktop) │
├─────────────────────────────────────────┤
│ AI引擎层 │
│ SDXL图像 │ LLM对话 │ RAG检索 │ STT语音 │
├─────────────────────────────────────────┤
│ 算力层 │
│ GPU: RTX 5070 12GB × N台 │
│ 模型: 本地推理 + 云端API混合 │
└─────────────────────────────────────────┘

```

### 2.3 功能清单

| 模块 | 功能 | 说明 |
|------|------|------|
| AI对话 | 多模型切换、团队协作 | DeepSeek/GPT/Claude等 |
| 图像生成 | SDXL文生图、企业LoRA | 品牌风格定制 |
| 知识库 | 向量检索、RAG增强 | 企业文档智能问答 |
| 权限管理 | 角色/团队/数据隔离 | 多人安全协作 |

### 2.4 部署方案

**方案A: 本地私有化部署**
- 硬件: AI工作站 × N台
- 网络: 内网部署, 无需外网
- 优势: 数据安全, 低延迟

**方案B: 混合部署**
- GPU推理本地化, 对话API云端
- 优势: 成本可控, 弹性扩容

---

## 3. 实施计划

| 阶段 | 内容 | 周期 | 交付物 |
|------|------|------|--------|
| 第一阶段 | 环境部署+基础功能上线 | 1周 | AI工作站就绪 |
| 第二阶段 | 企业知识库+定制化 | 2周 | RAG知识库上线 |
| 第三阶段 | 培训+试运行 | 1周 | 操作手册+培训 |
| 第四阶段 | 正式交付+持续支持 | 长期 | SLA运维保障 |

---

## 4. 报价明细

### 产品费用

| 项目 | 规格 | 数量 | 单价 | 小计 |
|------|------|------|------|------|
| AI工作站硬件 | 8845 CPU/32GB/512GB+2TB/RTX 5070 | N台 | ¥XX,XXX | ¥XXX,XXX |
| CentaurAI 团队版 | 永久授权, N用户 | 1套 | ¥XX,XXX | ¥XXX,XXX |
| 企业LoRA训练 | 品牌风格模型定制 | 1次 | ¥XX,XXX | ¥XXX,XXX |
| 部署实施 | 安装+配置+集成 | 1次 | ¥XX,XXX | ¥XXX,XXX |

### 年度服务

| 服务 | 内容 | 费用/年 |
|------|------|---------|
| 技术支持 | 7×12h响应, 远程+现场 | ¥XX,XXX |
| 版本升级 | 功能更新+安全补丁 | ¥XX,XXX |
| 模型更新 | LoRA定期重训优化 | ¥XX,XXX |

---

## 5. 为什么选择半人马AI

### 核心优势

1. **开箱即用** — 硬件+软件一体化, 插电即用
2. **国产化适配** — 支持国产GPU和国产模型
3. **私有化部署** — 数据不出企业内网, 安全合规
4. **持续迭代** — 双周发版, 快速响应需求

### 典型客户案例

| 客户 | 场景 | 规模 | 效果 |
|------|------|------|------|
| <客户A> | 电商产品图生成 | 5人团队 | 设计效率提升60% |
| <客户B> | 内部知识库问答 | 20人团队 | 检索准确率92% |

---

## 6. 下一步

- [ ] 技术POC演示（免费, 1天内完成）
- [ ] 商务条款确认
- [ ] 合同签订
- [ ] 项目启动

---

> 半人马人工智能（深圳）有限公司
> 官网: www.centaurloop.com
```

## Quick Proposal Types

### Type 1: Quick Quote (报价单)

Lightweight, 1-page pricing for known products:

```markdown
# CentaurAI 超级工作台 — 报价单

| 配置   | 规格                      | 单价    |
| ------ | ------------------------- | ------- |
| 标准版 | 1台工作站 + 团队版软件    | ¥XX,XXX |
| 增强版 | 2台工作站(双GPU) + 团队版 | ¥XX,XXX |
| 旗舰版 | 3台+ 定制化部署           | 面议    |
```

### Type 2: Technical POC (技术验证方案)

For prospects testing before buying:

- Scope: 1-2 core features, 1 week
- Hardware: loaner workstation or remote demo
- Deliverable: POC report with metrics

### Type 3: RFP Response (投标响应)

For formal procurement:

- Follow RFP structure requirements
- Include company qualifications (营业执照, 软著)
- Formal pricing with validity period
- Milestone-based timeline

## Customization Points

Fill from context or ask:

1. **Client name + industry** — tailors language and case studies
2. **Team size** — determines hardware count and pricing
3. **Primary use case** — image/chat/knowledge base focus
4. **Budget sensitivity** — offer tiered options
5. **Timeline urgency** — adjust implementation phases

## Output Formats

- **Markdown first** — draft, review content
- **DOCX export** — load `officecli-docx` for formal document
- **PPTX export** — load `officecli-pptx` for presentation
- **Bilingual** — load `team-translation` for CN/EN versions

## Common Pitfalls

1. **Over-promising timeline.** 4 weeks for full deployment is aggressive. Add 1-2 weeks buffer.
2. **Vague pricing.** Empty price fields look unprofessional. Write "面议" and explain why.
3. **No differentiator.** Every proposal must answer: "why CentaurAI over Dify/FastGPT/自研?"
4. **Too technical early.** Decision-makers read first. Lead with business value, put technical details later.
5. **Missing call to action.** Every proposal needs a clear next step.

## Verification Checklist

- [ ] Client name, industry, team size confirmed
- [ ] Solution tailored to actual needs (not generic)
- [ ] Architecture diagram matches deployment model
- [ ] Pricing table complete (or explicitly "面议")
- [ ] Case studies relevant to client's industry
- [ ] Timeline includes buffer
- [ ] Differentiator clearly stated
- [ ] Next step / call to action present
