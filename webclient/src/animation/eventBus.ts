import type { GameEvent, GameEventKind } from './gameDelta';

/**
 * Slice 70-Z.2 — minimal pub/sub for the card-animation pipeline.
 * The {@link DeltaPump} computes events by diffing successive
 * {@link WebGameView} snapshots and {@link emit}s them. Visual
 * consumers ({@code CardAnimationLayer}, individual {@code
 * BattlefieldTile}s in slice 70-Z.4) subscribe via {@link on} and
 * drive their overlay/keyframe state.
 *
 * <p>The bus is module-singleton — single producer (DeltaPump),
 * many consumers. Decoupling the producer from per-component
 * subscribers prevents the layer from prop-drilling event arrays
 * through the React tree.
 *
 * <p>Per-cardId metadata maps ({@link castKindByCardId},
 * {@link exitKindByCardId}) are populated by the layer so individual
 * tiles can read their kind synchronously during exit / enter
 * animations. They live alongside the bus because the layer fans
 * events into them; consolidating prevents drift between event-
 * emission and metadata writes.
 */

type Listener<E extends GameEvent = GameEvent> = (evt: E) => void;

const listeners = new Map<GameEventKind, Set<Listener>>();

/**
 * Subscribe to events of a given kind. Returns an unsubscribe
 * function — pair {@code on} and the returned unsub in {@code
 * useEffect} cleanup.
 */
export function on<K extends GameEventKind>(
  kind: K,
  fn: Listener<Extract<GameEvent, { kind: K }>>,
): () => void {
  let bucket = listeners.get(kind);
  if (!bucket) {
    bucket = new Set();
    listeners.set(kind, bucket);
  }
  bucket.add(fn as Listener);
  return () => {
    bucket?.delete(fn as Listener);
  };
}

/**
 * Emit an event. All listeners for the event's kind are invoked
 * synchronously in subscription order. A throwing listener does
 * NOT abort the loop — animation overlays are independent and one
 * mounting-error mustn't cascade to the next.
 */
export function emit(evt: GameEvent): void {
  // Slice 70-Z diagnostic — opt-in via ?animDebug=1. Logs every emit
  // so we can confirm the diff pipeline is producing events when
  // animations don't seem to fire live.
  if (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('animDebug') === '1'
  ) {
    const bucketSize = listeners.get(evt.kind)?.size ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[animDebug] emit ${evt.kind}`, evt, `(${bucketSize} listener${bucketSize === 1 ? '' : 's'})`);
  }
  const bucket = listeners.get(evt.kind);
  if (!bucket) return;
  for (const fn of bucket) {
    try {
      fn(evt);
    } catch (err) {
      // Match the pre-existing console-only error policy used by
      // the Zustand store's gameUpdate handler. The bus is fire-
      // and-forget; an animation crash must not blank the table.
      console.error('[eventBus] listener threw', evt.kind, err);
    }
  }
}

/**
 * Imperative escape hatch used by tests, the demo route, and any
 * future "instant replay" feature to fire animations without the
 * snapshot-diff pipeline. Direct alias of {@link emit} — distinct
 * name surfaces intent at call sites.
 */
export const playCardAnimation = emit;

/**
 * Reset between tests. Avoids leakage where one test's listeners
 * fire during another's emits. NOT exported for production code.
 */
export function __resetForTests(): void {
  listeners.clear();
  castKindByCardId.clear();
  exitKindByCardId.clear();
}

/**
 * Per-cardId cast kind. Populated by CardAnimationLayer when a
 * {@code cast} event fires; read by the StackZone focal tile to
 * decide whether to delay its layout glide for the cinematic pose
 * pause. Cleared automatically when the cardId leaves the stack
 * (resolve_to_board / resolve_to_grave / countered handlers all
 * delete their entry).
 */
export const castKindByCardId = new Map<
  string,
  'standard' | 'cinematic'
>();

/**
 * Per-cardId exit kind. Populated by CardAnimationLayer when a
 * {@code creature_died} or {@code permanent_exiled} event fires;
 * read by BattlefieldTile during its AnimatePresence exit so it
 * can mount the dust / dissolve overlay synchronously with Framer's
 * exit phase. Cleared on AnimatePresence's onExitComplete callback.
 */
export const exitKindByCardId = new Map<
  string,
  'dust' | 'exile'
>();
