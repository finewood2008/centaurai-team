/**
 * HubSidebar — file-manager navigation for generated assets, NAS, and admin knowledge management.
 */
import React from 'react';
import { Button } from '@arco-design/web-react';
import { ArrowLeft, BookOpen, CloudStorage, FileCollection } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { HubSection } from '../../types';

type HubSidebarProps = {
  active: HubSection;
  mineCount: number;
  showKnowledge?: boolean;
  onChange: (section: HubSection) => void;
};

const SECTIONS: { key: HubSection; labelKey: string; icon: React.ReactNode }[] = [
  { key: 'mine', labelKey: 'contentHub.tabs.mine', icon: <FileCollection theme='outline' size={17} /> },
  { key: 'nas', labelKey: 'contentHub.tabs.nas', icon: <CloudStorage theme='outline' size={17} /> },
  { key: 'knowledge', labelKey: 'contentHub.tabs.knowledge', icon: <BookOpen theme='outline' size={17} /> },
];

const HubSidebar: React.FC<HubSidebarProps> = ({ active, mineCount, showKnowledge = true, onChange }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <aside className='w-220px shrink-0 border-r border-r-solid border-r-[var(--color-border-2)] bg-[var(--color-fill-1)] flex flex-col min-h-0'>
      <div className='px-14px py-14px border-b border-b-solid border-b-[var(--color-border-2)]'>
        <div className='flex items-center gap-8px'>
          <Button
            type='text'
            size='mini'
            icon={<ArrowLeft size='17' />}
            onClick={() => navigate(-1)}
            aria-label={t('contentHub.actions.back')}
          />
          <span className='centaur-title centaur-title-sm truncate'>{t('contentHub.title')}</span>
        </div>
      </div>
      <nav className='flex-1 overflow-y-auto p-8px'>
        <div className='flex flex-col gap-3px'>
          {SECTIONS.filter((section) => showKnowledge || section.key !== 'knowledge').map((section) => (
            <Button
              key={section.key}
              type='text'
              long
              onClick={() => onChange(section.key)}
              className={classNames(
                '!h-38px !justify-start !px-10px rd-8px',
                active === section.key
                  ? '!bg-[var(--color-fill-3)] !text-t-primary font-[500]'
                  : '!text-t-secondary hover:!bg-fill-2 hover:!text-t-primary'
              )}
            >
              <span className='flex w-full items-center gap-9px min-w-0'>
                <span className='shrink-0 leading-none'>{section.icon}</span>
                <span className='truncate'>{t(section.labelKey)}</span>
                {section.key === 'mine' && (
                  <span className='ml-auto shrink-0 text-11px text-t-tertiary'>{mineCount}</span>
                )}
              </span>
            </Button>
          ))}
        </div>
      </nav>
    </aside>
  );
};

export default HubSidebar;
