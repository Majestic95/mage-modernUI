import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import type {
  WebCombatGroupView,
  WebPermanentView,
} from '../api/schemas';
import { TargetingArrow } from './TargetingArrow';

/**
 * Combat-arrow overlay — extracted from StackZone.tsx (was at 865
 * LOC, past the 500 hard cap with no documented exception). This
 * module owns:
 *
 * <ul>
 *   <li>{@link CombatArrows} — renders one TargetingArrow per
 *       attacker→defender (or attacker→blocker) pair.</li>
 *   <li>{@link useCombatArrowGeometry} — measures source/target
 *       rects from {@code data-permanent-id} /
 *       {@code data-portrait-target-player-id} and applies the
 *       endpoint-fan pass.</li>
 *   <li>{@link useHoveredCombatId} — tracks which combat
 *       participant the cursor is over so the renderer can dim
 *       non-hovered arrows.</li>
 * </ul>
 *
 * <p><b>Why endpoint-fanning:</b> when N attackers all target the
 * same defender (or N attackers all pile onto one blocker), every
 * arrow's {@code target} resolved to the same {@code centerOf(rect)}
 * point. Arrowheads stacked on a single pixel — visually unreadable.
 * The fan offsets each shared-target endpoint along the perpendicular
 * to that arrow's source→target direction by
 * {@link ARROW_FAN_SPACING_PX} × signed-index, producing a small
 * fan at the receiving end. Sources are unchanged because each
 * attacker is a distinct DOM tile.
 *
 * <p><b>Why hover-isolation:</b> in dense combat the user wants to
 * trace one creature's connection without losing the full picture.
 * Hovering a {@code data-permanent-id} (attacker / blocker) or a
 * {@code data-portrait-target-player-id} (defender) sets the active
 * id; arrows touching that id stay at full opacity, the rest dim
 * to {@link ARROW_DIM_OPACITY}. Hovering off-board clears isolation.
 */

const ARROW_FAN_SPACING_PX = 24;
const ARROW_DIM_OPACITY = 0.25;

interface ArrowSpec {
  key: string;
  source: { x: number; y: number };
  target: { x: number; y: number };
  color: string;
  /** Originating attacker's permanent id (matches data-permanent-id). */
  attackerId: string;
  /**
   * Receiving end's id. Either a blocker permanent id (same scheme
   * as attackerId) or {@code "player:<defenderId>"} when unblocked.
   * Used by hover-isolation to match arrows against the hovered DOM.
   */
  targetId: string;
}

export function CombatArrows({
  combat,
}: {
  combat: readonly WebCombatGroupView[];
}) {
  const arrows = useCombatArrowGeometry(combat);
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
            color={spec.color}
            opacity={opacity}
          />
        );
      })}
    </div>
  );
}

/**
 * Measures combat-arrow source / target geometry from the DOM and
 * applies the endpoint-fan pass. Re-runs on combat changes
 * (fingerprinted), window resize, any nested scroll, and document
 * mutations observed via ResizeObserver. Returns viewport-space
 * coordinates to match the {@code position: fixed} TargetingArrow SVG.
 */
function useCombatArrowGeometry(
  combat: readonly WebCombatGroupView[],
): readonly ArrowSpec[] {
  const [arrows, setArrows] = useState<readonly ArrowSpec[]>([]);
  const combatFingerprint = useCombatFingerprint(combat);

  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const raw: ArrowSpec[] = [];
      for (const group of combat) {
        const attackerEntries = Object.values(group.attackers);
        const blockerEntries = Object.values(group.blockers);
        for (const attacker of attackerEntries) {
          const sourceRect = rectForPermanent(attacker);
          if (!sourceRect) continue;
          const sourcePoint = centerOf(sourceRect);
          // card.id is z.string() per webCardViewSchema (non-nullable).
          // Raw access — empty fallback would collapse multiple arrows
          // into one hover-isolation bucket and was a real bug
          // (technical critic 2026-05-08).
          const attackerId = attacker.card.id;

          if (blockerEntries.length > 0) {
            for (const blocker of blockerEntries) {
              const targetRect = rectForPermanent(blocker);
              if (!targetRect) continue;
              const blockerId = blocker.card.id;
              raw.push({
                key: `${attackerId}->${blockerId}`,
                source: sourcePoint,
                target: centerOf(targetRect),
                color: 'var(--color-targeting-arrow)',
                attackerId,
                targetId: blockerId,
              });
            }
          } else {
            const targetRect = rectForPlayer(group.defenderId);
            if (!targetRect) continue;
            raw.push({
              key: `${attackerId}->player:${group.defenderId}`,
              source: sourcePoint,
              target: centerOf(targetRect),
              color: 'var(--color-targeting-arrow)',
              attackerId,
              targetId: `player:${group.defenderId}`,
            });
          }
        }
      }

      const next = applyEndpointFan(raw);
      if (!cancelled) setArrows(next);
    };

    let frame: number | null = null;
    const scheduleMeasure = () => {
      if (cancelled || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };
    const onChange = () => scheduleMeasure();

    measure();
    window.addEventListener('resize', onChange);
    // Scroll does not bubble, so capture at the document level to
    // catch tabletop's nested zone scrollers. Without this, an
    // attacker can move inside an overflowed creature row while the
    // arrow stays pinned to its old viewport coordinate.
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
      for (const node of combatEndpointNodes(combat)) {
        observer.observe(node);
      }
    }

    return () => {
      cancelled = true;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener('resize', onChange);
      document.removeEventListener('scroll', scheduleMeasure, true);
      if (observer) observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combatFingerprint]);

  return arrows;
}

