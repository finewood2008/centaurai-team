/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { Assistant, CreateAssistantRequest, UpdateAssistantRequest } from '@/common/types/agent/assistantTypes';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import type { ProcessConfig as ProcessConfigType } from './initStorage';

/**
 * Seed the bundled "expert library" (agency advisors, `agency-*`) into the
 * backend on startup so a fresh install ships with the full catalog instead of
 * relying on a one-off import. The seed dataset lives in `resources/experts/`:
 *
 *   - `experts.json` — array of {@link CreateAssistantRequest}-shaped rows
 *     (id, name, i18n, avatar/emoji, preset_agent_type, enabled_skills, …).
 *   - `rules/<id>.<locale>.md` — the expert prompt body, per locale
 *     (`zh-CN` and `zh-TW` translated, `en-US` original).
 *
 * Both phases are content-aware so re-running is safe:
 *   1. `POST /api/assistants/import` is insert-only — already-present experts
 *      (and any user edits to them) are skipped, never clobbered.
 *   2. Rule upload is read-before-write — a non-empty backend rule for an
 *      (id, locale) is left untouched.
 *
 * Gated by a version flag so it normally runs once; bump {@link SEED_VERSION}
 * when the bundled dataset changes to re-seed newly added experts.
 */

const SEED_VERSION = 2;
const SEED_FLAG = 'migration.bundledExpertsSeeded';
const RULE_LOCALES = ['zh-CN', 'zh-TW', 'en-US'] as const;
const METADATA_LOCALES = ['zh-CN', 'zh-TW', 'en-US'] as const;

type ConfigFile = typeof ProcessConfigType;

type ConfigAccessor = {
  get: (key: string) => Promise<unknown>;
  set?: (key: string, value: unknown) => Promise<unknown>;
};

/** A manifest row: the create-request fields plus the rule-file template. */
type ExpertManifestEntry = CreateAssistantRequest & { rule_file?: string };

/**
 * Locate the bundled experts directory. In production electron-builder copies
 * `resources/experts` → `<resourcesPath>/experts`; in dev it sits in the repo
 * relative to the main bundle (`out/main`). Returns the first candidate that
 * actually holds `experts.json`, or null when the dataset is absent.
 */
export function resolveExpertsDir(): string | null {
  const candidates: string[] = [];
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'experts'));

  const baseDir =
    typeof require !== 'undefined' && require.main?.filename ? path.dirname(require.main.filename) : __dirname;
  candidates.push(path.resolve(baseDir, '../../resources/experts'));
  candidates.push(path.resolve(baseDir, '../../../resources/experts'));
  candidates.push(path.resolve(process.cwd(), 'resources/experts'));

  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'experts.json'))) return dir;
  }
  return null;
}

/** Strip the manifest-only `rule_file` field so the import payload matches the wire contract. */
function toCreateRequest(entry: ExpertManifestEntry): CreateAssistantRequest {
  const { rule_file: _ruleFile, ...request } = entry;
  return request;
}

function pickSupportedStrings(value: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const locale of METADATA_LOCALES) {
    const text = value?.[locale];
    if (typeof text === 'string' && text.trim()) result[locale] = text;
  }
  return result;
}

function pickSupportedPromptArrays(value: Record<string, string[]> | undefined): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const locale of METADATA_LOCALES) {
    const prompts = value?.[locale];
    if (Array.isArray(prompts) && prompts.length > 0) result[locale] = prompts;
  }
  return result;
}

function mergeMissingStrings(
  existing: Record<string, string> | undefined,
  bundled: Record<string, string> | undefined
): { value: Record<string, string>; changed: boolean } {
  const value = pickSupportedStrings(existing);
  let changed = Object.keys(existing ?? {}).some(
    (locale) => !METADATA_LOCALES.includes(locale as (typeof METADATA_LOCALES)[number])
  );
  for (const locale of METADATA_LOCALES) {
    if (value[locale]) continue;
    const text = bundled?.[locale];
    if (typeof text === 'string' && text.trim()) {
      value[locale] = text;
      changed = true;
    }
  }
  return { value, changed };
}

function mergeMissingPromptArrays(
  existing: Record<string, string[]> | undefined,
  bundled: Record<string, string[]> | undefined
): { value: Record<string, string[]>; changed: boolean } {
  const value = pickSupportedPromptArrays(existing);
  let changed = Object.keys(existing ?? {}).some(
    (locale) => !METADATA_LOCALES.includes(locale as (typeof METADATA_LOCALES)[number])
  );
  for (const locale of METADATA_LOCALES) {
    if (value[locale]?.length) continue;
    const prompts = bundled?.[locale];
    if (Array.isArray(prompts) && prompts.length > 0) {
      value[locale] = prompts;
      changed = true;
    }
  }
  return { value, changed };
}

