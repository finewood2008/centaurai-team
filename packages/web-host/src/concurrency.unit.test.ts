import { describe, expect, it, vi } from 'vitest';
import { AdmissionController, classifyRequest, getConcurrencyProfile } from './concurrency.js';

describe('request classifier', () => {
  it('classifies expensive WebHost routes', () => {
    expect(classifyRequest('POST', '/api/conversations/conv-1/messages')).toMatchObject({
      kind: 'agent_run',
      conversationId: 'conv-1',
    });
    expect(classifyRequest('POST', '/api/teams/team-1/messages')).toMatchObject({ kind: 'team_run', units: 3 });
    expect(classifyRequest('POST', '/api/teams/team-1/agents/slot-1/messages')).toMatchObject({
      kind: 'team_agent_run',
      units: 1,
    });
    expect(classifyRequest('POST', '/api/vector-search')).toMatchObject({ kind: 'vector_search' });
    expect(classifyRequest('GET', '/api/vector-image?path=x')).toMatchObject({ kind: 'vector_image' });
    expect(classifyRequest('GET', '/api/nas/list')).toMatchObject({ kind: 'nas_list' });
    expect(classifyRequest('POST', '/api/nas/upload')).toMatchObject({ kind: 'file_upload' });
    expect(classifyRequest('GET', '/assets/main.js')).toBeNull();
  });
});

describe('AdmissionController', () => {
  it('rejects new expensive work when memory pressure is hard', async () => {
    const controller = new AdmissionController({
      profile: 'team-32g',
      memory: { getUsedRatio: () => 0.91 },
    });

    await expect(
      controller.acquire({
        kind: 'agent_run',
        units: 1,
        userId: 'user-1',
        conversationId: 'conv-1',
      })
    ).rejects.toMatchObject({
      code: 'MEMORY_PRESSURE',
      details: { reason: 'memory_pressure_hard' },
    });
  });

  it('queues run work instead of starting it while memory pressure is soft', async () => {
    let usedRatio = 0.5;
    const controller = new AdmissionController({
      profile: 'team-32g',
      overrides: { activeRunUnits: 2 },
      memory: { getUsedRatio: () => usedRatio },
    });
    const active = await controller.acquire({
      kind: 'agent_run',
      units: 1,
      userId: 'active-user',
      conversationId: 'active-conv',
    });

    usedRatio = 0.85;
    const queued = controller.acquire({
      kind: 'agent_run',
      units: 1,
      userId: 'queued-user',
      conversationId: 'queued-conv',
    });

    await vi.waitFor(() => {
      expect(controller.getStatus().queues.total).toBe(1);
    });
    expect(controller.getStatus().activeRunUnits).toBe(1);

    usedRatio = 0.5;
    active.release();
    await expect(queued).resolves.toMatchObject({ queued: true });
  });

  it('starts memory-queued work after pressure clears even without an active release', async () => {
    vi.useFakeTimers();
    let usedRatio = 0.85;
    const controller = new AdmissionController({
      profile: 'team-32g',
      memory: {
        getUsedRatio: () => usedRatio,
        queueDrainIntervalMs: 50,
      },
    });

    const queued = controller.acquire({
      kind: 'agent_run',
      units: 1,
      userId: 'queued-user',
      conversationId: 'queued-conv',
    });

    await vi.waitFor(() => {
      expect(controller.getStatus().queues.total).toBe(1);
    });
    usedRatio = 0.5;
    await vi.advanceTimersByTimeAsync(50);

    await expect(queued).resolves.toMatchObject({ queued: true });
    vi.useRealTimers();
  });

  it('keeps per-user limits while soft memory pressure would otherwise queue work', async () => {
    let usedRatio = 0.5;
    const controller = new AdmissionController({
      profile: 'team-32g',
      memory: { getUsedRatio: () => usedRatio },
    });
    const active = await controller.acquire({
      kind: 'agent_run',
      units: 1,
      userId: 'same-user',
      conversationId: 'conv-1',
    });

    usedRatio = 0.85;
    await expect(
      controller.acquire({
        kind: 'agent_run',
        units: 1,
        userId: 'same-user',
        conversationId: 'conv-2',
      })
    ).rejects.toMatchObject({ code: 'PER_USER_LIMIT' });

    active.release();
  });

  it('enforces team-32g active run limit and starts queued work FIFO', async () => {
    vi.useFakeTimers();
    const controller = new AdmissionController({ profile: 'team-32g' });
    const active = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        controller.acquire({
          kind: 'agent_run',
          units: 1,
          userId: `user-${i}`,
          conversationId: `conv-${i}`,
        })
      )
    );

    const queued = controller.acquire({
      kind: 'agent_run',
      units: 1,
      userId: 'user-4',
      conversationId: 'conv-4',
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getStatus().queues.agent_run.length).toBe(1);

    active[0].release();
    await vi.advanceTimersByTimeAsync(0);
    const ticket = await queued;
    expect(ticket.queued).toBe(true);
    expect(controller.getStatus().active.agent_run).toBe(4);

    active.slice(1).forEach((t) => t.release());
    ticket.release();
    vi.useRealTimers();
  });

  it('returns QUEUE_FULL when saturated run work already filled the queue', async () => {
    const controller = new AdmissionController({
      profile: 'team-32g',
      overrides: { activeRunUnits: 1, queueLimit: 1 },
    });
    const active = await controller.acquire({
      kind: 'agent_run',
      units: 1,
      userId: 'active-user',
      conversationId: 'active-conv',
    });

    void controller.acquire({
      kind: 'agent_run',
      units: 1,
      userId: 'queued-user',
      conversationId: 'queued-conv',
    });

    await expect(
      controller.acquire({
        kind: 'agent_run',
        units: 1,
        userId: 'overflow-user',
        conversationId: 'overflow-conv',
      })
    ).rejects.toMatchObject({ code: 'QUEUE_FULL', details: { reason: 'queue_full' } });

    active.release();
  });

  it('rejects duplicate active or queued work per user', async () => {
    const controller = new AdmissionController({ profile: 'team-32g' });
    const ticket = await controller.acquire({
      kind: 'agent_run',
      units: 1,
      userId: 'same-user',
      conversationId: 'conv-1',
    });

    await expect(
      controller.acquire({
        kind: 'agent_run',
        units: 1,
        userId: 'same-user',
        conversationId: 'conv-2',
      })
    ).rejects.toMatchObject({ code: 'PER_USER_LIMIT' });

    ticket.release();
  });

  it('rejects non-queueable expensive requests when the class limit is saturated', async () => {
    const controller = new AdmissionController({ profile: 'team-32g' });
    const tickets = await Promise.all(
      Array.from({ length: getConcurrencyProfile('team-32g').limits.vectorSearch }, (_, i) =>
        controller.acquire({
          kind: 'vector_search',
          units: 1,
          userId: `user-${i}`,
        })
      )
    );

    await expect(
      controller.acquire({
        kind: 'vector_search',
        units: 1,
        userId: 'overflow',
      })
    ).rejects.toMatchObject({ code: 'DEVICE_BUSY', details: { reason: 'class_limit' } });

    tickets.forEach((ticket) => ticket.release());
  });
});
