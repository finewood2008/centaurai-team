---
name: 新人入职
description: 'Use when onboarding a new team member to the company, project, or development environment. Covers environment setup, account provisioning, access permissions, first-day tasks, and knowledge base orientation. Trigger on: onboarding, 入职, new employee, 新人, setup workstation, 环境配置, first day.'
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [team, onboarding, 入职, HR, environment-setup, access-control]
    related_skills: [team-knowledge-base, centaurai, tailscale]
---

# Team Onboarding (新成员入职)

Structured onboarding for new CentaurAI team members — from environment setup to first commit.

## Overview

Standardized onboarding checklist covering:

- Account provisioning (email, GitHub, Tailscale, internal tools)
- Development environment setup (Linux, CentaurAI stack)
- Access permissions (servers, repos, APIs)
- Knowledge base orientation
- First-week task plan

All onboarding docs live at `~/团队/入职/<name>/`.

## When to Use

- "onboard a new developer / designer / PM"
- "set up a new workstation for <name>"
- "create onboarding checklist for <name>"
- "what access does a new hire need?"
- "generate first-day tasks for the new hire"

## Onboarding Checklist

### Phase 0: Pre-arrival (admin)

Before the new member starts:

- [ ] Create company email (admin@centaurloop.com pattern)
- [ ] GitHub: invite to centaurloop org, grant repo access
- [ ] Tailscale: share invite link, add to tailnet
- [ ] CentaurAI: create user account (Settings → User Management → New User)
- [ ] Prepare workstation hardware (if applicable)
- [ ] Assign buddy/mentor

### Phase 1: Day 1 — Environment

```bash
# System check
uname -a && cat /etc/os-release

# Essential tools
sudo apt install -y build-essential curl git vim

# Shell environment
# Add to ~/.bashrc:
export PATH="$HOME/.bun/bin:$HOME/.hermes/node/bin:$HOME/.local/bin:$PATH"
export ELECTRON_OZONE_PLATFORM_HINT=wayland
```

- [ ] OS updated (centaurOS / Ubuntu)
- [ ] Git configured: `git config --global user.name "Name"` + `git config --global user.email`
- [ ] SSH key generated: `ssh-keygen -t ed25519 -C "email@centaurloop.com"`
- [ ] SSH key added to GitHub
- [ ] VPN/Proxy configured (Clash Verge, SOCKS5 proxy)
- [ ] Bun installed: `curl -fsSL https://bun.sh/install | bash`
- [ ] Node.js global tools available (npx, claude, codex, etc.)

### Phase 2: Day 1 — Project Setup

```bash
# Clone main repos
cd ~
git clone git@github.com:centaurloop/centaurai-team.git
git clone git@github.com:centaurloop/centaurAI-database.git
git clone git@github.com:centaurloop/centaurAI-database-team.git
git clone git@github.com:centaurloop/centaurai-core.git

# Or for decision edition
git clone git@github.com:centaurloop/centaurai-decision.git
```

- [ ] Main repos cloned
- [ ] `cd centaurai-team && bun install`
- [ ] CentaurAI starts successfully (run `centaur team`)
- [ ] Can log in with assigned credentials
- [ ] Vector database accessible (port 8618/8619)
- [ ] ComfyUI accessible (port 8188)

### Phase 3: Day 1-2 — Knowledge

- [ ] Read `~/团队/知识库/技术架构.md` (system architecture overview)
- [ ] Read `~/团队/知识库/开发规范.md` (coding standards)
- [ ] Read `~/团队/知识库/常见问题.md` (FAQ)
- [ ] Review current sprint board: `~/团队/项目/<project>/board.md`
- [ ] Skim recent meeting minutes: `~/团队/会议/`
- [ ] Review product roadmap (if exists)
- [ ] Understand the two-product strategy: 超级工作台 vs 超级参谋

### Phase 4: Week 1 — First Tasks

- [ ] Day 1-2: Fix a small bug or documentation issue (first PR)
- [ ] Day 2-3: Pair program with buddy on a real feature
- [ ] Day 3-5: Take on a small sprint task independently
- [ ] Attend daily standup (listen first 2 days, contribute by day 3)
- [ ] Attend weekly tech sharing session
- [ ] Set up 1-on-1 with team lead by end of week

### Phase 5: Week 2 — Integration

- [ ] Own at least one sprint task end-to-end
- [ ] Participate in at least one code review (reviewer)
- [ ] Contribute to one meeting (take minutes or present)
- [ ] Buddy check-in: any blockers or confusion points?

## Role-Specific Additions

### Developer

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Node.js debugging
# Chrome DevTools Protocol: chrome://inspect

# Database tools
sudo apt install -y sqlite3 sqlitebrowser
```

- [ ] Rust toolchain installed (for aioncore)
- [ ] Can build centaurai-core: `cargo build --release -p aionui-app`
- [ ] Understand the Electron + Rust architecture
- [ ] Understand Hermes Agent skill system

### Designer

- [ ] Figma / design tool access
- [ ] ComfyUI workflow basics
- [ ] Brand assets: `~/桌面/centauros-assets/`
- [ ] UI conventions: Arco Design + icon-park + UnoCSS

### Operations / PM

- [ ] Access to project boards
- [ ] Customer communication channels
- [ ] Product analytics / monitoring tools
- [ ] Weekly report process understanding

## Buddy System

Every new hire gets a buddy (mentor) for the first 2 weeks:

| Task              | Buddy                                        |
| ----------------- | -------------------------------------------- |
| Day 1 walkthrough | Show around the codebase                     |
| First PR review   | Approve + explain feedback                   |
| First standup     | Help prepare status update                   |
| End of week 1     | 15-min check-in                              |
| End of week 2     | Handoff — new hire should be self-sufficient |

## Templates

Create onboarding doc at `~/团队/入职/<github-username>/`:

```
~/团队/入职/<username>/
  checklist.md     — this checklist, with checkboxes
  access.md        — accounts created, keys issued
  first-week.md    — day-by-day task plan
  notes.md         — personal notes, questions, feedback
```

## Common Pitfalls

1. **Access delays.** GitHub org invite sits in spam. Tailscale invite expires. Verify all invites were accepted before Day 1.
2. **DNS pollution.** New hires on the same network will hit the same DNS issues (198.18.0.x). Pre-configure proxy or hosts file.
3. **Too much reading.** Don't dump all docs on Day 1. Spread knowledge base reading across the first week.
4. **First PR too hard.** The first task should be achievable in 2 hours max. A typo fix or README update builds confidence.
5. **No buddy assigned.** Without a buddy, new hires stall on small blockers that would take 30 seconds to unblock.
6. **Password sharing over chat.** Use CentaurAI's User Management UI to create accounts and communicate credentials securely.

## Verification Checklist

- [ ] Onboarding doc created at `~/团队/入职/<name>/checklist.md`
- [ ] All accounts provisioned and verified
- [ ] Environment setup complete (git, SSH, proxy, bun, PATH)
- [ ] All repos cloned and building
- [ ] CentaurAI running and login verified
- [ ] Buddy assigned and introduced
- [ ] First task identified and scoped to <2 hours
- [ ] Week 1 daily plan mapped out
