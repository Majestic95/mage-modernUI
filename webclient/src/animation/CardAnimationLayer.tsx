import { useEffect, useState } from 'react';
import { on } from './eventBus';
import {
  startCinematicCast,
  subscribeToAnimationState,
  isCinematicCastActive,
} from './animationState';
import { CastingPoseOverlay } from './CastingPoseOverlay';
import { RibbonTrail } from './RibbonTrail';
import { CommanderReturnGlide } from './CommanderReturnGlide';
import {
  resolveCastSourceCenter,
  resolveCommanderReturnTarget,
  resolveFocalZoneCenter,
  stubCardFromCommandList,
} from './sourceResolvers';
import { useGameStore } from '../game/store';
import type { WebCardView } from '../api/schemas';

interface ActiveCinematic {
  card: WebCardView;
  sourceCenter: { x: number; y: number } | null;
  targetCenter: { x: number; y: number } | null;
}

interface ActiveReturn {
  card: WebCardView;
  targetCenter: { x: number; y: number };
}

/**
 * Slice 70-Z.2 + 70-Z.3 — root-level overlay portal for the card-
 * animation system. Subscribes to {@link eventBus} for events
 * emitted by {@link DeltaPump} and mounts the appropriate visual
 * overlay (cinematic casting pose this slice; ribbon trail +
 * commander-return glide also this slice; per-tile dust + screen-
 * pulse arrive in slice 70-Z.4).
 *
 * <p><b>Mount point:</b> rendered as a sibling of {@code GameTable}
 * inside the page root's {@code LayoutGroup} (see Game.tsx). Sits
 * fixed-position over the entire viewport with {@code
 * pointer-events: none} so it never intercepts clicks.
 *
 * <p><b>z-index ladder</b> (slice 70-Z.2 critic UI/UX-C1 fix): the
 * layer sits at {@code z-35} — ABOVE the side panel + floating
 * action dock (both {@code z-30}, GameTable.tsx) so animation
 * overlays paint over the table chrome, but BELOW every interactive
 * dialog ({@code z-40}: GameDialog shells, ZoneBrowser, ConcedeConfirm,
 * GameEndOverlay banner, TargetingArrow). Decorative-over-interactive
 * is the rule the catalog implies — a cinematic-cast pose must NEVER
 * obscure a target-confirmation dialog. HoverCardDetail's portal at
 * {@code z-50} naturally floats above us.
 *
 * <p><b>aria-hidden contract:</b> overlays inside this layer are
 * visual flourishes only. The underlying gameView snapshot already
 * conveys "this card is on the stack / battlefield" through
 * StackZone / BattlefieldTile DOM nodes that live OUTSIDE this
 * layer. Don't remove {@code aria-hidden} when overlays mount the
 * cinematic-pose card — the screen-reader-relevant card is the
 * StackZone focal tile, not the pose copy.
 *
 * <p><b>Reduced motion:</b> the layer mounts unconditionally; the
 * decorative overlays it spawns check
 * {@code prefers-reduced-motion} at THIS layer's event-subscription
 * boundary (below) and skip mounting overlay components entirely
 * when reduce is set. The cardId-based layoutId graph (LAYOUT_GLIDE)
 * survives reduced-motion as essential motion, so cards still glide
 * hand → stack instantaneously — only the cinematic pose / ribbon
 * trail decorations get suppressed.
 */
