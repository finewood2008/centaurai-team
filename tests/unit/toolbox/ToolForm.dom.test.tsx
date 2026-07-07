import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolDef } from '@/renderer/pages/toolbox/types';

const mocks = vi.hoisted(() => ({
  applyImageModelSelection: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/renderer/hooks/agent/useConfigModelListWithImage', () => ({
  default: () => ({
    modelListWithImage: [
      {
        id: 'provider-1',
        name: 'Provider 1',
        platform: 'openai',
        base_url: 'https://example.invalid',
        api_key: '',
        models: ['image-model-1'],
      },
    ],
  }),
}));

vi.mock('@/renderer/hooks/config/useConfig', () => ({
  useConfig: (key: string) => {
    if (key === 'tools.imageGenerationModels') return [{}];
    if (key === 'tools.imageGenerationModel') return [{ id: 'provider-1', use_model: 'image-model-1' }];
    return [undefined];
  },
}));

vi.mock('@/renderer/pages/toolbox/imageModel', () => ({
  applyImageModelSelection: mocks.applyImageModelSelection,
  getCurrentImageModelValue: () => JSON.stringify(['provider-1', 'image-model-1']),
  getImageModelOptions: (providers: unknown[]) => providers,
}));

import ToolForm from '@/renderer/pages/toolbox/components/ToolForm';

const imageTool: ToolDef = {
  id: 'text-to-image',
  titleKey: 'toolbox.tools.textToImage.title',
  descKey: 'toolbox.tools.textToImage.desc',
  icon: 'Picture',
  category: 'image',
  output: 'image',
  requires: 'image-model',
  source: 'builtin',
  fields: [],
  execution: {
    kind: 'mcp',
    mcpTool: 'aionui_image_generation',
    promptTemplate: '{{prompt}}',
  },
};

describe('ToolForm LAN image model behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
  });

  it('does not mutate image model settings from a WebUI/LAN browser run', async () => {
    const onRun = vi.fn();
    render(<ToolForm tool={imageTool} agents={[]} running={false} onRun={onRun} />);

    const button = screen.getByText('toolbox.generate').closest('button');
    expect(button).not.toBeNull();
    fireEvent.click(button!);

    await waitFor(() => expect(onRun).toHaveBeenCalledWith(imageTool, null, {}));
    expect(mocks.applyImageModelSelection).not.toHaveBeenCalled();
  });
});
