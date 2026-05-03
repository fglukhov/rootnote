import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import NotesListItem from '@/components/NotesListItem';
import { NotesProvider } from '@/components/NotesContext';
import { NotesListItemProps } from '@/components/NotesListItem';
import { useKeyPress } from '@/lib/useKeyPress';
import { getFamily, removeFamily, getNoteDepth } from '@/lib/notesTree';
import {
  type NoteDeleteUndoSnapshot,
  captureAnchorSiblingId,
  restoreDeletedFamilyIntoFeed,
  expandAncestorsForRestore,
} from '@/lib/noteDeleteUndo';
import NotesHotkeysHints from '@/components/NotesHotkeysHints';
import { Button } from '@/components/Button';
import styles from '@/components/NotesList.module.scss';
import Router, { useRouter } from 'next/router';

// TODO tidy up types
// TODO handle page reload on cmd+R
// TODO restore current position after reload and scroll to it

export type FeedModalSync =
  | {
      rev: number;
      kind: 'patch';
      noteId: string;
      hasContent: boolean;
      title?: string;
    }
  | {
      rev: number;
      kind: 'removeFamily';
      rootId: string;
    };

type Props = {
  feed: NotesListItemProps[];
  /** Enables periodic remote sync for authenticated users. */
  enableRemoteSync?: boolean;
  /** One-shot sync from the note modal (save, delete, …). */
  feedModalSync?: FeedModalSync | null;
  /** Called whenever the local notesFeed changes (for optimistic modal opening). */
  onFeedChange?: (feed: NotesListItemProps[]) => void;
};

type SyncChangeNote = Pick<
  NotesListItemProps,
  | 'id'
  | 'title'
  | 'content'
  | 'hasContent'
  | 'parentId'
  | 'sort'
  | 'complete'
  | 'collapsed'
  | 'priority'
>;

type SyncChangesResponse = {
  changes: Array<{
    op: 'upsert' | 'delete';
    id: string;
    updatedAt: string;
    note?: SyncChangeNote;
  }>;
  nextSince: string;
  hasMore: boolean;
};

const UNDO_DELETE_MS = 10_000;

//let reorderInterval = null;
let timeout: ReturnType<typeof setTimeout> | null = null;

const parentKey = (pid: string | undefined | null) => pid ?? 'root';

const sameParent = (
  noteParent: string | undefined | null,
  targetParent: string | undefined | null,
) => parentKey(noteParent) === parentKey(targetParent);

