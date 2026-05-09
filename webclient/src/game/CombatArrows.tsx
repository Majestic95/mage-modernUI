import { useEffect, useState } from 'react';
import type {
  WebCombatGroupView,
  WebPlayerView,
} from '../api/schemas';
import { TargetingArrow } from './TargetingArrow';
import { useCombatArrowGeometry } from './combatArrowGeometry';

/**
 * Combat-arrow overlay — extracted from StackZone.tsx (was at 865
 * LOC, past the 500 hard cap with no documented exception). The
 * geometry layer (ArrowSpec, useCombatArrowGeometry, applyEndpointFan,
 * fingerprint memo, DOM-rect helpers) was further split out into
 * {@link ./combatArrowGeometry} in slice 1-X.0 (mechanical-tier,
 * 2026-05-09) so this file lands back under cap with room for slices
 * 1-B / 1-C / 1-D to layer on. This file owns only:
 *
 * <ul>
 *   <li>{@link CombatArrows} — renders one TargetingArrow per
 *       attacker→defender (or attacker→blocker) pair.</li>
 *   <li>{@link useHoveredCombatId} — tracks which combat
 *       participant the cursor is over so the renderer can dim
 *       non-hovered arrows.</li>
 * </ul>
 *
 * <p><b>Why hover-isolation:</b> in dense combat the user wants to
 * trace one creature's connection without losing the full picture.
 * Hovering a {@code data-permanent-id} (attacker / blocker) or a
 * {@code data-portrait-target-player-id} (defender) sets the active
 * id; arrows touching that id stay at full opacity, the rest dim
 * to {@link ARROW_DIM_OPACITY}. Hovering off-board clears isolation.
 */

// Slice 1-A — raised from 0.25 to 0.5 alongside per-defender colored
// strokes. At 0.25 a dark-bias mana color (mono-B's lavender
// `--color-mana-black` over the dark teal `--color-bg-base`) drops to
// ~1.4:1 contrast — well below WCAG 1.4.11's 3:1 minimum for non-
// text graphics. 0.5 keeps the dimmed arrow clearly de-emphasized
// while preserving identifiability of every color identity.
const ARROW_DIM_OPACITY = 0.5;

export function CombatArrows({
  combat,
  players = [],
}: {
  combat: readonly WebCombatGroupView[];
  /**
   * Slice 1-A — players array used to resolve the defender's
   * commander color identity into the arrow stroke + dash pattern.
   * Optional with a default of {@code []} so older call sites that
   * don't yet plumb players don't crash; arrows fall back to the
   * legacy neutral teal stroke when no defender is found in the list.
   */
  players?: readonly WebPlayerView[];
}) {
  const arrows = useCombatArrowGeometry(combat, players);
  const hoveredId = useHoveredCombatId();

  if (arrows.length === 0) {
    return (
      <div
        data-testid="stack-zone"
        data-stack-mode="combat-pending"
        aria-hidden="true"
      />
    );
  }

  const isolating = hoveredId !== null;

  return (
    <div
      data-testid="stack-zone"
      data-stack-mode="combat"
      data-arrow-count={arrows.length}
      data-hover-isolating={isolating || undefined}
      aria-hidden="true"
    >
      {arrows.map((spec) => {
        const matches =
          isolating &&
          (spec.attackerId === hoveredId || spec.targetId === hoveredId);
        const opacity = !isolating ? 1 : matches ? 1 : ARROW_DIM_OPACITY;
        return (
          <TargetingArrow
            key={spec.key}
            source={spec.source}
            to={spec.target}
            stroke={spec.stroke}
            strokeDasharray={spec.dashArray}
            opacity={opacity}
            defenderId={spec.defenderId}
            // Slice 1-A — drop -1 sentinel (defender not in players)
            // at the boundary so the rendered DOM doesn't surface a
            // confusing `data-defender-index="-1"` to downstream
            // consumers (slice 1-B's incoming-tag pin-by-defender,
            // slice 1-D's beams). Pattern lookup already returns ''
            // for -1 so the visual fallback is unaffected.
            defenderIndex={
              spec.defenderIndex >= 0 ? spec.defenderIndex : undefined
            }
          />
        );
      })}
    </div>
  );
}

/**
 * Tracks the cursor-targeted combat participant id. Returns:
 * <ul>
 *   <li>a permanent id (attacker or blocker) when the cursor is
 *       over a {@code data-permanent-id} element,</li>
 *   <li>{@code "player:<uuid>"} when the cursor is over a
 *       {@code data-portrait-target-player-id} element,</li>
 *   <li>{@code null} otherwise (no isolation).</li>
 * </ul>
 *
 * <p>Document-level pointerover listener. Fast path: closest() on
 * the immediate event target. Slow path (when the immediate target
 * isn't a combat element): walk the elementsFromPoint stack so a
 * tooltip / HoverCardDetail painted ON TOP of an attacker tile
 * still resolves to the underlying tile rather than clearing
 * isolation. setHovered bails out via Object.is when the resolved
 * id doesn't change, so transitions between nested children of
 * the same tile don't trigger re-renders.
 */
function useHoveredCombatId(): string | null {
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const matchOn = (el: Element): string | null => {
      const tile = el.closest('[data-permanent-id]');
      if (tile) return tile.getAttribute('data-permanent-id');
      const portrait = el.closest('[data-portrait-target-player-id]');
      if (portrait) {
        const pid = portrait.getAttribute('data-portrait-target-player-id');
        return pid ? `player:${pid}` : null;
      }
      return null;
    };
    const onOver = (ev: PointerEvent) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (target) {
        const fast = matchOn(target);
        if (fast !== null) {
          setHovered(fast);
          return;
        }
      }
      // Slow path — peek beneath the cursor for stacked combat
      // elements (tooltip / portal painted on top).
      if (typeof document.elementsFromPoint === 'function') {
        const stack = document.elementsFromPoint(ev.clientX, ev.clientY);
        for (const el of stack) {
          const id = matchOn(el);
          if (id !== null) {
            setHovered(id);
            return;
          }
        }
      }
      setHovered(null);
    };
    document.addEventListener('pointerover', onOver);
    return () => {
      document.removeEventListener('pointerover', onOver);
    };
  }, []);

  return hovered;
}