/**
 * Splays endpoints of arrows that share a target. Returns a new
 * array; raw is not mutated. Single-arrow targets pass through
 * unchanged so an unblocked 1v1 attack looks identical to today.
 *
 * <p>Buckets by {@code arrow.targetId} (the canonical "same target"
 * key — blocker permanent id or {@code player:<defenderId>}) rather
 * than by quantized screen coordinate. Coordinate-based grouping
 * carried a false-positive risk if two unrelated targets ever
 * landed within a few pixels of each other.
 */
function applyEndpointFan(raw: readonly ArrowSpec[]): ArrowSpec[] {
  const groups = new Map<string, ArrowSpec[]>();
  for (const arrow of raw) {
    let bucket = groups.get(arrow.targetId);
    if (!bucket) {
      bucket = [];
      groups.set(arrow.targetId, bucket);
    }
    bucket.push(arrow);
  }

  const out: ArrowSpec[] = [];
  for (const bucket of groups.values()) {
    if (bucket.length === 1) {
      out.push(bucket[0]!);
      continue;
    }
    // Stable visual order: leftmost source → leftmost fan slot.
    bucket.sort((a, b) => a.source.x - b.source.x);
    const n = bucket.length;
    for (let i = 0; i < n; i++) {
      const arrow = bucket[i]!;
      const offset = (i - (n - 1) / 2) * ARROW_FAN_SPACING_PX;
      const dx = arrow.target.x - arrow.source.x;
      const dy = arrow.target.y - arrow.source.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len;
      const py = dx / len;
      out.push({
        ...arrow,
        target: {
          x: arrow.target.x + px * offset,
          y: arrow.target.y + py * offset,
        },
      });
    }
  }
  return out;
}

/**
 * Reduces a combat array to a content-fingerprint string so the
 * geometry effect doesn't re-run on referentially-fresh-but-equal
 * gameUpdate frames.
 */
function useCombatFingerprint(
  combat: readonly WebCombatGroupView[],
): string {
  return useMemo(() => {
    return combat
      .map((g) => {
        const att = Object.keys(g.attackers).sort().join(',');
        const blk = Object.keys(g.blockers).sort().join(',');
        return `${g.defenderId}|${att}|${blk}`;
      })
      .join(';');
  }, [combat]);
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

function rectForPermanent(perm: WebPermanentView): DOMRect | null {
  const node = nodeForPermanent(perm);
  if (!node) return null;
  return node.getBoundingClientRect();
}

function nodeForPermanent(perm: WebPermanentView): HTMLElement | null {
  const id = perm.card.id;
  if (!id) return null;
  const selector = `[data-permanent-id="${cssEscape(id)}"]`;
  const node = document.querySelector(selector);
  if (!node) return null;
  return node as HTMLElement;
}

function rectForPlayer(playerId: string): DOMRect | null {
  const node = nodeForPlayer(playerId);
  if (!node) return null;
  return node.getBoundingClientRect();
}

function nodeForPlayer(playerId: string): HTMLElement | null {
  if (!playerId) return null;
  // Picture-catalog §3.2 — arrow targets the PORTRAIT, not the
  // outer pod. Falls back to the pod-level data-player-id when
  // the portrait isn't mounted (e.g. legacy PlayerArea variant).
  const portraitSelector = `[data-portrait-target-player-id="${cssEscape(playerId)}"]`;
  const portrait = document.querySelector(portraitSelector);
  if (portrait) return portrait as HTMLElement;
  const podSelector = `[data-player-id="${cssEscape(playerId)}"]`;
  const pod = document.querySelector(podSelector);
  if (!pod) return null;
  return pod as HTMLElement;
}

function combatEndpointNodes(
  combat: readonly WebCombatGroupView[],
): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const push = (node: HTMLElement | null) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    nodes.push(node);
  };
  for (const group of combat) {
    for (const attacker of Object.values(group.attackers)) {
      push(nodeForPermanent(attacker));
    }
    const blockers = Object.values(group.blockers);
    if (blockers.length > 0) {
      for (const blocker of blockers) {
        push(nodeForPermanent(blocker));
      }
    } else {
      push(nodeForPlayer(group.defenderId));
    }
  }
  return nodes;
}

function centerOf(rect: DOMRect): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/(["\\])/g, '\\$1');
}
