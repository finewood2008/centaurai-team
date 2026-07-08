import { describe, expect, it } from 'vitest';
import { parseLoadOptions, runLoadTest, summarizeLoadResults } from '../../load/webhost-concurrency-load.js';

describe('webhost concurrency load helpers', () => {
  it('parses load-test options with stable defaults and overrides', () => {
    expect(
      parseLoadOptions([
        '--profile',
        'team-64g',
        '--users',
        '40',
        '--duration-ms',
        '1000',
        '--run-delay-ms',
        '200',
        '--repeat-clicks',
        '3',
        '--queue-limit',
        '10',
        '--report',
        '/tmp/report.json',
      ])
    ).toMatchObject({
      profile: 'team-64g',
      users: 40,
      durationMs: 1000,
      runDelayMs: 200,
      repeatClicks: 3,
      queueLimit: 10,
      reportPath: '/tmp/report.json',
    });
  });

  it('summarizes status/code counts and fails when active runs exceed the profile limit', () => {
    const summary = summarizeLoadResults({
      expectedActiveRunLimit: 4,
      expectedQueueLimit: 30,
      maxActiveRunUnits: 5,
      maxQueuedRuns: 8,
      results: [{ status: 200 }, { status: 429, code: 'DEVICE_BUSY' }, { status: 429, code: 'PER_USER_LIMIT' }],
    });

    expect(summary.statusCounts).toEqual({ '200': 1, '429': 2 });
    expect(summary.codeCounts).toEqual({ DEVICE_BUSY: 1, PER_USER_LIMIT: 1 });
    expect(summary.ok).toBe(false);
    expect(summary.failures).toContain('active_run_limit_exceeded');
  });

  it('fails when queue length exceeds the expected queue limit', () => {
    const summary = summarizeLoadResults({
      expectedActiveRunLimit: 4,
      expectedQueueLimit: 1,
      maxActiveRunUnits: 4,
      maxQueuedRuns: 2,
      results: [{ status: 200 }],
    });

    expect(summary.ok).toBe(false);
    expect(summary.failures).toContain('queue_limit_exceeded');
  });

  it('runs a short mock-backend load test without exceeding the active run limit', async () => {
    const summary = await runLoadTest({
      profile: 'team-32g',
      users: 8,
      durationMs: 50,
      runDelayMs: 20,
      repeatClicks: 1,
      pollMs: 5,
    });

    expect(summary.ok).toBe(true);
    expect(summary.totalRequests).toBe(8);
    expect(summary.maxActiveRunUnits).toBeLessThanOrEqual(4);
  });

  it('can simulate repeated user clicks and records admission rejections', async () => {
    const summary = await runLoadTest({
      profile: 'team-32g',
      users: 2,
      durationMs: 50,
      runDelayMs: 30,
      repeatClicks: 2,
      pollMs: 5,
    });

    expect(summary.totalRequests).toBe(4);
    expect(summary.codeCounts.PER_USER_LIMIT ?? 0).toBeGreaterThan(0);
  });
});
