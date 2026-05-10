/**
 * Bundle 5 / Slice 5-A.2 — displayed-life lag store.
 *
 * Each attacker fires N parcels (one per damage point). Each parcel
 * landing should tick the defender's DISPLAYED life down by 1 — not
 * the wire-side life, which has already moved to the post-damage
 * value at the moment the wire frame arrived. This store tracks the
 * lag: when N parcels are queued for player P, the displayed life
 * is `wireLife + pendingTicks(P)`. As each parcel lands, pendingTicks
 * decrements, and the displayed life converges down to the wire
 * value tick by tick.
 *
 * <p><b>Lifetime:</b> session-only, like all the other zustand stores
 * in this folder. A reconnect / new game replaces the gameView
 * snapshot wholesale; this store gets reset by the consumer
 * (DamageParcelOverlay) on cleanup if it survives long enough to
 * matter, but in practice ticks resolve within 3 seconds of the wire
 * frame so a fresh game finds the store empty.
 *
 * <p><b>Defensive clamp:</b> {@code tickLand} floors the count at 0
 * so a stray landing event (e.g. a parcel that timed out without
 * being properly queued) doesn't take the displayed life below the
 * wire value. {@code enqueueTicks} ignores zero-or-negative counts
 * (no-op) so callers don't need to guard.
 */
import { create } from 'zustand';

interface LifeDisplayState {
  /** Outstanding parcel-landings per playerId. */
  pendingTicksByPlayerId: Record<string, number>;
  /**
   * Increase the pending tick count for a player. Called when an
   * attacker's parcel stream is queued — {@code count} = the number
   * of parcels about to fire (= attacker's power).
   */
  enqueueTicks: (playerId: string, count: number) => void;
  /**
   * Decrement the pending tick count for a player by 1, floored at
   * 0. Called when a parcel lands. Drops the player from the map
   * entirely when the count reaches 0 so a stale entry never lingers.
   */
  tickLand: (playerId: string) => void;
  /** Clear all pending ticks (e.g. on game-end / reconnect). */
  reset: () => void;
}

export const useLifeDisplayStore = create<LifeDisplayState>((set) => ({
  pendingTicksByPlayerId: {},
  enqueueTicks: (playerId, count) => {
    if (!playerId || count <= 0) return;
    set((state) => ({
      pendingTicksByPlayerId: {
        ...state.pendingTicksByPlayerId,
        [playerId]:
          (state.pendingTicksByPlayerId[playerId] ?? 0) + Math.floor(count),
      },
    }));
  },
  tickLand: (playerId) => {
    if (!playerId) return;
    set((state) => {
      const current = state.pendingTicksByPlayerId[playerId] ?? 0;
      if (current <= 0) return state;
      const next = current - 1;
      const updated = { ...state.pendingTicksByPlayerId };
      if (next === 0) {
        delete updated[playerId];
      } else {
        updated[playerId] = next;
      }
      return { pendingTicksByPlayerId: updated };
    });
  },
  reset: () => set({ pendingTicksByPlayerId: {} }),
}));

/**
 * Hook returning the pending tick count for a given player. Returns
 * 0 when no ticks are pending. Subscribed via zustand's selector
 * pattern so a component only re-renders when ITS player's count
 * changes (not when other players' counts change).
 */
export function usePendingLifeTicks(playerId: string): number {
  return useLifeDisplayStore(
    (state) => state.pendingTicksByPlayerId[playerId] ?? 0,
  );
}
