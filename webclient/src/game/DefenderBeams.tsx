import { useLayoutEffect, useMemo, useState } from 'react';
import type { WebPlayerView } from '../api/schemas';
import { useGameStore } from './store';
import { defenderColorIdentity, manaGlowTokenForCode } from './halo';

/**
 * Bundle 1 / Slice 1-D — defender beams overlay. During combat,
 * soft low-opacity color washes radiate from the central focal area
 * toward each opponent being attacked. Idle (non-defended) opponents
 * stay neutral. The wash signals the *distribution of pressure*
 * across the table — at a glance the user reads "two are getting
 * hit, one isn't" before parsing individual arrows.
 *
 * <p><b>Implementation:</b> per-defender {@code <div>} positioned
 * fixed over the entire viewport. Background is a CSS
 * {@code radial-gradient} centred at viewport center fading out to
 * transparent; {@code clip-path} cones the visible region toward
 * the defender's portrait. Together they paint a soft directional
 * wash from the table's middle toward each attacked seat.
 *
 * <p><b>Why a CSS gradient + clip-path</b> rather than SVG: keeps
 * geometry simple (no per-frame stroke layout, no per-arrow defs),
 * GPU-composited via {@code background} and {@code clip-path}, no
 * additional listener overhead beyond the resize-and-portrait-rect
 * remeasure already used by combat arrows.
 *
 * <p><b>Multicolor commanders:</b> the beam uses the FIRST color
 * of the defender's identity (e.g., a Selesnya WG opponent's beam
 * is green). The beam is ambient pressure, not strict identification
 * — slice 1-A's per-arrow gradient stroke + dash signal already
 * carries the precise color encoding. Documented simplification;
 * may revisit if live-test feel says it reads wrong.
 *
 * <p><b>Why this is OK alongside the central-area mutex:</b> the
 * brainstorm flagged that the central focal cell can only show one
 * thing at a time (stack OR arrows). DefenderBeams is a viewport
 * overlay, not focal-cell content — it survives stack pushes during
 * combat and continues signaling pressure even when CombatArrows
 * temporarily unmounts. (Slice 1-B made the same architectural call
 * for IncomingTag's pin lifetime.)
 *
 * <p><b>Static surface:</b> no motion (no pulse, no rotate, no
 * breathing). Reduced-motion users see exactly the same thing as
 * everyone else — fades / opacity-only static gradients pass WCAG
 * 2.3.3 trivially.
 */
export function DefenderBeams() {
  // Subscribe with primitive selectors where possible. `players` and
  // `combat` are array references that shift per gameUpdate frame;
  // the geometry effect collapses them via a content fingerprint
  // so the actual remeasure only fires on real change.
  const phase = useGameStore((s) => s.gameView?.phase ?? '');
  const myPlayerId = useGameStore((s) => s.gameView?.myPlayerId ?? '');
  const players = useGameStore(
    (s) => s.gameView?.players ?? EMPTY_PLAYERS,
  );
  const combat = useGameStore((s) => s.gameView?.combat ?? EMPTY_COMBAT);

  // Distinct defenderIds being attacked, with at least one attacker.
  // Local player is suppressed (consistent with IncomingTag's own-
  // portrait suppression in slice 1-B — the player doesn't need a
  // pressure indicator pointing at themselves). The `myPlayerId`
  // truthy guard prevents an empty-string `myPlayerId` (spectator
  // view, unjoined fixture) from collapsing into "match every
  // defender with empty defenderId" and silently suppressing them
  // (slice 1-D critic-pass TC-N2).
  const activeDefenderIds = useMemo<readonly string[]>(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const group of combat) {
      if (myPlayerId && group.defenderId === myPlayerId) continue;
      if (Object.keys(group.attackers).length === 0) continue;
      if (!seen.has(group.defenderId)) {
        seen.add(group.defenderId);
        out.push(group.defenderId);
      }
    }
    return out;
  }, [combat, myPlayerId]);

  const beams = useDefenderBeamGeometry(activeDefenderIds, players);

  if (phase !== 'COMBAT') return null;
  if (beams.length === 0) return null;

  return (
    <div
      data-testid="defender-beams"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: BEAM_Z_INDEX,
        pointerEvents: 'none',
      }}
    >
      {beams.map((beam) => (
        <div
          key={beam.defenderId}
          data-testid={`defender-beam-${beam.defenderId}`}
          style={{
            position: 'fixed',
            inset: 0,
            background: `radial-gradient(circle at 50% 50%, ${beam.color} 0%, transparent ${BEAM_RADIUS_PCT}%)`,
            clipPath: beam.clipPath,
            opacity: BEAM_OPACITY,
            pointerEvents: 'none',
          }}
        />
      ))}
    </div>
  );
}

