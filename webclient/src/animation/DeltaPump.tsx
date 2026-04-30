import { useCallback } from 'react';
import { emit } from './eventBus';
import { useGameDelta } from './useGameDelta';
import type { GameEvent } from './gameDelta';

/**
 * Slice 70-Z.2 — pure-side-effect React component that subscribes
 * to gameView via {@link useGameDelta} and fans every emitted
 * {@link GameEvent} through the module-singleton event bus.
 *
 * <p>One-line consumer; lives in its own file so the slice 70-Z.3
 * integration tests can mount it in isolation without dragging in
 * the entire {@code CardAnimationLayer}'s overlay portals.
 *
 * <p>Renders nothing. The testid lets integration tests assert it
 * was actually mounted into the tree.
 */
export function DeltaPump(): React.JSX.Element {
  const dispatch = useCallback((events: GameEvent[]) => {
    for (const evt of events) emit(evt);
  }, []);
  useGameDelta(dispatch);
  // Hidden span (NOT `return null`) so integration tests can assert
  // mount via getByTestId('delta-pump'). The `hidden` attribute is
  // sufficient for screen-reader suppression — span renders no
  // pixels and announces nothing. DO NOT replace with return null
  // without also rewriting the slice 70-Z.3 integration tests that
  // depend on the testid.
  return <span data-testid="delta-pump" hidden aria-hidden="true" />;
}
