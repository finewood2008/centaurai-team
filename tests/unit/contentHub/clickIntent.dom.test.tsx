import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SINGLE_CLICK_DELAY_MS, useSingleDoubleClick } from '@/renderer/pages/contentHub/components/view/clickIntent';

afterEach(() => {
  vi.useRealTimers();
});

describe('useSingleDoubleClick', () => {
  it('delays a single click before opening preview', () => {
    vi.useFakeTimers();
    const openPreview = vi.fn();
    const directOpen = vi.fn();
    const { result } = renderHook(() => useSingleDoubleClick(openPreview, directOpen));

    act(() => {
      result.current.handleClick('report.pdf');
    });

    expect(openPreview).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SINGLE_CLICK_DELAY_MS - 1);
    });
    expect(openPreview).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(openPreview).toHaveBeenCalledTimes(1);
    expect(openPreview).toHaveBeenCalledWith('report.pdf');
    expect(directOpen).not.toHaveBeenCalled();
  });

  it('cancels pending preview when a double click opens the file directly', () => {
    vi.useFakeTimers();
    const openPreview = vi.fn();
    const directOpen = vi.fn();
    const { result } = renderHook(() => useSingleDoubleClick(openPreview, directOpen));

    act(() => {
      result.current.handleClick('report.pdf');
      result.current.handleClick('report.pdf');
      result.current.handleDoubleClick('report.pdf');
    });

    expect(directOpen).toHaveBeenCalledTimes(1);
    expect(directOpen).toHaveBeenCalledWith('report.pdf');
    expect(openPreview).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });
    expect(openPreview).not.toHaveBeenCalled();
  });

  it('falls back to single-click behavior when no double-click handler is provided', () => {
    vi.useFakeTimers();
    const openPreview = vi.fn();
    const { result } = renderHook(() => useSingleDoubleClick(openPreview));

    act(() => {
      result.current.handleClick('report.pdf');
      result.current.handleDoubleClick('report.pdf');
    });

    expect(openPreview).toHaveBeenCalledTimes(1);
    expect(openPreview).toHaveBeenCalledWith('report.pdf');

    act(() => {
      vi.runAllTimers();
    });
    expect(openPreview).toHaveBeenCalledTimes(1);
  });
});
