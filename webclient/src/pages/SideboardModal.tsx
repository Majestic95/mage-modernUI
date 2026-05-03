import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, request } from '../api/client';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';
import { useDraggable } from '../util/useDraggable';
import { useModalA11y } from '../util/useModalA11y';
import type { WebSideboardInfo, WebSimpleCardView } from '../api/schemas';

/**
 * Sideboarding modal — fires when the server pushes a
 * {@code sideboard} frame between games of a sideboarded match
 * (upstream's {@code User.ccSideboard} → schema 1.14 wire format).
 *
 * <p>UX: two-pane list view, main on the left and sideboard on the
 * right. Each card row shows the card name, set/number hint, and an
 * arrow button that moves it to the other pane. Submit posts the
 * finalized lists to {@code POST /api/tables/{tableId}/deck}; on
 * 204 success we clear {@link useGameStore.pendingSideboard} and the
 * modal unmounts.
 *
 * <p>The header renders a live countdown derived from
 * {@link WebSideboardInfo#time}: on every fresh frame we capture
 * {@code Date.now() + time*1000} as the deadline and tick a
 * derived "remaining" value down via {@code setInterval}. The
 * server's {@code futureTimeout} is the authoritative timer
 * (autoSideboard fires at {@code Match.SIDEBOARD_TIME = 180}); a
 * reconnect-replay re-anchors the deadline to the new frame's
 * {@code time}. Below 30s the display flips to red so the user
 * sees the urgency before auto-submission.
 */
export function SideboardModal() {
  const pending = useGameStore((s) => s.pendingSideboard);
  const clear = useGameStore((s) => s.clearSideboard);
  const session = useAuthStore((s) => s.session);

  if (!pending || !session) {
    return null;
  }
  // Key on tableId only. Earlier the key included {@code pending.time},
  // which decreases on every reconnect-replay of the SIDEBOARD frame
  // (the engine re-samples {@code futureTimeout.getDelay} on each
  // dispatch). That would force a fresh component instance — and
  // therefore a fresh {@code useState} — on every replay, discarding
  // the user's in-progress main↔side moves. {@code tableId} alone is
  // unique per sideboarding window (a match never has overlapping
  // sideboard windows for the same table), so the modal now persists
  // across reconnects on the same table.
  return (
    <SideboardModalImpl
      key={pending.tableId}
      pending={pending}
      clear={clear}
      token={session.token}
    />
  );
}

