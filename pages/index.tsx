import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAutoResizeTextarea } from '@/lib/useAutoResizeTextarea';
import { GetServerSideProps } from 'next';
import Layout from '@/components/Layout';
import NotesList, { FeedModalSync } from '@/components/NotesList';
import { NotesListItemProps } from '@/components/NotesListItem';
import { Button } from '@/components/Button';
import prisma from '@/lib/prisma';
import { getSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import Modal from 'react-modal';
import ReactMarkdown from 'react-markdown';
import { X } from 'react-feather';
import MarkdownNoteEditor from '@/components/MarkdownNoteEditor';
import { getFamily } from '@/lib/notesTree';
import {
  applyInlineMarkdown,
  handleTitleMarkdownPaste,
} from '@/lib/markdownInput';
if (typeof document !== 'undefined') {
  Modal.setAppElement('#__next');
}

/**
 * Demo feed: same fields as Prisma `Note` in the list + body (`content` / `hasContent`).
 */
const mockNotes: NotesListItemProps[] = [
  // === Travel (first root tree) ===
  {
    id: '1',
    title: 'Family trip',
    content: '',
    sort: 0,
    parentId: 'root',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '2',
    title: 'This week: where we go & what to see',
    content: `**Shortlist**
- Rome / Florence — art & food
- Train between cities — book early

**Open questions**
- Dates vs school holidays`,
    sort: 0,
    parentId: '1',
    collapsed: false,
    complete: false,
    priority: 2,
    hasContent: true,
    authorId: null,
  },
  {
    id: '3',
    title: 'Italy — Tuscany & trains',
    content: `Focus on **Tuscany** this time.

- [ ] Agriturismo
- [ ] Car vs trains`,
    sort: 0,
    parentId: '2',
    collapsed: false,
    complete: true,
    hasContent: true,
    authorId: null,
  },
  {
    id: '4',
    title: 'Greece — if we have time',
    content: '',
    sort: 1,
    parentId: '2',
    collapsed: false,
    complete: false,
    priority: 3,
    hasContent: false,
    authorId: null,
  },
  {
    id: '5',
    title: 'Booking',
    content: '',
    sort: 1,
    parentId: '1',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '22',
    title:
      '**Outbound** booked — *return* still open · [seat map](https://www.google.com/flights)',
    content: '',
    sort: 2,
    parentId: '1',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '6',
    title: 'Flights — fares climbing',
    content: `Google Flights — **+12%** vs last week on our dates.

Airline A: flexible fare OK · Airline B: basic only — skip.`,
    sort: 0,
    parentId: '5',
    collapsed: false,
    complete: false,
    priority: 1,
    hasContent: true,
    authorId: null,
  },
  {
    id: '7',
    title: 'Hotels — shortlist',
    content: `**Center** — demo €120–180  
**Near station** — demo €90–130

Free cancel 48h — prioritize.`,
    sort: 1,
    parentId: '5',
    collapsed: false,
    complete: false,
    hasContent: true,
    authorId: null,
  },

  // === Second root tree (nested headings + real rows) ===
  {
    id: '19',
    title: '# Website relaunch',
    content: '',
    sort: 1,
    parentId: 'root',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '23',
    title: 'Copy deck due Wednesday — legal still reviewing',
    content: '',
    sort: 0,
    parentId: '19',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '24',
    title: 'Hero image: design owes us two crops by EOD',
    content: '',
    sort: 1,
    parentId: '19',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '25',
    title: 'Pricing page — numbers confirmed with finance',
    content: '',
    sort: 2,
    parentId: '19',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '20',
    title: '## QA & staging',
    content: '',
    sort: 3,
    parentId: '19',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '26',
    title: 'Smoke test on staging before demo Friday',
    content: '',
    sort: 0,
    parentId: '20',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '27',
    title: 'Safari scroll bug — ticket RN-204, in progress',
    content: '',
    sort: 1,
    parentId: '20',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '21',
    title: '### Go-live',
    content: '',
    sort: 2,
    parentId: '20',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '28',
    title: 'Deploy window 6–8 am CET — ping releases channel',
    content: '',
    sort: 0,
    parentId: '21',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '29',
    title: 'Post-mortem template — link in repo wiki',
    content: '',
    sort: 1,
    parentId: '21',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '30',
    title: 'Customer email draft — waiting on marketing sign-off',
    content: '',
    sort: 2,
    parentId: '21',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },

  // === Work ===
  {
    id: '8',
    title: 'Work: tooling & releases',
    content: `### Next sync
- Pain: deploy times
- Proposal: shared CLI wrapper

_No decisions — gather feedback first._`,
    sort: 2,
    parentId: 'root',
    collapsed: false,
    complete: false,
    priority: 2,
    hasContent: true,
    authorId: null,
  },
  {
    id: '9',
    title: 'CI/CD pipeline refresh',
    content: `**build → test → deploy**

- Cache deps
- Parallelize slow suite by folder

Branch: \`chore/ci-speed\` (demo)`,
    sort: 0,
    parentId: '8',
    collapsed: false,
    complete: false,
    hasContent: true,
    authorId: null,
  },
  {
    id: '10',
    title: 'Monitoring — after release',
    content: '',
    sort: 1,
    parentId: '8',
    collapsed: false,
    complete: false,
    priority: 3,
    hasContent: false,
    authorId: null,
  },
  {
    id: '11',
    title: 'Alert thresholds — checkout spike',
    content: `**Symptom:** p95 latency + errors on checkout API.

**Hypothesis:** DB pool exhausted — raise max + alert on timeouts.

**Action:** hotfix tonight; proper fix tomorrow.`,
    sort: 0,
    parentId: '10',
    collapsed: false,
    complete: true,
    priority: 1,
    hasContent: true,
    authorId: null,
  },
  {
    id: '12',
    title: 'Log aggregation — Vector → S3',
    content: `**Vector** → S3 → Athena for ad-hoc queries.

On-call: wiki / demo runbook (placeholder).`,
    sort: 1,
    parentId: '10',
    collapsed: false,
    complete: false,
    hasContent: true,
    authorId: null,
  },

  // === Reading ===
  {
    id: '13',
    title: 'Reading list',
    content: '',
    sort: 3,
    parentId: 'root',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '14',
    title: 'Fiction',
    content: '',
    sort: 0,
    parentId: '13',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '15',
    title: '1984 — finish this weekend',
    content: `Part 1 done · Part 2 after Ch. 5.

Themes: **surveillance**, language, truth.

*Who controls the past…*`,
    sort: 0,
    parentId: '14',
    collapsed: false,
    complete: true,
    priority: 2,
    hasContent: true,
    authorId: null,
  },
  {
    id: '16',
    title: 'The Hobbit',
    content: '',
    sort: 1,
    parentId: '14',
    collapsed: false,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '17',
    title: 'Non-fiction',
    content: '',
    sort: 1,
    parentId: '13',
    collapsed: true,
    complete: false,
    hasContent: false,
    authorId: null,
  },
  {
    id: '18',
    title: 'Sapiens — someday',
    content: `Skimmed intro — full read when travel plans settle.

Cognitive revolution vs fiction — ties to planning notes.`,
    sort: 0,
    parentId: '17',
    collapsed: false,
    complete: false,
    priority: 3,
    hasContent: true,
    authorId: null,
  },
];

const DEMO_NOTE_STORAGE_PREFIX = 'demo-note:';
const DEMO_DELETED_IDS_KEY = 'demo-deleted-note-ids';

function readDemoDeletedIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DEMO_DELETED_IDS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeDemoDeletedIds(ids: string[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DEMO_DELETED_IDS_KEY, JSON.stringify(ids));
}

function readDemoNoteOverride(noteId: string): {
  title?: string;
  content?: string;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DEMO_NOTE_STORAGE_PREFIX + noteId);
    if (!raw) return null;
    return JSON.parse(raw) as { title?: string; content?: string };
  } catch {
    return null;
  }
}

