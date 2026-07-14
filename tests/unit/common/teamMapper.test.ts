import { describe, expect, it } from 'vitest';
import { fromBackendAgent, toBackendAgent } from '@/common/adapter/teamMapper';
import type { TeamAgent } from '@/common/types/team/teamTypes';

const frontendAgent: Omit<TeamAgent, 'slot_id' | 'conversation_id'> = {
  role: 'leader',
  agent_type: 'claude',
  agent_name: 'Lead',
  conversation_type: 'acp',
  status: 'pending',
  model: 'default',
  custom_agent_id: 'bare:claude',
};

describe('teamMapper Core v0.2.2 contract', () => {
  it('maps the frontend assistant identity to assistant_id without legacy backend fields', () => {
    expect(toBackendAgent(frontendAgent)).toEqual({
      name: 'Lead',
      role: 'lead',
      model: 'default',
      assistant_id: 'bare:claude',
    });
  });

  it('maps assistant_id responses back to the compatibility field used by the renderer', () => {
    expect(
      fromBackendAgent({
        slot_id: 'slot-1',
        conversation_id: 'conversation-1',
        role: 'lead',
        backend: 'claude',
        model: 'default',
        name: 'Lead',
        status: 'idle',
        assistant_id: 'bare:claude',
      }).custom_agent_id
    ).toBe('bare:claude');
  });

  it('rejects requests that have no assistant identity', () => {
    expect(() => toBackendAgent({ ...frontendAgent, custom_agent_id: undefined })).toThrow(
      'Team agent assistant_id is required'
    );
  });
});
