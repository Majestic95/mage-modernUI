import {
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import type {
  WebCombatGroupView,
  WebPermanentView,
  WebPlayerView,
} from '../api/schemas';
import {
  arrowStrokeForColorIdentity,
  defenderColorIdentity,
  type StrokeSpec,
} from './halo';

/**
 * Slice 1-X-tunings round 7 (live-test verdict 2026-05-09) —
 * uniform dash pattern across all combat arrows. Color encodes
 * defender identity; the original per-defender dash variation
 * (solid / dashed / dotted / ticked) was unnecessary visual noise
 * once the gradient stroke + dash were both present. User
 * direction: "colors are differentiators enough, they don't need
 * different dashed lines."
 */
const ARROW_DASH_PATTERN = '8 6';

/**
 * Combat-arrow geometry — extracted from {@link ./CombatArrows} in
 * slice 1-X.0 (mechanical-tier split, 2026-05-09) so that file
 * lands back under the project's 500 LOC hard cap. The split is
 * verbatim: every helper here lived in CombatArrows.tsx between
 * slice 1-A's color/dash addition and this slice. No logic change.
 *
 * <p>Owns:
 *
 * <ul>
 *   <li>{@link ArrowSpec} — per-arrow render spec (geometry + visual
 *       signal + identity metadata) consumed by the renderer.</li>
 *   <li>{@link useCombatArrowGeometry} — the React hook that
 *       measures source/target rects from the DOM and applies the
 *       endpoint-fan pass.</li>
 *   <li>{@code useCombatFingerprint} (internal) — content-keyed
 *       memo so the geometry effect doesn't re-run on referentially-
 *       fresh-but-equal gameUpdate frames.</li>
 *   <li>{@code applyEndpointFan} (internal) — splays endpoints when
 *       multiple arrows share a target so the arrowheads don't
 *       stack on a single pixel.</li>
 *   <li>DOM-rect helpers (internal) — {@code rectForPermanent},
 *       {@code rectForPlayer}, {@code combatEndpointNodes},
 *       {@code centerOf}, {@code cssEscape}.</li>
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
 */

const ARROW_FAN_SPACING_PX = 24;

export interface ArrowSpec {
  key: string;
  source: { x: number; y: number };
  target: { x: number; y: number };
  /**
   * Slice 1-A — full stroke spec routed from the defender's commander
   * color identity (single-color → solid mana token; multi-color →
   * banded gradient). Replaces the prior single-color {@code color}
   * field; {@link TargetingArrow} consumes the spec directly.
   */
  stroke: StrokeSpec;
  /**
   * Slice 1-A — SVG dash pattern paired with the stroke color so
   * color-blind users get a redundant signal. Indexed by defender
   * position in the {@code players} array via
   * {@link defenderDashPattern}.
   */
  dashArray: string;
  /** Originating attacker's permanent id (matches data-permanent-id). */
  attackerId: string;
  /**
   * Receiving end's id. Either a blocker permanent id (same scheme
   * as attackerId) or {@code "player:<defenderId>"} when unblocked.
   * Used by hover-isolation to match arrows against the hovered DOM.
   */
  targetId: string;
  /** Slice 1-A — defender id (player UUID) for data-attr surfacing. */
  defenderId: string;
  /** Slice 1-A — defender position in the players array (-1 if missing). */
  defenderIndex: number;
}

/**
 * Measures combat-arrow source / target geometry from the DOM and
 * applies the endpoint-fan pass. Re-runs on combat changes
 * (fingerprinted), window resize, any nested scroll, and document
 * mutations observed via ResizeObserver. Returns viewport-space
 * coordinates to match the {@code position: fixed} TargetingArrow SVG.
 */
export function useCombatArrowGeometry(
  combat: readonly WebCombatGroupView[],
  players: readonly WebPlayerView[],
): readonly ArrowSpec[] {
  const [arrows, setArrows] = useState<readonly ArrowSpec[]>([]);
  const combatFingerprint = useCombatFingerprint(combat, players);

  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const raw: ArrowSpec[] = [];
      for (const group of combat) {
        // Slice 1-A — derive defender stroke + dash once per group
        // so every arrow targeting this defender shares the same
        // visual signal (color = identity, dash = lane). Blocker
        // arrows inherit the defender's lane signal (the brainstorm
        // is explicit: arrow color matches the *defending* player's
        // commander, not the blocker's).
        const defenderIndex = players.findIndex(
          (p) => p.playerId === group.defenderId,
        );
        const colorId = defenderColorIdentity(group.defenderId, players);
        const stroke = arrowStrokeForColorIdentity(colorId);
        const dashArray = ARROW_DASH_PATTERN;

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
                stroke,
                dashArray,
                attackerId,
                targetId: blockerId,
                defenderId: group.defenderId,
                defenderIndex,
              });
            }
          } else {
            const targetRect = rectForPlayer(group.defenderId);
            if (!targetRect) continue;
            raw.push({
              key: `${attackerId}->player:${group.defenderId}`,
              source: sourcePoint,
              target: centerOf(targetRect),
              stroke,
              dashArray,
              attackerId,
              targetId: `player:${group.defenderId}`,
              defenderId: group.defenderId,
              defenderIndex,
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
 * Reduces a combat array (and slice-1-A's defender-color inputs) to
 * a content-fingerprint string so the geometry effect doesn't re-run
 * on referentially-fresh-but-equal gameUpdate frames.
 *
 * <p>Players' relevant fields (playerId + colorIdentity) participate
 * in the fingerprint because slice 1-A derives per-arrow stroke +
 * dash from defender colors. Color identity rarely changes mid-game,
 * but if it does, the geometry effect must rebuild ArrowSpecs so the
 * stroke updates. This is cheap — color identity changes correspond
 * to player joins/leaves, which are infrequent.
 */
function useCombatFingerprint(
  combat: readonly WebCombatGroupView[],
  players: readonly WebPlayerView[],
): string {
  return useMemo(() => {
    const combatPart = combat
      .map((g) => {
        const att = Object.keys(g.attackers).sort().join(',');
        const blk = Object.keys(g.blockers).sort().join(',');
        return `${g.defenderId}|${att}|${blk}`;
      })
      .join(';');
    const playersPart = players
      .map((p) => `${p.playerId}:${p.colorIdentity.join('')}`)
      .join('+');
    return `${combatPart}@@${playersPart}`;
  }, [combat, players]);
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