async function syncExpertMetadata(manifest: ExpertManifestEntry[]): Promise<boolean> {
  let existingAssistants: Assistant[];
  try {
    existingAssistants = await ipcBridge.assistants.list.invoke();
  } catch (error) {
    console.error('[CentaurAI] Failed to read assistant catalog for expert metadata sync:', error);
    return false;
  }

  const byId = new Map(existingAssistants.map((assistant) => [assistant.id, assistant]));
  const updates: UpdateAssistantRequest[] = [];

  for (const entry of manifest) {
    if (!entry.id) continue;
    const existing = byId.get(entry.id);
    if (!existing) continue;

    const name = mergeMissingStrings(existing.name_i18n, entry.name_i18n);
    const description = mergeMissingStrings(existing.description_i18n, entry.description_i18n);
    const prompts = mergeMissingPromptArrays(existing.prompts_i18n, entry.prompts_i18n);
    if (!name.changed && !description.changed && !prompts.changed) continue;

    updates.push({
      id: entry.id,
      name_i18n: name.value,
      description_i18n: description.value,
      prompts_i18n: prompts.value,
    });
  }

  if (updates.length === 0) return true;

  const results = await Promise.allSettled(updates.map((update) => ipcBridge.assistants.update.invoke(update)));
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length > 0) {
    console.error(`[CentaurAI] Expert metadata sync partial: ${failed.length}/${updates.length} failed`, failed[0]);
    return false;
  }
  console.log(`[CentaurAI] Synced localized metadata for ${updates.length} bundled experts`);
  return true;
}

/**
 * Upload the bundled rule bodies for one expert. Skips missing files and any
 * (id, locale) the backend already has non-empty content for. Throws on a
 * genuine write failure so the caller can count it.
 */
async function uploadExpertRules(expertsDir: string, id: string): Promise<void> {
  await Promise.all(
    RULE_LOCALES.map(async (locale) => {
      const filePath = path.join(expertsDir, 'rules', `${id}.${locale}.md`);
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        return; // No bundled body for this locale.
      }
      if (!content.trim()) return;

      // Read-before-write: never overwrite an existing (e.g. user-edited) rule.
      const existing = await ipcBridge.fs.readAssistantRule.invoke({ assistant_id: id, locale }).catch(() => '');
      if (existing.trim().length > 0) return;

      await ipcBridge.fs.writeAssistantRule.invoke({ assistant_id: id, locale, content });
    })
  );
}

/**
 * Seed bundled experts into the backend. Returns `true` on success (including
 * the no-op cases: already seeded, or no dataset present); `false` on a partial
 * failure so the caller can log it and retry on the next launch.
 */
export async function seedBundledExperts(configFile: ConfigFile): Promise<boolean> {
  const accessor = configFile as unknown as ConfigAccessor;

  let seededVersion = 0;
  try {
    const raw = await accessor.get(SEED_FLAG);
    if (typeof raw === 'number') seededVersion = raw;
  } catch {
    // Treat read errors as "not seeded yet".
  }
  if (seededVersion >= SEED_VERSION) return true;

  const expertsDir = resolveExpertsDir();
  if (!expertsDir) {
    console.warn('[CentaurAI] Bundled experts dataset not found; skipping expert seed');
    return true;
  }

  let manifest: ExpertManifestEntry[];
  try {
    const raw = await fs.readFile(path.join(expertsDir, 'experts.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    manifest = Array.isArray(parsed) ? (parsed as ExpertManifestEntry[]) : [];
  } catch (error) {
    console.error('[CentaurAI] Failed to read bundled experts manifest:', error);
    return false;
  }
  if (manifest.length === 0) return true;

  // Phase 1: import the catalog rows (insert-only).
  try {
    const result = await ipcBridge.assistants.import.invoke({ assistants: manifest.map(toCreateRequest) });
    if (result.failed !== 0) {
      console.error(`[CentaurAI] Expert seed import partial: ${result.failed} failed`, result.errors);
      return false;
    }
    if (result.imported > 0 || result.skipped > 0) {
      console.log(`[CentaurAI] Seeded ${result.imported} experts (skipped ${result.skipped})`);
    }
  } catch (error) {
    console.error('[CentaurAI] Expert seed import failed:', error);
    return false;
  }

  if (!(await syncExpertMetadata(manifest))) {
    return false;
  }

  // Phase 2: upload the per-locale rule bodies (read-before-write).
  let ruleFailures = 0;
  const outcomes = await Promise.allSettled(
    manifest.map((entry) => (entry.id ? uploadExpertRules(expertsDir, entry.id) : Promise.resolve()))
  );
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      ruleFailures += 1;
      console.error(`[CentaurAI] Failed to seed rules for '${manifest[index].id}':`, outcome.reason);
    }
  });
  if (ruleFailures > 0) {
    console.error(`[CentaurAI] Expert rule seed partial: ${ruleFailures}/${manifest.length} failed`);
    return false;
  }

  if (typeof accessor.set === 'function') {
    try {
      await accessor.set(SEED_FLAG, SEED_VERSION);
    } catch (error) {
      console.warn('[CentaurAI] Failed to persist expert seed flag', error);
    }
  }
  return true;
}
