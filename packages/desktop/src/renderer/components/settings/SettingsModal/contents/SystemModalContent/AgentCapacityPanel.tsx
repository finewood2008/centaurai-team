import { BackendHttpError, httpRequest } from '@/common/adapter/httpBridge';
import { Alert, Button, InputNumber, Radio, Spin, Tag } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

type SchedulerMode = 'off' | 'shadow' | 'enforce';

type RuntimePolicy = {
  mode: SchedulerMode;
  global_active_limit: number;
  per_user_active_limit: number;
  per_user_queue_limit: number;
  global_queue_limit: number;
  queue_timeout_ms: number;
  confirmation_timeout_ms: number;
  resident_task_limit: number;
  resident_idle_timeout_ms: number;
  memory_constrained_percent: number;
  memory_pause_percent: number;
  memory_reject_percent: number;
};

type RuntimeStatus = {
  memory_used_percent?: number;
  memory_state: 'normal' | 'constrained' | 'paused' | 'rejecting';
  configured_active_limit: number;
  effective_active_limit: number;
  active_count: number;
  queued_count: number;
  resident_task_count: number;
};

const getPolicy = () => httpRequest<RuntimePolicy>('GET', '/api/admin/agent-runtime-policy');
const getStatus = () => httpRequest<RuntimeStatus>('GET', '/api/admin/agent-runtime-status');

