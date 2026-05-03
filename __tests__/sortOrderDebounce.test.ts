/**
 * `scheduleSyncUpdate` merges into `savedUpdatedIds` immediately and sets `isChanged`.
 * An effect on `[isChanged, notesFeed]` arms an 800ms timer before `reorderCallback` (POST).
 */

import { describe, expect, it, vi } from 'vitest';

describe('debounce / timer interaction (model)', () => {
  it('800ms reorder timer coalesces when cleared and rescheduled like the isChanged effect', () => {
    vi.useFakeTimers();
    let fires = 0;
    let reorderTimeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleReorder = () => {
      if (reorderTimeout) clearTimeout(reorderTimeout);
      reorderTimeout = setTimeout(() => {
        fires += 1;
        reorderTimeout = null;
      }, 800);
    };
    scheduleReorder();
    vi.advanceTimersByTime(400);
    scheduleReorder();
    vi.advanceTimersByTime(800);
    expect(fires).toBe(1);
    vi.useRealTimers();
  });

  it('independent 1s and 800ms timers: which runs first depends on start offsets', () => {
    vi.useFakeTimers();
    const log: string[] = [];
    setTimeout(() => log.push('1s'), 1000);
    setTimeout(() => log.push('800ms'), 800);
    vi.advanceTimersByTime(900);
    expect(log).toEqual(['800ms']);
    vi.advanceTimersByTime(200);
    expect(log).toEqual(['800ms', '1s']);
    vi.useRealTimers();
  });

  it('immediate merge pattern: each schedule flushes pending into saved', () => {
    let saved: string[] = [];
    let pending: string[] = [];

    const schedule = () => {
      saved = Array.from(new Set([...saved, ...pending]));
      pending = [];
    };

    pending.push('a');
    schedule();
    pending.push('b');
    schedule();
    expect(saved.sort()).toEqual(['a', 'b']);
  });
});
