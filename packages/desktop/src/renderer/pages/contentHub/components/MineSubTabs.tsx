/**
 * MineSubTabs — secondary view switcher inside the generated-assets section.
 */
import React from 'react';
import { Button } from '@arco-design/web-react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { HubMineView } from '../types';

type MineSubTabsProps = {
  active: HubMineView;
  onChange: (view: HubMineView) => void;
};

const VIEWS: { key: HubMineView; labelKey: string }[] = [
  { key: 'drafts', labelKey: 'contentHub.mineView.drafts' },
  { key: 'all', labelKey: 'contentHub.mineView.all' },
  { key: 'byConversation', labelKey: 'contentHub.mineView.byConversation' },
  { key: 'byType', labelKey: 'contentHub.mineView.byType' },
  { key: 'archived', labelKey: 'contentHub.mineView.archived' },
];

const MineSubTabs: React.FC<MineSubTabsProps> = ({ active, onChange }) => {
  const { t } = useTranslation();

  return (
    <div className='flex items-center gap-2px p-2px rd-8px bg-[var(--color-fill-1)] border border-solid border-[var(--color-border-2)]'>
      {VIEWS.map((item) => (
        <Button
          key={item.key}
          type='text'
          size='mini'
          onClick={() => onChange(item.key)}
          className={classNames(
            '!h-26px !px-9px rd-6px !text-12px transition-colors',
            active === item.key
              ? '!bg-[var(--color-fill-3)] !text-t-primary font-[500]'
              : '!text-t-secondary hover:!bg-fill-2 hover:!text-t-primary'
          )}
        >
          {t(item.labelKey)}
        </Button>
      ))}
    </div>
  );
};

export default MineSubTabs;
