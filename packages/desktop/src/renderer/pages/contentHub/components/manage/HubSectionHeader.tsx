/**
 * HubSectionHeader — active section title and compact status row.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { HubFileKind, HubMineView, HubSection, HubViewMode } from '../../types';

type HubSectionHeaderProps = {
  section: HubSection;
  mineView: HubMineView;
  visibleCount?: number;
  totalCount?: number;
  selectedCount?: number;
  kind: HubFileKind;
  view: HubViewMode;
};

const sectionTitleKey = (section: HubSection): string => {
  if (section === 'shared') return 'contentHub.tabs.shared';
  if (section === 'nas') return 'contentHub.tabs.nas';
  if (section === 'knowledge') return 'contentHub.tabs.knowledge';
  return 'contentHub.tabs.mine';
};

const HubSectionHeader: React.FC<HubSectionHeaderProps> = ({
  section,
  mineView,
  visibleCount,
  totalCount,
  selectedCount = 0,
  kind,
  view,
}) => {
  const { t } = useTranslation();

  return (
    <div className='shrink-0 px-18px py-14px border-b border-b-solid border-b-[var(--color-border-2)] bg-[var(--color-bg-1)]'>
      <div className='flex flex-wrap items-center gap-10px'>
        <div className='min-w-0'>
          <div className='flex items-center gap-8px min-w-0'>
            <span className='text-18px font-[600] text-t-primary truncate'>{t(sectionTitleKey(section))}</span>
            {section === 'mine' && mineView !== 'all' && (
              <span className='rd-999px bg-fill-2 px-8px py-2px text-11px text-t-secondary'>
                {t(`contentHub.mineView.${mineView}`)}
              </span>
            )}
          </div>
          <div className='mt-5px flex flex-wrap items-center gap-6px text-12px text-t-secondary'>
            {typeof visibleCount === 'number' && <span>{t('contentHub.stats.visible', { count: visibleCount })}</span>}
            {typeof totalCount === 'number' && totalCount !== visibleCount && (
              <span>{t('contentHub.stats.total', { count: totalCount })}</span>
            )}
            <span>{t(`contentHub.type.${kind}`)}</span>
            <span>{t(`contentHub.view.${view}`)}</span>
            {selectedCount > 0 && <span>{t('contentHub.selection.selected', { count: selectedCount })}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HubSectionHeader;
