# CentaurAI Core v0.1.46 Migration Runbook

This runbook switches TEAM from upstream AionCore to
`finewood2008/centaurai-core` without opening the only production database with
an unverified binary.

## Required Inputs

- Canonical `centaurai-core` v0.1.46 binary.
- Its exact release commit and SHA-256.
- A stopped, production-shaped data directory.
- The previous core binary for rollback rehearsal.
- A new output directory on encrypted or otherwise access-controlled storage.

Run the audit twice: once with a data directory created by v0.1.24 and once
with a current daily-use data directory. Never reuse an output directory.

## Audit Command

```bash
python3 ../centaurai-core/scripts/migration/audit_data_migration.py \
  --source-data-dir /path/to/staged-data \
  --core-bin ../centaurai-core/target/release/centaurai-core \
  --expected-version 0.1.46 \
  --expected-commit "$(git -C ../centaurai-core rev-parse HEAD)" \
  --legacy-core-bin /path/to/aioncore-v0.1.24 \
  --legacy-expected-version 0.1.24 \
  --output-dir /secure/audit/v0.1.46-current
```

Stop the source core before running the command. The tool uses SQLite's backup
API for a consistent database snapshot, but non-database files can still change
if another process is writing the data directory.

The output contains three isolated directories:

- `rollback-data`: immutable upgrade-before snapshot. No core is started here.
- `upgrade-data`: the only copy opened by v0.1.46.
- `rollback-drill-data`: a fresh clone of `rollback-data`, opened only by the
  explicitly supplied legacy core.

`migration-report.json` records the binary path/version/SHA, health
service/version/commit, endpoint probes, database integrity, schema migration
range, row counts, primary-key preservation, workspace reference counts, and
credential-reference counts. It never records credential values, message
content, provider configuration, workspace paths, or raw object identifiers.

## Acceptance Checks

Accept a data sample only when all of these are true:

1. `/health` reports `service: centaurai-core`, version `0.1.46`, and the
   expected non-unknown commit.
2. Settings, providers, conversations, assistants, teams, MCP, and skills APIs
   all return successful JSON responses.
3. SQLite quick check, foreign keys, and custom cross-table references pass.
4. Users, providers, conversations, messages, assistants, teams, cron jobs,
   MCP servers, ACP sessions, workspace references, and credential references
   do not lose rows or identities.
5. The only allowed preference removals are the retired runtime cache keys
   explicitly deleted by migration 019.
6. The `rollback-data` tree fingerprint is unchanged after both upgrade and
   rollback rehearsal.
7. The legacy core starts successfully only on `rollback-drill-data`.

Keep `migration-report.json`, `reports/before.json`, `reports/after.json`, and
`reports/comparison.json` with the release evidence. The data copies contain
production secrets and must not be committed or uploaded.

## Rollback

If startup, migration, or critical feature validation fails:

1. Stop the v0.1.46 process and confirm no core holds the data directory.
2. Quarantine the upgraded directory. Never start a legacy core against it.
3. Restore the complete `rollback-data` snapshot to a fresh production path.
   Do not restore only the SQLite file; rules, skills, workspaces, and runtime
   references belong to the same snapshot.
4. Point the launch configuration at the restored path and the saved legacy
   binary.
5. Enable legacy resolution explicitly with
   `CENTAURAI_CORE_ALLOW_LEGACY_FALLBACK=1` (or
   `AIONUI_BACKEND_ALLOW_LEGACY=1`).
6. Verify legacy health and the same read-only API set before reopening TEAM.

Once v0.1.46 has migrated the production database, rollback always means
restoring the upgrade-before snapshot. It never means running the old binary on
the upgraded database.
