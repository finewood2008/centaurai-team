/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import { DETECTED_AGENTS_SWR_KEY, fetchManagedAgents, MANAGED_AGENTS_SWR_KEY } from '@/renderer/utils/model/agentTypes';
import AionModal from '@/renderer/components/base/AionModal';
import { Button, Spin, Typography } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import AgentCard from './AgentCard';
import InlineAgentEditor, { type CustomAgentDraft } from './InlineAgentEditor';
import { getAgentKey } from '@/renderer/pages/guid/hooks/agentSelectionUtils';

/** Agent health check status derived from backend fields. */
type AgentHealthGroup = 'available' | 'installed_unavailable' | 'not_installed' | 'checking' | 'unchecked';

function getHealthGroup(agent: AgentMetadata, isChecking: boolean): AgentHealthGroup {
  if (isChecking) return 'checking';
  if (agent.installed === false) return 'not_installed';
  if (agent.installed === true && agent.management_status === 'online') return 'available';
  if (agent.installed === true && (agent.management_status === 'missing' || agent.management_status === 'offline'))
    return 'installed_unavailable';
  return 'unchecked';
}

const GROUP_LABELS: Record<AgentHealthGroup, string> = {
  available: '已安装且可用',
  installed_unavailable: '已安装但不可用',
  not_installed: '未安装',
  checking: '检测中',
  unchecked: '待检测',
};