/* =====================================================================
 * Constants — the beam's visual character. Tuned at the 1440p target
 * viewport (T4); sub-1440p degrades cleanly because the cone widens
 * proportionally with viewport size.
 * ===================================================================*/

/**
 * z-index for the beam overlay container. Slice 1-X.3 critic-pass
 * fix (UI-N4): dropped from 30 to 5 so beams sit BEHIND
 * `--z-ui-chrome` (30) — the user's hand fan, the floating
 * ActionButton, and the side panel were getting tinted in
 * opponents' commander colors when this was at z-30. Arrows
 * (z-40), chrome (z-30), and stack (z-10) all paint over beams now.
 * Source of truth: `--z-defender-beams: 5` in `tokens.css`.
 * {@code pointer-events: none} keeps clicks passing through
 * regardless of stacking.
 */
const BEAM_Z_INDEX = 5;

/**
 * Radial-gradient fade radius as a percentage of the viewport's
 * smaller dimension (CSS `circle` units). 50% means the gradient
 * fully fades to transparent at the viewport edge — beam intensity
 * peaks at the table center and softens toward the player's pod.
 */
const BEAM_RADIUS_PCT = 50;

/**
 * Single-beam core opacity. With overlapping beams at the viewport
 * center (worst case: 3 simultaneously-attacked defenders share the
 * same center pixels), the sum is bounded at ~0.54, well below the
 * "blinding flash" threshold. Brief target was 0.18.
 */
const BEAM_OPACITY = 0.18;

/**
 * Half-angle of the cone clip-path in radians. 30° (π/6) total =
 * 60° cone aperture, narrow enough to read as "pointing at this
 * pod" rather than "general spotlight," wide enough to spread the
 * gradient softly across the player's pod and adjacent space.
 */
const BEAM_HALF_ANGLE_RAD = Math.PI / 6;

// Module-scope empty fallbacks for the gameView selectors. Returning
// fresh `[]` each call would defeat zustand's identity-stable
// re-render gating; these constants stay referentially equal across
// renders.
const EMPTY_PLAYERS: readonly WebPlayerView[] = [];
const EMPTY_COMBAT: readonly never[] = [];

interface BeamSpec {
  defenderId: string;
  /** CSS background color string (mana token CSS variable reference). */
  color: string;
  /** CSS {@code clip-path} polygon string aiming the cone at the portrait. */
  clipPath: string;
}

/**
 * Computes per-defender beam geometry: viewport center → portrait
 * direction, cone clip-path, beam color. Re-runs on defender-set
 * change, window resize, and ResizeObserver mutations on observed
 * portrait nodes (mirrors {@code combatArrowGeometry}'s recomputation
 * triggers so the beam stays pinned to the portrait while the layout
 * settles).
 */
