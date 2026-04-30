import { useEffect, useState } from 'react';
import {
  isCinematicCastActive,
  subscribeToAnimationState,
} from './animationState';

/**
 * Slice 70-Z.3 — React subscription to {@link animationState}.
 * Returns true while the given cardId is mid-cinematic-cast (the
 * casting-pose hold is in flight). Used by {@code StackZone}'s
 * focal-tile to render {@code null} during the hold so the
 * overlay's {@code layoutId={cardId}} doesn't collide with the
 * focal tile's own {@code layoutId={cardId}}.
 */
export function useIsCinematicCastActive(cardId: string): boolean {
  const [active, setActive] = useState<boolean>(() =>
    isCinematicCastActive(cardId),
  );
  useEffect(() => {
    const update = () => setActive(isCinematicCastActive(cardId));
    update();
    return subscribeToAnimationState(update);
  }, [cardId]);
  return active;
}
