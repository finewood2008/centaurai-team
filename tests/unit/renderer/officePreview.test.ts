import { describe, expect, it, vi } from 'vitest';
import {
  getOfficePreviewContentType,
  isOfficePreviewFile,
  openOfficePreviewForFile,
} from '@/renderer/utils/file/officePreview';

describe('officePreview helpers', () => {
  it('maps Office file names to preview content types', () => {
    expect(getOfficePreviewContentType('slides.pptx')).toBe('ppt');
    expect(getOfficePreviewContentType('report.docx')).toBe('word');
    expect(getOfficePreviewContentType('预算.xlsx')).toBe('excel');
    expect(getOfficePreviewContentType('notes.md')).toBeNull();
  });

  it('detects Office preview files', () => {
    expect(isOfficePreviewFile('/srv/work/output.ppt')).toBe(true);
    expect(isOfficePreviewFile('/srv/work/data.csv')).toBe(true);
    expect(isOfficePreviewFile('/srv/work/image.png')).toBe(false);
  });

  it('opens Office files through the preview panel with path metadata', () => {
    const openPreview = vi.fn();

    const opened = openOfficePreviewForFile(openPreview, {
      path: '/srv/work/方案.pptx',
      name: '方案.pptx',
      workspace: '/srv/work',
    });

    expect(opened).toBe(true);
    expect(openPreview).toHaveBeenCalledWith(
      '',
      'ppt',
      {
        title: '方案.pptx',
        file_name: '方案.pptx',
        file_path: '/srv/work/方案.pptx',
        workspace: '/srv/work',
        editable: false,
      },
      { replace: true }
    );
  });

  it('returns false for non-Office files without opening preview', () => {
    const openPreview = vi.fn();

    expect(openOfficePreviewForFile(openPreview, { path: '/srv/work/image.png', name: 'image.png' })).toBe(false);
    expect(openPreview).not.toHaveBeenCalled();
  });
});