function useDefenderBeamGeometry(
  defenderIds: readonly string[],
  players: readonly WebPlayerView[],
): readonly BeamSpec[] {
  const [beams, setBeams] = useState<readonly BeamSpec[]>([]);
  const fingerprint = useDefenderBeamFingerprint(defenderIds, players);

  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const out: BeamSpec[] = [];
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      for (const defenderId of defenderIds) {
        const portrait = portraitNodeFor(defenderId);
        if (!portrait) continue;
        const rect = portrait.getBoundingClientRect();
        const px = rect.left + rect.width / 2;
        const py = rect.top + rect.height / 2;
        // Aim vector from viewport center toward the portrait.
        // Skip degenerate (defender's portrait happens to overlap
        // the viewport center — vanishingly rare; would yield a
        // zero-length vector and an undefined cone).
        const aimDx = px - cx;
        const aimDy = py - cy;
        if (aimDx === 0 && aimDy === 0) continue;
        const aimAngle = Math.atan2(aimDy, aimDx);
        // Clip-path cone reaches all the way to the viewport's
        // bounding diagonal so the gradient's transparent edge
        // fades naturally inside the cone.
        const reach = Math.hypot(window.innerWidth, window.innerHeight);
        const leftAngle = aimAngle - BEAM_HALF_ANGLE_RAD;
        const rightAngle = aimAngle + BEAM_HALF_ANGLE_RAD;
        const leftX = cx + Math.cos(leftAngle) * reach;
        const leftY = cy + Math.sin(leftAngle) * reach;
        const rightX = cx + Math.cos(rightAngle) * reach;
        const rightY = cy + Math.sin(rightAngle) * reach;
        const clipPath = `polygon(${cx.toFixed(1)}px ${cy.toFixed(1)}px, ${leftX.toFixed(1)}px ${leftY.toFixed(1)}px, ${rightX.toFixed(1)}px ${rightY.toFixed(1)}px)`;
        const colorId = defenderColorIdentity(defenderId, players);
        const color = beamColorFor(colorId);
        out.push({ defenderId, color, clipPath });
      }
      if (!cancelled) setBeams(out);
    };

    let frame: number | null = null;
    const scheduleMeasure = () => {
      if (cancelled || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };

    measure();
    window.addEventListener('resize', scheduleMeasure);
    document.addEventListener('scroll', scheduleMeasure, {
      capture: true,
      passive: true,
    });
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(scheduleMeasure)
        : null;
    if (observer) {
      observer.observe(document.body);
      for (const id of defenderIds) {
        const node = portraitNodeFor(id);
        if (node) observer.observe(node);
      }
    }

    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleMeasure);
      document.removeEventListener('scroll', scheduleMeasure, true);
      if (observer) observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  return beams;
}

/**
 * Content-keyed fingerprint so the geometry effect doesn't re-run
 * on referentially-fresh-but-equal gameUpdate frames. Captures the
 * defender-set order plus each defender's color identity (the
 * inputs that drive the beam's appearance).
 */
function useDefenderBeamFingerprint(
  defenderIds: readonly string[],
  players: readonly WebPlayerView[],
): string {
  return useMemo(() => {
    const ids = defenderIds.join(',');
    const colors = players
      .map((p) => `${p.playerId}:${p.colorIdentity.join('')}`)
      .join('+');
    return `${ids}@@${colors}`;
  }, [defenderIds, players]);
}

/**
 * First-color-of-identity → mana-glow-token CSS reference. Multicolor
 * commanders use only their first color for the beam wash; the
 * full identity encoding lives on the per-arrow stroke from slice
 * 1-A.
 *
 * <p>Slice 1-D critic-pass (UC-N1) — uses the alpha-reduced `*-glow`
 * tokens (rgba 0.5 internally) instead of full-saturation tokens to
 * avoid stacking against tabletop's per-pod glow-token zone
 * backgrounds. Effective per-beam alpha: 0.18 × 0.5 = 0.09;
 * 3-beam-stack worst case at viewport center: 0.27 instead of 0.54
 * — keeps the focal card readable.
 *
 * <p>Slice 1-X.3 critic-pass (Bundle-1 UI-2) — empty identity
 * (colorless commander) now uses `--color-mana-colorless-glow`
 * (silver-grey rgba 0.45) instead of `--color-targeting-arrow`
 * (cream/teal). The targeting-arrow neutral compounded against
 * tabletop's `--tabletop-zone-colorless` ivory+gold zone tint —
 * the same family of saturation collision UC-N1 was meant to
 * prevent for colored commanders. The colorless-glow token is
 * the actual `*-glow` sibling for the colorless lane and stays
 * consistent with the alpha-reduced family.
 */
function beamColorFor(colorIdentity: readonly string[]): string {
  if (colorIdentity.length === 0) {
    return 'var(--color-mana-colorless-glow)';
  }
  return manaGlowTokenForCode(colorIdentity[0]!);
}

function portraitNodeFor(defenderId: string): HTMLElement | null {
  if (!defenderId) return null;
  const selector = `[data-portrait-target-player-id="${cssEscape(defenderId)}"]`;
  const node = document.querySelector(selector);
  return node ? (node as HTMLElement) : null;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/(["\\])/g, '\\$1');
}
