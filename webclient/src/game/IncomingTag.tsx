import { useMemo } from 'react';
import type { WebCombatGroupView } from '../api/schemas';
import { useGameStore } from './store';
import { useArrowIsolation } from './arrowIsolationStore';

/**
 * Bundle 1 / Slice 1-B — "incoming N — M unblocked" badge mounted
 * inside an opponent's PlayerPortrait wrapper during combat.
 *
 * <p>Reads game state directly from {@link useGameStore} (rather
 * than taking it via props) to keep PlayerPortrait's prop shape
 * stable — the brief explicitly constrained slice 1-B to a
 * mount-point insertion only on PlayerPortrait, no signature
 * change. Counts derive from {@code gameView.combat} where
 * {@code group.defenderId === player.id}; the {@code unblocked}
 * count is the subset where the matching combat group has zero
 * blockers.
 *
 * <p>Render gates (any one false → tag is unmounted):
 * <ul>
 *   <li>{@code phase === 'COMBAT'} (gameView.phase). Outside combat
 *       no incoming arrows exist; rendering an idle tag would clutter
 *       the portrait.</li>
 *   <li>{@code playerId !== gameView.myPlayerId}. Local player
 *       doesn't get the tag — it's about *opponents'* incoming
 *       attacks. The Mind Control / Telepathy edge where local
 *       player ends up the active defender is acknowledged in the
 *       brief and accepted (the brief calls for own-portrait
 *       suppression regardless).</li>
 *   <li>{@code incoming > 0}. A defender with zero attackers
 *       targeting them isn't being attacked.</li>
 * </ul>
 *
 * <p>Click toggles the pinned-defender id in
 * {@link useArrowIsolation}; CombatArrows reads that store and
 * treats the pinned id as a sticky version of cursor-hover
 * isolation. Pinned id wins over hover (precedence resolved at
 * the CombatArrows render call site).
 */
