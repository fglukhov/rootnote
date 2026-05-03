import React, {
  ReactNode,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useSyncExternalStore,
} from 'react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { useDrag } from '@use-gesture/react';
import { useKeyPress } from '@/lib/useKeyPress';
import {
  applyInlineMarkdown,
  handleTitleMarkdownPaste,
} from '@/lib/markdownInput';
import { useAutoResizeTextarea } from '@/lib/useAutoResizeTextarea';
import { getFamily } from '@/lib/notesTree';
import styles from './NotesListItem.module.scss';
import { useNotes } from '@/components/NotesContext';
import Router from 'next/router';

import ReactMarkdown from 'react-markdown';
import { ChevronDown, FileText, MoreVertical } from 'react-feather';

export type NotesListItemProps = {
  id: string;
  title: string;
  content?: string | null;
  authorId?: string | null;
  priority?: number | null;
  hasContent?: boolean;
  sort?: number;
  familyCount?: number;
  position?: number;
  parentPosition?: number;
  feed?: NotesListItemProps[];
  cursorPosition?: number;
  isEdit?: boolean;
  isEditTitle?: boolean;
  isFocus?: boolean;
  isNew?: boolean;
  children?: ReactNode;
  onFocus?: (id: string) => void;
  onSelect?: (
    noteId: string,
    position: number,
    startEditTitle?: boolean,
  ) => void;
  onCancel?: (
    isNewParam: boolean,
    noteId: string,
    parentId: string | undefined,
    sort: number | undefined,
  ) => void;
  onEdit?: (noteId: string, title: string) => void;
  onAdd?: (noteId: string, title: string) => void;
  onComplete?: (noteId: string, isComplete: boolean) => void;
  onDelete?: (
    noteId: string,
    parentId: string | undefined,
    sort: number | undefined,
  ) => void;
  parentId?: string;
  complete?: boolean;
  collapsed?: boolean;
  registerCollapsedRange?: (
    start: number,
    familyCount: number,
    collapsed?: boolean,
  ) => void;
  onToggleCollapse?: (noteId: string, position: number) => void;
  onRunAction?: (
    noteId: string,
    position: number,
    actionId:
      | 'addBelow'
      | 'addAbove'
      | 'addSubItem'
      | 'editTitle'
      | 'openNote'
      | 'navigateUp'
      | 'navigateDown'
      | 'collapse'
      | 'expand'
      | 'indent'
      | 'outdent'
      | 'reorderUp'
      | 'reorderDown'
      | 'complete'
      | 'delete'
      | 'priority1'
      | 'priority2'
      | 'priority3'
      | 'bold'
      | 'italic'
      | 'heading',
  ) => void;
};