const asNumber = (value: number | string | null | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Administrator-only controls for the persistent agent scheduler. */
const AgentCapacityPanel: React.FC = () => {
  const { data: policy, error: policyError, mutate: refreshPolicy } = useSWR('agent-runtime-policy', getPolicy);
  const {
    data: status,
    error: statusError,
    mutate: refreshStatus,
  } = useSWR('agent-runtime-status', getStatus, {
    refreshInterval: 5000,
  });
  const [draft, setDraft] = useState<RuntimePolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (policy && !saving) setDraft(policy);
  }, [policy, saving]);

  const forbidden = policyError instanceof BackendHttpError && policyError.status === 403;
  const loadError = policyError || statusError;
  const stateColor = useMemo(() => {
    switch (status?.memory_state) {
      case 'normal':
        return 'green';
      case 'constrained':
        return 'orange';
      case 'paused':
      case 'rejecting':
        return 'red';
      default:
        return 'gray';
    }
  }, [status?.memory_state]);

  if (forbidden) return null;

  const update = <K extends keyof RuntimePolicy>(key: K, value: RuntimePolicy[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await httpRequest<RuntimePolicy>('PATCH', '/api/admin/agent-runtime-policy', draft);
      setDraft(updated);
      await Promise.all([refreshPolicy(updated, false), refreshStatus()]);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存资源策略失败');
    } finally {
      setSaving(false);
    }
  };

  const numberControl = (
    key: Exclude<keyof RuntimePolicy, 'mode'>,
    min: number,
    max: number,
    step = 1
  ): React.ReactNode => (
    <InputNumber
      size='small'
      value={asNumber(draft?.[key], min)}
      min={min}
      max={max}
      step={step}
      precision={step < 1 ? 1 : 0}
      onChange={(value) => update(key, asNumber(value, min) as never)}
      style={{ width: 104 }}
    />
  );

  const durationControl = (key: 'queue_timeout_ms' | 'confirmation_timeout_ms' | 'resident_idle_timeout_ms') => (
    <InputNumber
      size='small'
      value={Math.round(asNumber(draft?.[key], 60_000) / 60_000)}
      min={1}
      max={1_440}
      step={1}
      onChange={(value) => update(key, asNumber(value, 1) * 60_000)}
      style={{ width: 104 }}
    />
  );

  return (
    <section className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px space-y-12px'>
      <div className='flex items-start justify-between gap-12px'>
        <div>
          <div className='text-16px text-1 font-600'>智能体容量与进程管理</div>
          <div className='text-12px text-t-tertiary mt-4px'>仅管理员可调整；变更立即写入 Core，并在重启后保留。</div>
        </div>
        <Button size='small' onClick={() => void Promise.all([refreshPolicy(), refreshStatus()])}>
          刷新状态
        </Button>
      </div>

      {loadError && !forbidden ? (
        <Alert type='error' content='无法读取容量策略。请确认 Core 已升级到包含多用户容量控制的版本。' />
      ) : !draft ? (
        <div className='py-16px flex justify-center'>
          <Spin />
        </div>
      ) : (
        <>
          <div className='grid grid-cols-2 md:grid-cols-4 gap-8px'>
            <StatusCard
              label='运行中'
              value={`${status?.active_count ?? '--'} / ${status?.effective_active_limit ?? '--'}`}
            />
            <StatusCard label='等待队列' value={status?.queued_count ?? '--'} />
            <StatusCard
              label='驻留进程'
              value={`${status?.resident_task_count ?? '--'} / ${draft.resident_task_limit}`}
            />
            <StatusCard
              label='内存状态'
              value={`${status?.memory_used_percent?.toFixed(1) ?? '--'}%`}
              suffix={<Tag color={stateColor}>{status?.memory_state ?? 'unknown'}</Tag>}
            />
          </div>

          <div className='grid grid-cols-1 md:grid-cols-2 gap-x-32px divide-y md:divide-y-0 divide-border-2'>
            <Control label='调度模式' hint='关闭只用于紧急回退；影子模式仅记录；强制模式执行限额。'>
              <Radio.Group
                size='small'
                type='button'
                value={draft.mode}
                onChange={(value) => update('mode', value as SchedulerMode)}
              >
                <Radio value='off'>关闭</Radio>
                <Radio value='shadow'>影子</Radio>
                <Radio value='enforce'>强制</Radio>
              </Radio.Group>
            </Control>
            <Control label='全局并发 turn' hint='所有用户合计可同时运行的智能体 turn 数。'>
              {numberControl('global_active_limit', 1, 64)}
            </Control>
            <Control label='单用户运行 turn' hint='一个用户同时运行的最大 turn 数。'>
              {numberControl('per_user_active_limit', 1, 8)}
            </Control>
            <Control label='单用户排队 turn' hint='一个用户等待执行的最大 turn 数。'>
              {numberControl('per_user_queue_limit', 1, 8)}
            </Control>
            <Control label='全局队列上限' hint='超过此数量的新 turn 将被拒绝。'>
              {numberControl('global_queue_limit', 1, 1000)}
            </Control>
            <Control label='队列超时（分钟）' hint='等待超过该时间会取消，原消息保留。'>
              {durationControl('queue_timeout_ms')}
            </Control>
            <Control label='确认占槽超时（分钟）' hint='等待人工确认的 turn 最多占用一个执行槽。'>
              {durationControl('confirmation_timeout_ms')}
            </Control>
            <Control label='驻留智能体进程' hint='达到上限时回收最久未使用的空闲 task。'>
              {numberControl('resident_task_limit', 1, 64)}
            </Control>
            <Control label='空闲回收（分钟）' hint='空闲达到此时间后回收驻留 agent task。'>
              {durationControl('resident_idle_timeout_ms')}
            </Control>
            <Control label='内存降并发阈值' hint='到达后新任务并发自动降低到最多 2。'>
              {numberControl('memory_constrained_percent', 50, 97, 0.5)}
            </Control>
            <Control label='内存暂停阈值' hint='到达后暂停派发新任务，已有任务不中断。'>
              {numberControl('memory_pause_percent', 51, 98, 0.5)}
            </Control>
            <Control label='内存拒绝阈值' hint='到达后拒绝新任务；取消和管理接口仍可用。'>
              {numberControl('memory_reject_percent', 52, 100, 0.5)}
            </Control>
          </div>
          {saveError && <Alert type='error' content={saveError} />}
          <div className='flex justify-end'>
            <Button type='primary' loading={saving} onClick={() => void save()}>
              保存容量策略
            </Button>
          </div>
        </>
      )}
    </section>
  );
};

const StatusCard: React.FC<{ label: string; value: React.ReactNode; suffix?: React.ReactNode }> = ({
  label,
  value,
  suffix,
}) => (
  <div className='bg-[var(--fill-1)] rd-8px px-12px py-10px'>
    <div className='text-12px text-t-tertiary'>{label}</div>
    <div className='flex items-center gap-6px mt-4px text-16px text-1 font-600'>
      {value}
      {suffix}
    </div>
  </div>
);

const Control: React.FC<{ label: string; hint: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className='flex items-center justify-between gap-16px py-12px'>
    <div>
      <div className='text-14px text-2'>{label}</div>
      <div className='text-12px text-t-tertiary mt-3px'>{hint}</div>
    </div>
    <div className='flex-shrink-0'>{children}</div>
  </div>
);

export default AgentCapacityPanel;