function writeDemoNoteOverride(
  noteId: string,
  title: string,
  content: string,
): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(
    DEMO_NOTE_STORAGE_PREFIX + noteId,
    JSON.stringify({ title, content }),
  );
}

function getDemoNotePayload(noteId: string): {
  id: string;
  title: string;
  content: string;
  hasContent: boolean;
  authorName: string;
  authorEmail: string | null;
} | null {
  if (readDemoDeletedIds().includes(noteId)) return null;
  const row = mockNotes.find((n) => n.id === noteId);
  if (!row) return null;
  let title = row.title;
  let content = row.content ?? '';
  const o = readDemoNoteOverride(noteId);
  if (o) {
    if (typeof o.title === 'string') title = o.title;
    if (typeof o.content === 'string') content = o.content;
  }
  const hasContent = content.trim().length > 0;
  return {
    id: row.id,
    title,
    content,
    hasContent,
    authorName: '',
    authorEmail: null,
  };
}

// index.tsx
export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getSession(context);

  let feed = [];

  if (session) {
    feed = await prisma.note.findMany({
      orderBy: {
        sort: 'asc',
      },
      where: {
        // @ts-ignore
        authorId: session.user.id,
      },
    });
  }

  return {
    props: { feed, session },
  };
};

type Props = {
  feed: NotesListItemProps[];
  session: any;
};

