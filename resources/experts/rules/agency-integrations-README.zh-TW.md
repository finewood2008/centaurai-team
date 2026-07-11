# 🔌 集成

本目錄包含 The Agency 針對受支持的智能體編碼工具的集成與轉換後格式。

## 受支持的工具

- **[Claude Code](#claude-code)** —— `.md` 智能體，直接使用本倉庫
- **[GitHub Copilot](#github-copilot)** —— `.md` 智能體，直接使用本倉庫
- **[Antigravity](#antigravity)** —— 每個智能體在 `antigravity/` 中對應一個 `SKILL.md`
- **[Gemini CLI](#gemini-cli)** —— `gemini-cli/agents/` 中的 `.md` 智能體文件
- **[OpenCode](#opencode)** —— `opencode/` 中的 `.md` 智能體文件
- **[OpenClaw](#openclaw)** —— `SOUL.md` + `AGENTS.md` + `IDENTITY.md` 工作區
- **[Cursor](#cursor)** —— `cursor/` 中的 `.mdc` 規則文件
- **[Aider](#aider)** —— `aider/` 中的 `CONVENTIONS.md`
- **[Windsurf](#windsurf)** —— `windsurf/` 中的 `.windsurfrules`
- **[Kimi Code](#kimi-code)** —— `kimi/` 中的 YAML 智能體規格
- **[Qwen Code](#qwen-code)** —— `.qwen/agents/` 中項目範圍的 `.md` 子智能體
- **[Codex](#codex)** —— `codex/` 中的 `.toml` 自定義智能體

## 快速安裝

```bash
# Install for all detected tools automatically
./scripts/install.sh

# Install a specific home-scoped tool
./scripts/install.sh --tool antigravity
./scripts/install.sh --tool copilot
./scripts/install.sh --tool openclaw
./scripts/install.sh --tool claude-code
./scripts/install.sh --tool codex

# Gemini CLI needs generated integration files on a fresh clone
./scripts/convert.sh --tool gemini-cli
./scripts/install.sh --tool gemini-cli

# Qwen Code also needs generated SubAgent files on a fresh clone
./scripts/convert.sh --tool qwen
./scripts/install.sh --tool qwen
```

如果你安裝了 OpenClaw 且網關已在運行，請在安裝後重啓它：

```bash
openclaw gateway restart
```

對於項目範圍的工具，如 OpenCode、Cursor、Aider、Windsurf 和 Qwen Code，請按照下文各工具專屬章節所示，從目標項目根目錄運行安裝程序。

## 重新生成集成文件

如果你新增或修改了智能體，請重新生成所有集成文件：

```bash
./scripts/convert.sh
```

---

## Claude Code

The Agency 最初是為 Claude Code 設計的。智能體無需轉換即可原生運行。

```bash
cp -r <category>/*.md ~/.claude/agents/
# or install everything at once:
./scripts/install.sh --tool claude-code
```

詳見 [claude-code/README.md](claude-code/README.md)。

---

## GitHub Copilot

The Agency 同樣可與 GitHub Copilot 原生協作。智能體無需轉換即可直接複製到 `~/.github/agents/` 和 `~/.copilot/agents/`。

```bash
./scripts/install.sh --tool copilot
```

詳見 [github-copilot/README.md](github-copilot/README.md)。

---

## Antigravity

技能安裝到 `~/.gemini/antigravity/skills/`。每個智能體都會成為一個獨立的技能，並以 `agency-` 為前綴以避免命名衝突。

```bash
./scripts/install.sh --tool antigravity
```

詳見 [antigravity/README.md](antigravity/README.md)。

---

## Gemini CLI

智能體被打包為 Gemini CLI 子智能體。子智能體安裝到 `~/.gemini/agents/`。由於這些智能體文件是生成產物，在全新克隆的倉庫中安裝前請先運行 `./scripts/convert.sh --tool gemini-cli`。

```bash
./scripts/convert.sh --tool gemini-cli
./scripts/install.sh --tool gemini-cli
```

詳見 [gemini-cli/README.md](gemini-cli/README.md)。

---

## OpenCode

每個智能體都會成為 `.opencode/agents/` 中一個項目範圍的 `.md` 文件。

```bash
cd /your/project && /path/to/agency-agents/scripts/install.sh --tool opencode
```

詳見 [opencode/README.md](opencode/README.md)。

---

## OpenClaw

每個智能體都會成為一個 OpenClaw 工作區，其中包含 `SOUL.md`、`AGENTS.md` 和 `IDENTITY.md`。

安裝前，請先生成 OpenClaw 工作區：

```bash
./scripts/convert.sh --tool openclaw
```

然後安裝它們：

```bash
./scripts/install.sh --tool openclaw
```

詳見 [openclaw/README.md](openclaw/README.md)。

---

## Cursor

每個智能體都會成為一個 `.mdc` 規則文件。規則是項目範圍的——請從項目根目錄運行安裝程序。

```bash
cd /your/project && /path/to/agency-agents/scripts/install.sh --tool cursor
```

詳見 [cursor/README.md](cursor/README.md)。

---

## Aider

所有智能體被整合到單個 `CONVENTIONS.md` 文件中，Aider 在你的項目根目錄存在該文件時會自動讀取。

```bash
cd /your/project && /path/to/agency-agents/scripts/install.sh --tool aider
```

詳見 [aider/README.md](aider/README.md)。

---

## Windsurf

所有智能體被整合到一個用於項目根目錄的 `.windsurfrules` 文件中。

```bash
cd /your/project && /path/to/agency-agents/scripts/install.sh --tool windsurf
```

詳見 [windsurf/README.md](windsurf/README.md)。

---

## Kimi Code

每個智能體被轉換為一個 Kimi Code CLI 智能體規格（YAML 格式，附帶獨立的系統提示文件）。智能體安裝到 `~/.config/kimi/agents/`。

由於 Kimi 智能體文件是從源 Markdown 生成的，在全新克隆的倉庫中安裝前請先運行 `./scripts/convert.sh --tool kimi`。

```bash
./scripts/convert.sh --tool kimi
./scripts/install.sh --tool kimi
```

### 用法

安裝後，使用 `--agent-file` 標誌來調用某個智能體：

```bash
kimi --agent-file ~/.config/kimi/agents/frontend-developer/agent.yaml
```

或在特定項目中：

```bash
cd /your/project
kimi --agent-file ~/.config/kimi/agents/frontend-developer/agent.yaml \
     --work-dir /your/project
```

詳見 [kimi/README.md](kimi/README.md)。

---

## Qwen Code

每個智能體都會成為 `.qwen/agents/` 中一個項目範圍的 `.md` 子智能體文件。

從全新克隆的倉庫開始時，請先生成 Qwen 文件：

```bash
./scripts/convert.sh --tool qwen
```

然後從你的項目根目錄安裝它們：

```bash
cd /your/project && /path/to/agency-agents/scripts/install.sh --tool qwen
```

詳見 [qwen/README.md](qwen/README.md)。

---

## Codex

每個智能體被轉換為一個獨立的 Codex 自定義智能體 TOML 文件，並安裝到 `~/.codex/agents/`。

由於 Codex 使用生成的 TOML 文件而非直接使用源 Markdown，在全新克隆的倉庫中安裝前請先運行轉換器：

```bash
./scripts/convert.sh --tool codex
./scripts/install.sh --tool codex
```

詳見 [codex/README.md](codex/README.md)。
