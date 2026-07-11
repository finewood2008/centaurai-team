import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid='markdown-root'>{children}</div>,
}));

vi.mock('@/renderer/components/Markdown/CodeBlock', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <code>{children}</code>,
}));

vi.mock('@/renderer/utils/platform', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/renderer/utils/chat/latexDelimiters', () => ({ convertLatexDelimiters: (value: string) => value }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import MarkdownView from '@/renderer/components/Markdown';

describe('MarkdownView remote-content boundary', () => {
  it('renders Markdown but never interprets raw HTML elements', () => {
    const { container } = render(
      <MarkdownView>{`# Release notes

<iframe src="file:///etc/passwd"></iframe>
<object data="https://attacker.example/payload"></object>
<script>globalThis.pwned = true</script>`}</MarkdownView>
    );

    expect(screen.getByRole('heading', { name: 'Release notes' })).toBeInTheDocument();
    expect(container.querySelector('iframe, object, embed, script')).toBeNull();
  });
});
