/**
 * Bundle 5 / Slice 5-A — frame-diff hook synthesizing damage events
 * from consecutive `WebGameView` snapshots. Sibling to
 * {@link useGameDelta} (which handles zone-transition events like
 * `creature_died`); damage detection is a separate concern with its
 * own discriminated-union type so the two hooks can evolve
 * independently.
 *
 * <p><b>Why a sibling, not extending GameEvent:</b> {@code GameEvent}
 * (`webclient/src/animation/gameDelta.ts`) is scoped to zone changes
 * (cast, resolve, die, exile, board-wipe). Damage events fire inside
 * the SAME zone (battlefield) and key off life/damage deltas, not
 * zone transitions. Bundling them would muddy the type. Bundle 5
 * slices 5-B/5-C/5-D will subscribe to this same hook for portrait
 * bloom, freeze-frame, and death-handoff sequencing.
 *
 * <p><b>Combat-damage-only attribution:</b> when a player's life
 * decreases, we attribute the loss to attackers in `gameView.combat`
 * groups whose `defenderId` matches the affected player. One event
 * is emitted PER attacker — the parcel cinematic then traces each
 * attacker's arrow path independently. We do NOT try to apportion
 * damage proportionally across multiple attackers; the `amount`
 * field carries the player's total life delta, which is sufficient
 * for the cinematic (parcel size + bloom intensity don't depend on
 * pixel-accurate attribution).
 *
 * <p>Non-combat life loss (instant cast, ETB triggers) currently
 * emits NO parcel events because we have no attacker to anchor to.
 * The default-recommendation in the slice 5-A scope brief is
 * combat-damage-only; UI critic can re-open if non-combat parcels
 * read better.
 *
 * <p><b>Synchronous Zustand subscribe:</b> mirrors {@link useGameDelta}'s
 * pattern — fires inside the store's `set()` call, BEFORE React
 * re-renders. Critical for cinematic timing: the parcel animation
 * must start at the SAME tick the life-counter flash starts so the
 * two visual signals land synchronously.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useGameStore } from '../game/store';
import type { WebGameView } from '../api/schemas';

/**
 * One damage event derived from a frame-diff. `attackerId` is the
 * permanent UUID of the attacker the cinematic should anchor to;
 * `defenderId` is the player UUID whose life decreased; `amount` is
 * the total life delta for that frame (NOT per-attacker).
 *
 * <p>Stable type shape so future slices can extend the union with
 * `creature_damaged` (perm.damage delta) and `creature_died` (zone
 * transition; sourced from useGameDelta) without breaking consumers
 * that only care about parcel events.
 */
export type DamageEvent = {
  kind: 'parcel_hit_player';
  attackerId: string;
  defenderId: string;
  amount: number;
};

/**
 * Slice 5-A — subscribe to game-state diffs and fire `onEvents` with
 * the synthesized damage events for that frame. Same lifetime
 * semantics as {@link useGameDelta}: subscribes once at mount,
 * unsubscribes on unmount; callback identity may change without
 * re-subscribing (latest captured via ref).
 *
 * <p>Empty event arrays are NOT delivered (callers always receive
 * at least one event when invoked, just like useGameDelta).
 */
export function useDamageEvents(
  onEvents: (events: DamageEvent[]) => void,
): void {
  const prevRef = useRef<WebGameView | null>(null);
  const onEventsRef = useRef(onEvents);
  useLayoutEffect(() => {
    onEventsRef.current = onEvents;
  });

  useEffect(() => {
    prevRef.current = useGameStore.getState().gameView;
    const unsub = useGameStore.subscribe((state, prev) => {
      if (state.gameView === prev.gameView) return;
      if (state.gameView === null) {
        // Pre-game / Waiting state — clear so the next real
        // snapshot is treated as the baseline (no events emitted
        // on the boundary).
        prevRef.current = null;
        return;
      }
      const events = diffDamageEvents(prevRef.current, state.gameView);
      prevRef.current = state.gameView;
      if (events.length > 0) {
        onEventsRef.current(events);
      }
    });
    return unsub;
  }, []);
}

/**
 * Pure diff function — exported for unit testing without standing
 * up the Zustand store. Returns events sorted deterministically by
 * `(defenderId, attackerId)` so multi-event frames stagger in a
 * stable order frame-after-frame.
 *
 * <p>Returns `[]` on the first invocation (no prev) since there's
 * no baseline to diff against.
 */
export function diffDamageEvents(
  prev: WebGameView | null,
  next: WebGameView,
): DamageEvent[] {
  if (prev == null) return [];
  if (!next.combat || next.combat.length === 0) return [];

  const events: DamageEvent[] = [];
  // Build a quick lookup of prev player life by playerId so we can
  // diff against the new frame in O(N).
  const prevLifeById = new Map<string, number>();
  for (const p of prev.players) {
    prevLifeById.set(p.playerId, p.life);
  }

  for (const nextPlayer of next.players) {
    const prevLife = prevLifeById.get(nextPlayer.playerId);
    if (prevLife === undefined) continue;
    const delta = prevLife - nextPlayer.life;
    if (delta <= 0) continue;
    // Find combat groups attacking this player. Each attacker in
    // those groups gets its own event so the parcel cinematic can
    // trace one arrow per attacker.
    for (const group of next.combat) {
      if (group.defenderId !== nextPlayer.playerId) continue;
      for (const attackerId of Object.keys(group.attackers ?? {})) {
        if (!attackerId) continue;
        events.push({
          kind: 'parcel_hit_player',
          attackerId,
          defenderId: nextPlayer.playerId,
          amount: delta,
        });
      }
    }
  }

  // Deterministic ordering: defender first, then attacker. Stagger
  // logic in DamageParcelOverlay assumes stable sort so the cadence
  // reads identically frame-after-frame for the same fixture.
  events.sort((a, b) => {
    if (a.defenderId !== b.defenderId) {
      return a.defenderId < b.defenderId ? -1 : 1;
    }
    if (a.attackerId !== b.attackerId) {
      return a.attackerId < b.attackerId ? -1 : 1;
    }
    return 0;
  });

  return events;
}
