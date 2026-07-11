/**
 * HubHeader — Content Hub page header: back button, title, and count.
 */
import React from 'react';
import { Button } from '@arco-design/web-react';
import { ArrowLeft } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type HubHeaderProps = {
  count?: number;
};

const HubHeader: React.FC<HubHeaderProps> = ({ count }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className='flex items-center gap-12px px-20px py-14px border-b border-solid border-[color:var(--border-light)] shrink-0'>
      <Button
        type='text'
        size='mini'
        icon={<ArrowLeft size='18' />}
        onClick={() => navigate(-1)}
        aria-label={t('contentHub.actions.back')}
      />
      <span className='centaur-title centaur-title-md'>{t('contentHub.title')}</span>
      {typeof count === 'number' && <span className='text-12px text-t-secondary'>({count})</span>}
    </div>
  );
};

export default HubHeader;
