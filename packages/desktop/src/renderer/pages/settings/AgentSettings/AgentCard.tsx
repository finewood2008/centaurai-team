/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Avatar, Button, Spin, Switch, Tag, Typography } from '@arco-design/web-react';
import { Delete, EditTwo, Refresh, Robot } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { getAgentDisplayName } from '@/renderer/utils/model/agentTypes';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';

type DetectedAgentData = {
  id: string;
  agent_type: string;
  backend?: string;
  icon?: string;
  name: string;
  custom_agent_id?: string;
  isExtension?: boolean;
  avatar?: string;
  enabled: boolean;
  available: boolean;
  installed?: boolean;
  management_status?: 'online' | 'unchecked' | 'missing' | 'offline';
  last_check_status?: 'online' | 'offline';
  last_check_error_code?: string;
  last_check_error_message?: string;
  last_check_guidance?: string;
  last_check_at?: number;
};

/** Minimal custom-agent fields consumed by the 'custom' card variant. */
type CustomAgentCardData = {
  id: string;
  name: string;
  icon?: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  available: boolean;
};

type AgentCardProps =
  | {
      type: 'detected';
      agent: DetectedAgentData;
      isChecking?: boolean;
      isLaunching?: boolean;
      onGoToChat: () => void;
      onToggle?: (enabled: boolean) => void;
      onRetryCheck?: () => void;
    }
  | {
      type: 'custom';
      agent: CustomAgentCardData;
      isChecking?: boolean;
      isLaunching?: undefined;
      onGoToChat: () => void;
      onEdit: () => void;
      onDelete: () => void;
      onToggle: (enabled: boolean) => void;
      onRetryCheck?: undefined;
    };

function statusBadge(
  agent: DetectedAgentData,
  isChecking: boolean,
  _t: (key: string, opts?: Record<string, unknown>) => string
): { color: string; text: string; showRetry: boolean } {
  if (isChecking) return { color: 'blue', text: '检测中', showRetry: false };
  if (agent.installed === false) return { color: 'gray', text: '未安装', showRetry: true };
  if (agent.management_status === 'online') return { color: 'green', text: '可用', showRetry: false };
  if (agent.management_status === 'missing' || agent.management_status === 'offline')
    return { color: 'red', text: '不可用', showRetry: true };
  if (agent.last_check_status === 'offline') return { color: 'red', text: '不可用', showRetry: true };
  return { color: 'orange', text: '待检测', showRetry: true };
}

const AgentCard: React.FC<AgentCardProps> = (props) => {
  const { t } = useTranslation();
  const goToChatButtonClassName = '!w-full !justify-center !rounded-10px !text-12px';

  if (props.type === 'detected') {
    const { agent, isChecking = false, isLaunching = false, onGoToChat, onToggle, onRetryCheck } = props;
    const displayName = getAgentDisplayName(agent);
    const canStartChat = agent.enabled !== false && agent.available !== false && !isLaunching;
    const badge = statusBadge(agent, isChecking, t);
    const extensionAvatar = resolveExtensionAssetUrl(agent.isExtension ? agent.avatar : undefined);
    const logo =
      extensionAvatar ||
      resolveAgentLogo({
        icon: agent.icon,
        backend: agent.backend || agent.agent_type,
        custom_agent_id: agent.custom_agent_id,
        isExtension: agent.isExtension,
      });

    return (
      <div className='flex min-h-[190px] flex-col rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-12px transition-colors hover:border-[var(--color-border-3)]'>
        {/* Status badge */}
        <div className='flex items-center gap-4px mb-6px'>
          {isChecking ? (
            <Spin size={12} className='text-10px' />
          ) : (
            <Tag size='small' color={badge.color} className='!text-10px !leading-16px !px-4px !py-0'>
              {badge.text}
            </Tag>
          )}
          {badge.showRetry && onRetryCheck && (
            <Button
              size='mini'
              type='text'
              icon={<Refresh theme='outline' size='12' />}
              onClick={(e) => {
                e.stopPropagation();
                onRetryCheck();
              }}
              className='!p-0 !text-10px !h-16px'
            />
          )}
        </div>

        <div className='mb-10px flex justify-center'>
          <Avatar size={40} shape='square' style={{ flexShrink: 0, backgroundColor: 'transparent' }}>
            {logo ? <img src={logo} alt={agent.name} className='h-full w-full object-contain' /> : '🤖'}
          </Avatar>
        </div>

        <div className='mb-8px flex-1 text-center'>
          <Typography.Text className='block text-13px font-medium leading-18px line-clamp-2'>
            {displayName}
          </Typography.Text>
          <Typography.Text className='mt-2px block text-11px text-t-secondary'>
            {t('settings.agentManagement.detected')}
          </Typography.Text>
        </div>

        {/* Failure reason */}
        {!isChecking && agent.last_check_error_message && (
          <div className='mb-8px px-2px'>
            <Typography.Text className='block text-11px text-[var(--color-danger-light)] line-clamp-2'>
              {agent.last_check_error_message}
            </Typography.Text>
            {agent.last_check_guidance && (
              <Typography.Text className='block text-10px text-t-tertiary line-clamp-2 mt-2px'>
                {agent.last_check_guidance}
              </Typography.Text>
            )}
          </div>
        )}

        <div className='flex flex-col gap-6px'>
          {onToggle && (
            <div className='flex items-center justify-center gap-6px'>
              <Switch size='small' checked={agent.enabled !== false} onChange={onToggle} />
              <Typography.Text className='text-11px text-t-tertiary'>
                {agent.enabled === false
                  ? t('common.disable', { defaultValue: '已禁用' })
                  : badge.text === '可用'
                    ? t('common.enable', { defaultValue: '已启用' })
                    : badge.text}
              </Typography.Text>
            </div>
          )}
          <Button
            size='small'
            type='secondary'
            onClick={onGoToChat}
            disabled={!canStartChat}
            loading={isLaunching}
            className={goToChatButtonClassName}
          >
            {isLaunching ? '检测中...' : t('settings.agentManagement.goToChat')}
          </Button>
        </div>
      </div>
    );
  }

  const { agent, onGoToChat, onEdit, onDelete, onToggle } = props;

  return (
    <div className='flex items-center justify-between px-16px py-10px rd-8px bg-aou-1 hover:bg-aou-2'>
      <div className='flex items-center gap-12px min-w-0 flex-1'>
        <Avatar
          size={32}
          shape='square'
          style={{ flexShrink: 0, backgroundColor: agent.icon ? 'var(--color-fill-2)' : 'transparent', fontSize: 18 }}
        >
          {agent.icon || <Robot theme='outline' size='20' />}
        </Avatar>
        <div className='min-w-0 flex-1'>
          <Typography.Text className='font-medium text-14px'>{agent.name || 'Custom Agent'}</Typography.Text>
          <div className='text-12px text-t-secondary truncate'>
            {agent.command}
            {agent.args && agent.args.length > 0 ? ` ${agent.args.join(' ')}` : ''}
          </div>
        </div>
      </div>
      <div className='flex items-center gap-8px'>
        <Switch size='small' checked={agent.enabled !== false} onChange={onToggle} />
        <Button
          size='small'
          type='text'
          onClick={onGoToChat}
          disabled={agent.enabled === false || agent.available === false}
        >
          {t('settings.agentManagement.goToChat')}
        </Button>
        <Button size='small' type='text' icon={<EditTwo theme='outline' size='14' />} onClick={onEdit} />
        <Button
          size='small'
          type='text'
          status='danger'
          icon={<Delete theme='outline' size='14' />}
          onClick={onDelete}
        />
      </div>
    </div>
  );
};

export default AgentCard;