function SideboardModalImpl({
  pending,
  clear,
  token,
}: {
  pending: WebSideboardInfo;
  clear: () => void;
  token: string;
}) {
  const [mainList, setMainList] = useState<WebSimpleCardView[]>(
    () => pending.deck.mainList.slice(),
  );
  const [sideboard, setSideboard] = useState<WebSimpleCardView[]>(
    () => pending.deck.sideboard.slice(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal a11y: focus trap + initial focus + focus restoration. ESC
  // intentionally does NOT close — sideboarding is submission-only;
  // the engine auto-submits at timeout. So we omit {@code onClose}.
  // {@link useDraggable} owns the dialog box's position; the inline
  // header is the drag handle.
  const { ref: modalRootRef, containerProps, style: dragStyle } = useDraggable({
    placement: { kind: 'center' },
  });
  useModalA11y(modalRootRef, {});

  // Live countdown. The server sends {@code time} (seconds remaining
  // until {@code autoSideboard} fires); we derive an absolute
  // {@code deadlineMs} on each fresh frame and tick a {@code remaining}
  // state down every second. On a reconnect-replay the new frame's
  // {@code time} is the engine's authoritative residual delay, so we
  // re-anchor the deadline — a brief jump in the displayed value is
  // correct (the engine timer is the source of truth).
  //
  // <p>Slice 66a lint refactor: the deadline ref starts at a sentinel
  // ({@code 0}) and is populated lazily by the interval effect using
  // {@code pendingTimeRef} — keeping the {@code useRef} initializer
  // pure (no {@code Date.now()} during render). The display value
  // {@code remaining} is mirrored from {@code pending.time} via the
  // React-recommended "adjust state during render" pattern (storing
  // the previous prop alongside state), which provides the immediate
  // re-anchor on a reconnect-replay frame without triggering
  // {@code react-hooks/set-state-in-effect}.
  const deadlineMsRef = useRef<number>(0);
  // {@code remaining} is the displayed countdown value. We mirror it
  // from {@code pending.time} on every fresh frame using the
  // "adjust state during render" pattern
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders),
  // which is the React-recommended way to derive state from a prop
  // change without an effect — keeping us clear of
  // {@code react-hooks/set-state-in-effect}. The {@code useEffect}
  // below then anchors {@code deadlineMsRef} (ref mutation in effects
  // is allowed) and an interval drives {@code setRemaining} from
  // its tick callback (allowed) for the once-per-second decrement.
  const [prevPendingTime, setPrevPendingTime] = useState<number>(pending.time);
  const [remaining, setRemaining] = useState<number>(() =>
    Math.max(0, pending.time),
  );
  if (prevPendingTime !== pending.time) {
    setPrevPendingTime(pending.time);
    setRemaining(Math.max(0, pending.time));
  }

  // Anchor the deadline ref on every fresh frame. Ref mutation +
  // {@code Date.now()} are both fine inside an effect body — the
  // restriction is only on synchronous {@code setState} (and on
  // calling them during render).
  useEffect(() => {
    deadlineMsRef.current = Date.now() + pending.time * 1000;
  }, [pending.tableId, pending.time]);

  // Tick {@code remaining} down once per second from the anchored
  // deadline. {@code setState} fires inside the interval callback,
  // not synchronously in the effect body.
  useEffect(() => {
    if (pending.time <= 0) return;
    const id = setInterval(() => {
      const left = Math.max(
        0,
        Math.round((deadlineMsRef.current - Date.now()) / 1000),
      );
      setRemaining(left);
    }, 1000);
    return () => clearInterval(id);
  }, [pending.tableId, pending.time]);

  const moveToSideboard = (card: WebSimpleCardView) => {
    setMainList((cur) => removeFirstById(cur, card.id));
    setSideboard((cur) => [...cur, card]);
  };
  const moveToMain = (card: WebSimpleCardView) => {
    setSideboard((cur) => removeFirstById(cur, card.id));
    setMainList((cur) => [...cur, card]);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const body = {
      name: pending.deck.name,
      author: '',
      cards: collapseToCardInfo(mainList),
      sideboard: collapseToCardInfo(sideboard),
    };
    try {
      await request(`/api/tables/${pending.tableId}/deck`, null, {
        token,
        method: 'POST',
        body,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submit failed.');
      setSubmitting(false);
      return;
    }
    clear();
  };

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="sideboard-modal-backdrop"
        className="fixed inset-0 z-50 bg-black/70"
      />
      <div
        ref={modalRootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sideboard-heading"
        data-testid="sideboard-modal"
        className="z-50 w-[min(95vw,768px)] max-h-[90vh] bg-zinc-900 border border-zinc-800 rounded-lg p-6 flex flex-col"
        style={dragStyle}
        {...containerProps}
      >
        <form
          onSubmit={onSubmit}
          className="flex-1 min-h-0 flex flex-col"
        >
          <header
            data-drag-handle
            className="flex items-baseline justify-between mb-3 cursor-move select-none"
          >
          <h2 id="sideboard-heading" className="text-xl font-semibold">Sideboard</h2>
          <span className="text-xs text-zinc-500">
            {pending.time > 0 ? (
              <span
                data-testid="sideboard-countdown"
                className={
                  remaining <= 30
                    ? 'text-red-400 font-semibold'
                    : 'text-zinc-400'
                }
                title="Time runs out → engine auto-submits your current main/side configuration"
              >
                {formatRemaining(remaining)} remaining
              </span>
            ) : (
              'untimed'
            )}
            {pending.limited && (
              <span className="ml-2 text-amber-300">limited</span>
            )}
          </span>
        </header>
        {pending.time > 0 && (
          <p className="text-[10px] text-zinc-600 -mt-2 mb-3">
            Time runs out → engine auto-submits your current
            main/side configuration.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
          <CardPane
            title={`Main (${mainList.length})`}
            cards={mainList}
            buttonLabel="→"
            buttonTitle="Move to sideboard"
            onClick={moveToSideboard}
            data-testid="sideboard-main"
          />
          <CardPane
            title={`Sideboard (${sideboard.length})`}
            cards={sideboard}
            buttonLabel="←"
            buttonTitle="Move to main"
            onClick={moveToMain}
            data-testid="sideboard-side"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400 mt-3">
            {error}
          </p>
        )}

        <footer className="flex justify-end gap-2 pt-3 mt-3 border-t border-zinc-800">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 text-white font-medium"
          >
            {submitting ? 'Submitting…' : 'Submit deck'}
          </button>
        </footer>
        </form>
      </div>
    </>
  );
}

function CardPane({
  title,
  cards,
  buttonLabel,
  buttonTitle,
  onClick,
  ...rest
}: {
  title: string;
  cards: WebSimpleCardView[];
  buttonLabel: string;
  buttonTitle: string;
  onClick: (card: WebSimpleCardView) => void;
} & Record<`data-${string}`, string>) {
  return (
    <section
      {...rest}
      className="flex flex-col min-h-0 border border-zinc-800 rounded bg-zinc-950"
    >
      <header className="text-xs uppercase tracking-wide text-zinc-500 px-3 py-2 border-b border-zinc-800">
        {title}
      </header>
      <ul className="flex-1 overflow-y-auto divide-y divide-zinc-800">
        {cards.length === 0 && (
          <li className="text-xs italic text-zinc-600 px-3 py-4 text-center">
            empty
          </li>
        )}
        {cards.map((card, idx) => (
          <li
            key={`${card.id}-${idx}`}
            className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-zinc-900"
          >
            <div className="flex flex-col min-w-0">
              <span className="text-zinc-100 truncate" title={card.name}>
                {card.name}
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">
                {card.expansionSetCode}:{card.cardNumber}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onClick(card)}
              title={buttonTitle}
              data-testid="sideboard-move"
              className="text-zinc-400 hover:text-fuchsia-300 px-2 py-0.5 rounded border border-zinc-800 hover:border-fuchsia-600 text-xs"
            >
              {buttonLabel}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Format the countdown as {@code m:ss} (or {@code 0:ss} for sub-minute
 * values). Keeping a leading zero on the seconds component ("0:35"
 * rather than "0:5") matches the conventional egg-timer cadence and
 * keeps the column width stable as the value ticks down.
 */
function formatRemaining(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Strip the first occurrence with the given id. Splice rather than
 * filter because cards may legitimately repeat (mainboard 4-of's).
 */
function removeFirstById(
  list: WebSimpleCardView[],
  id: string,
): WebSimpleCardView[] {
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return list;
  const next = list.slice();
  next.splice(idx, 1);
  return next;
}

/**
 * Collapse a flat list of {@link WebSimpleCardView}s into the
 * {@code WebDeckCardInfo} shape the server's deck-submit endpoint
 * expects. Repeated cards (same name + set + number) roll up into a
 * single entry with {@code amount > 1}.
 */
function collapseToCardInfo(
  cards: WebSimpleCardView[],
): { cardName: string; setCode: string; cardNumber: string; amount: number }[] {
  const buckets = new Map<
    string,
    { cardName: string; setCode: string; cardNumber: string; amount: number }
  >();
  for (const card of cards) {
    const key = `${card.expansionSetCode}|${card.cardNumber}|${card.name}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.amount += 1;
    } else {
      buckets.set(key, {
        cardName: card.name,
        setCode: card.expansionSetCode,
        cardNumber: card.cardNumber,
        amount: 1,
      });
    }
  }
  return Array.from(buckets.values());
}