export function CardAnimationLayer(): React.JSX.Element {
  const [activeCinematic, setActiveCinematic] = useState<
    Map<string, ActiveCinematic>
  >(() => new Map());
  const [activeReturns, setActiveReturns] = useState<
    Map<string, ActiveReturn>
  >(() => new Map());

  // Cast subscription — when a cinematic cast fires, capture the
  // card payload + add to the active-cinematic map so the overlay
  // and ribbon mount. When endCinematicCast fires (overlay unmount
  // or game reset), the animationState subscription below prunes
  // the entry from local state.
  useEffect(() => {
    return on('cast', (evt) => {
      if (!evt.cinematic) return;
      if (prefersReducedMotion()) return;
      // The cast event carries the cardId but not the card payload.
      // Resolve it from the current gameView snapshot via Zustand's
      // imperative escape hatch — we're inside a useEffect-registered
      // callback, not a render path, so getState() is safe.
      const card = lookupCardOnStack(evt.cardId);
      if (!card) return;
      // Resolve source + target bboxes at event-handler time (DOM
      // is up-to-date for the previous render). Slice 70-Z.3 critic
      // CRIT-1 fix: opponent-cast resolution uses playerId, not
      // ownerSeat — derive playerId from the seat via the snapshot.
      // Critic IMP-5 fix: target is the central-focal-zone bbox
      // center (NOT viewport center) so overlay + ribbon align with
      // where the focal tile actually sits.
      const gv = useGameStore.getState().gameView;
      const ownerPlayerId =
        evt.from === 'unknown' && gv && evt.ownerSeat >= 0
          ? gv.players[evt.ownerSeat]?.playerId ?? null
          : null;
      const sourceCenter = resolveCastSourceCenter(evt.from, ownerPlayerId);
      const targetCenter = resolveFocalZoneCenter();
      startCinematicCast(evt.cardId);
      setActiveCinematic((prev) => {
        const next = new Map(prev);
        next.set(evt.cardId, { card, sourceCenter, targetCenter });
        return next;
      });
    });
  }, []);

  // commander_returned subscription — resolve the destination
  // portrait bbox at event-handler time and stash a stub card.
  // Reduced motion: skipped so the commander silently disappears
  // (correct state without flair).
  useEffect(() => {
    return on('commander_returned', (evt) => {
      if (prefersReducedMotion()) return;
      const gv = useGameStore.getState().gameView;
      if (!gv) return;
      const player = gv.players[evt.ownerSeat];
      if (!player) return;
      const targetCenter = resolveCommanderReturnTarget(player.playerId);
      if (!targetCenter) return;
      const commanderEntry = player.commandList.find(
        (e) => e.kind === 'commander',
      );
      if (!commanderEntry) return;
      const stub = stubCardFromCommandList(evt.cardId, commanderEntry);
      setActiveReturns((prev) => {
        const next = new Map(prev);
        next.set(evt.cardId, { card: stub, targetCenter });
        return next;
      });
    });
  }, []);

  // Mirror the animationState into local React state so when
  // endCinematicCast fires (from the overlay unmount), we drop the
  // overlay + ribbon from our render tree.
  useEffect(() => {
    return subscribeToAnimationState(() => {
      setActiveCinematic((prev) => {
        let changed = false;
        const next = new Map<string, ActiveCinematic>();
        for (const [id, entry] of prev) {
          if (isCinematicCastActive(id)) {
            next.set(id, entry);
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
  }, []);

  return (
    <div
      data-testid="card-animation-layer"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[35]"
    >
      {Array.from(activeCinematic.entries()).map(([cardId, entry]) => (
        <CastingPoseOverlay
          key={cardId}
          card={entry.card}
          targetCenter={entry.targetCenter}
        />
      ))}
      {Array.from(activeCinematic.entries()).map(([cardId, entry]) => (
        <RibbonTrail
          key={`ribbon-${cardId}`}
          cardId={cardId}
          colors={entry.card.colors}
          sourceCenter={entry.sourceCenter}
          targetCenter={entry.targetCenter}
        />
      ))}
      {Array.from(activeReturns.entries()).map(([cardId, entry]) => (
        <CommanderReturnGlide
          key={`return-${cardId}`}
          cardId={cardId}
          card={entry.card}
          targetCenter={entry.targetCenter}
          onComplete={() => {
            setActiveReturns((prev) => {
              if (!prev.has(cardId)) return prev;
              const next = new Map(prev);
              next.delete(cardId);
              return next;
            });
          }}
        />
      ))}
    </div>
  );
}

/**
 * Per-call query of `prefers-reduced-motion`. Not cached because
 * test fixtures swap the matchMedia mock between cases; a cache
 * would pin the first observed value and produce false negatives
 * in tests. Cost is one synchronous matchMedia lookup per cast /
 * commander_returned event — negligible.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Resolve a cardId to its WebCardView from the current Zustand
 * gameView via the imperative {@code getState()} escape hatch.
 * The cast-event handler runs inside a useEffect-registered
 * subscription, so it's not a render path — accessing the store
 * imperatively is fine. Returns undefined if the card isn't on
 * the stack (rare race; the diff fires the event in the same
 * snapshot that put the card there).
 */
function lookupCardOnStack(cardId: string): WebCardView | undefined {
  const gv = useGameStore.getState().gameView;
  if (!gv) return undefined;
  for (const card of Object.values(gv.stack)) {
    if (card.cardId === cardId) return card;
  }
  return undefined;
}

