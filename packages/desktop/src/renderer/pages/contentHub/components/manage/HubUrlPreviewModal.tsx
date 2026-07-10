import React from 'react';
import { Modal } from '@arco-design/web-react';

export type HubUrlPreview = {
  title: string;
  url: string;
};

type HubUrlPreviewModalProps = {
  preview: HubUrlPreview | null;
  onClose: () => void;
};

const HubUrlPreviewModal: React.FC<HubUrlPreviewModalProps> = ({ preview, onClose }) => (
  <Modal
    visible={!!preview}
    title={preview?.title}
    footer={null}
    onCancel={onClose}
    unmountOnExit
    style={{ width: 'min(960px, 92vw)' }}
  >
    {preview && (
      <iframe
        title={preview.title}
        src={preview.url}
        className='w-full h-[72vh] border-0 rd-6px bg-[var(--color-bg-2)]'
      />
    )}
  </Modal>
);

export default HubUrlPreviewModal;
