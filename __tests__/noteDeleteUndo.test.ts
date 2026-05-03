import { describe, expect, it } from 'vitest';
import {
  captureAnchorSiblingId,
  restoreDeletedFamilyIntoFeed,
} from '@/lib/noteDeleteUndo';
import type { NotesListItemProps } from '@/components/NotesListItem';

const n = (
  id: string,
  sort: number,
  parentId: string | undefined = 'root',
  title = '',
): NotesListItemProps => ({
  id,
  title,
  sort,
  parentId,
});

describe('noteDeleteUndo', () => {
  it('captureAnchorSiblingId returns the direct sibling before the target', () => {
    const feed = [n('a', 0), n('b', 1), n('c', 2)];
    expect(captureAnchorSiblingId(feed, 'b', 'root')).toBe('a');
    expect(captureAnchorSiblingId(feed, 'a', 'root')).toBeNull();
  });

  it('restoreDeletedFamilyIntoFeed inserts the subtree after the anchor', () => {
    const before = [n('a', 0), n('b', 1), n('c', 2)];
    const removedFamily = [n('b', 1)];
    const afterDelete = [n('a', 0), n('c', 1)];
    const snapshot = {
      removedFamily,
      rootId: 'b',
      parentId: 'root' as const,
      anchorSiblingId: 'a',
    };
    const { feed } = restoreDeletedFamilyIntoFeed(afterDelete, snapshot);
    const roots = feed
      .filter((x) => x.parentId === 'root')
      .slice()
      .sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
    expect(roots.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('restoreDeletedFamilyIntoFeed works when sibling sorts were permuted', () => {
    const removedFamily = [n('b', 2)];
    const afterDelete = [n('a', 99), n('c', 1)];
    const snapshot = {
      removedFamily,
      rootId: 'b',
      parentId: 'root' as const,
      anchorSiblingId: 'a',
    };
    const { feed } = restoreDeletedFamilyIntoFeed(afterDelete, snapshot);
    const roots = feed
      .filter((x) => x.parentId === 'root')
      .slice()
      .sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
    expect(roots.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('restoreDeletedFamilyIntoFeed appends when anchor is no longer a sibling', () => {
    const removedFamily = [n('b', 1)];
    const afterDelete = [n('c', 0)];
    const snapshot = {
      removedFamily,
      rootId: 'b',
      parentId: 'root' as const,
      anchorSiblingId: 'a',
    };
    const { feed } = restoreDeletedFamilyIntoFeed(afterDelete, snapshot);
    const roots = feed
      .filter((x) => x.parentId === 'root')
      .slice()
      .sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
    expect(roots.map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('restoreDeletedFamilyIntoFeed puts root first when anchor is null', () => {
    const afterDelete = [n('b', 0), n('c', 1)];
    const removedFamily = [n('a', 0)];
    const snapshot = {
      removedFamily,
      rootId: 'a',
      parentId: 'root' as const,
      anchorSiblingId: null,
    };
    const { feed } = restoreDeletedFamilyIntoFeed(afterDelete, snapshot);
    const roots = feed
      .filter((x) => x.parentId === 'root')
      .slice()
      .sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
    expect(roots.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