export function IncomingTag({
  playerId,
  podPosition,
}: {
  playerId: string;
  /**
   * Slice 1-X-tunings round 5 (2026-05-09) — explicit pod position
   * passed through from PlayerPortrait. Replaces the prior closest()
   * DOM-walk approach which failed in tabletop's actual rendered
   * tree (no `[data-position]` ancestor on the IncomingTag's path
   * despite PlayerArea/PlayerFrameRedesigned both emitting it
   * elsewhere). Optional — fixtures and non-game consumers
   * (LobbySeatPortrait etc.) leave it undefined and get the
   * single-line above-portrait default layout.
   */
  podPosition?: 'top' | 'left' | 'right' | 'bottom' | undefined;
}) {
  // Subscribe with primitive selectors so identity-stable
  // gameView frames don't trigger re-render. `combat` is a
  // referenced array slice (will change identity per frame),
  // accept the cost; the count memo below collapses it back to
  // primitives.
  const phase = useGameStore((s) => s.gameView?.phase ?? '');
  const myPlayerId = useGameStore((s) => s.gameView?.myPlayerId ?? '');
  const combat = useGameStore((s) => s.gameView?.combat ?? EMPTY_COMBAT);

  // Pin state — primitives only, identity-stable.
  const pinnedDefenderId = useArrowIsolation((s) => s.pinnedDefenderId);
  const togglePin = useArrowIsolation((s) => s.togglePin);

  const { incoming, unblocked } = useMemo(
    () => deriveCounts(combat, playerId),
    [combat, playerId],
  );

  // Slice 1-X-tunings round 5 (2026-05-09) — `podPosition` is now
  // a prop threaded down from PlayerPortrait → IncomingTag.
  // Replaces the closest() DOM-walk that failed in tabletop's
  // actual rendered tree. Layout varies per position:
  //   - left/right pods: enough vertical space for two-line stack
  //     ("incoming N" / "unblocked M"). No em-dash separator.
  //   - top pod: phase ladder above clips a tag that floats above
  //     the portrait, so the badge slides DOWN to overlap the
  //     portrait by ~10% of badge height. Single-line text reads
  //     across the badge's width.
  //   - bottom / unknown: falls back to single-line above (current
  //     default; preserves existing test fixtures' rendering).

  // Render gates. None of these mid-render reads should change
  // referentially without a real game-state change, so memoising
  // separately would just add noise.
  if (phase !== 'COMBAT') return null;
  if (playerId === myPlayerId) return null;
  if (incoming === 0) return null;

  const pinned = pinnedDefenderId === playerId;
  const isLeftRight = podPosition === 'left' || podPosition === 'right';
  const isTop = podPosition === 'top';

  return (
    <button
      type="button"
      data-testid={`incoming-tag-${playerId}`}
      data-pinned={pinned || undefined}
      data-pod-position={podPosition ?? undefined}
      aria-pressed={pinned}
      // Slice 1-X.3 critic-pass (Bundle-1 UX-2) — extended copy
      // surfaces the Escape affordance for SR users when pinned.
      // Native `title` does the same for sighted users via the
      // browser's tooltip (covers both unpinned-discoverability
      // and pinned-Escape-discoverability without adding a custom
      // tooltip surface).
      aria-label={
        pinned
          ? `Pinned. ${incoming} attackers incoming, ${unblocked} unblocked. Click to unpin, or press Escape.`
          : `${incoming} attackers incoming, ${unblocked} unblocked. Click to pin this defender's combat arrows.`
      }
      title={
        pinned
          ? "Click to unpin, or press Escape."
          : "Click to focus this defender's combat arrows. Press Escape to unpin."
      }
      // Slice 1-X.3 critic-pass (Bundle-1 UX-1) — `stopPropagation`
      // prevents the click from bubbling into PlayerFrameRedesigned's
      // `<button aria-label="Target alice">` ancestor when the
      // opponent is BOTH targetable AND an active defender. Without
      // this guard, a click on the tag fires both `togglePin` AND
      // a target-dispatch — a real game-state mis-fire surface.
      // Keyboard activation (Enter/Space) follows the same
      // bubble-blocking pattern.
      onClick={(ev) => {
        ev.stopPropagation();
        togglePin(playerId);
      }}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.stopPropagation();
        }
      }}
      className={
        // Position inside PlayerPortrait's `position: relative`
        // wrapper. Slice 1-X-tunings round 4 (2026-05-09) —
        // per-pod-position layout. Top pod overlaps portrait by
        // ~8px (≈10% of medium portrait height) to avoid the phase
        // ladder above. Left/right + default float above with 6px
        // breathing gap. T1: still `position: absolute` — no
        // change to portrait box footprint regardless of branch.
        'pointer-events-auto absolute left-1/2 -translate-x-1/2 z-10 ' +
        (isTop
          ? 'bottom-full translate-y-2 '
          : 'bottom-full mb-1.5 ') +
        // Slice 1-B critic-pass: bumped text from text-[10px] to
        // text-[11px] for readability (10px is below Material 12px
        // floor and iOS HIG 11pt minimum).
        'px-1.5 py-0.5 rounded text-[11px] uppercase ' +
        // Left/right pods get two-line stack via two block-level
        // <div> children + leading-tight + text-center; top pod +
        // default render single-line. `whitespace-nowrap` is
        // applied in BOTH branches so the per-line text doesn't
        // re-wrap under width pressure (slice 1-X-tunings round 6
        // 2026-05-09: without nowrap on left/right, the badge
        // shrunk to the portrait's 80px and "incoming 1" itself
        // wrapped within its <div>, producing 4 lines instead of
        // the intended 2).
        (isLeftRight
          ? 'leading-tight text-center whitespace-nowrap select-none '
          : 'whitespace-nowrap select-none ') +
        'font-semibold ' +
        'border shadow-sm transition-colors duration-100 ' +
        // Slice 1-B critic-pass: WCAG 2.4.7 (Focus Visible) —
        // keyboard-focused badge gets an amber ring. Slice 1-X.3
        // critic-pass (Bundle-1 UI-3): focus ring stays amber even
        // though the pinned-state fill flipped from amber to violet,
        // so focus-while-pinned reads as amber-ring + violet-bg —
        // both signals visible without competing.
        'focus-visible:outline-none focus-visible:ring-2 ' +
        'focus-visible:ring-amber-300 focus-visible:ring-offset-1 ' +
        'focus-visible:ring-offset-zinc-950 ' +
        // Slice 1-X.3 critic-pass (Bundle-1 UI-3): pinned-state fill
        // moved from amber to violet (`--color-accent-primary` family
        // = `bg-violet-500`) to break the 3-way amber semantic
        // collision. Bundle 3's combat-banner Done button = amber,
        // active-priority halo = amber-700/0.7, pin tag pre-fix =
        // amber. Three "amber means..." things on screen at once
        // confused the meaning. Violet is the project's existing
        // selection / target accent (see `--color-card-frame-targeted`
        // and `--color-focus-ring`); a pinned tag conceptually IS
        // "I have selected this defender's lane for isolation."
        (pinned
          ? 'bg-violet-500 text-zinc-50 border-violet-300 '
          : 'bg-zinc-900/85 text-zinc-100 border-zinc-700 hover:bg-zinc-800/90 ')
      }
    >
      {isLeftRight ? (
        <>
          <div>incoming {incoming}</div>
          {unblocked > 0 ? <div>unblocked {unblocked}</div> : null}
        </>
      ) : (
        <>
          incoming {incoming}
          {unblocked > 0 ? <> &mdash; {unblocked} unblocked</> : null}
        </>
      )}
    </button>
  );
}

// Module-scoped empty fallback for the combat selector. Returning
// a fresh `[]` each call would defeat zustand's identity-stable
// re-render gating; this constant is reused so the selector's
// no-op output stays referentially equal across renders.
const EMPTY_COMBAT: readonly WebCombatGroupView[] = [];

interface Counts {
  incoming: number;
  unblocked: number;
}

function deriveCounts(
  combat: readonly WebCombatGroupView[],
  playerId: string,
): Counts {
  let incoming = 0;
  let unblocked = 0;
  for (const group of combat) {
    if (group.defenderId !== playerId) continue;
    const attackerCount = Object.keys(group.attackers).length;
    incoming += attackerCount;
    if (Object.keys(group.blockers).length === 0) {
      unblocked += attackerCount;
    }
  }
  return { incoming, unblocked };
}
