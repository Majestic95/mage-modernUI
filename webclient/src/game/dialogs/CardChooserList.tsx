import { useMemo, useState } from 'react';
import type { WebCardView } from '../api/schemas';
import { CardFace } from '../CardFace';
import { PrimaryButton, SecondaryButton } from './dialogPrimitives';

/**
 * Slice 70-X.14 (Wave A item 1) — card-grid chooser primitive shared
 * by {@link SelectDialog} and {@link TargetDialog}. Pre-Wave-A both
 * dialogs rendered cardsView1 as text rows (or a paste-a-UUID stub
 * for SelectDialog), even though the wire format carries full
 * {@link WebCardView} entries with set + cardNumber → Scryfall art.
 *
 * <p>This primitive renders {@code cards} (typed
 * {@code Record<UUID, WebCardView>}, the wire format of cardsView1)
 * as a grid of small CardFace tiles. Click handlers vary by mode:
 *
 * <ul>
 *   <li><b>Single-pick</b> ({@code min=max=1}): click submits
 *     immediately. Used for Fierce Empath, Demonic Tutor,
 *     Worldly Tutor, etc.</li>
 *   <li><b>Multi-pick</b> ({@code min &lt; max}): click toggles
 *     selection; "Done" button submits the selected list. Selected
 *     cards highlight. Used for discard, reveal, scry partition,
 *     surveil partition.</li>
 *   <li><b>Sequential pick</b> ({@code min=max=N, N&gt;1}): click
 *     each card in the desired order; last click submits the ordered
 *     list. Used for the second-phase ordering call after scry/surveil
 *     partition (CR 701.27 / 701.42 — when 2+ remain on top, the
 *     engine asks the player to order them).</li>
 * </ul>
 *
 * <p>Eligibility: when {@code eligibleIds} is provided and non-empty,
 * cards not in the set render dimmed and unclickable. Empty / undefined
 * means "all cards in {@code cards} are eligible" — this matches the
 * permissive routing in {@link clickRouter} for empty {@code targets[]}.
 *
 * <p>Cancel: {@code onSkip} renders a Skip button when present.
 * Mandatory prompts (engine flag=true) omit it.
 *
 * <p>Per CR 701.27 (scry) / 701.42 (surveil), the partition is
 * "any number" — i.e. {@code min=0, max=N}. Per the rules-expert
 * validation (slice 70-X.14), the ordering follow-up is a SEPARATE
 * engine prompt; this component does NOT chain phases. Each prompt
 * arrives as its own dialog frame.
 */
interface CardChooserListProps {
  cards: Record<string, WebCardView>;
  eligibleIds?: readonly string[];
  /** Minimum picks required before submit / done. */
  min: number;
  /** Maximum picks. {@code Infinity} when the engine sets no upper bound. */
  max: number;
  /** Submit (single or multi). For sequential, value is order-preserved. */
  onSubmit: (ids: string[]) => void;
  /**
   * Skip button handler. When present, renders a Skip button.
   * Single-pick mode: skip is the only no-selection path.
   * Multi-pick mode: also gives the player an out when min=0
   * (server still treats empty as a valid response).
   */
  onSkip?: () => void;
  /**
   * For {@code min=max=N, N&gt;1} (sequential pick), selection is
   * order-preserving and Done submits the in-order list. When false
   * (default), selection is a Set — Done submits the unordered list.
   */
  ordered?: boolean;
}

export function CardChooserList({
  cards,
  eligibleIds,
  min,
  max,
  onSubmit,
  onSkip,
  ordered = false,
}: CardChooserListProps) {
  const cardEntries = useMemo(() => Object.values(cards), [cards]);
  const eligibleSet = useMemo(
    () => (eligibleIds && eligibleIds.length > 0 ? new Set(eligibleIds) : null),
    [eligibleIds],
  );

  // Multi-pick selection. For ordered=true, this preserves click order.
  const [picked, setPicked] = useState<string[]>([]);

  const isSinglePick = min === 1 && max === 1;
  const submittable = picked.length >= min && picked.length <= max;

  const isEligible = (id: string): boolean => {
    if (!eligibleSet) return true;
    return eligibleSet.has(id);
  };

  const handleClick = (id: string) => {
    if (!isEligible(id)) return;
    if (isSinglePick) {
      onSubmit([id]);
      return;
    }
    setPicked((prev) => {
      if (prev.includes(id)) {
        return prev.filter((p) => p !== id);
      }
      if (prev.length >= max) return prev;
      return [...prev, id];
    });
  };

  const handleDone = () => {
    if (!submittable) return;
    onSubmit(picked);
  };

  return (
    <>
      <ul
        className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto p-1"
        data-testid="card-chooser-list"
      >
        {cardEntries.map((card) => {
          const eligible = isEligible(card.id);
          const pickedIndex = picked.indexOf(card.id);
          const isPicked = pickedIndex >= 0;
          return (
            <li key={card.id} className="relative">
              <button
                type="button"
                disabled={!eligible}
                onClick={() => handleClick(card.id)}
                data-testid={`card-chooser-tile-${card.id}`}
                data-eligible={eligible || undefined}
                data-picked={isPicked || undefined}
                aria-label={card.name + (isPicked ? ' (selected)' : '')}
                className={
                  'block w-full rounded transition focus:outline-none focus:ring-2 focus:ring-fuchsia-400 ' +
                  (eligible
                    ? 'cursor-pointer hover:brightness-110 '
                    : 'cursor-not-allowed opacity-40 ') +
                  (isPicked ? 'ring-2 ring-fuchsia-400 brightness-110' : '')
                }
              >
                <CardFace card={card} size="hand" />
                {ordered && isPicked && (
                  <span
                    className="absolute top-1 right-1 bg-fuchsia-500 text-zinc-950 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold pointer-events-none"
                    aria-hidden="true"
                  >
                    {pickedIndex + 1}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {!isSinglePick && (
        <div
          className="flex gap-2 justify-end pt-2"
          data-testid="card-chooser-actions"
        >
          {onSkip && <SecondaryButton onClick={onSkip}>Skip</SecondaryButton>}
          <PrimaryButton onClick={handleDone} disabled={!submittable}>
            {min === max
              ? `Done (${picked.length}/${max})`
              : `Done (${picked.length}${max === Infinity ? '' : `/${max}`})`}
          </PrimaryButton>
        </div>
      )}
      {isSinglePick && onSkip && (
        <div
          className="flex gap-2 justify-end pt-2"
          data-testid="card-chooser-actions"
        >
          <SecondaryButton onClick={onSkip}>Skip</SecondaryButton>
        </div>
      )}
    </>
  );
}
