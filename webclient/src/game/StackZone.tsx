import {
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type {
  WebCardView,
  WebCombatGroupView,
  WebPermanentView,
} from '../api/schemas';
import { slow, SLOWMO } from '../animation/debug';
import {
  STACK_ENTER_EXIT,
  STACK_ZONE_COLLAPSE_MS,
} from '../animation/transitions';
import { CardFace } from './CardFace';
import { HoverCardDetail } from './HoverCardDetail';
import { REDESIGN } from '../featureFlags';
import { computeHaloBackground, computeHaloGlow } from './halo';
import { TargetingArrow } from './TargetingArrow';

/**
 * Slice 70-N (ADR 0011 D5, picture-catalog §3) — central focal-zone
 * rewrite. Replaces the legacy flex-wrap row of small uniform stack
 * tiles with three exclusive modes:
 *
 * <ul>
 *   <li><b>Stack mode</b> (§3.1): topmost stack item rendered at
 *       {@code --card-size-focal} (170×238) with a color-identity
 *       glow ring pulsing at 1.5s ({@code stack-glow-pulse}). Items
 *       2-5 fan BEHIND the topmost at progressively smaller scales
 *       (85% / 70% / 55% / 40% of focal) and slight angles. 6+
 *       collapse to a "+N more" pill.</li>
 *   <li><b>Combat mode</b> (§3.2): when stack is empty AND combat is
 *       in progress, replace stack content with attack/block arrows.
 *       Arrows reuse {@link TargetingArrow}'s SVG geometry; source
 *       is the attacker's {@code BattlefieldTile} bounding-rect
 *       center, target is each declared blocker (when the group is
 *       blocked) or the defending player's PORTRAIT (when not
 *       blocked — picture-catalog §3.2 specs "portrait", not the
 *       outer pod).</li>
 *   <li><b>Empty</b> (§3.3): renders nothing — the particle-drift
 *       backdrop shows through unobstructed.</li>
 * </ul>
 *
 * <p>Legacy (non-REDESIGN) branch preserves the slice-50 strip
 * layout verbatim. Will be deleted in slice 70-Z after the redesign
 * push signs off.
 *
 * <p><b>Critic-pass changes (post slice 70-N initial dispatch):</b>
 * <ul>
 *   <li>Fan tiles render via a {@code size="focal"} CardFace scaled
 *       through a wrapper transform (UI critic C1) so the fan reads
 *       as "small versions of the focal card" not as 60×84 stack
 *       tiles bunched behind a giant focal.</li>
 *   <li>Multicolor halo uses {@link computeHaloBackground} conic-
 *       gradient (UI critic C2 / Graphical critic IMP-2) to honor
 *       the catalog's "alternating bands" mandate, with a blur
 *       filter for the soft-halo feathered edge.</li>
 *   <li>Fan {@code layoutId} is namespaced (UI critic C3) so two
 *       copies of the same card on the stack don't collapse into
 *       one Framer layout slot during AnimatePresence transitions.</li>
 *   <li>Fan tiles are explicitly centered via translate-1/2
 *       (Graphical critic CRIT-3) — without this they rendered at
 *       the section's top-left corner.</li>
 *   <li>Defender-arrow target prefers the PlayerPortrait selector
 *       (Tech critic IMPORTANT-4); falls back to the pod-level
 *       PlayerArea selector for SR / legacy compatibility.</li>
 *   <li>FAN_CAP capped at 4 (Graphical critic IMP-5 / Tech critic
 *       IMPORTANT-2) since 5th tile at 25% scale was an illegible
 *       smear.</li>
 *   <li>Glow color regex falls back to colorless-glow on no-match
 *       (Tech critic CRITICAL-1).</li>
 *   <li>Combat-arrow hook: cancelled flag for setState-after-unmount
 *       safety; scroll listener uses passive mode without capture
 *       (Tech critic CRITICAL-2/-3).</li>
 *   <li>Halo box-shadow drops 8px spread (Graphical critic IMP-1 /
 *       UI critic I2) — keeps blur only for the "soft halo, not
 *       hard ring" anchor in picture-catalog "Color & motion
 *       impressions."</li>
 *   <li>"+N more" pill moved from {@code -top-2 -right-2} to
 *       {@code -top-2 -left-2} (UI critic N1) so it doesn't compete
 *       with the focal CardFace's top-right mana cost overlay.</li>
 * </ul>
 */
export function StackZone({
  stack,
  combat = [],
}: {
  stack: Record<string, WebCardView>;
  /**
   * Slice 70-N — combat groups passed through from {@link Battlefield}.
   * Drives combat-arrow mode (§3.2). Defaults to {@code []} so older
   * call sites and legacy non-REDESIGN tests don't need to change.
   * Ignored entirely outside REDESIGN mode.
   */
  combat?: readonly WebCombatGroupView[];
}) {
  const entries = Object.values(stack).reverse();

  if (REDESIGN) {
    return (
      <StackZoneRedesigned entries={entries} combat={combat} />
    );
  }

  // Legacy branch — unchanged from slice 50.
  const isEmpty = entries.length === 0;
  return (
    <section
      data-testid="stack-zone"
      className={`flex-shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2 transition-opacity ${
        isEmpty ? 'opacity-0 pointer-events-none h-0 overflow-hidden py-0 border-b-0' : 'opacity-100'
      }`}
      style={{ transitionDuration: `${STACK_ZONE_COLLAPSE_MS * SLOWMO}ms` }}
    >
      <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
        Stack ({entries.length}) — top resolves first
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {entries.map((card, idx) => {
            const tooltip = [card.typeLine, ...(card.rules ?? [])]
              .filter(Boolean)
              .join('\n');
            const layoutId = card.cardId ? card.cardId : undefined;
            return (
              <motion.div
                key={card.id}
                layout
                layoutId={layoutId}
                data-layout-id={layoutId}
                initial={{ opacity: 0, y: -16, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 24, scale: 0.85 }}
                transition={slow(STACK_ENTER_EXIT)}
              >
                <HoverCardDetail card={card}>
                  <div
                    data-testid="stack-entry"
                    className="relative"
                    title={tooltip || card.name}
                  >
                    <CardFace card={card} size="stack" />
                    {idx === 0 && (
                      <span
                        data-testid="stack-top-marker"
                        className="absolute -top-1.5 -right-1.5 text-[9px] font-semibold bg-fuchsia-500 text-zinc-100 px-1 rounded shadow"
                      >
                        TOP
                      </span>
                    )}
                  </div>
                </HoverCardDetail>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}

/**
 * Slice 70-N — REDESIGN focal + combat-arrow renderer. Split out as
 * a named subcomponent so the legacy branch above stays a clean
 * verbatim copy of slice 50; future work that retires the legacy
 * branch can delete the wrapper outright and rename this back to
 * {@link StackZone}.
 */
function StackZoneRedesigned({
  entries,
  combat,
}: {
  entries: readonly WebCardView[];
  combat: readonly WebCombatGroupView[];
}) {
  const stackEmpty = entries.length === 0;
  const combatActive = combat.length > 0;

  if (stackEmpty && !combatActive) {
    return (
      <div
        data-testid="stack-zone"
        data-stack-mode="empty"
        aria-hidden="true"
      />
    );
  }

  if (stackEmpty && combatActive) {
    return <CombatArrows combat={combat} />;
  }

  return <StackFan entries={entries} />;
}

/**
 * Slice 70-N — visible-fan cap. Entries 2-5 (idx 1-4, max 4 fan
 * tiles) render behind the topmost. 5+ collapse to the "+N more"
 * pill.
 *
 * <p>Originally shipped with FAN_CAP=5; the Graphical critic
 * (IMP-5) and Technical critic (IMPORTANT-2) both flagged that
 * position 5 at 25% scale (~42×60px) was an illegible smear that
 * contributed nothing perceptual. Picture-catalog §3.1 specs the
 * scale curve as "85% / 70% / etc." — 4 fan tiles cover scales
 * 0.85 / 0.70 / 0.55 / 0.40, which is the readable band.
 */
const FAN_CAP = 4;

/**
 * Slice 70-N — focal-card + fan layout (§3.1). The topmost entry
 * (idx 0) renders at {@code --card-size-focal} with a color-identity
 * halo. Lower entries fan BEHIND the topmost via a {@code
 * size="focal"} CardFace scaled by a wrapper transform — picture-
 * catalog §3.1 specs the fan tiles as "85% of focal", "70% of
 * focal", etc., NOT as smaller stack-variant tiles. Five+ entries
 * past the focal collapse to a "+N more" pill on the topmost.
 */
function StackFan({ entries }: { entries: readonly WebCardView[] }) {
  const topmost = entries[0];
  if (!topmost) return null;

  const fan = entries.slice(1, 1 + FAN_CAP);
  const overflow = Math.max(0, entries.length - 1 - FAN_CAP);

  const topmostHalo = computeHaloBackground(topmost.colors, false);
  // Slice 70-N.1 — outer radiating glow sourced from the SAME color
  // identity as the inner halo bands. User directive 2026-04-30:
  // every halo must radiate its color. 32px glow radius reads as
  // "soft halo" on the 170×238 focal card without spilling into the
  // pod regions.
  const topmostGlow = computeHaloGlow(topmost.colors, false, 32);

  return (
    <section
      data-testid="stack-zone"
      data-stack-mode="focal"
      data-stack-count={entries.length}
      className="relative flex items-center justify-center"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {/* Fan items render BELOW the topmost. Reverse mapping order
            so motion's reorder animations don't shuffle the visible
            stack when an entry resolves. */}
        {fan
          .slice()
          .reverse()
          .map((card, reverseIdx) => {
            const distance = fan.length - reverseIdx;
            return (
              <FanCard key={card.id} card={card} distance={distance} />
            );
          })}
        <FocalCard
          key={topmost.id}
          card={topmost}
          haloBackground={topmostHalo}
          haloGlow={topmostGlow}
          haloIsMulticolor={topmost.colors.length > 1}
          overflow={overflow}
        />
      </AnimatePresence>
    </section>
  );
}

/**
 * Slice 70-N — fan-position card. Renders a {@code size="focal"}
 * CardFace scaled down by a wrapper transform. Centered absolutely
 * behind the focal card via {@code top-1/2 left-1/2 -translate-x-1/2
 * -translate-y-1/2} (the Graphical critic CRIT-3 fix — without
 * explicit centering the absolute positioning collapsed to the
 * section's top-left corner).
 *
 * <p>Scale step: 0.85 / 0.70 / 0.55 / 0.40 (15% per position) —
 * matches picture-catalog §3.1's "~85% of focal for position 2,
 * ~70% for position 3, etc." curve. Rotation alternates sign per
 * position with magnitude growing 5°→8° (alternating ±) so the fan
 * reads as a deck of spells, not a straight-down accordion.
 *
 * <p>Vertical offset rises with distance so each successive tile
 * peeks above the topmost. The offset is a fraction of the focal
 * card height so a future polish slice that retunes
 * {@code --card-size-focal} doesn't break the fan layout.
 */
function FanCard({
  card,
  distance,
}: {
  card: WebCardView;
  /** 1 = directly behind topmost, FAN_CAP = furthest visible. */
  distance: number;
}) {
  const scale = 1 - distance * 0.15;
  // ±5° → ±6° → ±7° → ±8° per position. Sign alternates by parity
  // of `distance` so even tiles tip left and odd tiles tip right —
  // produces the "deck of cards spread on a table" silhouette
  // rather than a straight-line stack.
  const rotateDeg =
    (distance % 2 === 0 ? -1 : 1) * Math.min(8, 4 + distance);
  // Fraction-of-focal-height vertical offset. Picks 0.10× per step
  // — at 238px focal that's ~24px per position, comfortably above
  // the focal's bottom edge.
  const yOffset = `calc(var(--card-size-focal) * 7 / 5 * ${-distance * 0.1})`;

  // Slice 70-N UI critic C3 — namespace the layoutId so a fan tile
  // and the focal card never share an id during AnimatePresence's
  // exit-old-enter-new overlap. The cross-zone glide track (hand →
  // stack) lives on the FOCAL card's plain `cardId`; fans are
  // intra-zone and don't need to participate in cross-zone glides.
  const layoutId = card.cardId ? `stack-fan-${card.cardId}` : undefined;

  return (
    <motion.div
      layout
      layoutId={layoutId}
      data-testid="stack-fan-card"
      data-fan-distance={distance}
      data-fan-scale={scale.toFixed(2)}
      data-layout-id={layoutId}
      initial={{ opacity: 0, scale: scale * 0.9 }}
      animate={{ opacity: 0.85, scale, rotate: rotateDeg }}
      exit={{ opacity: 0, scale: scale * 0.85 }}
      transition={slow(STACK_ENTER_EXIT)}
      className="absolute pointer-events-none top-1/2 left-1/2"
      style={{
        // Center the wrapper at the section's center, then offset
        // upward by `yOffset` so the fan rises above the focal card.
        // The -50% translate centers the wrapper itself (since its
        // intrinsic size is the focal card's 170×238); the additional
        // calc() shifts it up.
        transform: `translate(-50%, calc(-50% + ${yOffset}))`,
        zIndex: -2,
      }}
    >
      <CardFace card={card} size="focal" />
    </motion.div>
  );
}

/**
 * Slice 70-N — topmost focal card. Wraps {@link CardFace} in a
 * color-identity halo + {@code stack-glow-pulse} pulse, plus
 * optional "+N more" overflow pill.
 *
 * <p>Halo composition (post critic-pass):
 * <ul>
 *   <li>Single color → solid color background on the halo div with
 *       the {@code --color-mana-X-glow} alpha token.</li>
 *   <li>Multicolor → conic-gradient via {@link computeHaloBackground}
 *       — same mechanism as PlayerPortrait halos so the visual
 *       language is consistent across pod + focal.</li>
 *   <li>Colorless / empty → neutral team color from
 *       {@link computeHaloBackground}.</li>
 * </ul>
 * The halo div sits at {@code -inset-2} (extends 8px past the
 * card edges) with a CSS {@code filter: blur(8px)} that softens
 * the boundary between bands and feathers the outer edge — picture-
 * catalog "Color & motion impressions" anchor: "soft halo, not hard
 * ring; large blur radius, low alpha."
 */
function FocalCard({
  card,
  haloBackground,
  haloGlow,
  haloIsMulticolor,
  overflow,
}: {
  card: WebCardView;
  /**
   * CSS background value for the halo div — solid color, conic-
   * gradient (multicolor), or the team-neutral fallback.
   */
  haloBackground: string;
  /**
   * Slice 70-N.1 — CSS box-shadow value for the outer radiating
   * glow. Sourced from {@code computeHaloGlow} so the glow color
   * matches the card's color identity (single = that color's -glow
   * token; multicolor = layered shadows, one per color; colorless =
   * silver). Required for the "every halo radiates from its color"
   * universal rule.
   */
  haloGlow: string;
  /**
   * Whether the halo background is a multicolor conic-gradient.
   * Drives whether {@code animate-halo-rotate} animates the
   * gradient origin (multicolor only — rotating a solid color is a
   * no-op and wastes a layer).
   */
  haloIsMulticolor: boolean;
  /** Number of entries beyond the visible fan; 0 → no pill. */
  overflow: number;
}) {
  const tooltip = [card.typeLine, ...(card.rules ?? [])]
    .filter(Boolean)
    .join('\n');
  // Slice 70-N UI critic C3 — focal layoutId stays on plain `cardId`
  // (no namespace) so a card animating from the hand to the stack
  // glides via the existing cross-zone layoutId track. Fan tiles use
  // a `stack-fan-` prefix to avoid collisions during a stack
  // resolution where a fan tile promotes to focal.
  const layoutId = card.cardId ? card.cardId : undefined;

  // Slice 70-N.1 — halo style. Background carries the inner color
  // (solid or conic-gradient bands), filter softens the band edges
  // into the catalog's "soft halo" treatment, and box-shadow
  // radiates outward in the SAME color identity per
  // computeHaloGlow (user directive 2026-04-30: every halo must
  // glow in its color, not flat gold).
  const haloStyle: CSSProperties = {
    background: haloBackground,
    filter: 'blur(10px)',
    boxShadow: haloGlow,
  };

  return (
    <motion.div
      layout
      layoutId={layoutId}
      key={card.id}
      data-testid="stack-focal-card"
      data-stack-glow={haloBackground}
      data-halo-outer-glow={haloGlow}
      data-halo-multicolor={haloIsMulticolor || undefined}
      data-layout-id={layoutId}
      initial={{ opacity: 0, y: -24, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.85 }}
      transition={slow(STACK_ENTER_EXIT)}
      className="relative"
    >
      {/* Pulsing halo — sits at -inset-2 (extends 8px past the card
          edges) so the blur(10px) filter has room to feather without
          clipping. animate-stack-glow-pulse modulates opacity 0.55
          ↔ 1.0; animate-halo-rotate spins the conic-gradient origin
          for multicolor cards (no-op for single-color). z-index: -1
          places it behind the CardFace within the focal motion.div's
          stacking context. */}
      <div
        data-testid="stack-focal-glow"
        className={
          'animate-stack-glow-pulse absolute -inset-2 rounded-xl pointer-events-none ' +
          (haloIsMulticolor ? 'animate-halo-rotate' : '')
        }
        style={{ ...haloStyle, zIndex: -1 }}
        aria-hidden="true"
      />
      <HoverCardDetail card={card}>
        <div
          data-testid="stack-entry"
          className="relative"
          title={tooltip || card.name}
        >
          <CardFace card={card} size="focal" />
          {overflow > 0 && (
            // Slice 70-N UI critic N1 — pill moved to top-LEFT so it
            // doesn't compete with the focal CardFace's mana cost
            // overlay at top-2 right-2 (CardFace.tsx focal variant).
            <span
              data-testid="stack-overflow-pill"
              className="absolute -top-2 -left-2 rounded-full bg-zinc-900/90 px-2 py-0.5 text-[11px] font-semibold text-zinc-100 shadow-md ring-1 ring-zinc-700"
            >
              +{overflow} more
            </span>
          )}
        </div>
      </HoverCardDetail>
    </motion.div>
  );
}

// ---------------------------------------------------------------
// Combat-arrow mode (§3.2)
// ---------------------------------------------------------------

interface ArrowSpec {
  key: string;
  source: { x: number; y: number };
  target: { x: number; y: number };
  color: string;
}

/**
 * Slice 70-N — renders an SVG TargetingArrow per attacker→defender
 * (or attacker→blocker) pair. Source / target coordinates come from
 * {@code getBoundingClientRect()} on the BattlefieldTile DOM nodes
 * (matched by {@code data-permanent-id}) and the defending player's
 * PlayerPortrait (matched by {@code data-portrait-target-player-id};
 * Tech critic IMPORTANT-4 fix — picture-catalog §3.2 specs "portrait"
 * not the outer pod).
 */
function CombatArrows({ combat }: { combat: readonly WebCombatGroupView[] }) {
  const arrows = useCombatArrowGeometry(combat);

  if (arrows.length === 0) {
    return (
      <div
        data-testid="stack-zone"
        data-stack-mode="combat-pending"
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      data-testid="stack-zone"
      data-stack-mode="combat"
      data-arrow-count={arrows.length}
      aria-hidden="true"
    >
      {arrows.map((spec) => (
        <TargetingArrow
          key={spec.key}
          source={spec.source}
          to={spec.target}
          color={spec.color}
        />
      ))}
    </div>
  );
}

/**
 * Slice 70-N — measures combat-arrow source / target geometry from
 * the DOM. Re-runs on combat changes, window resize, and document
 * resize-observed mutations. Returns viewport coordinates (matches
 * the {@code position: fixed} TargetingArrow SVG).
 *
 * <p><b>Critic-pass changes:</b>
 * <ul>
 *   <li>Tech critic CRITICAL-2 — {@code cancelled} flag in the
 *       cleanup guards {@code setArrows} from firing after the
 *       effect tears down. Combat array identity changes every
 *       gameUpdate frame, so this race window is real.</li>
 *   <li>Tech critic CRITICAL-2 — combat groups are reduced to a
 *       string fingerprint via {@link useCombatFingerprint} so
 *       reference-identity churn on equal-content frames doesn't
 *       force a fresh measurement run.</li>
 *   <li>Tech critic CRITICAL-3 — scroll listener is {@code passive:
 *       true} without {@code capture: true} so a game-log
 *       auto-scroll during combat doesn't trigger a measurement
 *       cascade.</li>
 * </ul>
 */
function useCombatArrowGeometry(
  combat: readonly WebCombatGroupView[],
): readonly ArrowSpec[] {
  const [arrows, setArrows] = useState<readonly ArrowSpec[]>([]);

  // Reduce the combat array to a stable fingerprint so referentially-
  // distinct but content-equal frames (the typical gameUpdate case
  // — server emits a fresh JSON-deserialized array each tick) don't
  // tear down + re-create the listener stack.
  const combatFingerprint = useCombatFingerprint(combat);

  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const next: ArrowSpec[] = [];
      for (const group of combat) {
        const attackerEntries = Object.values(group.attackers);
        const blockerEntries = Object.values(group.blockers);
        for (const attacker of attackerEntries) {
          const sourceRect = rectForPermanent(attacker);
          if (!sourceRect) continue;
          const sourcePoint = centerOf(sourceRect);

          if (blockerEntries.length > 0) {
            for (const blocker of blockerEntries) {
              const targetRect = rectForPermanent(blocker);
              if (!targetRect) continue;
              next.push({
                key: `${attacker.card.id}->${blocker.card.id}`,
                source: sourcePoint,
                target: centerOf(targetRect),
                color: 'var(--color-targeting-arrow)',
              });
            }
          } else {
            const targetRect = rectForPlayer(group.defenderId);
            if (!targetRect) continue;
            next.push({
              key: `${attacker.card.id}->player:${group.defenderId}`,
              source: sourcePoint,
              target: centerOf(targetRect),
              color: 'var(--color-targeting-arrow)',
            });
          }
        }
      }
      if (!cancelled) setArrows(next);
    };

    measure();

    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    // Tech critic CRITICAL-3 — passive scroll listener at the document
    // level (no capture). Avoids cascade fires from nested scrollers
    // like the game log's auto-scroll. Also passive so the browser's
    // scroll path stays jank-free.
    window.addEventListener('scroll', onChange, { passive: true });

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(onChange)
        : null;
    if (observer) observer.observe(document.body);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange);
      if (observer) observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combatFingerprint]);

  return arrows;
}

/**
 * Slice 70-N — derives a stable string fingerprint from a combat
 * group array. Two arrays with the same attackers/blockers/defenders
 * produce the same fingerprint regardless of object identity, so
 * the geometry effect doesn't churn on every gameUpdate.
 *
 * <p>Uses card IDs only (not full views) because all the geometry
 * hook needs is the set of attacker/blocker UUIDs to query and the
 * defender's UUID — no rendering state.
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

function rectForPermanent(perm: WebPermanentView): DOMRect | null {
  const id = perm.card.id;
  if (!id) return null;
  const selector = `[data-permanent-id="${cssEscape(id)}"]`;
  const node = document.querySelector(selector);
  if (!node) return null;
  return (node as HTMLElement).getBoundingClientRect();
}

function rectForPlayer(playerId: string): DOMRect | null {
  if (!playerId) return null;
  // Slice 70-N Tech critic IMPORTANT-4 — prefer the PlayerPortrait
  // selector (catalog §3.2 says arrow target is the "portrait").
  // Falls back to the pod-level data-player-id when the portrait
  // isn't mounted (e.g. PlayerArea legacy branch, or a future pod
  // variant that suppresses the portrait).
  const portraitSelector = `[data-portrait-target-player-id="${cssEscape(playerId)}"]`;
  const portrait = document.querySelector(portraitSelector);
  if (portrait) return (portrait as HTMLElement).getBoundingClientRect();

  const podSelector = `[data-player-id="${cssEscape(playerId)}"]`;
  const pod = document.querySelector(podSelector);
  if (!pod) return null;
  return (pod as HTMLElement).getBoundingClientRect();
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
  // Inside a quoted attribute selector value the only characters
  // that need escaping are `"` and `\`. Engine UUIDs match
  // /[0-9a-f-]/i which contains neither — this branch is dead code
  // for the documented identifier scheme but defends against future
  // identifier formats that include a quote or backslash.
  return value.replace(/(["\\])/g, '\\$1');
}