const NotesListItem: React.FC<NotesListItemProps> = (props) => {
  const SWIPE_THRESHOLD = 80;
  const MAX_SWIPE_OFFSET = 120;
  const id = props.id;
  const parentId = props.parentId;
  const onSelect = props.onSelect;
  const [title, setTitle] = useState(props.title);
  const sort = props.sort;
  const [prevTitle, setPrevTitle] = useState(props.title);
  const [isNew, setIsNew] = useState(props.isNew);
  const [menuSearch, setMenuSearch] = useState('');
  const [activeActionIndex, setActiveActionIndex] = useState(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const swipeOffsetRef = useRef(0);
  const isSwipeGestureActiveRef = useRef(false);
  const isEditing = props.isEdit && props.isFocus;
  const parentPosition = props.position ?? 0;
  const { callbackRef: titleTextareaCallbackRef } =
    useAutoResizeTextarea(title);
  const isLeaf = (props.familyCount ?? 1) === 1;
  const hasCommittedRef = useRef(false);
  const [menuRenderKey, setMenuRenderKey] = useState(0);
  const wasFocusedRef = useRef(Boolean(props.isFocus));

  useEffect(() => {
    hasCommittedRef.current = false;
    // When entering edit mode, sync title/prevTitle with the latest prop value.
    if (isEditing) {
      setTitle(props.title);
      setPrevTitle(props.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  //const { isInViewport, ref } = useInViewport();

  const eventKeyRef = useRef<string | null>(null);
  const titleWrapperRef = useRef<HTMLDivElement | null>(null);
  const actionsMenuRootRef = useRef<HTMLDivElement | null>(null);
  const actionsMenuItemsRef = useRef<HTMLDivElement | null>(null);
  const actionsMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const actionsMenuSearchRef = useRef<HTMLInputElement | null>(null);
  const lastAKeyAtRef = useRef(0);
  const forceCloseActionsMenu = useCallback(
    (focusNote: boolean) => {
      document.body.classList.add('notes-keyboard-nav');
      const clearKeyboardNavMode = () => {
        document.body.classList.remove('notes-keyboard-nav');
      };
      window.addEventListener('mousemove', clearKeyboardNavMode, {
        once: true,
      });

      setMenuRenderKey((prev) => prev + 1);
      requestAnimationFrame(() => {
        const activeElement = document.activeElement as HTMLElement | null;
        if (
          activeElement &&
          actionsMenuRootRef.current?.contains(activeElement)
        ) {
          activeElement.blur();
        }

        if (!focusNote) return;
        onSelect?.(id, parentPosition);
        actionsMenuButtonRef.current?.blur();
        titleWrapperRef.current?.focus({ preventScroll: true });
      });
    },
    [id, onSelect, parentPosition],
  );
  /** Avoid scrollIntoView on every parent re-render (e.g. modal close) while staying focused. */
  const hadFocusRef = useRef(false);

  const notesFeed = (useNotes() ?? []) as NotesListItemProps[];
  const isMac = useSyncExternalStore(
    () => () => {},
    () =>
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad|iPod/i.test(navigator.platform),
    () => false,
  );
  const actionItems = [
    ['addBelow', 'Add note', 'Enter'],
    ['addAbove', 'Add above', isMac ? '⌥ + Enter' : 'Alt + Enter'],
    ['addSubItem', 'Add a sub-item', isMac ? '⇧ + Enter' : 'Shift + Enter'],
    ['editTitle', 'Edit title', 'ee'],
    ['openNote', 'Open note', 'nn'],
    ['navigateUp', 'Navigate up', '↑'],
    ['navigateDown', 'Navigate down', '↓'],
    ['collapse', 'Collapse', '←'],
    ['expand', 'Expand', '→'],
    ['indent', 'Indent', isMac ? '⌘ + →' : 'Ctrl + →'],
    ['outdent', 'Outdent', isMac ? '⌘ + ←' : 'Ctrl + ←'],
    ['reorderUp', 'Reorder up', isMac ? '⌘ + ↑' : 'Ctrl + ↑'],
    ['reorderDown', 'Reorder down', isMac ? '⌘ + ↓' : 'Ctrl + ↓'],
    ['complete', 'Complete/reopen', 'Space'],
    ['delete', 'Delete', isMac ? 'fn + ⌫' : 'Del'],
    ['priority1', 'Set/unset priority 1', '1'],
    ['priority2', 'Set/unset priority 2', '2'],
    ['priority3', 'Set/unset priority 3', '3'],
    ['bold', 'Toggle bold', isMac ? '⌘ + B' : 'Ctrl + B'],
    ['italic', 'Toggle italic', isMac ? '⌘ + I' : 'Ctrl + I'],
    ['heading', 'Toggle heading', 'mh'],
  ] as const;
  const filteredActionItems = actionItems.filter(([, label, hotkey]) => {
    const q = menuSearch.trim().toLowerCase();
    if (!q) return true;
    return label.toLowerCase().includes(q) || hotkey.toLowerCase().includes(q);
  });

  useEffect(() => {
    setActiveActionIndex(0);
  }, [menuSearch, menuRenderKey]);

  useEffect(() => {
    const activeItem = actionsMenuItemsRef.current?.querySelector<HTMLElement>(
      '[data-active-action-item="true"]',
    );
    activeItem?.scrollIntoView({ block: 'nearest' });
  }, [activeActionIndex, menuSearch]);

  useLayoutEffect(() => {
    if (!props.isFocus) {
      hadFocusRef.current = false;
      return;
    }
    if (hadFocusRef.current) return;
    hadFocusRef.current = true;
    titleWrapperRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'start',
    });
  }, [props.isFocus]);

  useEffect(() => {
    const wasFocused = wasFocusedRef.current;
    wasFocusedRef.current = Boolean(props.isFocus);
    if (wasFocused && !props.isFocus) {
      forceCloseActionsMenu(false);
    }
  }, [forceCloseActionsMenu, props.isFocus]);

  useEffect(() => {
    if (!props.isFocus || isEditing) return;

    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code !== 'KeyA') return;

      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }

      const now = Date.now();
      const isDoubleA = now - lastAKeyAtRef.current <= 450;
      lastAKeyAtRef.current = now;
      if (!isDoubleA) return;

      event.preventDefault();
      event.stopPropagation();
      document.body.classList.add('notes-keyboard-nav');
      actionsMenuButtonRef.current?.click();
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [props.isFocus, isEditing]);

  // if (props.isFocus && !isOnScreen) {
  //
  //
  // 	if (elementRef.current != null) {
  //
  // 		console.log('need to scroll to: ' + title)
  // 		elementRef.current.scrollIntoView({
  // 			behavior: "smooth",
  // 			block: "nearest",
  // 			inline: "start"
  // 		});
  //
  // 	}
  //
  // }

  const onKeyPress = (event: KeyboardEvent): void => {
    eventKeyRef.current = event.code;

    if (eventKeyRef.current == 'Escape') {
      if (props.isFocus) {
        if (props.isEdit) {
          if (!isNew) {
            setTitle(prevTitle);
          }

          props.onCancel(isNew, id, parentId, sort);
        }
      }
    }
  };

  const commitTitle = () => {
    // Prevent double-save (e.g. `Enter` submit then `blur`).
    if (hasCommittedRef.current) return;
    hasCommittedRef.current = true;

    if (title) {
      if (!isNew) {
        props.onEdit?.(id, title);
        setPrevTitle(title);
      } else {
        setIsNew(false);
        setPrevTitle(title);
        props.onAdd?.(id, title);
      }
    } else {
      props.onDelete?.(id, parentId, sort);
    }
  };

  const resetSwipeState = () => {
    isSwipeGestureActiveRef.current = false;
    swipeOffsetRef.current = 0;
    setIsSwiping(false);
    setSwipeOffset(0);
  };

  useKeyPress(props.isFocus ? ['Escape', 'Delete'] : [], onKeyPress);

  const bindSwipe = useDrag(
    ({ down, first, movement: [mx], event }) => {
      if (typeof window === 'undefined') return;
      if (window.innerWidth >= 768) return;
      if (isEditing) return;
      const isTouchGesture =
        ('pointerType' in event && event.pointerType === 'touch') ||
        event.type.startsWith('touch');

      if (first && !isTouchGesture) return;
      if (!isSwipeGestureActiveRef.current && !isTouchGesture) return;

      const nextOffset = Math.max(
        -MAX_SWIPE_OFFSET,
        Math.min(MAX_SWIPE_OFFSET, mx),
      );

      if (down) {
        isSwipeGestureActiveRef.current = true;
        setIsSwiping(true);
        swipeOffsetRef.current = nextOffset;
        setSwipeOffset(nextOffset);
        return;
      }

      if (!isSwipeGestureActiveRef.current) return;
      setIsSwiping(false);
      const finalOffset =
        Math.abs(nextOffset) > 0 ? nextOffset : swipeOffsetRef.current;
      if (Math.abs(finalOffset) >= SWIPE_THRESHOLD) {
        if (finalOffset > 0) {
          props.onComplete?.(id, !Boolean(props.complete));
        } else if (finalOffset < 0) {
          props.onDelete?.(id, parentId, sort);
        }
      }

      resetSwipeState();
    },
    {
      axis: 'x',
      filterTaps: true,
    },
  );
  const swipeProgress = Math.min(Math.abs(swipeOffset) / SWIPE_THRESHOLD, 1);
  const showLeftAction = swipeOffset > 0;
  const showRightAction = swipeOffset < 0;
  const completeActionLabel = props.complete ? 'Reopen' : 'Complete';

  if (props.isFocus) {
    props.onFocus(props.id);
  }

  const childNotes = notesFeed
    .filter((childNote) => childNote.parentId == props.id)
    .slice()
    // `sort` is the position inside the current parent.
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const priorityClass =
    props.priority === 1
      ? styles.priority_1
      : props.priority === 2
        ? styles.priority_2
        : props.priority === 3
          ? styles.priority_3
          : '';

  props.registerCollapsedRange?.(
    props.position,
    props.familyCount ?? 1,
    props.collapsed,
  );

  //console.log(props)

  return (
    <div
      className={
        styles.notes_list_item +
        ' notes-list-item' +
        (props.isFocus ? ' ' + styles.focus : '') +
        (props.isFocus ? ' notes-list-item--focus' : '') +
        (props.parentId != 'root' ? ' ml-4 md:ml-8' : '') +
        (props.complete ? ' ' + styles.complete : '') +
        (props.collapsed ? ' ' + styles.collapsed : '')
      }
      id={props.id}
    >
      {/*<div>"collapsed: " + {props.collapsed && "true"}</div>*/}
      {/*<div>"children: " + {props.familyCount > 1 && "true"}</div>*/}
      <div
        className={`${styles.notes_list_item_row} notes-list-item-row relative`}
      >
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between md:hidden">
          <span
            className="inline-flex h-8 items-center rounded-md bg-(--accent) px-3 text-xs font-semibold uppercase tracking-wide leading-none text-white transition-opacity"
            style={{ opacity: showLeftAction ? swipeProgress : 0 }}
          >
            {completeActionLabel}
          </span>
          <span
            className="inline-flex h-8 items-center rounded-md bg-(--danger) px-3 text-xs font-semibold uppercase tracking-wide leading-none text-white transition-opacity"
            style={{ opacity: showRightAction ? swipeProgress : 0 }}
          >
            Delete
          </span>
        </div>
        <div
          className={`${styles.notes_list_item_title_wrapper} notes-list-item-title outline-none focus:outline-none focus-visible:outline-none`}
          ref={titleWrapperRef}
          tabIndex={-1}
          {...bindSwipe()}
          style={{
            touchAction: 'pan-y',
            transform: `translateX(${swipeOffset}px)`,
            transition: isSwiping
              ? 'none'
              : 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
          onTouchEnd={resetSwipeState}
          onTouchCancel={resetSwipeState}
          onPointerCancel={resetSwipeState}
          onClick={
            !isEditing
              ? (e) => {
                  e.stopPropagation();
                  props.onSelect?.(id, parentPosition);
                }
              : undefined
          }
          onDoubleClick={
            !isEditing
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  props.onSelect?.(id, parentPosition, true);
                }
              : undefined
          }
        >
          {/*<div>Is in viewport: {isOnScreen ? 'true' : 'false'}</div>*/}
          {!isEditing ? (
            <>
              <div className={styles.notes_list_item_title}>
                {isLeaf && (
                  <label
                    className={styles.notes_list_item_complete_checkbox}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(props.complete)}
                      onChange={(e) => {
                        e.stopPropagation();
                        props.onComplete?.(id, e.target.checked);
                      }}
                      aria-label="Mark note complete"
                    />
                  </label>
                )}
                {
                  // <span
                  //   style={{
                  //     color: 'red',
                  //     fontSize: '12px',
                  //     paddingBottom: '3px',
                  //     paddingRight: '5px',
                  //   }}
                  // >
                  //   {props.sort}
                  // </span>
                }
                {/*<span style={{color: "red", fontSize: "12px",}}>{props.position + ": "}</span>*/}
                {props.familyCount > 1 && (
                  <div
                    className={styles.notes_list_item_arrow}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onToggleCollapse?.(id, props.position);
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <ChevronDown size={24} />
                  </div>
                )}
                <span
                  className={[
                    priorityClass,
                    /^#{1}\s/.test(props.title ?? '') ? styles.title_h1 : '',
                    /^#{2}\s/.test(props.title ?? '') ? styles.title_h2 : '',
                    /^#{3}\s/.test(props.title ?? '') ? styles.title_h3 : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <>{children}</>,
                      h1: ({ children }) => <>{children}</>,
                      h2: ({ children }) => <>{children}</>,
                      h3: ({ children }) => <>{children}</>,
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          {children}
                        </a>
                      ),
                    }}
                    allowedElements={[
                      'p',
                      'h1',
                      'h2',
                      'h3',
                      'strong',
                      'em',
                      'code',
                      'del',
                      's',
                      'a',
                    ]}
                    unwrapDisallowed
                  >
                    {props.title}
                  </ReactMarkdown>
                </span>
                <div className="notes-list-item-title-actions">
                  {props.hasContent && (
                    <button
                      type="button"
                      aria-label="Open note"
                      className="notes-list-item-icon-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onSelect?.(id, parentPosition);
                        Router.push(
                          { pathname: '/', query: { note: id } },
                          undefined,
                          { shallow: true },
                        );
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <FileText size={16} />
                    </button>
                  )}
                  <Menu
                    as="div"
                    key={`${id}-${menuRenderKey}`}
                    className="relative"
                    ref={actionsMenuRootRef}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MenuButton
                      ref={actionsMenuButtonRef}
                      aria-label="Note actions"
                      className="notes-list-item-icon-button notes-list-item-more-button"
                      onClick={() => {
                        setMenuSearch('');
                        props.onSelect?.(id, parentPosition);
                        setTimeout(() => {
                          actionsMenuSearchRef.current?.focus({
                            preventScroll: true,
                          });
                        }, 0);
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <MoreVertical size={16} />
                    </MenuButton>
                    <MenuItems
                      anchor={{ to: 'bottom end', gap: '4px', padding: '8px' }}
                      modal={false}
                      ref={actionsMenuItemsRef}
                      className="z-20 w-72 origin-top-right overflow-y-auto rounded-md border border-black/10 bg-white p-1 shadow-lg outline-none"
                      style={
                        {
                          '--anchor-max-height': '300px',
                        } as React.CSSProperties
                      }
                      onKeyDownCapture={(e) => {
                        if (e.key !== 'Escape') return;
                        e.preventDefault();
                        e.stopPropagation();
                        forceCloseActionsMenu(true);
                      }}
                    >
                      <div className="sticky top-0 z-10 -mx-1 -mt-1 mb-1 border-b border-black/5 bg-white px-1 pt-1 pb-1">
                        <input
                          ref={actionsMenuSearchRef}
                          type="text"
                          value={menuSearch}
                          onChange={(e) => setMenuSearch(e.target.value)}
                          placeholder="Search actions..."
                          className="w-full rounded border border-black/10 px-2 py-1 text-sm outline-none focus:border-(--text-primary)"
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              if (!filteredActionItems.length) return;
                              setActiveActionIndex((prev) =>
                                Math.min(
                                  prev + 1,
                                  filteredActionItems.length - 1,
                                ),
                              );
                              return;
                            }
                            if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              if (!filteredActionItems.length) return;
                              setActiveActionIndex((prev) =>
                                Math.max(prev - 1, 0),
                              );
                              return;
                            }
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const active =
                                filteredActionItems[activeActionIndex];
                              if (!active) return;
                              props.onRunAction?.(
                                id,
                                parentPosition,
                                active[0] as NonNullable<
                                  NotesListItemProps['onRunAction']
                                > extends (
                                  noteId: string,
                                  position: number,
                                  action: infer A,
                                ) => void
                                  ? A
                                  : never,
                              );
                              forceCloseActionsMenu(true);
                            }
                          }}
                        />
                      </div>
                      {filteredActionItems.map(([actionId, label, hotkey]) => (
                        <MenuItem key={actionId}>
                          {() => (
                            <button
                              type="button"
                              data-action-item="true"
                              data-active-action-item={
                                filteredActionItems[activeActionIndex]?.[0] ===
                                actionId
                                  ? 'true'
                                  : 'false'
                              }
                              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${
                                filteredActionItems[activeActionIndex]?.[0] ===
                                actionId
                                  ? 'bg-neutral-100 text-(--text-primary)'
                                  : 'text-(--text-primary)'
                              }`}
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => {
                                const idx = filteredActionItems.findIndex(
                                  ([id]) => id === actionId,
                                );
                                if (idx >= 0) setActiveActionIndex(idx);
                              }}
                              onClick={() => {
                                props.onRunAction?.(
                                  id,
                                  parentPosition,
                                  actionId as NonNullable<
                                    NotesListItemProps['onRunAction']
                                  > extends (
                                    noteId: string,
                                    position: number,
                                    action: infer A,
                                  ) => void
                                    ? A
                                    : never,
                                );
                                forceCloseActionsMenu(true);
                              }}
                            >
                              <span>{label}</span>
                              <span className="ml-3 text-xs text-neutral-500">
                                {hotkey}
                              </span>
                            </button>
                          )}
                        </MenuItem>
                      ))}
                    </MenuItems>
                  </Menu>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={styles.notes_list_item_form}>
                <textarea
                  rows={1}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title"
                  value={title}
                  onBlur={() => commitTitle()}
                  onPaste={(e) => {
                    if (handleTitleMarkdownPaste(e, setTitle))
                      e.preventDefault();
                  }}
                  onKeyDown={(e) => {
                    const isMod = e.metaKey || e.ctrlKey;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      commitTitle();
                    } else if (isMod && e.key === 'b') {
                      e.preventDefault();
                      applyInlineMarkdown(e.currentTarget, '**', setTitle);
                    } else if (isMod && e.key === 'i') {
                      e.preventDefault();
                      applyInlineMarkdown(e.currentTarget, '*', setTitle);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      hasCommittedRef.current = true;
                      if (!isNew) setTitle(prevTitle);
                      props.onCancel(isNew, id, parentId, sort);
                    }
                  }}
                  ref={(el) => {
                    titleTextareaCallbackRef(el);
                    if (el && props.isFocus) {
                      el.focus({ preventScroll: true });
                    }
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {childNotes.map((childNote, i) => {
        const previousFamiliesCount = childNotes
          .slice(0, i)
          .reduce(
            (acc, prevChild) => acc + getFamily(prevChild.id, notesFeed).length,
            0,
          );
        const familyCount = getFamily(childNote.id, notesFeed).length;
        const position = parentPosition + 1 + previousFamiliesCount;

        return (
          <NotesListItem
            key={childNote.id}
            id={childNote.id}
            sort={childNote.sort}
            position={position}
            familyCount={familyCount}
            title={childNote.title}
            priority={childNote.priority}
            hasContent={childNote.hasContent}
            complete={childNote.complete}
            collapsed={childNote.collapsed}
            parentId={childNote.parentId}
            cursorPosition={props.cursorPosition}
            isFocus={position === props.cursorPosition}
            isEdit={position === props.cursorPosition && props.isEditTitle}
            isEditTitle={props.isEditTitle}
            onFocus={props.onFocus}
            onCancel={props.onCancel}
            onEdit={props.onEdit}
            onAdd={props.onAdd}
            onDelete={props.onDelete}
            isNew={childNote.isNew}
            registerCollapsedRange={props.registerCollapsedRange}
            onToggleCollapse={props.onToggleCollapse}
            onSelect={props.onSelect}
            onComplete={props.onComplete}
            onRunAction={props.onRunAction}
          />
        );
      })}
    </div>
  );
};

export default NotesListItem;
