---
name: 中英互译
description: "Use when translating content between Chinese and English for business, technical, or marketing purposes. Handles docs, emails, UI strings, marketing copy, and technical documentation with domain-aware terminology. Trigger on: 翻译, translate, 中译英, 英译中, i18n, localization, English version, 中文版."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [team, translation, i18n, localization, 翻译, 中英互译, documentation]
    related_skills: [officecli-docx, wechat-marketing]
---

# Team Translation (中英互译)

Translate content between Chinese and English for business and technical contexts.

## Overview

Domain-aware translation for AI/tech company workflows:
- Technical documentation (API docs, README, architecture docs)
- Marketing copy (官网, 产品介绍, 宣传文案)
- Business communication (邮件, 提案, 合同摘要)
- UI strings (i18n keys for CentaurAI)
- Meeting materials (slides, handouts)

The agent uses its built-in language capability — no external translation API needed.
The skill provides conventions, terminology, and quality checks.

## When to Use

- "把这个README翻译成中文"
- "translate this email to English"
- "帮我写一份中英双语的提案"
- "translate these UI strings for i18n"
- "check my translation for AI terminology accuracy"
- "这个英文表达在AI行业地道吗?"

## Translation Modes

### Mode 1: Full Translation

Produce a complete translation. Preserve formatting (markdown, code blocks, tables).
```bash
# Input: Chinese README
# Output: English README with same structure
```

### Mode 2: Bilingual Side-by-Side

Useful for proposals, contracts, and documents where both languages are needed:
```markdown
## 产品概述 / Product Overview

半人马AI超级工作台是一站式AI工作站...
CentaurAI Super Workstation is an all-in-one AI workstation...

## 核心功能 / Core Features

- 本地AI推理 / Local AI Inference
- 团队协作 / Team Collaboration
```

### Mode 3: i18n String Translation

For CentaurAI locale JSON files. Preserve keys, translate values only:
```json
// zh-CN/settings.json
{ "users": { "title": "用户管理", "createUser": "新建用户" } }

// → en-US/settings.json
{ "users": { "title": "User Management", "createUser": "New User" } }
```

### Mode 4: Review Only

Review an existing translation for:
- Accuracy (no meaning loss)
- Terminology consistency
- Natural phrasing (not machine-translated sounding)
- Cultural appropriateness

## Terminology Glossary

Consistent terminology across all CentaurAI translations:

| Chinese | English | Context |
|---------|---------|---------|
| 半人马AI | CentaurAI | Brand name, never translate |
| 超级工作台 | Super Workstation | Product name |
| 超级参谋 | Super Advisor | Product name |
| 向量数据库 | Vector Database | Technical |
| 知识库 | Knowledge Base | Product feature |
| 推理 | Inference | Technical (not "reasoning" for ML context) |
| 微调 | Fine-tuning | Technical |
| 工作流 | Workflow | Product feature |
| 插件 | Plugin | General |
| 模型提供商 | Model Provider | Product term |
| 令牌 | Token | Product (API context) |
| 算力 | Compute / Computing Power | Business |
| 私有化部署 | On-premise Deployment | Business |
| 开箱即用 | Out-of-the-box | Marketing |
| 一站式 | All-in-one | Marketing |

## AI Industry Conventions

### English technical terms (don't translate)

Keep these in English even in Chinese documents:
- API, SDK, CLI, GUI, UI/UX
- GPU, CPU, RAM, SSD
- LoRA, SDXL, GGUF, RAG
- JSON, YAML, HTTP, REST
- Git, PR, CI/CD
- Docker, Kubernetes

### Chinese technical conventions

| English | Good Chinese | Bad Chinese |
|---------|-------------|-------------|
| inference | 推理 | 推断 |
| prompt | 提示词 | 提示 |
| embedding | 向量嵌入 | 嵌入 |
| hallucination | 幻觉 | 幻想 |
| agent | 智能体/Agent | 代理 |
| token | Token/令牌 | 标记 |
| fine-tuning | 微调 | 精调 |
| deployment | 部署 | 展开 |

### Marketing tone

- Chinese: 简洁有力, 避免过度夸张 ("极致/颠覆/革命性" 慎用)
- English: Professional but warm, avoid "revolutionary/game-changing" cliches
- Both: Focus on what the product DOES, not what it IS

## Quality Checklist

After translating, verify:

1. **Completeness** — no skipped paragraphs or truncated content
2. **Code blocks intact** — backticks, indentation, language tags preserved
3. **Links preserved** — URLs and reference links unchanged
4. **Proper nouns consistent** — CentaurAI not CentauAI, ComfyUI not Comfy UI
5. **Numbers formatted correctly** — 1,234 vs 1.234 (locale-appropriate)
6. **Tone matches audience** — technical doc vs marketing copy vs internal email
7. **No AI-translation artifacts** — avoid "delve into", "crucial", "robust", "in the realm of" (overused by AI translators)

## Common Pitfalls

1. **Over-literal translation.** "超级工作台" → "Super Workbench" is literal but "Super Workstation" is the actual product name. Always check the glossary.
2. **Mixing "reasoning" and "inference".** In ML context, "推理" = "inference" (model running), NOT "reasoning" (logical thinking).
3. **Brand name translation.** Never translate "CentaurAI" or "半人马AI". Keep the brand name as-is.
4. **AI-speak in English output.** Watch for overused AI translator words: delve, crucial, comprehensive, robust, realm, landscape, testament. Strip them; write like a human.
5. **Missing code fences.** Translation models sometimes drop or misplace markdown code fences. Always verify code blocks survived intact.
6. **Character encoding.** Chinese characters in English documents — ensure UTF-8 encoding. No mojibake (乱码).

## Verification Checklist

- [ ] All sections translated (no skipped content)
- [ ] Code blocks and formatting preserved
- [ ] Proper nouns match glossary
- [ ] Technical terms used correctly (inference vs reasoning)
- [ ] Tone appropriate for document type
- [ ] No AI-translation artifacts in output
- [ ] Links and URLs unchanged
