import { describe, expect, it } from 'vitest';
import {
  buildContentHubSearchParams,
  classifyHubFile,
  clearHubSelection,
  createHubSelectionState,
  filterHubRecords,
  getHubSelectionSummary,
  parseContentHubQuery,
  setHubSelectionForIds,
  sortHubRecords,
  toggleHubSelection,
} from '@/renderer/pages/contentHub/components/manage/hubState';
import type { HubFileRecord } from '@/renderer/pages/contentHub/types';

const records: HubFileRecord[] = [
  {
    id: 'z',
    name: 'zeta.pdf',
    size: 20,
    modifiedAt: 20,
    kind: 'document',
    source: 'mine',
    raw: {},
  },
  {
    id: 'a',
    name: 'alpha.png',
    size: 10,
    modifiedAt: 30,
    kind: 'image',
    source: 'mine',
    subtitle: 'Design assets',
    raw: {},
  },
  {
    id: 'folder',
    name: 'Folder',
    size: 0,
    modifiedAt: 10,
    kind: 'other',
    source: 'nas',
    isDirectory: true,
    raw: {},
  },
];

describe('content hub URL state', () => {
  it('keeps legacy tab deep links compatible', () => {
    expect(parseContentHubQuery('?tab=shared').section).toBe('nas');
    expect(parseContentHubQuery('?tab=drafts').mineView).toBe('drafts');
    expect(parseContentHubQuery('?tab=byConversation').mineView).toBe('byConversation');
    expect(parseContentHubQuery('?tab=byType').mineView).toBe('byType');
  });

  it('falls back when query values are invalid', () => {
    const state = parseContentHubQuery('?tab=unknown&view=table&filter=movie&sort=random&dir=sideways');

    expect(state.section).toBe('mine');
    expect(state.view).toBe('list');
    expect(state.kind).toBe('all');
    expect(state.sortKey).toBe('modified');
    expect(state.sortDirection).toBe('desc');
  });

  it('serializes non-default state without losing legacy tab shape', () => {
    const params = buildContentHubSearchParams({
      section: 'mine',
      mineView: 'byType',
      search: ' report ',
      kind: 'document',
      sortKey: 'name',
      sortDirection: 'desc',
      view: 'grid',
    });

    expect(params.toString()).toBe('tab=byType&q=report&filter=document&sort=name&dir=desc&view=grid');
  });
});

describe('content hub filtering and sorting', () => {
  it('classifies common file families', () => {
    expect(classifyHubFile('photo.webp')).toBe('image');
    expect(classifyHubFile('report.docx')).toBe('document');
    expect(classifyHubFile('deck.pptx.md')).toBe('document');
    expect(classifyHubFile('index.ts')).toBe('code');
  });

  it('filters by search, subtitle, and type while keeping folders visible for navigation', () => {
    expect(filterHubRecords(records, 'design', 'all').map((record) => record.id)).toEqual(['a']);
    expect(filterHubRecords(records, '', 'image').map((record) => record.id)).toEqual(['a', 'folder']);
  });

  it('sorts folders first and applies the requested key and direction', () => {
    expect(sortHubRecords(records, 'name', 'asc').map((record) => record.id)).toEqual(['folder', 'a', 'z']);
    expect(sortHubRecords(records, 'modified', 'desc').map((record) => record.id)).toEqual(['folder', 'a', 'z']);
    expect(sortHubRecords(records, 'size', 'asc').map((record) => record.id)).toEqual(['folder', 'a', 'z']);
  });
});

describe('content hub selection state', () => {
  it('toggles individual records and clears selection', () => {
    const selected = toggleHubSelection(createHubSelectionState(), 'a');

    expect(selected.selectedIds.has('a')).toBe(true);
    expect(toggleHubSelection(selected, 'a').selectedIds.has('a')).toBe(false);
    expect(clearHubSelection().selectedIds.size).toBe(0);
  });

  it('sets visible records as a group and reports partial selection', () => {
    const selected = setHubSelectionForIds(createHubSelectionState(['existing']), ['a', 'z'], true);
    const summary = getHubSelectionSummary(selected, ['a', 'z', 'missing']);

    expect([...selected.selectedIds].toSorted()).toEqual(['a', 'existing', 'z']);
    expect(summary.selectedVisibleCount).toBe(2);
    expect(summary.allVisibleSelected).toBe(false);
    expect(summary.partiallySelected).toBe(true);
  });
});
