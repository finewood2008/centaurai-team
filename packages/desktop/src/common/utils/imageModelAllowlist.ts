/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Allowlist for built-in image generation tool.
 *
 * The tool currently only supports "form B" — OpenAI chat completions multimodal
 * output (model returns images via `message.images` or markdown). It does NOT
 * support "form A" (`/v1/images/generations` endpoint) or async/polling APIs.
 *
 * Model selection therefore must be a platform+model allowlist of providers
 * known to work, rather than a coarse name-substring match. Otherwise users
 * see options like `gpt-image-1` / `dall-e-3` / `sd-3.5` in the dropdown that
 * are guaranteed to fail at runtime.
 *
 * Rules below mirror `useConfigModelListWithImage.ts` — the same providers we
 * auto-supplement with default image models. When #6 lands a form-A adapter,
 * extend this list accordingly.
 */

type ProviderShape = {
  platform?: string;
  base_url?: string;
  name?: string;
  models?: string[];
  enabled?: boolean;
  model_enabled?: Record<string, boolean>;
};

const IMAGE_NAME_PATTERN = /(image|banana|imagine)/i;

const RULES: Array<{
  id: string;
  match: (provider: ProviderShape) => boolean;
}> = [
  {
    id: 'gemini',
    match: (p) => p.platform === 'gemini' || p.platform === 'gemini-vertex-ai',
  },
  {
    id: 'openrouter',
    match: (p) => !!p.base_url?.includes('openrouter.ai'),
  },
  {
    id: 'antigravity',
    match: (p) => !!p.name?.toLowerCase().includes('antigravity'),
  },
];

export const isImageGenSupported = (provider: ProviderShape, modelName: string): boolean => {
  if (!IMAGE_NAME_PATTERN.test(modelName)) return false;
  return RULES.some((rule) => rule.match(provider));
};

const normalizeModelName = (name: string): string => name.trim();

const uniqueModels = (models: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawModel of models) {
    const model = normalizeModelName(rawModel);
    if (!model || seen.has(model)) continue;
    seen.add(model);
    result.push(model);
  }
  return result;
};

export function getSupplementalImageModels(provider: ProviderShape): string[] {
  const platformLower = provider.platform?.toLowerCase() || '';
  const models = provider.models ?? [];
  const hasImageModel = models.some((model) => IMAGE_NAME_PATTERN.test(model));

  if (provider.platform === 'gemini' && (!provider.base_url || provider.base_url.trim() === '')) {
    const hasGeminiImage = models.some((model) => model.includes('gemini') && IMAGE_NAME_PATTERN.test(model));
    return hasGeminiImage ? [] : ['gemini-2.5-flash-image-preview'];
  }

  if (provider.base_url?.includes('openrouter.ai')) {
    const hasOpenRouterImage = models.some((model) => IMAGE_NAME_PATTERN.test(model));
    return hasOpenRouterImage ? [] : ['google/gemini-2.5-flash-image-preview'];
  }

  if (platformLower.includes('antigravity') || provider.name?.toLowerCase().includes('antigravity')) {
    return hasImageModel ? [] : ['gemini-3-pro-image-1x1'];
  }

  return [];
}

export function buildSelectableImageGenerationModels(
  provider: ProviderShape,
  explicitModels: string[] = [],
  selectedModel?: string
): string[] {
  const explicitSet = new Set(explicitModels.map(normalizeModelName).filter(Boolean));
  const detectedModels = uniqueModels([...(provider.models ?? []), ...getSupplementalImageModels(provider)]).filter(
    (modelName) => isImageGenSupported(provider, modelName) || explicitSet.has(modelName)
  );
  return uniqueModels([...detectedModels, ...explicitModels, ...(selectedModel ? [selectedModel] : [])]);
}

export function findFirstSelectableImageGenerationModel(
  provider: ProviderShape,
  explicitModels: string[] = []
): string | undefined {
  if (provider.enabled === false) return undefined;
  return buildSelectableImageGenerationModels(provider, explicitModels).find(
    (modelName) => provider.model_enabled?.[modelName] !== false
  );
}
