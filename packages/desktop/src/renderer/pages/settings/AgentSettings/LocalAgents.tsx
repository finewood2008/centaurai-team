/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import { DETECTED_AGENTS_SWR_KEY, fetchDetectedAgents } from '@/renderer/utils/model/agentTypes';
import AionModal from '@/renderer/components/base/AionModal';
import { Button, Typography } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import AgentCard from './AgentCard';
import InlineAgentEditor, { type CustomAgentDraft } from './InlineAgentEditor';
import { getAgentKey } from '@/renderer/pages/guid/hooks/agentSelectionUtils';

/** Local storage key for caching full agent metadata (including disabled agents). */
const AGENT_CACHE_KEY = 'centaurai.agents.cache';

function loadCachedAgents(): AgentMetadata[] {
  try {
    const raw = localStorage.getItem(AGENT_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCachedAgents(agents: AgentMetadata[]): void {
  try {
    localStorage.setItem(AGENT_CACHE_KEY, JSON.stringify(agents));
  } catch { /* storage full - silent */ }
}

const LocalAgents: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Fetch detected agents (enabled+available only). Disabled agents come from local cache.
  const { data: apiAgents = [], mutate: mutateApi } = useSWR<AgentMetadata[]>(
    DETECTED_AGENTS_SWR_KEY,
    fetchDetectedAgents
  );

  // On first mount, populate cache from DB so ALL agents (even disabled ones) are known
  React.useEffect(() => {
    const cached = loadCachedAgents();
    if (cached.length === 0) {
      ipcBridge.acpConversation.getAllAgentsFromDb.invoke().then((all) => {
        if (all && all.length > 0) {
          saveCachedAgents(all);
          mutateApi();
          mutate(DETECTED_AGENTS_SWR_KEY);
        }
      }).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge API agents with cached disabled agents
  const allAgents = React.useMemo(() => {
    const apiIds = new Set(apiAgents.map((a) => a.id));
    const cached = loadCachedAgents();
    // API agents always win (they have fresh enabled state)
    const merged = [...apiAgents];
    for (const cachedAgent of cached) {
      if (!apiIds.has(cachedAgent.id)) {
        // Agent is not in API response → it's disabled
        merged.push({ ...cachedAgent, enabled: false });
      }
    }
    // Save merged list for next time
    if (apiAgents.length > 0) {
      saveCachedAgents(merged);
    }
    return merged;
  }, [apiAgents]);

  const detectedAgents = allAgents.filter((a) => a.agent_type !== 'remote' && a.agent_source !== 'custom');

  const customAgents: AgentMetadata[] = allAgents.filter((a) => a.agent_source === 'custom');

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentMetadata | null>(null);

  const refreshAll = useCallback(async () => {
    await mutateApi();
    await mutate(DETECTED_AGENTS_SWR_KEY);
    await mutate('agents.detected.all');
  }, [mutateApi]);

  const handleSaveCustomAgent = useCallback(
    async (draft: CustomAgentDraft) => {
      const body = {
        name: draft.name,
        command: draft.command,
        icon: draft.icon,
        args: draft.args,
        env: draft.env,
        advanced: draft.advanced,
      };
      try {
        if (editingAgent) {
          await ipcBridge.acpConversation.updateCustomAgent.invoke({ id: editingAgent.id, ...body });
        } else {
          await ipcBridge.acpConversation.createCustomAgent.invoke(body);
        }
        await refreshAll();
        setEditorVisible(false);
        setEditingAgent(null);
      } catch (err) {
        console.error('save custom agent failed:', err);
      }
    },
    [editingAgent, refreshAll]
  );

  const handleDeleteCustomAgent = useCallback(
    async (agentId: string) => {
      try {
        await ipcBridge.acpConversation.deleteCustomAgent.invoke({ id: agentId });
        await refreshAll();
      } catch (err) {
        console.error('delete custom agent failed:', err);
      }
    },
    [refreshAll]
  );

  const handleToggleCustomAgent = useCallback(
    async (agentId: string, enabled: boolean) => {
      try {
        await ipcBridge.acpConversation.setAgentEnabled.invoke({ id: agentId, enabled });
        await refreshAll();
      } catch (err) {
        console.error('toggle custom agent failed:', err);
      }
    },
    [refreshAll]
  );

  const handleToggleDetectedAgent = useCallback(
    async (agentId: string, enabled: boolean) => {
      try {
        await ipcBridge.acpConversation.setAgentEnabled.invoke({ id: agentId, enabled });
        await refreshAll();
      } catch (err) {
        console.error('toggle detected agent failed:', err);
      }
    },
    [refreshAll]
  );

  // 直连模型 first among detected agents
  const aionrsAgent = detectedAgents?.find((a) => a.agent_type === 'aionrs' || a.backend === 'aionrs');
  const otherDetected = detectedAgents?.filter((a) => a.agent_type !== 'aionrs' && a.backend !== 'aionrs') ?? [];

  const openCustomAgentEditor = useCallback(() => {
    setEditingAgent(null);
    setEditorVisible(true);
  }, []);

  const goToChatWithAgent = useCallback(
    (agent: AgentMetadata) => {
      navigate('/guid', { state: { selectedAgentKey: getAgentKey(agent) } });
    },
    [navigate]
  );

  return (
    <div className='flex flex-col gap-8px py-16px'>
      <div className='px-16px text-12px text-t-secondary'>
        <span>{t('settings.agentManagement.localAgentsDescription')} </span>
        <Button
          type='text'
          size='mini'
          className='!h-auto !p-0 !align-baseline !text-12px !font-normal !text-primary-6 hover:!text-primary-7 hover:!underline underline-offset-2'
          onClick={openCustomAgentEditor}
        >
          {t('settings.agentManagement.detectCustomAgent')}
        </Button>
      </div>

      {/* Detected Agents section */}
      <div className='px-16px mt-8px'>
        <Typography.Text className='text-12px font-medium text-t-secondary mb-4px block'>
          {t('settings.agentManagement.detected')}
        </Typography.Text>
      </div>
      <div className='grid grid-cols-2 gap-10px px-16px md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
        {aionrsAgent && (
          <AgentCard
            type='detected'
            agent={aionrsAgent}
            onGoToChat={() => goToChatWithAgent(aionrsAgent)}
            onToggle={(enabled) => void handleToggleDetectedAgent(aionrsAgent.id, enabled)}
          />
        )}
        {otherDetected.map((agent) => (
          <AgentCard
            key={agent.backend || agent.agent_type}
            type='detected'
            agent={agent}
            onGoToChat={() => goToChatWithAgent(agent)}
            onToggle={(enabled) => void handleToggleDetectedAgent(agent.id, enabled)}
          />
        ))}
      </div>
      {(!detectedAgents || detectedAgents.length === 0) && (
        <Typography.Text type='secondary' className='block px-16px py-16px text-center text-12px'>
          {t('settings.agentManagement.localAgentsEmpty')}
        </Typography.Text>
      )}

      {/* Custom Agents section */}
      {(editorVisible || (customAgents && customAgents.length > 0)) && (
        <div className='px-16px mt-16px'>
          <Typography.Text className='text-12px font-medium text-t-secondary mb-4px block'>
            {t('settings.agentManagement.customAgents', { defaultValue: 'Custom Agents' })}
          </Typography.Text>
        </div>
      )}

      <AionModal
        visible={editorVisible}
        onCancel={() => {
          setEditorVisible(false);
          setEditingAgent(null);
        }}
        header={{
          title: editingAgent
            ? t('settings.agentManagement.editCustomAgent')
            : t('settings.agentManagement.detectCustomAgent'),
          showClose: true,
        }}
        footer={null}
        style={{ maxWidth: '92vw', borderRadius: 16 }}
        contentStyle={{
          background: 'var(--dialog-fill-0)',
          borderRadius: 16,
          padding: '20px 24px 16px',
          overflow: 'auto',
        }}
      >
        {editorVisible && (
          <InlineAgentEditor
            key={editingAgent?.id ?? 'new'}
            agent={editingAgent}
            onSave={(agent) => void handleSaveCustomAgent(agent)}
            onCancel={() => {
              setEditorVisible(false);
              setEditingAgent(null);
            }}
          />
        )}
      </AionModal>

      <div className='flex flex-col gap-4px px-0'>
        {customAgents?.map((agent) => (
          <AgentCard
            key={agent.id}
            type='custom'
            agent={agent}
            onGoToChat={() => goToChatWithAgent(agent)}
            onEdit={() => {
              setEditingAgent(agent);
              setEditorVisible(true);
            }}
            onDelete={() => void handleDeleteCustomAgent(agent.id)}
            onToggle={(enabled) => void handleToggleCustomAgent(agent.id, enabled)}
          />
        ))}
      </div>
    </div>
  );
};

export default LocalAgents;
