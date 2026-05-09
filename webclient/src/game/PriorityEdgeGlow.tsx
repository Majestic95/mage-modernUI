import { useGameStore } from './store';

/**
 * Soft pulsing ring at the viewport edges that signals "you have
 * priority." Per user direction 2026-05-09 — players were missing
 * their own turns despite the existing per-pod glow + header text;
 * a viewport-edge ring is hard to peripherally miss without
 * dominating attention.
 *
 * <p>Implementation:
 * <ul>
 *   <li><b>Position:</b> {@code position: fixed inset-0} so the ring
 *       follows the viewport regardless of game-table grid layout.
 *       T1/T7 unaffected — overlay, not a pod participant.</li>
 *   <li><b>z-index:</b> 20, below ActionPanel (z-30) + dialogs (z-40)
 *       + modals (z-50). Player can still click everything; the ring
 *       sits behind interactive surfaces visually.</li>
 *   <li><b>Pointer events:</b> {@code pointer-events: none} so it
 *       never intercepts clicks on cards / buttons below.</li>
 *   <li><b>Visual:</b> inset box-shadow at the viewport edges in
 *       fuchsia (the project accent), plus a soft 2s breathe pulse
 *       via the {@code priority-edge-pulse} keyframe.</li>
 *   <li><b>Reduced motion:</b> the keyframe is gated by the global
 *       {@code @media (prefers-reduced-motion: reduce)} rule (slice
 *       70-B contract); reduced-motion users see a static glow
 *       instead of the breathe pulse.</li>
 * </ul>
 *
 * <p>Renders nothing when the local player does NOT have priority —
 * spectators, dead players, mid-resolution states all fall through
 * to null (no DOM, no paint cost).
 */
export function PriorityEdgeGlow() {
  const hasPriority = useGameStore((s) => {
    const gv = s.gameView;
    if (!gv) return false;
    const me = gv.players.find((p) => p.playerId === gv.myPlayerId);
    return !!me?.hasPriority;
  });
  if (!hasPriority) return null;
  return (
    <div
      data-testid="priority-edge-glow"
      aria-hidden="true"
      className="fixed inset-0 z-20 pointer-events-none priority-edge-glow"
    />
  );
}
