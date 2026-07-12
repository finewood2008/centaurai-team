# 团队工作台 · CentaurAI Team Workspace

This is a **downstream distribution** of
[centaurai-station](https://github.com/finewood2008/centaurai-station) — the core / full app.
It is built as the **Team edition** (`AIONUI_EDITION=team`):

- For employees: office assistants + expert advisors (顾问团) + workbench / image studio.
- Multi-user **WebUI / LAN server** (the current distributed-client model).
- **智囊团 (decision meetings) removed** — both from the UI and blocked at the WebUI
  API layer, so LAN users can't reach `/api/teams*`.

The edition split lives in the **core**, behind a build-time flag that defaults to
`full`. This repo selects `team` via the GitHub **repo variable**
`AIONUI_EDITION=team` (Settings → Secrets and variables → Actions → Variables) —
no source fork of the build logic, so upstream merges stay conflict-free.

## Pull core updates from upstream

```bash
./scripts/sync-upstream.sh        # adds the upstream remote if missing, then merges upstream/main
```

## Build locally

```bash
bun install
bun run build-mac:team            # or build-win:team / build-deb:team
# Plain `bun dev` runs the FULL app; for the team UI use:
AIONUI_EDITION=team bun dev
```

## Release

Push a version tag (e.g. `v2.5.0`). The inherited **Build and Release** workflow reads
`AIONUI_EDITION=team` (repo variable) and builds + publishes the team installers to
this repo's Releases.
