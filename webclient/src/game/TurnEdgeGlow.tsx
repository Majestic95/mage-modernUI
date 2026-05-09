import { useGameStore } from './store';
import { computeBlendedHaloBackground } from './halo';

/**
 * Slow-rotating commander-identity-colored ring at the viewport
 * edges that signals "it's your turn." Per user direction
 * 2026-05-09 — players were missing their own turns despite the
 * existing per-pod glow + header text; a viewport-edge ring is
 * hard to peripherally miss without dominating attention.
 *
 * <p>Triggers on the local player's TURN ({@code isActive}), not
 * on priority. Priority changes hands many times within a single
 * turn (every spell on the stack, every responder window) — using
 * priority would make the ring blink in/out constantly. Turn is
 * the right signal: ring visible for the duration of the player's
 * own turn, hidden during opponents' turns.
 *
 * <p>Coloring uses {@link computeHaloBackground} from the shared
 * halo helper, so multi-color commanders get a banded
 * conic-gradient (e.g., Boros W/R = 2-band white/red), single-
 * color get a solid mana token, colorless / eliminated get the
 * neutral team ring. Same color vocabulary as the per-pod halos.
 *
 * <p>Rotation reuses the existing {@code halo-rotate} keyframe
 * (animates the registered {@code @property --halo-angle} from 0
 * to 360deg). Local override at 20s/cycle (vs portrait halo's
 * 12s) since the viewport perimeter is much longer — slower feels
 * ambient rather than busy.
 *
 * <p>Implementation notes:
 * <ul>
 *   <li>{@code position: fixed inset:0} so the ring follows the
 *       viewport regardless of game-table grid layout.</li>
 *   <li>{@code z-20} — below ActionPanel (z-30), dialogs (z-40),
 *       modals (z-50). Player can still click everything.</li>
 *   <li>{@code pointer-events: none} so it never intercepts clicks.</li>
 *   <li>Mask-composite trick clips the conic-gradient to a 12px
 *       ring at the viewport perimeter (see
 *       {@code .turn-edge-glow} in index.css).</li>
 *   <li>Reduced-motion silences the rotation (slice 70-B contract);
 *       the static colored ring stays visible.</li>
 * </ul>
 *
 * <p>Renders nothing when the local player is NOT the active
 * player — spectators, opponents' turns, dead players all fall
 * through to null (no DOM, no paint cost).
 */
export function TurnEdgeGlow() {
  const me = useGameStore((s) => {
    const gv = s.gameView;
    if (!gv) return null;
    return gv.players.find((p) => p.playerId === gv.myPlayerId) ?? null;
  });
  if (!me?.isActive) return null;
  // Match the elimination signal used by PlayerPortrait halos
  // (player.hasLeft is the terminal "out of the game" flag).
  // Use the blended helper (smooth crossfade between colors) rather
  // than the banded one — the viewport halo reads better as a soft
  // gradient than as discrete arc bands.
  const background = computeBlendedHaloBackground(
    me.colorIdentity ?? [],
    !!me.hasLeft,
  );
  return (
    <div
      data-testid="turn-edge-glow"
      data-color-identity={(me.colorIdentity ?? []).join('') || 'C'}
      aria-hidden="true"
      style={{ background }}
      className="fixed inset-0 z-20 pointer-events-none turn-edge-glow"
    />
  );
}
