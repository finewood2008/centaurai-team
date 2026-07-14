---
name: 更新日志
description: "Use when managing product release changelogs following semantic versioning conventions. Generates structured release notes from git history, categorizes changes (features, fixes, breaking), and maintains CHANGELOG.md files. Trigger on: changelog, release notes, 更新日志, version bump, 发版, what's new, 版本发布."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [team, changelog, release-notes, 更新日志, semantic-versioning, 发版]
    related_skills: [team-project-tracker, github-pr-workflow]
---

# Team Changelog (产品更新日志)

Generate and maintain structured product changelogs for CentaurAI releases.

## Overview

Follows [Keep a Changelog](https://keepachangelog.com/) conventions with Chinese-first content.
Each release entry is categorized, human-readable, and linked to relevant issues/PRs.
Supports both product-facing changelogs (for customers) and internal release notes (for the team).

## When to Use

- "generate changelog for v1.5.0"
- "what's new since the last release?"
- "prepare release notes for the team"
- "update CHANGELOG.md for this sprint"
- "write release announcement copy"
- "customer-facing release notes"

## Changelog Format

Store at `~/团队/发版/CHANGELOG.md` (project root) or per-product:

```
~/团队/发版/
  CHANGELOG-team.md          — 超级工作台
  CHANGELOG-decision.md      — 超级参谋
  CHANGELOG-vector-db.md     — 向量数据库
```

### Entry template

```markdown
# Changelog

## [1.5.0] — 2026-07-25

### 🚀 新增功能 (Added)

- 团队版多用户权限系统 — 支持管理员/成员/访客三种角色 ([#142](link))
- 向量数据库新增混合检索策略 — 关键词+语义联合检索，准确率提升15%
- 用户管理设置页 — 管理员可直接在UI中创建/删除用户

### 🔧 改进 (Changed)

- ComfyUI工作流面板适配暗色主题 (墨夜)
- ACP Agent启动速度优化 — 首次加载减少40%
- 首页文件图标支持自动换行布局

### 🐛 修复 (Fixed)

- 修复aioncore auth middleware在local模式下JWT被错误绕过的问题
- 修复多用户同时登录时对话列表串号
- 修复SettingsPageWrapper移动端白屏 (builtinMap缺失条目)

### ⚠️ 破坏性变更 (Breaking)

- 数据库迁移v12: assistant_definitions表结构变更 — 需要备份后升级
- API: `DELETE /api/auth/internal/users/{id}` 端点新增，旧版客户端返回405

### 🔒 安全 (Security)

- API密钥加密密钥轮换机制优化
- 用户密码最少8位，支持复杂度检查

### 📝 文档 (Documentation)

- 新增开发者入门指南
- 更新ComfyUI集成文档 (RTX 5070显存优化建议)

---

## [1.4.1] — 2026-07-10

...
```

## Generating from Git

### Collect commits since last tag

```bash
# Get last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")

# Commits since last tag
git log $LAST_TAG..HEAD --format="%h %s (%an)" --no-merges

# Grouped by conventional commit prefix
git log $LAST_TAG..HEAD --format="%s" --no-merges | \
  grep -E "^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)"
```

### Conventional commit mapping

| Commit prefix      | Changelog section       |
| ------------------ | ----------------------- |
| `feat:`            | 🚀 新增功能             |
| `fix:`             | 🐛 修复                 |
| `perf:`            | 🔧 改进                 |
| `refactor:`        | 🔧 改进                 |
| `style:`           | (omit — no user impact) |
| `docs:`            | 📝 文档                 |
| `test:`            | (omit — internal)       |
| `chore:`           | (omit — internal)       |
| `BREAKING CHANGE:` | ⚠️ 破坏性变更           |

## Release Workflow

### 1. Pre-release checklist

- [ ] All sprint tasks in 完成 column
- [ ] CI passing on main branch
- [ ] Database migrations tested (up AND down)
- [ ] Breaking changes documented
- [ ] Release branch created: `release/v1.5.0`

### 2. Generate changelog

1. Collect commits since last tag
2. Categorize by type (feat/fix/perf/breaking)
3. Add human-readable descriptions (commits messages may be cryptic)
4. Link to issues/PRs
5. Write customer-facing summary

### 3. Version bump

```bash
# Semantic versioning decision
# MAJOR: breaking changes (1.x → 2.0)
# MINOR: new features, backward-compatible (1.4 → 1.5)
# PATCH: bug fixes only (1.5.0 → 1.5.1)

# Tag the release
git tag -a v1.5.0 -m "Release v1.5.0: 多用户权限系统"
git push origin v1.5.0
```

### 4. Write release announcement

For customer-facing channels (官网, 钉钉群, 邮件):

```markdown
# CentaurAI 超级工作台 v1.5.0 发布

## 🎉 本次更新亮点

**多用户权限系统正式上线！** 现在可以为团队成员设置不同角色，
管理员拥有全部权限，成员按需分配，访客只能查看。

## 主要更新

- 🔐 **权限系统** — 管理员/成员/访客三级角色, 细粒度权限控制
- 🔍 **混合检索** — 关键词+语义联合检索, 准确率提升15%
- ⚡ **启动加速** — ACP Agent首次加载减少40%

## 升级指南

1. 备份数据库: `cp aionui-backend.db aionui-backend.db.bak`
2. 拉取最新代码: `git pull && bun install`
3. 重启服务: `centaur restart`

[查看完整更新日志](link)
```

## Product-Facing vs Internal

| Aspect   | Product Changelog         | Internal Release Notes |
| -------- | ------------------------- | ---------------------- |
| Audience | 客户/用户                 | 开发团队               |
| Tone     | 简洁, 突出价值            | 技术细节, 可操作       |
| Content  | 新功能 + 改进             | + 部署步骤 + 回滚方案  |
| Language | Chinese (客户群)          | Chinese (团队)         |
| Length   | 5-10 items, scan-friendly | Full diff, all changes |

## Common Pitfalls

1. **Commit messages as changelog.** "fix: stuff" is not a changelog entry. Rewrite every entry for a human reader who has zero context.
2. **No breaking change warning.** If a DB migration or API change breaks old clients, it MUST be in the ⚠️ section with clear upgrade instructions.
3. **Too many entries.** Not every commit deserves a changelog line. Omit internal refactors, style changes, and test additions. Aim for 5-15 meaningful entries.
4. **Version number confusion.** Follow semver strictly. If unsure: PATCH for bugfixes, MINOR for features, MAJOR for breaking changes.
5. **Forgetting to tag.** The changelog is generated from git tags. If you don't tag the release, the next changelog will include all commits from the beginning.
6. **Chinese-only without English.** International users exist. At minimum, provide English headings and key feature summaries.

## Verification Checklist

- [ ] All commits since last tag collected and categorized
- [ ] Breaking changes clearly marked with upgrade steps
- [ ] Customer-facing summary written in Chinese
- [ ] Version bumped following semver
- [ ] Git tag created and pushed
- [ ] CHANGELOG.md updated in project root
- [ ] Internal release notes include deployment steps
