import { useMemo, useRef, useState } from 'react';
import { useModalA11y } from '../../util/useModalA11y';
import type { GameStream } from '../stream';
import type { PendingDialogClientMessage } from '../store';
import { Header, Message, PrimaryButton, SecondaryButton } from './dialogPrimitives';
import { LibrarySearchFilters } from './LibrarySearchFilters';
import {
  applyFilter,
  EMPTY_FILTER,
  type FilterState,
} from './librarySearchFilter';
import { LibrarySearchGrid } from './LibrarySearchGrid';

interface Props {
  dialog: PendingDialogClientMessage;
  stream: GameStream | null;
  clearDialog: () => void;
}

const SKIP_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Library-search modal — replaces the bottom-right floating shell for
 * gameTarget Case 2 (cards in hidden zones, e.g. Demonic Tutor /
 * Worldly Tutor / Fierce Empath / cascade reveal). Centered + scrim,
 * with a name-substring filter, type-chip filters, and a CMC-grouped
 * grid.
 *
 * <p>Selection / submit / skip semantics are preserved from the
 * pre-rework {@link CardChooserList} flow:
 * <ul>
 *   <li>Single-pick (min=max=1) — click submits immediately.</li>
 *   <li>Multi-pick (min &lt; max) — click toggles, Done submits.</li>
 *   <li>Sequential pick (min=max=N, N&gt;1) — order-preserving;
 *       Done submits when picked.length === max.</li>
 * </ul>
 *
 * <p>Skip / Esc / scrim-click cancel are wired only when the engine
 * marks the prompt as optional (flag=false). Mandatory prompts trap
 * focus and offer no escape — the engine is waiting on a real answer.
 */
export function LibrarySearchModal({ dialog, stream, clearDialog }: Props) {
  const data = dialog.data;
  const cards = useMemo(
    () => Object.values(data.cardsView1 ?? {}),
    [data.cardsView1],
  );
  // Match the pre-rework `TargetDialog → CardChooserList` path
  // verbatim: cardsView1 IS the eligible set on library-search
  // prompts (engine pre-filters to legal targets), so we never
  // derive eligibility from `data.targets`. Passing null tells the
  // grid "treat all visible cards as eligible".
  const eligibleIds: ReadonlySet<string> | null = null;

  const min = Math.max(data.min, 1);
  const max = data.max > 0 ? data.max : 1;
  const isSinglePick = min === 1 && max === 1;
  const isOrdered = min === max && max > 1;

  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [picked, setPicked] = useState<string[]>([]);

  const visibleCards = useMemo(
    () => applyFilter(cards, filter),
    [cards, filter],
  );

  const skip = !data.flag
    ? () => {
        stream?.sendPlayerResponse(dialog.messageId, 'uuid', SKIP_UUID);
        clearDialog();
      }
    : null;

  const submit = (ids: readonly string[]) => {
    for (const id of ids) {
      stream?.sendPlayerResponse(dialog.messageId, 'uuid', id);
    }
    clearDialog();
  };

  const onCardClick = (id: string) => {
    if (isSinglePick) {
      submit([id]);
      return;
    }
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= max) return prev;
      return [...prev, id];
    });
  };

  const onDone = () => {
    if (picked.length < min || picked.length > max) return;
    submit(picked);
  };

  const modalRef = useRef<HTMLDivElement>(null);
  useModalA11y(modalRef, { ...(skip ? { onClose: skip } : {}) });

  const submittable = picked.length >= min && picked.length <= max;
  const noMatches = visibleCards.length === 0;

  return (
    <>
      <div
        data-testid="library-search-backdrop"
        aria-hidden="true"
        onClick={skip ?? undefined}
        className="fixed inset-0 z-40 bg-black/70"
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search library"
        data-testid="game-dialog"
        data-method={dialog.method}
        data-variant="library-search"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-40 w-[min(95vw,1100px)] max-h-[85vh] flex flex-col bg-zinc-900 border border-zinc-700 rounded-lg p-6 gap-4 shadow-2xl"
      >
        {/* Header is title-only — no `×` close button. Skip lives in
            the footer (and Esc when optional). This keeps useModalA11y's
            initial-focus pick on the search input rather than the X
            button, which is the right ergonomic for a search-driven
            modal (per UI/UX critic 2026-05-08). */}
        <Header title="Search your library" />
        <Message text={data.message} />
        <LibrarySearchFilters state={filter} setState={setFilter} />
        {noMatches ? (
          <div
            className="flex-1 flex items-center justify-center"
            data-testid="library-search-no-matches"
          >
            <button
              type="button"
              onClick={() => setFilter(EMPTY_FILTER)}
              className="px-4 py-2 rounded border border-zinc-700 text-zinc-300 hover:border-fuchsia-500 hover:text-fuchsia-300"
            >
              No matches — clear filters
            </button>
          </div>
        ) : (
          <LibrarySearchGrid
            cards={visibleCards}
            eligibleIds={eligibleIds}
            pickedIds={picked}
            ordered={isOrdered}
            onCardClick={onCardClick}
          />
        )}
        {!isSinglePick && (
          <div
            className="flex justify-end gap-2 pt-2"
            data-testid="library-search-actions"
          >
            {skip && (
              <SecondaryButton onClick={skip} data-testid="library-search-skip">
                Skip
              </SecondaryButton>
            )}
            <PrimaryButton onClick={onDone} disabled={!submittable}>
              {min === max
                ? `Done (${picked.length}/${max})`
                : `Done (${picked.length}${max === Infinity ? '' : `/${max}`})`}
            </PrimaryButton>
          </div>
        )}
        {isSinglePick && skip && (
          <div
            className="flex justify-end gap-2 pt-2"
            data-testid="library-search-actions"
          >
            <SecondaryButton onClick={skip} data-testid="library-search-skip">
              Skip
            </SecondaryButton>
          </div>
        )}
      </div>
    </>
  );
}
