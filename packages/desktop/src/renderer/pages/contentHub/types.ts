/**
 * Content Hub shared types.
 */
import type { FileEntry } from '@/renderer/pages/guid/components/RecentFiles';

/** Top-level sections of the Content Hub. */
export type HubSection = 'mine' | 'shared' | 'nas' | 'knowledge';

/** Sub-views within the 我的产物 (mine) section. */
export type HubMineView = 'drafts' | 'all' | 'byConversation' | 'byType' | 'archived';

/** How files are laid out: dense list, uniform grid, or masonry waterfall. */
export type HubViewMode = 'list' | 'grid' | 'waterfall';

/** Card size preset, shared by both view modes. */
export type HubCardSize = 'small' | 'medium' | 'large';

/** Coarse classification used by the 按类型 (by type) filter. */
export type HubFileKind = 'all' | 'image' | 'document' | 'code' | 'other';

/** Sort keys shared by all hub sections. */
export type HubSortKey = 'modified' | 'name' | 'size';

/** Sort direction shared by all hub sections. */
export type HubSortDirection = 'asc' | 'desc';

/** URL-synced shell state for the Content Hub. */
export type HubUrlState = {
  section: HubSection;
  mineView: HubMineView;
  search: string;
  kind: HubFileKind;
  sortKey: HubSortKey;
  sortDirection: HubSortDirection;
  view: HubViewMode;
};

/** Selection state used by batch toolbars. */
export type HubSelectionState = {
  selectedIds: ReadonlySet<string>;
};

/** Shared toolbar controls passed from the shell into each section. */
export type HubToolbarControls = {
  search: string;
  kind: HubFileKind;
  sortKey: HubSortKey;
  sortDirection: HubSortDirection;
  view: HubViewMode;
  size: HubCardSize;
  onSearchChange: (value: string) => void;
  onKindChange: (value: HubFileKind) => void;
  onSortKeyChange: (value: HubSortKey) => void;
  onSortDirectionChange: (value: HubSortDirection) => void;
  onViewChange: (view: HubViewMode) => void;
  onSizeChange: (size: HubCardSize) => void;
};

/** Internal normalized file row/card model; backend DTOs remain unchanged. */
export type HubFileRecord<T = unknown> = {
  id: string;
  name: string;
  size: number;
  modifiedAt: number;
  kind: Exclude<HubFileKind, 'all'>;
  source: HubSection;
  raw: T;
  path?: string;
  subtitle?: string;
  isDirectory?: boolean;
  asset?: ContentAsset;
};

/** A group of files that belong to the same conversation. */
export type HubConversationGroup = {
  conversation: string;
  files: FileEntry[];
};

export type ContentAssetKind = Exclude<HubFileKind, 'all'>;

export type ContentAssetVisibility = 'private' | 'team' | 'public';

export type ContentAssetStorageProvider = 'workspace' | 'personal_content' | 'shared_drive' | 'nas' | 'knowledge';

export type ContentAssetStatusFlag =
  | 'draft'
  | 'saved'
  | 'shared'
  | 'stored_in_nas'
  | 'indexed'
  | 'archived'
  | 'missing';

export type ContentAsset = {
  id: string;
  title: string;
  kind: ContentAssetKind;
  ownerUserId: string;
  teamId?: string;
  visibility: ContentAssetVisibility;
  sourceConversationId?: string;
  sourceWorkspacePath: string;
  storageProvider: ContentAssetStorageProvider;
  storagePath: string;
  tags: string[];
  category?: string;
  statusFlags: ContentAssetStatusFlag[];
  createdAt: number;
  updatedAt: number;
  sharedDriveId?: string;
  nasStoragePath?: string;
};

export type { FileEntry };