/** Siblings under the same parent, ordered by `sort` then id (stable). */
const siblingsSortedByParent = (
  feed: NotesListItemProps[],
  parentId: string | undefined | null,
) => {
  const key = parentKey(parentId);
  return feed
    .filter((n) => parentKey(n.parentId) === key)
    .slice()
    .sort((a, b) => {
      const d = (a.sort ?? 0) - (b.sort ?? 0);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
};

/** Reassign sort to 0..n-1 among direct children of `parentId` (canonical tree order). */
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

const markSiblingsForSync = (
  feed: NotesListItemProps[],
  parentId: string | undefined | null,
  bucket: string[],
) => {
  const key = parentKey(parentId);
  for (const n of feed) {
    if (parentKey(n.parentId) === key && !bucket.includes(n.id)) {
      bucket.push(n.id);
    }
  }
};

const findPositionByIdInFeed = (
  feed: NotesListItemProps[],
  targetId: string,
): number | null => {
  let position = 0;

  const visit = (parentKey: string): number | null => {
    const children = feed
      .filter((n) => (n.parentId ?? 'root') === parentKey)
      .slice()
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

    for (const note of children) {
      if (note.id === targetId) {
        return position;
      }

      position += 1;
      const found = visit(note.id);
      if (found !== null) {
        return found;
      }
    }

    return null;
  };

  return visit('root');
};

export function applyFeedModalSync(
  prev: NotesListItemProps[],
  sync: FeedModalSync,
): NotesListItemProps[] {
  if (sync.kind === 'patch') {
    return prev.map((n) =>
      n.id === sync.noteId
        ? {
            ...n,
            hasContent: sync.hasContent,
            ...(sync.title !== undefined ? { title: sync.title } : {}),
          }
        : n,
    );
  }

  const curNote = prev.find((n) => n.id === sync.rootId);
  if (!curNote) return prev;

  const removedFeed = removeFamily(curNote.id, prev);
  const remainingIds = new Set(removedFeed.map((n) => n.id));
  const removedIds = prev
    .map((n) => n.id)
    .filter((id) => !remainingIds.has(id));
  let newFeed = prev.filter((n) => !removedIds.includes(n.id));
  newFeed = renormalizeSortsForParent(newFeed, curNote.parentId);
  return newFeed;
}

const NotesList: React.FC<Props> = (props) => {
  type NotesItemAction = Parameters<
    NonNullable<NotesListItemProps['onRunAction']>
  >[2];
  const reorderTimeoutRef = useRef<number | null>(null);

  const updatedIds = useRef<string[]>([]);
  const savedUpdatedIds = useRef<string[]>([]);

  const prevFeed = useRef(props.feed);
  const syncFeed = useRef<NotesListItemProps[] | null>(null);

  const eventKeyRef = useRef<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const focusId = useRef<string | null>(null);
  const prevFocusId = useRef<string | null>(null);

  const prevCursorPosition = useRef<number | null>(null);
  const saveCursorPosition = useRef<number | null>(null);
  const prevTitle = useRef<string | null>(null);

  const [cursorPosition, setCursorPosition] = useState(0);
  const [notesFeed, setNotesFeed] = useState(props.feed);
  const [showRestoreUndo, setShowRestoreUndo] = useState(false);
  const deleteUndoRef = useRef<NoteDeleteUndoSnapshot | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const router = useRouter();
  const isNoteModalOpen = router.isReady && Boolean(router.query.note);

  const noteIdFromQuery = useMemo(() => {
    const raw = router.query.note;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return raw[0] ?? null;
    return null;
  }, [router.query.note]);

  const notesListScrollRef = useRef<HTMLDivElement | null>(null);

  const [isEditTitle, setIsEditTitle] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isChanged, setIsChanged] = useState(false);

  const isChangedRef = useRef(isChanged);
  const isUpdatingRef = useRef(isUpdating);
  /** True as soon as local edits queue an outbound save (before React commits isChanged). */
  const outboundDirtyRef = useRef(false);
  const isSyncingRemoteRef = useRef(false);
  const remoteSinceRef = useRef<string>(new Date().toISOString());

  const hiddenRanges = useMemo(() => {
    const ranges: { start: number; end: number }[] = [];

    function visit(parentKey: string, position: number): number {
      const children = notesFeed
        .filter((n) => (n.parentId ?? 'root') === parentKey)
        .slice()
        // `sort` is the position inside the current parent.
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      for (const note of children) {
        const familyCount = getFamily(note.id, notesFeed).length;
        if (note.collapsed && familyCount > 1) {
          ranges.push({
            start: position + 1,
            end: position + familyCount - 1,
          });
        }
        if (note.collapsed) {
          position += familyCount;
        } else {
          position = visit(note.id, position + 1);
        }
      }
      return position;
    }

    visit('root', 0);
    return ranges;
  }, [notesFeed]);

  function reorderCallback() {
    // TODO notes are not synchronized while a form is open, but syncing breaks sorting

    if (isChanged && !isUpdating) {
      setIsChanged(false);
      setIsUpdating(true);

      reorderNotes(prevFeed.current, syncFeed.current, savedUpdatedIds.current)
        .then(() => {
          setIsUpdating(false);
          if (syncFeed.current) {
            prevFeed.current = syncFeed.current.map((n) => ({ ...n }));
          }

          outboundDirtyRef.current =
            savedUpdatedIds.current.length > 0 || updatedIds.current.length > 0;

          // If new changes appear while sending, send one more time.
          if (isChangedRef.current) {
            reorderCallback();
          }
        })
        .catch((err: unknown) => {
          console.error(err);

          setIsUpdating(false);
          outboundDirtyRef.current =
            savedUpdatedIds.current.length > 0 || updatedIds.current.length > 0;

          // Retry as well if changes appeared while the request failed.
          if (isChangedRef.current) {
            reorderCallback();
          }
        });
    }
  }

  const scheduleSyncUpdate = () => {
    outboundDirtyRef.current = true;
    // Merge ids immediately so the next POST always sees the full pending set.
    // Setting isChanged without the old 1s delay blocks remote sync from overwriting
    // local sort/collapse state before the outbound request arms (see runSyncTick).
    savedUpdatedIds.current = Array.from(
      new Set([...savedUpdatedIds.current, ...updatedIds.current]),
    );
    updatedIds.current = [];

    setIsChanged(true);
  };

  const removeNoteFamilyFromFeed = (
    noteId: string,
    baseFeed: NotesListItemProps[],
  ): NotesListItemProps[] => {
    const curNote = baseFeed.find((n) => n.id === noteId);
    if (!curNote) return baseFeed;

    const removedFeed = removeFamily(curNote.id, baseFeed);
    const remainingIds = new Set(removedFeed.map((n) => n.id));
    const removedIds = baseFeed
      .map((n) => n.id)
      .filter((id) => !remainingIds.has(id));

    for (const rid of removedIds) {
      if (!updatedIds.current.includes(rid)) updatedIds.current.push(rid);
    }

    let newFeed = baseFeed.filter((n) => !removedIds.includes(n.id));
    newFeed = renormalizeSortsForParent(newFeed, curNote.parentId);
    markSiblingsForSync(newFeed, curNote.parentId, updatedIds.current);

    return newFeed;
  };

  const clearDeleteUndoTimer = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  };

  const clearDeleteUndo = () => {
    clearDeleteUndoTimer();
    deleteUndoRef.current = null;
    setShowRestoreUndo(false);
  };

  const performUndoRestore = () => {
    const snap = deleteUndoRef.current;
    if (!snap) return;

    clearDeleteUndo();

    let { feed: merged, parentId } = restoreDeletedFamilyIntoFeed(
      notesFeed,
      snap,
    );
    merged = expandAncestorsForRestore(merged, snap.rootId);

    for (const n of snap.removedFamily) {
      if (!updatedIds.current.includes(n.id)) {
        updatedIds.current.push(n.id);
      }
    }
    markSiblingsForSync(merged, parentId, updatedIds.current);

    scheduleSyncUpdate();
    syncFeed.current = merged;
    setNotesFeed(merged);

    focusId.current = snap.rootId;
    const pos = findPositionByIdInFeed(merged, snap.rootId);
    if (pos !== null) {
      setCursorPosition(pos);
    }
  };

  const handleDelete = (noteId?: string) => {
    setIsEditTitle(false);

    const targetId = noteId ?? focusId.current ?? undefined;
    if (!targetId) return;

    const curNote = notesFeed.find((n) => n.id === targetId);
    if (!curNote) return;

    const family = getFamily(targetId, notesFeed);
    const removedFamily = family.map((n) => ({ ...n }));
    const anchorSiblingId = captureAnchorSiblingId(
      notesFeed,
      targetId,
      curNote.parentId,
    );

    clearDeleteUndo();

    deleteUndoRef.current = {
      removedFamily,
      rootId: targetId,
      parentId: curNote.parentId,
      anchorSiblingId,
    };
    setShowRestoreUndo(true);
    undoTimerRef.current = window.setTimeout(() => {
      undoTimerRef.current = null;
      deleteUndoRef.current = null;
      setShowRestoreUndo(false);
    }, UNDO_DELETE_MS);

    const newFeed = removeNoteFamilyFromFeed(targetId, notesFeed);
    scheduleSyncUpdate();
    syncFeed.current = newFeed;
    setNotesFeed(newFeed);

    setCursorPosition((cp) =>
      newFeed.length === 0 ? 0 : Math.min(cp, newFeed.length - 1),
    );
  };

  const insertNote = (
    event: KeyboardEvent | { shiftKey: boolean; altKey: boolean } | null,
  ): void => {
    clearDeleteUndo();

    if (event == null) {
      event = {
        shiftKey: false,
        altKey: false,
      };
    }

    // TODO extract into a function and reuse after submit to instantly add a new note

    prevFocusId.current = focusId.current;
    prevCursorPosition.current = cursorPosition;

    clearTimeout(timeout);
    lastKeyRef.current = null;

    let newId = crypto.randomUUID();

    let curNote = notesFeed.find((n) => n.id == focusId.current);

    if (curNote !== undefined) {
      prevTitle.current = curNote.title;
    }

    let parentId;

    let insertChild = false;

    let newSort = 0;

    if (!notesFeed.length) {
      parentId = 'root';
    } else if (!curNote) {
      parentId = 'root';
      newSort = siblingsSortedByParent(notesFeed, 'root').length;
    } else {
      if (event.shiftKey === true) {
        insertChild = true;

        parentId = curNote.id;
      } else {
        parentId = curNote.parentId;

        if (event.altKey) {
          newSort = curNote.sort;
        } else {
          newSort = curNote.sort + 1;
        }
      }
    }

    let insertAt;

    if (!notesFeed.length) {
      insertAt = 0;
    } else if (!curNote) {
      insertAt = notesFeed.length;
    } else {
      if (insertChild) {
        // A nested item is always inserted at the next position after current.

        insertAt = cursorPosition + 1;
      } else {
        if (!insertChild && event.altKey) {
          insertAt = cursorPosition;
        } else {
          insertAt = cursorPosition + getFamily(curNote.id, notesFeed).length;
        }
      }
    }

    let newNote: NotesListItemProps = {
      id: newId,
      title: '',
      priority: null,
      sort: newSort,
      //position: insertAt,
      isNew: true,
      parentId: parentId,
    };

    let newFeed = [...notesFeed, newNote];

    newFeed = newFeed.map((n) => {
      if (
        n.sort >= newSort &&
        n.id != newId &&
        sameParent(n.parentId, parentId)
      ) {
        return {
          ...n,
          sort: n.sort + 1,
        };
      } else if (insertChild && n.id == parentId) {
        return {
          ...n,
          collapsed: false,
        };
      } else {
        return n;
      }
    });

    newFeed = renormalizeSortsForParent(newFeed, parentId);
    markSiblingsForSync(newFeed, parentId, updatedIds.current);
    const newIdx = updatedIds.current.indexOf(newId);
    if (newIdx >= 0) updatedIds.current.splice(newIdx, 1);

    // TODO remove this timeout. It prevents the new note form from being submitted immediately.

    setTimeout(function () {
      setCursorPosition(insertAt);
      setIsEditTitle(true);
      focusId.current = newId;
      syncFeed.current = newFeed;
      setNotesFeed(newFeed);
    }, 1);
  };

  const handleMobileAddBelow = () => {
    insertNote({ shiftKey: false, altKey: false });
  };

  const handleMobileAddAbove = () => {
    if (!focusId.current) {
      insertNote({ shiftKey: false, altKey: false });
      return;
    }
    insertNote({ shiftKey: false, altKey: true });
  };

  useEffect(() => {
    if (!isChanged) return;

    // If the user keeps interacting, reset the timer.
    if (reorderTimeoutRef.current) {
      clearTimeout(reorderTimeoutRef.current);
    }

    reorderTimeoutRef.current = window.setTimeout(() => {
      reorderCallback();
      reorderTimeoutRef.current = null;
    }, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChanged, notesFeed]);

  useEffect(() => {
    isChangedRef.current = isChanged;
  }, [isChanged]);

  useEffect(() => {
    isUpdatingRef.current = isUpdating;
  }, [isUpdating]);

  useEffect(() => {
    const timestamps = props.feed
      .map((n) => {
        const raw = (n as NotesListItemProps & { updatedAt?: string | Date })
          .updatedAt;
        if (!raw) return null;
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      })
      .filter((v): v is Date => v instanceof Date);

    if (timestamps.length === 0) {
      remoteSinceRef.current = new Date().toISOString();
      return;
    }

    const latestMs = Math.max(...timestamps.map((d) => d.getTime()));
    remoteSinceRef.current = new Date(latestMs).toISOString();
  }, [props.feed]);

  useEffect(() => {
    props.onFeedChange?.(notesFeed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesFeed]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const sync = props.feedModalSync;
    if (!sync) return;

    let clampLen: number | null = null;
    setNotesFeed((prev) => {
      const next = applyFeedModalSync(prev, sync);
      if (sync.kind === 'removeFamily') {
        clampLen = next.length;
      }
      return next;
    });

    if (clampLen !== null) {
      setCursorPosition((cp) =>
        clampLen === 0 ? 0 : Math.min(cp, clampLen - 1),
      );
    }
  }, [props.feedModalSync]);

  useEffect(() => {
    if (!props.enableRemoteSync) return;
    if (typeof window === 'undefined') return;

    let cancelled = false;

    const applyChanges = (
      baseFeed: NotesListItemProps[],
      changes: SyncChangesResponse['changes'],
    ) => {
      let nextFeed = baseFeed.slice();
      const touchedParents = new Set<string | null | undefined>();

      for (const change of changes) {
        if (change.op === 'delete') {
          const idx = nextFeed.findIndex((n) => n.id === change.id);
          if (idx >= 0) {
            touchedParents.add(nextFeed[idx].parentId);
            nextFeed.splice(idx, 1);
          }
          continue;
        }
        if (!change.note) continue;
        const incoming = change.note;
        const idx = nextFeed.findIndex((n) => n.id === incoming.id);
        const prevParent = idx >= 0 ? nextFeed[idx].parentId : null;

        if (idx >= 0) {
          nextFeed[idx] = {
            ...nextFeed[idx],
            ...incoming,
            isNew: false,
          };
        } else {
          nextFeed.push({
            ...incoming,
            isNew: false,
          });
        }

        touchedParents.add(prevParent);
        touchedParents.add(incoming.parentId);
      }

      for (const parentId of Array.from(touchedParents)) {
        nextFeed = renormalizeSortsForParent(nextFeed, parentId);
      }

      return nextFeed;
    };

    const runSyncTick = async () => {
      if (cancelled) return;
      if (isSyncingRemoteRef.current) return;
      if (
        outboundDirtyRef.current ||
        isChangedRef.current ||
        isUpdatingRef.current
      )
        return;
      if (isEditTitle || isNoteModalOpen || showRestoreUndo) return;

      isSyncingRemoteRef.current = true;
      try {
        const stateRes = await fetch(
          `/api/sync/state?since=${encodeURIComponent(remoteSinceRef.current)}`,
        );
        if (!stateRes.ok) return;
        const stateData = (await stateRes.json()) as {
          hasChanges?: boolean;
          latestUpdatedAt?: string | null;
        };
        if (!stateData.hasChanges) return;

        const changesRes = await fetch(
          `/api/sync/changes?since=${encodeURIComponent(remoteSinceRef.current)}&limit=200`,
        );
        if (!changesRes.ok) return;

        const payload = (await changesRes.json()) as SyncChangesResponse;
        if (!Array.isArray(payload.changes) || payload.changes.length === 0) {
          if (
            typeof payload.nextSince === 'string' &&
            payload.nextSince.length > 0
          ) {
            remoteSinceRef.current = payload.nextSince;
          }
          return;
        }

        setNotesFeed((prev) => {
          const next = applyChanges(prev, payload.changes);
          syncFeed.current = next.map((n) => ({ ...n }));
          prevFeed.current = next.map((n) => ({ ...n }));
          const currentFocusId = focusId.current;
          if (currentFocusId) {
            const restoredPosition = findPositionByIdInFeed(
              next,
              currentFocusId,
            );
            if (restoredPosition !== null) {
              setCursorPosition(restoredPosition);
            } else {
              setCursorPosition((cp) =>
                next.length === 0 ? 0 : Math.min(cp, next.length - 1),
              );
            }
          }
          return next;
        });

        if (
          typeof payload.nextSince === 'string' &&
          payload.nextSince.length > 0
        ) {
          remoteSinceRef.current = payload.nextSince;
        }
      } catch (error) {
        console.error(error);
      } finally {
        isSyncingRemoteRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void runSyncTick();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isEditTitle, isNoteModalOpen, showRestoreUndo, props.enableRemoteSync]);

  const findPositionById = useCallback(
    (targetId: string): number | null => {
      return findPositionByIdInFeed(notesFeed, targetId);
    },
    [notesFeed],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!router.isReady) return;
    // URL `?note=` drives focus for the open note; do not override from session.
    if (router.query.note) return;

    const lastFocusId = sessionStorage.getItem('notes:last-focus-id');
    if (!lastFocusId) return;

    const restoredPosition = findPositionById(lastFocusId);
    if (restoredPosition !== null) {
      setCursorPosition(restoredPosition);
    }

    sessionStorage.removeItem('notes:last-focus-id');
  }, [notesFeed, findPositionById, router.isReady, router.query.note]);

  // After refresh with `/?note=<id>`, align list focus with the open note and expand ancestors.
  useEffect(() => {
    if (!router.isReady || !noteIdFromQuery) return;
    if (!notesFeed.some((n) => n.id === noteIdFromQuery)) return;

    const ancestorIds: string[] = [];
    let current: NotesListItemProps | undefined = notesFeed.find(
      (n) => n.id === noteIdFromQuery,
    );
    while (current?.parentId && current.parentId !== 'root') {
      const pid = current.parentId;
      ancestorIds.push(pid);
      current = notesFeed.find((n) => n.id === pid);
    }

    const collapsedAncestorIds = ancestorIds.filter((aid) => {
      const n = notesFeed.find((x) => x.id === aid);
      return n?.collapsed === true;
    });

    if (collapsedAncestorIds.length > 0) {
      setNotesFeed((prev) =>
        prev.map((n) =>
          collapsedAncestorIds.includes(n.id) ? { ...n, collapsed: false } : n,
        ),
      );
    }

    const restoredPosition = findPositionById(noteIdFromQuery);
    if (restoredPosition !== null) {
      setCursorPosition(restoredPosition);
      focusId.current = noteIdFromQuery;
    }
  }, [router.isReady, noteIdFromQuery, notesFeed, findPositionById]);

  useLayoutEffect(() => {
    if (!router.isReady || !noteIdFromQuery) return;
    const row = document.getElementById(noteIdFromQuery);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [router.isReady, noteIdFromQuery, notesFeed, cursorPosition]);

  const setCollapsedState = (noteId: string, collapsed: boolean) => {
    const curNote = notesFeed.find((n) => n.id == noteId);
    if (!curNote) return;

    const newFeed = notesFeed.map((n) => {
      if (n.id === curNote.id) {
        if (!updatedIds.current.includes(n.id)) updatedIds.current.push(n.id);

        return {
          ...n,
          collapsed,
        };
      }
      return n;
    });

    scheduleSyncUpdate();
    syncFeed.current = newFeed;
    setNotesFeed(newFeed);
  };

  const handleToggleCollapse = (noteId: string) => {
    const curNote = notesFeed.find((n) => n.id == noteId);
    if (!curNote) return;
    setCollapsedState(noteId, !curNote.collapsed);
  };

  const handleNavigate = (event: KeyboardEvent, isCtrlCommand: boolean) => {
    if (
      (eventKeyRef.current !== 'ArrowUp' &&
        eventKeyRef.current !== 'ArrowDown') ||
      isCtrlCommand
    ) {
      return;
    }

    event.preventDefault();

    lastKeyRef.current = null;
    clearTimeout(timeout);

    let curNote = notesFeed.find((n) => n.id == focusId.current);

    // @ts-ignore
    let curNoteFamily = getFamily(curNote.id, notesFeed);

    let positionShift = 0;

    if (curNote.collapsed && eventKeyRef.current == 'ArrowDown') {
      positionShift = curNoteFamily.length - 1;
    }

    if (eventKeyRef.current === 'ArrowUp' && cursorPosition > 0) {
      let nextPos = cursorPosition - 1;

      for (const range of hiddenRanges) {
        if (nextPos >= range.start && nextPos <= range.end) {
          nextPos = range.start - 1;
          break;
        }
      }

      setCursorPosition(nextPos);
      saveCursorPosition.current = nextPos;

      let navNote = notesFeed.find((n) => n.id == focusId.current);
      let navParentId = navNote.parentId;
      let navParents = [];

      while (navParentId != undefined && navParentId != 'root') {
        let navParent = notesFeed.find((n) => n.id == navParentId);

        navParents.push({
          id: navParentId,
          collapsed: navParent.collapsed,
        });

        navParentId = navParent.parentId;
      }

      let navParentsReverted = navParents.reverse();

      for (let i = 0; i < navParentsReverted.length; i++) {
        if (navParentsReverted[i].collapsed) {
          positionShift = getFamily(navParentsReverted[i].id, notesFeed).length;
          break;
        }
      }

      if (positionShift != 0) {
        setCursorPosition(saveCursorPosition.current - positionShift + 1);
      }
    } else if (
      eventKeyRef.current === 'ArrowDown' &&
      cursorPosition + positionShift < notesFeed.length - 1 &&
      cursorPosition !== null
    ) {
      setCursorPosition(cursorPosition + 1 + positionShift);
    } else if (eventKeyRef.current === 'ArrowDown' && cursorPosition === null) {
      setCursorPosition(0);
    }
  };

  const handleStartEditShortcut = () => {
    if (!(eventKeyRef.current === 'KeyE' && lastKeyRef.current === 'KeyE')) {
      return;
    }

    clearTimeout(timeout);
    lastKeyRef.current = null;

    setTimeout(function () {
      setIsEditTitle(true);
    }, 1);
  };

  const handleOpenNoteShortcut = () => {
    if (!(eventKeyRef.current === 'KeyN' && lastKeyRef.current === 'KeyN')) {
      return;
    }

    let curNote = notesFeed.find((n) => n.id == focusId.current);
    if (!curNote) return;
    Router.push({ pathname: '/', query: { note: curNote.id } }, undefined, {
      shallow: true,
    });
  };

  const handleIndent = (event: KeyboardEvent, isCtrlCommand: boolean) => {
    if (!(eventKeyRef.current == 'ArrowRight' && isCtrlCommand)) {
      return;
    }

    event.preventDefault();

    let curNote = notesFeed.find((n) => n.id == focusId.current);
    if (!curNote) return;

    const sibs = siblingsSortedByParent(notesFeed, curNote.parentId);
    const idx = sibs.findIndex((n) => n.id === focusId.current);
    const prevSiblingId = idx > 0 ? sibs[idx - 1].id : null;

    const newSiblingsCount = notesFeed.filter(
      (n) => n.parentId === prevSiblingId,
    ).length;
    const newSort = newSiblingsCount;
    const newParentId = prevSiblingId;

    if (idx > 0 && prevSiblingId !== null) {
      let newFeed = notesFeed.map((n) => {
        if (n.id === curNote.id) {
          if (!updatedIds.current.includes(n.id)) updatedIds.current.push(n.id);

          return {
            ...n,
            parentId: newParentId,
            sort: newSort,
          };
        } else if (
          sameParent(n.parentId, curNote.parentId) &&
          n.sort > curNote.sort
        ) {
          if (!updatedIds.current.includes(n.id)) updatedIds.current.push(n.id);

          return {
            ...n,
            sort: n.sort - 1,
          };
        } else {
          return n;
        }
      });

      newFeed = renormalizeSortsForParent(newFeed, curNote.parentId);
      newFeed = renormalizeSortsForParent(newFeed, newParentId);
      markSiblingsForSync(newFeed, curNote.parentId, updatedIds.current);
      markSiblingsForSync(newFeed, newParentId, updatedIds.current);

      scheduleSyncUpdate();

      syncFeed.current = newFeed;
      setNotesFeed(newFeed);
    }
  };

  const handleUnindent = (event: KeyboardEvent, isCtrlCommand: boolean) => {
    if (!(eventKeyRef.current == 'ArrowLeft' && isCtrlCommand)) {
      return;
    }

    event.preventDefault();

    let curNote = notesFeed.find((n) => n.id == focusId.current);
    if (!curNote) return;

    let parentId = curNote.parentId;

    let curNoteSiblings = siblingsSortedByParent(notesFeed, curNote.parentId);
    const sibIdx = curNoteSiblings.findIndex((n) => n.id === focusId.current);
    let parentFamily = getFamily(curNote.parentId, notesFeed);

    // @ts-ignore
    let curNoteFamily = removeFamily(curNote.id, parentFamily);

    let positionShift = 0;

    if (sibIdx >= 0 && sibIdx < curNoteSiblings.length - 1) {
      positionShift = curNoteFamily.length - 1;
    }

    if (parentKey(parentId) !== 'root') {
      let curParent = notesFeed.find((n) => n.id == parentId);
      let newParentId = curParent.parentId;
      let newSort = curParent.sort + 1;

      let newFeed = notesFeed.map((n) => {
        if (n.id === curNote.id) {
          if (!updatedIds.current.includes(n.id)) updatedIds.current.push(n.id);

          return {
            ...n,
            isNew: false,
            parentId: newParentId,
            sort: newSort,
          };
        } else if (
          sameParent(n.parentId, newParentId) &&
          n.sort > curParent.sort
        ) {
          if (!updatedIds.current.includes(n.id)) updatedIds.current.push(n.id);

          return {
            ...n,
            sort: n.sort + 1,
          };
        } else if (sameParent(n.parentId, parentId) && n.sort > curNote.sort) {
          if (!updatedIds.current.includes(n.id)) updatedIds.current.push(n.id);

          return {
            ...n,
            sort: n.sort - 1,
          };
        } else {
          return n;
        }
      });

      newFeed = renormalizeSortsForParent(newFeed, parentId);
      newFeed = renormalizeSortsForParent(newFeed, newParentId);
      markSiblingsForSync(newFeed, parentId, updatedIds.current);
      markSiblingsForSync(newFeed, newParentId, updatedIds.current);

      scheduleSyncUpdate();

      syncFeed.current = newFeed;
      setNotesFeed(newFeed);
      setCursorPosition(cursorPosition + positionShift);
    }
  };

  const handleCollapse = (event: KeyboardEvent, isCtrlCommand: boolean) => {
    if (
      (eventKeyRef.current != 'ArrowRight' &&
        eventKeyRef.current != 'ArrowLeft') ||
      isCtrlCommand
    ) {
      return;
    }

    event.preventDefault();

    let collapsed = false;
    if (eventKeyRef.current == 'ArrowLeft') {
      collapsed = true;
    }

    let curNote = notesFeed.find((n) => n.id == focusId.current);
    if (!curNote) return;
    setCollapsedState(curNote.id, collapsed);
  };

  const handleSort = (event: KeyboardEvent, isCtrlCommand: boolean) => {
    if (
      (eventKeyRef.current != 'ArrowUp' &&
        eventKeyRef.current != 'ArrowDown') ||
      !isCtrlCommand
    ) {
      return;
    }

    event.preventDefault();

    let sortShift = 0;
    let curNote = notesFeed.find((n) => n.id == focusId.current);
    if (!curNote) return;

    const curNoteSiblings = siblingsSortedByParent(notesFeed, curNote.parentId);
    const sIdx = curNoteSiblings.findIndex((n) => n.id === curNote.id);

    let shiftedNote: NotesListItemProps | null = null;

    if (eventKeyRef.current == 'ArrowUp') {
      if (sIdx > 0) {
        sortShift = -1;
        shiftedNote = curNoteSiblings[sIdx - 1];
      }
    } else if (eventKeyRef.current == 'ArrowDown') {
      if (sIdx >= 0 && sIdx < curNoteSiblings.length - 1) {
        sortShift = 1;
        shiftedNote = curNoteSiblings[sIdx + 1];
      }
    }

    if (sortShift !== 0 && shiftedNote) {
      const shiftedNoteFamily = getFamily(shiftedNote.id, notesFeed);
      const curSort = curNote.sort ?? 0;
      const otherSort = shiftedNote.sort ?? 0;

      updatedIds.current.push(curNote.id);
      updatedIds.current.push(shiftedNote.id);

      let newFeed = notesFeed.map((n) => {
        if (n.id === curNote.id) {
          return {
            ...n,
            sort: otherSort,
          };
        } else if (n.id === shiftedNote.id) {
          return {
            ...n,
            sort: curSort,
          };
        } else {
          return n;
        }
      });

      newFeed = renormalizeSortsForParent(newFeed, curNote.parentId);
      markSiblingsForSync(newFeed, curNote.parentId, updatedIds.current);

      scheduleSyncUpdate();

      syncFeed.current = newFeed;
      setNotesFeed(newFeed);

      setCursorPosition(cursorPosition + sortShift * shiftedNoteFamily.length);
    }
  };

  const handleComplete = (event: KeyboardEvent) => {
    if (eventKeyRef.current != 'Space') {
      return;
    }

    event.preventDefault();

    let curNote = notesFeed.find((n) => n.id == focusId.current);

    // @ts-ignore
    let removedFeed = removeFamily(curNote.id, notesFeed);

    let remainingIds = removedFeed.map((n) => n.id);
    let allIds = notesFeed.map((n) => n.id);
    let completeIds = [];

    allIds.map((id) => {
      if (!remainingIds.includes(id)) {
        completeIds.push(id);
      }
    });

    let newFeed = notesFeed.map((n) => {
      if (completeIds.includes(n.id)) {
        if (!updatedIds.current.includes(n.id)) updatedIds.current.push(n.id);

        return {
          ...n,
          complete: !curNote.complete,
        };
      } else {
        return n;
      }
    });

    scheduleSyncUpdate();
    syncFeed.current = newFeed;
    setNotesFeed(newFeed);
  };

  const handleCompleteChange = (noteId: string, isComplete: boolean) => {
    clearDeleteUndo();
    const curNote = notesFeed.find((n) => n.id === noteId);
    if (!curNote) return;

    const familyIds = new Set(getFamily(noteId, notesFeed).map((n) => n.id));

    const newFeed = notesFeed.map((n) => {
      if (!familyIds.has(n.id)) return n;
      if (!updatedIds.current.includes(n.id)) {
        updatedIds.current.push(n.id);
      }
      return { ...n, complete: isComplete };
    });

    scheduleSyncUpdate();
    syncFeed.current = newFeed;
    setNotesFeed(newFeed);
  };

  const handleDeleteShortcut = () => {
    if (eventKeyRef.current == 'Delete') {
      handleDelete();
    }
  };

  const handleInsertShortcut = (event: KeyboardEvent) => {
    if (eventKeyRef.current != 'Enter') {
      return;
    }
    // Holding Enter fires repeated keydowns before React state updates; each
    // would enqueue another insert and corrupt cursor/focus.
    if (event.repeat) {
      return;
    }
    event.preventDefault();
    insertNote(event);
  };

  const handlePriorityShortcut = (event: KeyboardEvent) => {
    const priorityByCode: Record<string, number> = {
      Digit1: 1,
      Numpad1: 1,
      Digit2: 2,
      Numpad2: 2,
      Digit3: 3,
      Numpad3: 3,
    };
    const nextPriority = priorityByCode[event.code];
    if (!nextPriority) {
      return;
    }

    const curNote = notesFeed.find((n) => n.id == focusId.current);
    if (!curNote) {
      return;
    }

    event.preventDefault();

    const updatedPriority =
      curNote.priority === nextPriority ? null : nextPriority;
    const newFeed = notesFeed.map((n) => {
      if (n.id !== curNote.id) {
        return n;
      }

      if (!updatedIds.current.includes(n.id)) {
        updatedIds.current.push(n.id);
      }

      return {
        ...n,
        priority: updatedPriority,
      };
    });

    scheduleSyncUpdate();
    syncFeed.current = newFeed;
    setNotesFeed(newFeed);
  };

  const handleBoldShortcut = (event: KeyboardEvent, isCtrlCommand: boolean) => {
    if (!(isCtrlCommand && eventKeyRef.current === 'KeyB')) {
      return;
    }

    const curNote = notesFeed.find((n) => n.id == focusId.current);
    if (!curNote) {
      return;
    }

    event.preventDefault();

    const newFeed = notesFeed.map((n) => {
      if (n.id !== curNote.id) {
        return n;
      }

      if (!updatedIds.current.includes(n.id)) {
        updatedIds.current.push(n.id);
      }

      const currentTitle = n.title ?? '';
      const boldMatch = currentTitle.match(/^\*\*([\s\S]+)\*\*$/);
      const newTitle = boldMatch ? boldMatch[1] : `**${currentTitle}**`;

      return {
        ...n,
        title: newTitle,
      };
    });

    scheduleSyncUpdate();
    syncFeed.current = newFeed;
    setNotesFeed(newFeed);
  };

  const handleItalicShortcut = (
    event: KeyboardEvent,
    isCtrlCommand: boolean,
  ) => {
    if (!(isCtrlCommand && eventKeyRef.current === 'KeyI')) return;

    const curNote = notesFeed.find((n) => n.id == focusId.current);
    if (!curNote) return;

    event.preventDefault();

    const newFeed = notesFeed.map((n) => {
      if (n.id !== curNote.id) return n;
      if (!updatedIds.current.includes(n.id)) updatedIds.current.push(n.id);

      const t = n.title ?? '';
      const isBold = /^\*\*([\s\S]+)\*\*$/.test(t);
      const isItalic = !isBold && /^\*([\s\S]+)\*$/.test(t);
      const newTitle = isItalic ? t.slice(1, -1) : `*${t}*`;

      return { ...n, title: newTitle };
    });

    scheduleSyncUpdate();
    syncFeed.current = newFeed;
    setNotesFeed(newFeed);
  };

  const handleHeadingShortcut = () => {
    if (!(eventKeyRef.current === 'KeyH' && lastKeyRef.current === 'KeyM'))
      return;

    const curNote = notesFeed.find((n) => n.id == focusId.current);
    if (!curNote) return;

    clearTimeout(timeout);
    lastKeyRef.current = null;

    const newFeed = notesFeed.map((n) => {
      if (n.id !== curNote.id) return n;
      if (!updatedIds.current.includes(n.id)) updatedIds.current.push(n.id);

      const t = n.title ?? '';
      const headingMatch = t.match(/^(#{1,3})\s+([\s\S]*)$/);
      let newTitle: string;

      if (headingMatch) {
        newTitle = headingMatch[2];
      } else {
        const depth = getNoteDepth(n.id, notesFeed);
        const level = Math.min(depth + 1, 3);
        newTitle = `${'#'.repeat(level)} ${t}`;
      }

      return { ...n, title: newTitle };
    });

    scheduleSyncUpdate();
    syncFeed.current = newFeed;
    setNotesFeed(newFeed);
  };

  const onKeyPress = (event: KeyboardEvent): void => {
    let isCtrlCommand = event.ctrlKey || event.metaKey;
    const target = event.target as HTMLElement | null;
    const isTypingTarget =
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable;

    if (isTypingTarget) {
      return;
    }

    if (isNoteModalOpen) {
      // Note modal is open; block list hotkeys/navigation.
      return;
    }

    if (isCtrlCommand && event.code === 'KeyZ' && !event.shiftKey) {
      if (deleteUndoRef.current) {
        event.preventDefault();
        performUndoRestore();
        return;
      }
    }

    eventKeyRef.current = event.code;

    clearTimeout(timeout);
    timeout = setTimeout(function () {
      lastKeyRef.current = null;
    }, 1000);

    if (!isEditTitle) {
      handleNavigate(event, isCtrlCommand);
      handleStartEditShortcut();
      handleOpenNoteShortcut();
      handleIndent(event, isCtrlCommand);
      handleUnindent(event, isCtrlCommand);
      handleCollapse(event, isCtrlCommand);
      handleSort(event, isCtrlCommand);
      handleComplete(event);
      handleDeleteShortcut();
      handleInsertShortcut(event);
      handlePriorityShortcut(event);
      handleBoldShortcut(event, isCtrlCommand);
      handleItalicShortcut(event, isCtrlCommand);
      handleHeadingShortcut();
    } else {
      // clearTimeout(timeout);
      // lastKeyRef.current = null;
    }

    if (eventKeyRef.current == 'Escape') {
      clearTimeout(timeout);
      lastKeyRef.current = null;
    }

    lastKeyRef.current = eventKeyRef.current;
  };

  useKeyPress([], onKeyPress);

  useEffect(() => {
    if (!router.isReady) return;

    const shouldLock = Boolean(router.query.note);

    if (!shouldLock) {
      // Restore body scroll if we previously locked it.
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
      return;
    }

    // Lock scroll to prevent underlying list/page scrolling.
    const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Keep window position when the scrollbar disappears (layout shift).
    if (typeof window !== 'undefined') {
      window.scrollTo(0, scrollY);
    }

    const el = notesListScrollRef.current;
    const prevent = (e: Event) => {
      e.preventDefault();
    };

    // Prevent wheel/touch scroll on the list container while modal is open.
    if (el) {
      el.addEventListener('wheel', prevent, { passive: false });
      el.addEventListener('touchmove', prevent, { passive: false } as any);
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (typeof window !== 'undefined') {
        const y = scrollY;
        requestAnimationFrame(() => {
          window.scrollTo(0, y);
        });
      }
      if (el) {
        el.removeEventListener('wheel', prevent as any);
        el.removeEventListener('touchmove', prevent as any);
      }
    };
  }, [router.isReady, router.query.note]);

  // TODO feed and updatedIds should be parameters
  const reorderNotes = async (
    prevFeed: NotesListItemProps[],
    feed: NotesListItemProps[] | null,
    ids: string[],
  ): Promise<void> => {
    const body = { prevFeed, feed, ids };

    try {
      await fetch('/api/update/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.error(error);
    }
  };

  const handleEdit = (noteId: string, title: string): void => {
    clearDeleteUndo();

    let curNote = notesFeed.find((n) => n.id == noteId);
    if (!curNote) return;

    const titleBlocks = title
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n+/)
      .map((part) => part.replace(/\n+/g, ' ').trimEnd())
      .filter((part) => part.trim().length > 0)
      .map((part) => {
        const indentMatch = part.match(/^[ \t]*/)?.[0] ?? '';
        const level = indentMatch.replace(/\t/g, '  ').length;
        return {
          level,
          text: part.slice(indentMatch.length).trim(),
        };
      })
      .filter((part) => part.text.length > 0);

    if (titleBlocks.length > 1) {
      const firstTitle = titleBlocks[0].text;
      const additionalBlocks = titleBlocks.slice(1);
      const levelAnchors = new Map<number, string>([[0, curNote.id]]);
      const siblingsToInsertAtRoot = additionalBlocks.filter(
        (b) => b.level === 0,
      ).length;
      const childCounts = new Map<string, number>();

      for (const n of notesFeed) {
        const key = parentKey(n.parentId);
        childCounts.set(key, (childCounts.get(key) ?? 0) + 1);
      }

      let rootInsertOffset = 0;
      const newNotes: NotesListItemProps[] = additionalBlocks.map((block) => {
        let resolvedLevel = block.level;
        while (resolvedLevel > 0 && !levelAnchors.has(resolvedLevel - 1)) {
          resolvedLevel -= 1;
        }

        let parentForNewNote: string | undefined;
        let sortForNewNote = 0;

        if (resolvedLevel === 0) {
          parentForNewNote = curNote.parentId;
          sortForNewNote = (curNote.sort ?? 0) + 1 + rootInsertOffset;
          rootInsertOffset += 1;
        } else {
          parentForNewNote = levelAnchors.get(resolvedLevel - 1);
          const parentKeyValue = parentKey(parentForNewNote);
          sortForNewNote = childCounts.get(parentKeyValue) ?? 0;
          childCounts.set(parentKeyValue, sortForNewNote + 1);
        }

        const newNote: NotesListItemProps = {
          id: crypto.randomUUID(),
          title: block.text,
          priority: null,
          sort: sortForNewNote,
          isNew: false,
          parentId: parentForNewNote,
        };

        levelAnchors.set(resolvedLevel, newNote.id);
        for (const key of Array.from(levelAnchors.keys())) {
          if (key > resolvedLevel) {
            levelAnchors.delete(key);
          }
        }

        return newNote;
      });

      let newFeed = notesFeed.map((n) => {
        if (n.id === noteId) {
          if (!updatedIds.current.includes(n.id)) updatedIds.current.push(n.id);
          return {
            ...n,
            title: firstTitle,
            isNew: false,
          };
        }

        if (
          sameParent(n.parentId, curNote.parentId) &&
          (n.sort ?? 0) > (curNote.sort ?? 0)
        ) {
          if (!updatedIds.current.includes(n.id)) updatedIds.current.push(n.id);
          return {
            ...n,
            sort: (n.sort ?? 0) + siblingsToInsertAtRoot,
          };
        }

        return n;
      });

      newFeed = [...newFeed, ...newNotes];
      newFeed = renormalizeSortsForParent(newFeed, curNote.parentId);
      markSiblingsForSync(newFeed, curNote.parentId, updatedIds.current);
      for (const nn of newNotes) {
        if (!updatedIds.current.includes(nn.id)) updatedIds.current.push(nn.id);
      }

      setIsEditTitle(false);
      scheduleSyncUpdate();
      syncFeed.current = newFeed;
      setNotesFeed(newFeed);
      const lastCreatedNoteId = newNotes[newNotes.length - 1]?.id;
      if (lastCreatedNoteId) {
        let position = 0;
        const getPositionById = (parentId: string): number | null => {
          const children = newFeed
            .filter((n) => (n.parentId ?? 'root') === parentId)
            .slice()
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

          for (const note of children) {
            if (note.id === lastCreatedNoteId) return position;
            position += 1;
            const nestedFound = getPositionById(note.id);
            if (nestedFound !== null) return nestedFound;
          }

          return null;
        };

        const nextPosition = getPositionById('root');
        if (nextPosition !== null) {
          setCursorPosition(nextPosition);
          focusId.current = lastCreatedNoteId;
        }
      }
      return;
    }

    let newFeed = notesFeed.map((n) => {
      if (n.id === noteId) {
        return {
          ...n,
          title: title,
          isNew: false,
        };
      } else {
        return n;
      }
    });

    setIsEditTitle(false);

    updatedIds.current.push(noteId);

    if (curNote.isNew) {
      newFeed.map((n) => {
        if (
          sameParent(n.parentId, curNote.parentId) &&
          n.sort >= curNote.sort &&
          n.id != noteId
        ) {
          updatedIds.current.push(n.id);
        }
      });

      const newId = crypto.randomUUID();

      newFeed = [
        ...newFeed,
        {
          id: newId,
          title: '',
          priority: null,
          sort: curNote.sort + 1,
          isNew: true,
          parentId: curNote.parentId,
        },
      ];

      syncFeed.current = newFeed;

      newFeed = newFeed.map((n) => {
        if (
          n.sort > curNote.sort &&
          sameParent(n.parentId, curNote.parentId) &&
          n.id != newId
        ) {
          return {
            ...n,
            sort: n.sort + 1,
          };
        } else {
          return n;
        }
      });

      newFeed = renormalizeSortsForParent(newFeed, curNote.parentId);
      markSiblingsForSync(newFeed, curNote.parentId, updatedIds.current);
      const placeholderIdx = updatedIds.current.indexOf(newId);
      if (placeholderIdx >= 0) updatedIds.current.splice(placeholderIdx, 1);

      setIsEditTitle(true);

      prevCursorPosition.current = cursorPosition;

      setCursorPosition(cursorPosition + 1);
    }

    scheduleSyncUpdate();

    syncFeed.current = newFeed;

    setNotesFeed(newFeed);
  };

  const handleCancel = (
    isNewParam: boolean,
    noteId: string,
    parentId: string | undefined,
    sort: number | undefined,
  ): void => {
    clearDeleteUndo();
    setIsEditTitle(false);
    clearTimeout(timeout);
    lastKeyRef.current = null;

    if (isNewParam) {
      let newFeed = notesFeed.map((n) => {
        if (n.sort > sort && sameParent(n.parentId, parentId)) {
          return {
            ...n,
            sort: n.sort - 1,
          };
        } else {
          return n;
        }
      });

      newFeed = newFeed.filter((n) => n.id !== noteId);

      newFeed = renormalizeSortsForParent(newFeed, parentId);

      // updatedIds.current = updatedIds.current.filter(id => {id != noteId});
      //
      // console.log(updatedIds.current)

      //setTimeout(function () {
      setNotesFeed(newFeed);
      setCursorPosition(prevCursorPosition.current);
      //},1);
    }
  };

  const runMenuAction = (
    noteId: string,
    position: number,
    actionId: NotesItemAction,
  ) => {
    focusId.current = noteId;
    setCursorPosition(position);

    const fakeEvent: {
      preventDefault: () => void;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      code: string;
      key: string;
    } = {
      preventDefault: () => {},
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      code: '',
      key: '',
    };

    switch (actionId) {
      case 'addBelow':
        insertNote({ shiftKey: false, altKey: false });
        return;
      case 'addAbove':
        insertNote({ shiftKey: false, altKey: true });
        return;
      case 'addSubItem':
        insertNote({ shiftKey: true, altKey: false });
        return;
      case 'editTitle':
        setIsEditTitle(true);
        return;
      case 'openNote':
        Router.push({ pathname: '/', query: { note: noteId } }, undefined, {
          shallow: true,
        });
        return;
      case 'navigateUp':
        eventKeyRef.current = 'ArrowUp';
        handleNavigate(fakeEvent as KeyboardEvent, false);
        return;
      case 'navigateDown':
        eventKeyRef.current = 'ArrowDown';
        handleNavigate(fakeEvent as KeyboardEvent, false);
        return;
      case 'collapse':
        eventKeyRef.current = 'ArrowLeft';
        handleCollapse(fakeEvent as KeyboardEvent, false);
        return;
      case 'expand':
        eventKeyRef.current = 'ArrowRight';
        handleCollapse(fakeEvent as KeyboardEvent, false);
        return;
      case 'indent':
        eventKeyRef.current = 'ArrowRight';
        handleIndent(fakeEvent as KeyboardEvent, true);
        return;
      case 'outdent':
        eventKeyRef.current = 'ArrowLeft';
        handleUnindent(fakeEvent as KeyboardEvent, true);
        return;
      case 'reorderUp':
        eventKeyRef.current = 'ArrowUp';
        handleSort(fakeEvent as KeyboardEvent, true);
        return;
      case 'reorderDown':
        eventKeyRef.current = 'ArrowDown';
        handleSort(fakeEvent as KeyboardEvent, true);
        return;
      case 'complete':
        eventKeyRef.current = 'Space';
        handleComplete(fakeEvent as KeyboardEvent);
        return;
      case 'delete':
        handleDelete(noteId);
        return;
      case 'priority1':
        fakeEvent.code = 'Digit1';
        handlePriorityShortcut(fakeEvent as KeyboardEvent);
        return;
      case 'priority2':
        fakeEvent.code = 'Digit2';
        handlePriorityShortcut(fakeEvent as KeyboardEvent);
        return;
      case 'priority3':
        fakeEvent.code = 'Digit3';
        handlePriorityShortcut(fakeEvent as KeyboardEvent);
        return;
      case 'bold':
        eventKeyRef.current = 'KeyB';
        handleBoldShortcut(fakeEvent as KeyboardEvent, true);
        return;
      case 'italic':
        eventKeyRef.current = 'KeyI';
        handleItalicShortcut(fakeEvent as KeyboardEvent, true);
        return;
      case 'heading':
        eventKeyRef.current = 'KeyH';
        lastKeyRef.current = 'KeyM';
        handleHeadingShortcut();
        lastKeyRef.current = null;
        return;
    }
  };

  return (
    <div className="flex flex-wrap gap-[30px]">
      <div className="grow basis-0">
        {/*<div>{isUpdating ? "true" : "false"}</div>*/}

        {!notesFeed.length && (
          <div className="new-note-hint">
            Press&nbsp;<span>Enter</span>&nbsp;to add your first note!
          </div>
        )}

        <div ref={notesListScrollRef} className={styles.notes_list}>
          <NotesProvider feed={notesFeed}>
            {(() => {
              const rootNotes = notesFeed
                .filter((n) => n.parentId === 'root')
                .slice()
                .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

              let positionCursor = 0;

              return rootNotes.map((note) => {
                const familyCount = getFamily(note.id, notesFeed).length;
                const position = positionCursor;
                positionCursor += familyCount;

                return (
                  <NotesListItem
                    key={note.id}
                    id={note.id}
                    sort={note.sort}
                    position={position}
                    familyCount={familyCount}
                    title={note.title}
                    priority={note.priority}
                    hasContent={note.hasContent}
                    complete={note.complete}
                    collapsed={note.collapsed}
                    parentId={note.parentId}
                    cursorPosition={cursorPosition}
                    // isFocus={note.position === cursorPosition}
                    // isEdit={note.position === cursorPosition && isEditTitle}
                    isFocus={position === cursorPosition}
                    isEdit={position === cursorPosition && isEditTitle}
                    isEditTitle={isEditTitle}
                    onCancel={handleCancel}
                    onFocus={(curId) => {
                      focusId.current = curId;
                    }}
                    onSelect={(curId, position, startEditTitle) => {
                      if (showRestoreUndo && focusId.current !== curId) {
                        clearDeleteUndo();
                      }
                      // Clicking moves focus; double-click enters edit mode.
                      setIsEditTitle(Boolean(startEditTitle));
                      setCursorPosition(position);
                      focusId.current = curId;
                    }}
                    onEdit={handleEdit}
                    onAdd={handleEdit}
                    onDelete={(curId) => handleDelete(curId)}
                    isNew={note.isNew}
                    onToggleCollapse={(curId, position) => {
                      handleToggleCollapse(curId);
                      setCursorPosition(position);
                      focusId.current = curId;
                    }}
                    onComplete={handleCompleteChange}
                    onRunAction={runMenuAction}
                  />
                );
              });
            })()}
          </NotesProvider>
        </div>

        <div className={styles.mobile_toolbar + ' md:hidden'}>
          <Button
            type="button"
            variant="primary"
            onClick={handleMobileAddBelow}
          >
            Add below
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleMobileAddAbove}
          >
            Add above
          </Button>
        </div>

        {showRestoreUndo && (
          <button
            type="button"
            className={styles.restore_undo_btn}
            aria-label="Restore deleted note"
            onClick={() => performUndoRestore()}
          >
            Restore
          </button>
        )}
      </div>
      <div className="flex-[0_0_340px] max-w-[340px] hidden md:block">
        <NotesHotkeysHints />
      </div>
    </div>
  );
};

export default NotesList;
