/**
 * Pure Content Hub helpers: URL compatibility, filtering, sorting, and
 * selection state transitions. Kept free of React so tests can cover the risky
 * state logic directly.
 */
import { getContentTypeByExtension } from '@/renderer/pages/conversation/Preview/fileUtils';
import type {
  HubFileKind,
  HubFileRecord,
  HubMineView,
  HubSection,
  HubSelectionState,
  HubSortDirection,
  HubSortKey,
  HubUrlState,
  HubViewMode,
} from '../../types';

const HUB_SECTIONS = new Set<HubSection>(['mine', 'shared', 'nas', 'knowledge']);
const HUB_MINE_VIEWS = new Set<HubMineView>(['drafts', 'all', 'byConversation', 'byType', 'archived']);
const HUB_KINDS = new Set<HubFileKind>(['all', 'image', 'document', 'code', 'other']);
const HUB_SORT_KEYS = new Set<HubSortKey>(['modified', 'name', 'size']);
const HUB_SORT_DIRECTIONS = new Set<HubSortDirection>(['asc', 'desc']);
const HUB_VIEW_MODES = new Set<HubViewMode>(['list', 'grid', 'waterfall']);

export const DEFAULT_HUB_URL_STATE: HubUrlState = {
  section: 'mine',
  mineView: 'drafts',
  search: '',
  kind: 'all',
  sortKey: 'modified',
  sortDirection: 'desc',
  view: 'list',
};

/** Map legacy ?tab= deep links onto the current section + mine-view model. */
export function parseHubTab(value: string | null): Pick<HubUrlState, 'section' | 'mineView'> {
  if (value === 'shared') return { section: 'nas', mineView: 'drafts' };
  if (value === 'nas') return { section: 'nas', mineView: 'all' };
  if (value === 'knowledge') return { section: 'knowledge', mineView: 'all' };
  if (value === 'drafts') return { section: 'mine', mineView: 'drafts' };
  if (value === 'archived') return { section: 'mine', mineView: 'archived' };
  if (value === 'byConversation') return { section: 'mine', mineView: 'byConversation' };
  if (value === 'byType') return { section: 'mine', mineView: 'byType' };
  if (HUB_SECTIONS.has(value as HubSection)) return { section: value as HubSection, mineView: 'all' };
  return { section: 'mine', mineView: 'drafts' };
}

export function defaultSortDirection(sortKey: HubSortKey): HubSortDirection {
  return sortKey === 'name' ? 'asc' : 'desc';
}

function parseEnum<T extends string>(value: string | null, allowed: ReadonlySet<T>, fallback: T): T {
  return value != null && allowed.has(value as T) ? (value as T) : fallback;
}

function asParams(input: URLSearchParams | string): URLSearchParams {
  if (typeof input !== 'string') return input;
  return new URLSearchParams(input.startsWith('?') ? input.slice(1) : input);
}

export function parseContentHubQuery(input: URLSearchParams | string): HubUrlState {
  const params = asParams(input);
  const tab = parseHubTab(params.get('tab'));
  const sortKey = parseEnum(params.get('sort'), HUB_SORT_KEYS, DEFAULT_HUB_URL_STATE.sortKey);

  return {
    section: tab.section,
    mineView: parseEnum(params.get('mineView'), HUB_MINE_VIEWS, tab.mineView),
    search: params.get('q') ?? '',
    kind: parseEnum(params.get('filter'), HUB_KINDS, DEFAULT_HUB_URL_STATE.kind),
    sortKey,
    sortDirection: parseEnum(params.get('dir'), HUB_SORT_DIRECTIONS, defaultSortDirection(sortKey)),
    view: parseEnum(params.get('view'), HUB_VIEW_MODES, DEFAULT_HUB_URL_STATE.view),
  };
}

export function hubTabForState(state: Pick<HubUrlState, 'section' | 'mineView'>): string | null {
  if (state.section === 'shared') return 'shared';
  if (state.section === 'nas') return 'nas';
  if (state.section === 'knowledge') return 'knowledge';
  if (state.mineView === 'drafts') return 'drafts';
  if (state.mineView === 'archived') return 'archived';
  if (state.mineView === 'byConversation') return 'byConversation';
  if (state.mineView === 'byType') return 'byType';
  return null;
}

export function buildContentHubSearchParams(state: HubUrlState): URLSearchParams {
  const params = new URLSearchParams();
  const tab = hubTabForState(state);
  if (tab) params.set('tab', tab);
  if (state.search.trim()) params.set('q', state.search.trim());
  if (state.kind !== DEFAULT_HUB_URL_STATE.kind) params.set('filter', state.kind);
  if (state.sortKey !== DEFAULT_HUB_URL_STATE.sortKey) params.set('sort', state.sortKey);
  if (state.sortDirection !== defaultSortDirection(state.sortKey)) params.set('dir', state.sortDirection);
  if (state.view !== DEFAULT_HUB_URL_STATE.view) params.set('view', state.view);
  return params;
}

export function classifyHubFile(name: string): Exclude<HubFileKind, 'all'> {
  if (name.toLowerCase().endsWith('.pptx.md')) return 'document';
  const type = getContentTypeByExtension(name);
  if (type === 'image') return 'image';
  if (type === 'pdf' || type === 'word' || type === 'excel' || type === 'ppt') return 'document';
  if (type === 'code' || type === 'markdown' || type === 'html' || type === 'diff') return 'code';
  return 'other';
}

export function filterHubRecords<T extends HubFileRecord>(
  records: readonly T[],
  search: string,
  kind: HubFileKind
): T[] {
  const q = search.trim().toLowerCase();
  return records.filter((record) => {
    if (q && !record.name.toLowerCase().includes(q) && !record.subtitle?.toLowerCase().includes(q)) return false;
    if (kind !== 'all' && !record.isDirectory && record.kind !== kind) return false;
    return true;
  });
}

export function sortHubRecords<T extends HubFileRecord>(
  records: readonly T[],
  sortKey: HubSortKey,
  direction: HubSortDirection
): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...records].toSorted((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    if (sortKey === 'name') {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      return byName * factor;
    }
    const av = sortKey === 'size' ? a.size : a.modifiedAt;
    const bv = sortKey === 'size' ? b.size : b.modifiedAt;
    if (av !== bv) return (av - bv) * factor;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
}

export function createHubSelectionState(ids: readonly string[] = []): HubSelectionState {
  return { selectedIds: new Set(ids) };
}

export function toggleHubSelection(state: HubSelectionState, id: string): HubSelectionState {
  const next = new Set(state.selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { selectedIds: next };
}

export function setHubSelectionForIds(
  state: HubSelectionState,
  ids: readonly string[],
  selected: boolean
): HubSelectionState {
  const next = new Set(state.selectedIds);
  for (const id of ids) {
    if (selected) next.add(id);
    else next.delete(id);
  }
  return { selectedIds: next };
}

export function clearHubSelection(): HubSelectionState {
  return createHubSelectionState();
}

export function getHubSelectionSummary(state: HubSelectionState, visibleIds: readonly string[]) {
  const selectedVisibleCount = visibleIds.filter((id) => state.selectedIds.has(id)).length;
  return {
    selectedVisibleCount,
    allVisibleSelected: visibleIds.length > 0 && selectedVisibleCount === visibleIds.length,
    partiallySelected: selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length,
  };
}