const LocalAgents: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [checkAllRunning, setCheckAllRunning] = useState(false);
  const autoCheckedRef = useRef(false);

  const { data: allAgents = [], mutate: mutateManaged } = useSWR<AgentMetadata[]>(
    MANAGED_AGENTS_SWR_KEY,
    fetchManagedAgents
  );

  const detectedAgents = allAgents.filter((a) => a.agent_type !== 'remote' && a.agent_source !== 'custom');
  const customAgents: AgentMetadata[] = allAgents.filter((a) => a.agent_source === 'custom');

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentMetadata | null>(null);

  const refreshAll = useCallback(async () => {
    await Promise.all([mutateManaged(), mutate(DETECTED_AGENTS_SWR_KEY), mutate('agents.detected.all')]);
  }, [mutateManaged]);

  /** Check a single agent's health via backend API. */
  const checkAgent = useCallback(
    async (agentId: string): Promise<void> => {
      setCheckingIds((prev) => new Set(prev).add(agentId));
      try {
        await ipcBridge.acpConversation.checkAgentHealth.invoke({ id: agentId });
        await refreshAll();
      } catch {
        // health check failure is reflected in the management row
        await refreshAll();
      } finally {
        setCheckingIds((prev) => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
      }
    },
    [refreshAll]
  );

  /** Check all detected (non-remote, non-custom) agents. */
  const checkAllAgents = useCallback(async () => {
    setCheckAllRunning(true);
    const ids = detectedAgents.map((a) => a.id);
    setCheckingIds(new Set(ids));
    try {
      // Fire all checks concurrently
      await Promise.allSettled(ids.map((id) => ipcBridge.acpConversation.checkAgentHealth.invoke({ id })));
      await refreshAll();
    } finally {
      setCheckingIds(new Set());
      setCheckAllRunning(false);
    }
  }, [detectedAgents, refreshAll]);

  // Auto-detect on first mount (once)
  useEffect(() => {
    if (autoCheckedRef.current || detectedAgents.length === 0) return;
    autoCheckedRef.current = true;
    void checkAllAgents();
  }, [detectedAgents.length]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const [launchGateAgentId, setLaunchGateAgentId] = useState<string | null>(null);
  const [launchGateError, setLaunchGateError] = useState<string | null>(null);

  const goToChatWithAgent = useCallback(
    async (agent: AgentMetadata) => {
      // Pre-launch gate: always run real-time health check
      setLaunchGateAgentId(agent.id);
      setLaunchGateError(null);
      try {
        await ipcBridge.acpConversation.checkAgentHealth.invoke({ id: agent.id });
        await refreshAll();
        // After refresh, check if agent is now available
        const refreshed = await ipcBridge.acpConversation.getManagedAgents.invoke();
        const updated = Array.isArray(refreshed) ? refreshed.find((a: AgentMetadata) => a.id === agent.id) : null;
        if (updated && updated.available) {
          navigate('/guid', { state: { selectedAgentKey: getAgentKey(agent) } });
        } else {
          setLaunchGateError(updated?.last_check_error_message || 'Agent 不可用，请先安装或修复配置');
        }
      } catch {
        setLaunchGateError('健康检查失败，请重试');
        await refreshAll();
      } finally {
        setLaunchGateAgentId(null);
      }
    },
    [navigate, refreshAll]
  );

  const openCustomAgentEditor = useCallback(() => {
    setEditingAgent(null);
    setEditorVisible(true);
  }, []);

  // --- Group detected agents ---
  const groups = React.useMemo(() => {
    const result: Record<AgentHealthGroup, AgentMetadata[]> = {
      available: [],
      installed_unavailable: [],
      not_installed: [],
      checking: [],
      unchecked: [],
    };
    for (const agent of detectedAgents) {
      const isChecking = checkingIds.has(agent.id);
      result[getHealthGroup(agent, isChecking)].push(agent);
    }
    return result;
  }, [detectedAgents, checkingIds]);

  const displayOrder: AgentHealthGroup[] = ['available', 'installed_unavailable', 'not_installed'];

  return (
    <div className='flex flex-col gap-8px py-16px'>
      {/* Header with re-detect button */}
      <div className='flex items-center justify-between px-16px'>
        <span className='text-12px text-t-secondary'>
          {t('settings.agentManagement.localAgentsDescription')}{' '}
          <Button
            type='text'
            size='mini'
            className='!h-auto !p-0 !align-baseline !text-12px !font-normal !text-primary-6 hover:!text-primary-7 hover:!underline underline-offset-2'
            onClick={openCustomAgentEditor}
          >
            {t('settings.agentManagement.detectCustomAgent')}
          </Button>
        </span>
        <Button
          size='small'
          type='text'
          icon={checkAllRunning ? <Spin size={14} /> : <Refresh theme='outline' size='14' />}
          onClick={checkAllAgents}
          disabled={checkAllRunning}
        >
          {checkAllRunning ? '检测中...' : '重新检测'}
        </Button>
      </div>

      {/* Launch gate error banner */}
      {launchGateError && (
        <div className='mx-16px px-12px py-8px rounded-8px bg-[var(--color-danger-light)] border border-[var(--color-danger-light)]'>
          <Typography.Text className='text-12px text-[var(--color-danger)]'>{launchGateError}</Typography.Text>
          <Button
            size='mini'
            type='text'
            className='!text-11px !text-t-secondary ml-8px'
            onClick={() => setLaunchGateError(null)}
          >
            关闭
          </Button>
        </div>
      )}

      {/* Grouped agent sections */}
      {displayOrder.map((group) => {
        const agents = groups[group];
        if (agents.length === 0) return null;
        return (
          <div key={group} className='mt-8px'>
            <div className='px-16px mb-4px'>
              <Typography.Text className='text-12px font-medium text-t-secondary'>
                {GROUP_LABELS[group]} ({agents.length})
              </Typography.Text>
            </div>
            <div className='grid grid-cols-2 gap-10px px-16px md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
              {agents.map((agent) => (
                <AgentCard
                  key={agent.backend || agent.agent_type}
                  type='detected'
                  agent={agent}
                  isChecking={checkingIds.has(agent.id)}
                  isLaunching={launchGateAgentId === agent.id}
                  onGoToChat={() => void goToChatWithAgent(agent)}
                  onToggle={(enabled) => void handleToggleDetectedAgent(agent.id, enabled)}
                  onRetryCheck={() => void checkAgent(agent.id)}
                />
              ))}
            </div>
          </div>
        );
      })}

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
