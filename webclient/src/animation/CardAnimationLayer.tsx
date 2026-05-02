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
import { BoardWipeRipple } from './BoardWipeRipple';
import { ImpactOverlay } from './ImpactOverlay';
import { GroundCrackOverlay } from './GroundCrackOverlay';
import {
  resolveCastSourceCenter,
  resolveCommanderReturnTarget,
  resolveFocalZoneCenter,
  resolveTileBBox,
  stubCardFromCommandList,
} from './sourceResolvers';
import {
  BOARD_WIPE_STAGGER_MS,
  GROUND_CRACK_LANDING_DELAY_MS,
  MAX_CONCURRENT_DISINTEGRATES,
} from './transitions';
import { useGameStore } from '../game/store';
import type { WebCardView } from '../api/schemas';

interface ActiveImpact {
  kind: 'dust' | 'exile';
  bbox: { left: number; top: number; width: number; height: number };
  staggerMs: number;
}

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
  const [activeRipples, setActiveRipples] = useState<
    Map<string, { center: { x: number; y: number } }>
  >(() => new Map());
  const [activeImpacts, setActiveImpacts] = useState<
    Map<string, ActiveImpact>
  >(() => new Map());
  const [activeCracks, setActiveCracks] = useState<
    Map<string, { bbox: { left: number; top: number; width: number; height: number } }>
  >(() => new Map());

  // Cast subscription — when a cinematic cast fires, capture the
  // card payload + add to the active-cinematic map so the overlay
  // and ribbon mount. When endCinematicCast fires (overlay unmount
  // or game reset), the animationState subscription below prunes
  // the entry from local state.
  useEffect(() => {
    return on('cast', (evt) => {
      const dbg = isAnimDebug();
      if (dbg) console.log('[animDebug] cast fired', evt);
      if (!evt.cinematic) {
        if (dbg) console.log('[animDebug]   gated: cast event has cinematic=false');
        return;
      }
      if (prefersReducedMotion()) {
        if (dbg) console.log('[animDebug]   gated: prefers-reduced-motion');
        return;
      }
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

  // creature_died / permanent_exiled subscriptions — slice 70-Z.4
  // critic CRIT-1 redesign. Capture the dying tile's bbox at
  // event-handler time (the synchronous Zustand subscribe path
  // means the tile is still in the DOM when we read it; React
  // hasn't yet re-rendered with the dying card removed). Mount an
  // ImpactOverlay at that bbox to play the dust/dissolve keyframe
  // and particle field.
  //
  // BattlefieldRowGroup's AnimatePresence still runs its default
  // B-glide exit on the dying motion.div in parallel — that fades
  // the underlying card away while the ImpactOverlay paints the
  // disintegration above it. The overlay-based approach sidesteps
  // the AnimatePresence-snapshots-stale-props bug from the first
  // pass: there's no need for BattlefieldRowGroup to know the
  // exitKind because the impact visual is layer-rendered, not
  // tile-rendered. Map leak (CRIT-2) also resolved — every
  // ImpactOverlay self-cleans via onComplete.
  //
  // Reduced motion: skip mounting entirely so the tile gets the
  // default B-glide exit alone (no decoration).
  useEffect(() => {
    const offDied = on('creature_died', (evt) => {
      if (prefersReducedMotion()) return;
      const bbox = resolveTileBBox(evt.cardId);
      if (!bbox) return;
      countAgainstBudget(() => {
        setActiveImpacts((prev) => {
          const next = new Map(prev);
          next.set(evt.cardId, { kind: 'dust', bbox, staggerMs: 0 });
          return next;
        });
      });
    });
    const offExiled = on('permanent_exiled', (evt) => {
      if (prefersReducedMotion()) return;
      const bbox = resolveTileBBox(evt.cardId);
      if (!bbox) return;
      countAgainstBudget(() => {
        setActiveImpacts((prev) => {
          const next = new Map(prev);
          next.set(evt.cardId, { kind: 'exile', bbox, staggerMs: 0 });
          return next;
        });
      });
    });
    return () => {
      offDied();
      offExiled();
    };
  }, []);

  // board_wipe subscription — single screen-pulse ripple at the
  // epicenter pod's center, plus per-permanent dust/dissolve
  // impacts staggered by BOARD_WIPE_STAGGER_MS so the wave reads.
  //
  // Slice 70-Z.4 critic CRIT-2 + IMPORTANT-1 fix: the per-permanent
  // creature_died / permanent_exiled events fire FIRST (they're
  // emitted by gameDelta before the synthesized board_wipe event,
  // see gameDelta.ts ordering), populating activeImpacts with
  // staggerMs=0. When board_wipe arrives, we re-write each cardId's
  // entry with staggerMs = index * BOARD_WIPE_STAGGER_MS so the
  // wave reads as outward propagation from the epicenter.
  useEffect(() => {
    return on('board_wipe', (evt) => {
      if (prefersReducedMotion()) return;
      const gv = useGameStore.getState().gameView;
      if (!gv) return;
      const player = gv.players[evt.epicenterSeat];
      if (!player) return;
      // Use the portrait selector (unique per player) instead of
      // data-player-id (which has multiple matches on the local
      // pod's slot-split). Slice 70-Z.4 critic UI/UX-CRIT-4 fix.
      const portraitEl =
        typeof document !== 'undefined'
          ? document.querySelector(
              `[data-portrait-target-player-id="${player.playerId}"]`,
            )
          : null;
      let center: { x: number; y: number };
      if (portraitEl) {
        const rect = (portraitEl as Element).getBoundingClientRect();
        center = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      } else {
        center = {
          x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
          y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
        };
      }
      const rippleId = evt.cardIds.join('|');
      setActiveRipples((prev) => {
        const next = new Map(prev);
        next.set(rippleId, { center });
        return next;
      });

      // Re-write each impacted cardId's entry with a staggered
      // animationDelay matching its index in the wipe.
      setActiveImpacts((prev) => {
        const next = new Map(prev);
        evt.cardIds.forEach((cardId, idx) => {
          const existing = next.get(cardId);
          if (!existing) return;
          next.set(cardId, {
            ...existing,
            staggerMs: idx * BOARD_WIPE_STAGGER_MS,
          });
        });
        return next;
      });
    });
  }, []);

  // resolve_to_board subscription — fires the ground-crack ETB
  // animation for cinematic-tier landings (round 2 user direction:
  // commanders, planeswalkers, manaValue ≥ 7). Tokens are excluded
  // (typeLine prefix "Token") even if they meet the type/CMC
  // criteria. Mirrors the cinematic-A cast threshold.
  //
  // Timing: the card just resolved stack → battlefield; LAYOUT_GLIDE
  // settles the tile into its slot over ~400ms. We wait that long
  // via setTimeout so the crack fires AS the creature lands (not
  // while still mid-glide), then resolve the now-mounted tile's
  // bbox via [data-card-id] and mount the GroundCrackOverlay.
  useEffect(() => {
    return on('resolve_to_board', (evt) => {
      const dbg = isAnimDebug();
      if (dbg) console.log('[animDebug] resolve_to_board fired', evt);
      if (prefersReducedMotion()) {
        if (dbg) console.log('[animDebug]   gated: prefers-reduced-motion');
        return;
      }
      const gv = useGameStore.getState().gameView;
      if (!gv) {
        if (dbg) console.log('[animDebug]   gated: no gameView');
        return;
      }
      const player = gv.players[evt.ownerSeat];
      if (!player) {
        if (dbg) console.log('[animDebug]   gated: no player at seat', evt.ownerSeat);
        return;
      }
      // Battlefield Record key is card.id (== card.cardId for
      // non-stack zones).
      const perm = player.battlefield[evt.cardId];
      if (!perm) {
        if (dbg) console.log('[animDebug]   gated: cardId', evt.cardId, 'NOT in battlefield. keys=', Object.keys(player.battlefield));
        return;
      }
      const card = perm.card;
      if (dbg) console.log('[animDebug]   card resolved:', { name: card.name, types: card.types, typeLine: card.typeLine, manaValue: card.manaValue });
      // Token exclusion — typeLine carries "Token Creature — ..."
      // for engine-created tokens. A 7-mana actual creature card
      // never has "Token" in its typeLine.
      if (card.typeLine.toLowerCase().startsWith('token')) {
        if (dbg) console.log('[animDebug]   gated: token (typeLine=', card.typeLine, ')');
        return;
      }
      // Cinematic-tier gate: commander OR planeswalker OR CMC ≥ 7.
      //
      // Slice 70-Z bug fix — `commandList` only carries commanders
      // currently IN the command zone. The moment a commander
      // resolves onto the battlefield, that player's commandList
      // empties for them — so checking commandList here would miss
      // EVERY commander cast and never fire the ground-crack for the
      // most cinematic moment of the game. The store accumulates
      // commander entries across zone changes via
      // `commanderSnapshots` (slice 70-Y bug 4 — same accumulator
      // that keeps the commander portrait alive after they leave the
      // command zone). Read from that instead. Bonus: snapshots also
      // remember commanders that died-and-returned-to-command-zone
      // multiple times, so the gate fires correctly on the 4th cast.
      const snapshots = useGameStore.getState().commanderSnapshots;
      const isCommander = Object.values(snapshots).some((entries) =>
        entries.some((e) => e.kind === 'commander' && e.name === card.name),
      );
      const isPlaneswalker = card.types.includes('PLANESWALKER');
      const isBigCmc = card.manaValue >= 7;
      if (dbg) console.log('[animDebug]   gates:', { isCommander, isPlaneswalker, isBigCmc, cardName: card.name, snapshots: Object.fromEntries(Object.entries(snapshots).map(([k, v]) => [k, v.map((e) => `${e.kind}:${e.name}`)])) });
      if (!isCommander && !isPlaneswalker && !isBigCmc) {
        if (dbg) console.log('[animDebug]   gated: not cinematic-tier (no commander/planeswalker/CMC≥7 match)');
        return;
      }
      // Defer bbox capture until the LAYOUT_GLIDE has settled. On
      // race conditions (e.g. the user resolves DURING a cinematic
      // hold, which briefly produces a layoutId collision), the
      // tile's bbox may not be valid at +400ms — width/height
      // could be 0 if Framer hasn't mounted it cleanly. Retry up
      // to 3 times via rAF so we get a stable bbox.
      const tryCapture = (attempt: number) => {
        const bbox = resolveTileBBox(evt.cardId);
        if (dbg) console.log('[animDebug]   bbox attempt', attempt, ':', bbox);
        if (bbox && bbox.width > 0 && bbox.height > 0) {
          if (dbg) console.log('[animDebug]   ✓ mounting GroundCrackOverlay for', evt.cardId);
          setActiveCracks((prev) => {
            const next = new Map(prev);
            next.set(evt.cardId, { bbox });
            return next;
          });
          return;
        }
        if (attempt < 3) {
          requestAnimationFrame(() => tryCapture(attempt + 1));
        } else if (dbg) {
          console.log('[animDebug]   ✗ bbox capture failed after 3 retries');
        }
      };
      const t = setTimeout(
        () => tryCapture(0),
        GROUND_CRACK_LANDING_DELAY_MS,
      );
      void t;
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
      {Array.from(activeRipples.entries()).map(([rippleId, entry]) => (
        <BoardWipeRipple
          key={`ripple-${rippleId}`}
          center={entry.center}
          onComplete={() => {
            setActiveRipples((prev) => {
              if (!prev.has(rippleId)) return prev;
              const next = new Map(prev);
              next.delete(rippleId);
              return next;
            });
          }}
        />
      ))}
      {Array.from(activeImpacts.entries()).map(([cardId, entry]) => (
        <ImpactOverlay
          key={`impact-${cardId}`}
          cardId={cardId}
          kind={entry.kind}
          bbox={entry.bbox}
          staggerMs={entry.staggerMs}
          onComplete={() => {
            setActiveImpacts((prev) => {
              if (!prev.has(cardId)) return prev;
              const next = new Map(prev);
              next.delete(cardId);
              return next;
            });
          }}
        />
      ))}
      {Array.from(activeCracks.entries()).map(([cardId, entry]) => (
        <GroundCrackOverlay
          key={`crack-${cardId}`}
          cardId={cardId}
          bbox={entry.bbox}
          onComplete={() => {
            setActiveCracks((prev) => {
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
 * Slice 70-Z.4 — performance budget enforcement. Caps the number of
 * concurrent disintegrate animations so a 5+ permanent board wipe
 * doesn't spawn 50+ motion.divs. The first MAX_CONCURRENT_DISINTEGRATES
 * destructions get the visual treatment; surplus snap to graveyard
 * via the standard B glide. The board-wipe ripple still fires once
 * regardless.
 *
 * <p><b>Counter:</b> increments on each populate; decrements on
 * setTimeout matching the longer of dust/exile durations. Race-free
 * because both increments and decrements happen on the JS main
 * thread.
 */
let activeDisintegrateCount = 0;
function countAgainstBudget(populate: () => void): void {
  if (activeDisintegrateCount >= MAX_CONCURRENT_DISINTEGRATES) return;
  populate();
  activeDisintegrateCount += 1;
  setTimeout(() => {
    activeDisintegrateCount = Math.max(0, activeDisintegrateCount - 1);
  }, 700);
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
 * Slice 70-Z diagnostic — opt-in console tracing for animations. Enable
 * by appending `?animDebug=1` to the page URL. When on, every event
 * subscription logs entry + each gate decision so we can see why an
 * animation didn't fire. Production-safe (silent unless flag is set).
 */
function isAnimDebug(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('animDebug') === '1';
  } catch {
    return false;
  }
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

