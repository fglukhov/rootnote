import type { NotesListItemProps } from '@/components/NotesListItem';

const parentKey = (pid: string | undefined | null) => pid ?? 'root';

export type NoteDeleteUndoSnapshot = {
  /** Root item first, then descendants (same order as `getFamily`). */
  removedFamily: NotesListItemProps[];
  rootId: string;
  parentId: string | undefined;
  /** Direct sibling immediately before the deleted root; `null` if it was first. */
  anchorSiblingId: string | null;
};

export function captureAnchorSiblingId(
  feed: NotesListItemProps[],
  rootId: string,
  parentId: string | undefined,
): string | null {
  const key = parentKey(parentId);
  const siblings = feed
    .filter((n) => parentKey(n.parentId) === key)
    .slice()
    .sort((a, b) => {
      const d = (a.sort ?? 0) - (b.sort ?? 0);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
  const idx = siblings.findIndex((n) => n.id === rootId);
  if (idx <= 0) return null;
  return siblings[idx - 1]!.id;
}

const renormalizeSortsForParent = (
  feed: NotesListItemProps[],
  parentId: string | undefined | null,
): NotesListItemProps[] => {
  const key = parentKey(parentId);
  const children = feed
    .filter((n) => parentKey(n.parentId) === key)
    .slice()
    .sort((a, b) => {
      const d = (a.sort ?? 0) - (b.sort ?? 0);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
  const idToNewSort = new Map(children.map((c, i) => [c.id, i]));
  return feed.map((n) => {
    const ns = idToNewSort.get(n.id);
    if (ns === undefined) return n;
    return { ...n, sort: ns };
  });
};

/**
 * Merges a previously removed subtree back into the flat feed and reorders direct
 * siblings under `parentId` so the restored root sits after `anchorSiblingId`.
 */
export function restoreDeletedFamilyIntoFeed(
  currentFeed: NotesListItemProps[],
  snapshot: NoteDeleteUndoSnapshot,
): { feed: NotesListItemProps[]; parentId: string | undefined } {
  const parentId = snapshot.parentId;
  const parentK = parentKey(parentId);
  const rootId = snapshot.rootId;

  const removedIds = new Set(snapshot.removedFamily.map((n) => n.id));
  const merged: NotesListItemProps[] = [
    ...currentFeed.filter((n) => !removedIds.has(n.id)),
    ...snapshot.removedFamily.map((n) => ({ ...n })),
  ];

  const directChildren = merged
    .filter((n) => parentKey(n.parentId) === parentK)
    .slice()
    .sort((a, b) => {
      const d = (a.sort ?? 0) - (b.sort ?? 0);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });

  const withoutRoot = directChildren.filter((n) => n.id !== rootId);

  let orderedIds: string[];
  if (snapshot.anchorSiblingId === null) {
    orderedIds = [rootId, ...withoutRoot.map((n) => n.id)];
  } else {
    const ai = withoutRoot.findIndex((n) => n.id === snapshot.anchorSiblingId);
    if (ai < 0) {
      orderedIds = [...withoutRoot.map((n) => n.id), rootId];
    } else {
      const before = withoutRoot.slice(0, ai + 1).map((n) => n.id);
      const after = withoutRoot.slice(ai + 1).map((n) => n.id);
      orderedIds = [...before, rootId, ...after];
    }
  }

  const orderIndex = new Map(orderedIds.map((id, i) => [id, i]));
  let next = merged.map((n) => {
    if (parentKey(n.parentId) !== parentK) return n;
    const idx = orderIndex.get(n.id);
    if (idx === undefined) return n;
    return { ...n, sort: idx };
  });

  next = renormalizeSortsForParent(next, parentId);
  return { feed: next, parentId };
}

/** Ensures ancestors of `rootId` are expanded so the subtree is visible. */
export function expandAncestorsForRestore(
  feed: NotesListItemProps[],
  rootId: string,
): NotesListItemProps[] {
  const ancestorIds: string[] = [];
  let current: NotesListItemProps | undefined = feed.find(
    (n) => n.id === rootId,
  );
  while (current?.parentId && current.parentId !== 'root') {
    const pid = current.parentId;
    ancestorIds.push(pid);
    current = feed.find((n) => n.id === pid);
  }
  if (ancestorIds.length === 0) return feed;
  const set = new Set(ancestorIds);
  return feed.map((n) =>
    set.has(n.id) && n.collapsed ? { ...n, collapsed: false } : n,
  );
}