const Main: React.FC<Props> = (props) => {
  const router = useRouter();

  const [demoDeletedIds, setDemoDeletedIds] = useState<string[]>([]);
  const localFeedRef = useRef<NotesListItemProps[]>([]);

  useEffect(() => {
    queueMicrotask(() => setDemoDeletedIds(readDemoDeletedIds()));
  }, []);

  const demoFeed = useMemo(
    () => mockNotes.filter((n) => !demoDeletedIds.includes(n.id)),
    [demoDeletedIds],
  );

  const noteIdFromQuery = useMemo(() => {
    const raw = router.query.note;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return raw[0] ?? null;
    return null;
  }, [router.query.note]);

  const isRouterReady = router.isReady;
  const isNoteModalOpenReady = isRouterReady && Boolean(noteIdFromQuery);

  const [note, setNote] = useState<{
    id: string;
    title: string;
    content: string;
    hasContent: boolean;
    authorName: string;
    authorEmail: string | null;
  } | null>(null);

  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  const [noteLoadError, setNoteLoadError] = useState<string | null>(null);

  const isNoteReady = Boolean(note && loadedNoteId === noteIdFromQuery);

  const userHasValidSession = Boolean(props.session);
  const sessionEmail: string | undefined = props.session?.user?.email;
  const noteBelongsToUser = Boolean(
    sessionEmail && note?.authorEmail && sessionEmail === note.authorEmail,
  );

  /** Demo behaves like an owned note: same editor, auto-focus, same actions. */
  const canEditNoteLikeOwner =
    !userHasValidSession || (userHasValidSession && noteBelongsToUser);

  const [isTitleInputOpen, setIsTitleInputOpen] = useState(false);

  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [lastSavedTitle, setLastSavedTitle] = useState('');
  const [lastSavedContent, setLastSavedContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const { ref: titleInputRef, callbackRef: titleInputCallbackRef } =
    useAutoResizeTextarea(draftTitle);

  const [feedModalSync, setFeedModalSync] = useState<FeedModalSync | null>(
    null,
  );

  // Modal needs appElement to be configured before first client render.

  useEffect(() => {
    if (!isRouterReady) return;
    if (!noteIdFromQuery) return;

    let cancelled = false;

    if (!props.session) {
      // Demo mode: load from static mock data.
      void Promise.resolve().then(() => {
        if (cancelled) return;
        const data = getDemoNotePayload(noteIdFromQuery);
        if (!data) {
          setNoteLoadError('Note not found');
          return;
        }
        setNote(data);
        setLoadedNoteId(data.id);
        setDraftTitle(data.title ?? '');
        setDraftContent(data.content ?? '');
        setIsTitleInputOpen(false);
      });
      return () => {
        cancelled = true;
      };
    }

    // Use a microtask so state updates don't fire synchronously inside the effect.
    void Promise.resolve().then(() => {
      if (cancelled) return;

      // Optimistic: show local data immediately while the server fetch is in flight.
      const localNote = localFeedRef.current.find(
        (n) => n.id === noteIdFromQuery,
      );

      if (localNote) {
        setNote({
          id: localNote.id,
          title: localNote.title ?? '',
          content: localNote.content ?? '',
          hasContent: localNote.hasContent ?? false,
          authorName: props.session?.user?.name ?? '',
          authorEmail: props.session?.user?.email ?? null,
        });
        setLoadedNoteId(localNote.id);
        setDraftTitle(localNote.title ?? '');
        setDraftContent(localNote.content ?? '');
        setIsTitleInputOpen(false);
      } else {
        setLoadedNoteId(null);
        setNoteLoadError(null);
      }

      fetch(`/api/note/${noteIdFromQuery}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`Failed to load note: ${r.status}`);
          return (await r.json()) as {
            id: string;
            title: string;
            content: string;
            hasContent: boolean;
            authorName: string;
            authorEmail: string | null;
          };
        })
        .then((data) => {
          if (cancelled) return;
          setNote(data);
          setLoadedNoteId(data.id);
          setDraftTitle(data.title ?? '');
          setDraftContent(data.content ?? '');
          setIsTitleInputOpen(false);
        })
        .catch((e) => {
          if (cancelled) return;
          // If we showed optimistic data, keep it — note just isn't on server yet.
          if (localNote) return;
          console.error(e);
          setNoteLoadError(e?.message ?? 'Failed to load note');
        });
    });

    return () => {
      cancelled = true;
    };
  }, [noteIdFromQuery, router, isRouterReady, props.session]);

  useEffect(() => {
    if (isTitleInputOpen) {
      requestAnimationFrame(() => {
        titleInputRef.current?.focus();
      });
    }
  }, [isTitleInputOpen, titleInputRef]);

  const normalizeContent = (value: string | null | undefined): string => {
    const raw = value ?? '';
    return raw.trim().length > 0 ? raw : '';
  };

  useEffect(() => {
    if (!note || loadedNoteId !== note.id) return;
    setLastSavedTitle(note.title ?? '');
    setLastSavedContent(normalizeContent(note.content));
  }, [note, loadedNoteId]);

  const isDraftDirty = useMemo(() => {
    return (
      draftTitle !== lastSavedTitle ||
      normalizeContent(draftContent) !== normalizeContent(lastSavedContent)
    );
  }, [draftTitle, draftContent, lastSavedTitle, lastSavedContent]);

  const draftKey = note ? `note-draft:${note.id}` : null;

  const persistDraft = (
    draftTitleToPersist: string,
    draftContentToPersist: string,
  ) => {
    if (!draftKey) return;
    if (typeof window === 'undefined') return;
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        title: draftTitleToPersist,
        content: draftContentToPersist,
      }),
    );
  };

  const clearDraft = () => {
    if (!draftKey) return;
    if (typeof window === 'undefined') return;
    localStorage.removeItem(draftKey);
  };

  const saveNote = async (
    draftTitleToSave: string,
    draftContentToSave: string,
  ) => {
    if (!note) return null;
    const body = {
      title: draftTitleToSave,
      content: normalizeContent(draftContentToSave),
    };

    if (!props.session) {
      writeDemoNoteOverride(note.id, body.title, body.content);
      const hasContent = body.content.length > 0;
      setNote((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          title: body.title,
          content: body.content,
          hasContent,
        };
      });
      setFeedModalSync({
        rev: Date.now(),
        kind: 'patch',
        noteId: note.id,
        hasContent,
        title: body.title,
      });
      return {
        title: body.title,
        content: body.content,
        hasContent,
      };
    }

    const r = await fetch(`/api/edit/${note.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      throw new Error(`Failed to save note: ${r.status}`);
    }

    const updated = (await r.json()) as {
      title?: string;
      content?: string;
      hasContent?: boolean;
    };

    setNote((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        title: updated.title ?? prev.title,
        content: updated.content ?? prev.content,
        hasContent: Boolean(updated.hasContent),
      };
    });

    setFeedModalSync({
      rev: Date.now(),
      kind: 'patch',
      noteId: note.id,
      hasContent: Boolean(updated.hasContent),
      ...(typeof updated.title === 'string' ? { title: updated.title } : {}),
    });

    const resolvedTitle = updated.title ?? body.title;
    const resolvedContent = updated.content ?? body.content;

    return {
      title: resolvedTitle,
      content: resolvedContent,
      hasContent: Boolean(updated.hasContent),
    };
  };

  const saveAndExit = () => {
    const canPersistOnClose = canEditNoteLikeOwner;

    if (typeof window !== 'undefined' && note?.id) {
      sessionStorage.setItem('notes:last-focus-id', String(note.id));
    }

    if (!canPersistOnClose) {
      router.push('/');
      return;
    }

    if (!note) return;

    const draftTitleToPersist = draftTitle;
    const draftContentToPersist = draftContent ?? '';

    persistDraft(draftTitleToPersist, draftContentToPersist);

    // Optimistic close: navigate immediately, save in background.
    router.push({ pathname: '/' }, undefined, { shallow: true });
    void saveNote(draftTitleToPersist, draftContentToPersist)
      .then(() => {
        clearDraft();
      })
      .catch((error) => {
        console.error(error);
      });
  };

  const editData = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!isDraftDirty || isSaving) return;
    try {
      setIsSaving(true);
      const draftTitleToSave = draftTitle;
      const draftContentToSave = draftContent ?? '';
      const persisted = await saveNote(draftTitleToSave, draftContentToSave);
      clearDraft();
      if (persisted) {
        setDraftTitle(persisted.title);
        setDraftContent(persisted.content);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteNote = async (id: string): Promise<void> => {
    if (!props.session) {
      if (typeof window !== 'undefined') {
        const toRemove = getFamily(id, mockNotes).map((n) => n.id);
        const next = Array.from(
          new Set([...readDemoDeletedIds(), ...toRemove]),
        );
        writeDemoDeletedIds(next);
        setDemoDeletedIds(next);
        for (const rid of toRemove) {
          localStorage.removeItem(DEMO_NOTE_STORAGE_PREFIX + rid);
        }
      }
      setFeedModalSync({
        rev: Date.now(),
        kind: 'removeFamily',
        rootId: id,
      });
      router.push('/');
      return;
    }
    await fetch(`/api/post/${id}`, {
      method: 'DELETE',
    });
    setFeedModalSync({
      rev: Date.now(),
      kind: 'removeFamily',
      rootId: id,
    });
    router.push('/');
  };

  useEffect(() => {
    if (!note || !draftKey) return;
    if (typeof window === 'undefined') return;

    const rawDraft = localStorage.getItem(draftKey);
    if (!rawDraft) return;

    try {
      const parsed = JSON.parse(rawDraft) as {
        title?: string;
        content?: string;
      };

      void Promise.resolve().then(() => {
        if (typeof parsed.title === 'string') {
          setDraftTitle(parsed.title);
        }
        if (typeof parsed.content === 'string') {
          setDraftContent(parsed.content);
        }
      });
    } catch {
      // Ignore malformed draft data.
    }
  }, [note, draftKey]);

  return (
    <Layout>
      <div className="page">
        <div>
          {/*
            <h1>{props.session ? 'Notes' : 'Demo'}</h1>
            */}

          <NotesList
            feed={props.session ? props.feed : demoFeed}
            enableRemoteSync={Boolean(props.session)}
            feedModalSync={feedModalSync}
            onFeedChange={(feed) => {
              localFeedRef.current = feed;
            }}
          />
        </div>
      </div>

      <Modal
        isOpen={isNoteModalOpenReady}
        onRequestClose={saveAndExit}
        contentLabel={note?.title ?? 'Note'}
        shouldFocusAfterRender={false}
        ariaHideApp={false}
        shouldReturnFocusAfterClose={false}
        shouldCloseOnOverlayClick
        className="note_modal"
        overlayClassName="note_modal_overlay"
      >
        {!isNoteReady ? (
          <div className="modal_loading">
            {noteLoadError ? `Error: ${noteLoadError}` : 'Loading...'}
          </div>
        ) : (
          <div className="modal_inner">
            <div className="modal_header">
              {canEditNoteLikeOwner ? (
                isTitleInputOpen ? (
                  <textarea
                    rows={1}
                    ref={(el) => {
                      titleInputCallbackRef(el);
                    }}
                    className="modal_title_input"
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="Title"
                    value={draftTitle}
                    onBlur={() => setIsTitleInputOpen(false)}
                    onPaste={(e) => {
                      if (handleTitleMarkdownPaste(e, setDraftTitle))
                        e.preventDefault();
                    }}
                    onKeyDown={(e) => {
                      const isMod = e.metaKey || e.ctrlKey;
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        setIsTitleInputOpen(false);
                      } else if (isMod && e.key === 'b') {
                        e.preventDefault();
                        applyInlineMarkdown(
                          e.currentTarget,
                          '**',
                          setDraftTitle,
                        );
                      } else if (isMod && e.key === 'i') {
                        e.preventDefault();
                        applyInlineMarkdown(
                          e.currentTarget,
                          '*',
                          setDraftTitle,
                        );
                      }
                    }}
                  />
                ) : (
                  <h2
                    className="modal_title modal_title_clickable"
                    onClick={() => setIsTitleInputOpen(true)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setIsTitleInputOpen(true);
                      }
                    }}
                  >
                    <ReactMarkdown
                      components={{ p: ({ children }) => <>{children}</> }}
                      allowedElements={[
                        'p',
                        'strong',
                        'em',
                        'code',
                        'del',
                        's',
                      ]}
                      unwrapDisallowed
                    >
                      {draftTitle}
                    </ReactMarkdown>
                  </h2>
                )
              ) : (
                <h2 className="modal_title">
                  <ReactMarkdown
                    components={{ p: ({ children }) => <>{children}</> }}
                    allowedElements={['p', 'strong', 'em', 'code', 'del', 's']}
                    unwrapDisallowed
                  >
                    {note?.title ?? ''}
                  </ReactMarkdown>
                </h2>
              )}
              <button
                type="button"
                className="close_button"
                onClick={saveAndExit}
                aria-label="Close"
              >
                <X size={20} strokeWidth={2.5} />
              </button>
            </div>

            {canEditNoteLikeOwner ? (
              <form onSubmit={editData} className="editor_form">
                <MarkdownNoteEditor
                  value={draftContent}
                  onChange={(val) => setDraftContent(val)}
                  placeholder="Content"
                  autoFocus
                />
                <div className="edit_footer">
                  <div className="edit_footer_left">
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => void deleteNote(note.id)}
                    >
                      Delete
                    </Button>
                  </div>

                  <div className="edit_footer_right">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!draftTitle || !isDraftDirty || isSaving}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </form>
            ) : (
              <ReactMarkdown>{note?.content ?? ''}</ReactMarkdown>
            )}
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default Main;
