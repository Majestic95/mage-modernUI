/**
 * Bundle 4 / Slices 4-A + 4-B — combat role markers.
 *
 * <p>Three on-card overlays for every battlefield creature with a
 * non-null {@code combatRole}:
 * <ol>
 *   <li><b>Outer halo</b> ({@link RoleOuterHalo}, slice 4-B) — full-tile
 *       background div mounted BEHIND {@code <CardFace>} so the cardart
 *       paints over the center and only a 2.5 px halo frame remains
 *       visible. Color keyed to the controller's commander
 *       {@code colorIdentity} via {@link controllerOuterRingBackground};
 *       same alpha-reduced glow tokens as Bundle 1's defender beams so
 *       three creature halos at the central focal cell don't compound
 *       to a saturation spike against the per-pod zone tint.</li>
 *   <li><b>Inner ring</b> ({@link RoleMarkers}, slice 4-B) — 1.5 px
 *       inset box-shadow on the cardart's inside edge, colored by
 *       combat role ({@code var(--color-attacker)} /
 *       {@code var(--color-blocker)}).</li>
 *   <li><b>Corner brackets</b> ({@link RoleMarkers}, slice 4-A) — four
 *       SVG L-corners pinned outside the cardart on a -2 px inset.
 *       Attacker = sharp 90° L; blocker = same L + 4 px 45° inward
 *       diagonal stub for color-blind redundant signal (WCAG 1.4.1).</li>
 * </ol>
 *
 * <p><b>Why two mount points</b> ({@link RoleOuterHalo} BEFORE
 * {@code <CardFace>}, {@link RoleMarkers} AFTER): the outer halo
 * needs to paint behind the cardart so the cardart covers the central
 * region of the gradient div, leaving only the visible 2.5 px frame.
 * The inner ring + brackets need to paint on top so their stroke
 * isn't occluded by the cardart's pixels. CSS {@code z-index} would
 * also work but introduces stacking-context fragility — two siblings
 * with explicit DOM-order is the simpler invariant.
 *
 * <p><b>Why a separate sibling component (not inside
 * {@code <CardFace>}):</b> {@code CardFace.tsx} is already over the
 * 500 LOC hard cap as a documented exception. Bundle 4's policy is
 * to NOT make it worse — markers live here, not as new branches
 * inside CardFace.
 *
 * <p><b>T1 footprint preservation:</b> all three overlays are
 * {@code position: absolute; pointer-events: none}. The parent
 * button's bounding box is unchanged whether {@code combatRole} is
 * defined or not.
 *
 * <p><b>T3 art preservation:</b> outer halo paints OUTSIDE the cardart
 * (only the 2.5 px frame is visible after the cardart covers the
 * center). Inner ring is a 1.5 px inset shadow on the cardart's
 * inside edge — frame-of-painting depth, not pixels of the art.
 * Brackets sit on a -2 px inset, fully outside cardart bounds.
 *
 * <p><b>Future slices:</b> 4-C will add an eligibility-pulse
 * animation to the existing CardFace eligibility ring (orthogonal
 * surface, different file). 4-D will wrap this file's rendered
 * output in an LOD threshold check that swaps to an A/B sigil at
 * sub-{@code LOD_FALLBACK_WIDTH_PX} tile widths.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { controllerOuterRingBackground } from './halo';

const BRACKET_LEN = 10;
const BRACKET_THICKNESS = 2;
const BLOCKER_STUB = 4;
// Load-bearing invariant: SVG_SIZE must be >= 1 + BRACKET_LEN +
// BLOCKER_STUB so the rotated-around-center placement leaves the
// bracket vertex flush with each parent corner. Bumping BRACKET_LEN
// or BLOCKER_STUB without bumping SVG_SIZE shifts the vertex inward
// and the L-corners no longer hug the cardart.
const SVG_SIZE = 14;
// Negative inset of the marker overlay relative to the cardart. At
// tabletop's BucketCardsRow gap of 6px, two adjacent markers sit
// (gap - 2*BRACKET_OUTSET) = 2px apart — enough clearance to read
// as two separate cards rather than one continuous strip.
const BRACKET_OUTSET = 2;
// Slice 4-B — outer halo thickness (px). Frame stays inside the
// existing BRACKET_OUTSET so the brackets' L-corners still hug the
// cardart edge cleanly without overlapping the halo frame.
const OUTER_HALO_THICKNESS = 2.5;
// Slice 4-B — inner ring thickness (px). 1.5 px is the lightest
// readable signal at 1440p; thicker reads as a heavy frame and
// crowds the cardart's printed border.
const INNER_RING_THICKNESS = 1.5;
// Cardart corner radius — matches CardFace's `rounded-lg` Tailwind
// class which resolves to 0.5rem = 8px = the project's
// `--radius-md` token. Hard-coded as a CSS variable reference so a
// future retune of CardFace's radius is one edit away.
const CARDART_RADIUS = 'var(--radius-md, 8px)';
// Slice 4-D — LOD threshold. At parent button widths below this,
// the per-corner brackets + per-edge inner ring collapse into a
// single A/B sigil overlay so the marker chrome doesn't visually
// swamp small tiles. Outer halo (RoleOuterHalo) PERSISTS at sigil
// mode — it's the controller-color cue, not noisy at small sizes
// (a 2.5 px frame on a 60 px tile = ~4% of width, proportional to
// a 14 px bracket on a 200 px tile).
//
// Threshold = 72 px is intentional: tabletop's canonical
// `--card-size-medium` is 80 px, so the standard battlefield tile
// stays in full LOD. Triggers below 72: stack-peek strips
// (~16 px), `--card-size-small` (72 px) opponent tiles, and any
// runtime shrink past the medium baseline. Tuned in slice 4-D's
// UI critic pass after a sub-88 default would have silently
// collapsed every 80 px tile to sigil mode.
export const LOD_FALLBACK_WIDTH_PX = 72;
// Sigil dimensions (px). Sized for legibility at 60-px tile widths
// without crowding the cardart's top-right corner.
const SIGIL_SIZE = 16;
const SIGIL_OFFSET = 4;

type CombatRole = 'attacker' | 'blocker';

interface RoleMarkersProps {
  /**
   * Combat role for the underlying creature. {@code null} or
   * {@code undefined} means the creature is not in combat —
   * component renders {@code null}. Both shapes accepted to align
   * with the existing {@link tabletopBucketStacking#TabletopCardButton}
   * convention which uses {@code null} for "no role" and the
   * {@link Battlefield} {@code combatRoles} map which uses
   * {@code undefined} for the same.
   */
  combatRole: CombatRole | null | undefined;
  /**
   * Slice 4-X.0 — when the underlying creature is tapped, the
   * cardart rotates 90° via CardFace's internal `motion.div`. The
   * marker overlays are SIBLINGS of CardFace (not children), so
   * without explicit handling here the brackets + inner ring would
   * stay upright while the cardart rotates — exact bug class
   * fixed at CardFace.tsx:382-387 for the commander halo. We
   * mirror the 90° rotation around the wrapper's center so the
   * marker chrome stays aligned with the rotated cardart.
   */
  tapped?: boolean | undefined;
}

interface RoleOuterHaloProps extends RoleMarkersProps {
  /**
   * Controller's commander color identity (`W`/`U`/`B`/`R`/`G`
   * array). Drives the outer halo's color via
   * {@link controllerOuterRingBackground}. Empty / undefined →
   * silver-grey neutral.
   */
  controllerColorIdentity: readonly string[] | undefined;
}

// Slice 4-X.0 — CSS transition for the tap-rotation. Fixed-duration
// approximation of CardFace's spring `MANA_TAP_ROTATE`; close enough
// that markers + cardart visually stay locked together through the
// rotation. Spring exact-match isn't worth the complexity for a
// decorative overlay.
const TAP_ROTATE_TRANSITION =
  'transform 220ms cubic-bezier(0.45, 0, 0.55, 1)';

type LodMode = 'full' | 'sigil';

/**
 * Slice 4-D — measures the parent button's width via ResizeObserver
 * and returns the appropriate LOD mode. Defaults to {@code 'full'}
 * for unmeasured / zero-sized elements (jsdom fallback + initial
 * render before the first observer callback) so existing tests
 * targeting the slice 4-A / 4-B render paths don't need updates.
 *
 * <p>Cleanup is automatic on unmount via {@code observer.disconnect()}.
 * Graceful degradation when {@code ResizeObserver} is undefined
 * (older browsers / tests without the polyfill) — measurement runs
 * once at mount and the LOD mode never updates, which is acceptable
 * because tabletop's BucketCardsRow geometry is static at runtime
 * (cards adapt by stack/scroll, T1, NOT by tile-width animation).
 *
 * <p>Each marker component (RoleMarkers, RoleOuterHalo) measures
 * the SAME parent independently — two ResizeObserver instances per
 * combat creature. Acceptable cost (~12 observers on a typical 4p
 * board with 6 active combat creatures) given the simpler API
 * vs. lifting the measurement to TabletopCardButton + drilling
 * lodMode through both children's prop chains.
 */
function useTileLodMode(
  wrapperRef: RefObject<HTMLDivElement | null>,
): LodMode {
  const [mode, setMode] = useState<LodMode>('full');
  // useLayoutEffect (not useEffect) — synchronously runs after DOM
  // mutation but before browser paint. For sub-threshold tiles this
  // means the first paint already reflects 'sigil' mode, killing
  // the one-frame flicker where brackets+ring would briefly
  // render before collapsing (slice 4-D Tech critic notable T-4).
  useLayoutEffect(() => {
    // wrapperRef is stable across renders (created once via useRef);
    // the empty dep array is intentional — the effect runs once at
    // mount and the observer keeps firing on subsequent resizes.
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const button = wrapper.parentElement;
    if (!button) return;
    const measure = () => {
      const w = button.getBoundingClientRect().width;
      // jsdom + zero-sized initial render → 'full' (preserves
      // existing test behavior). The `w > 0` guard is NOT a width
      // threshold — it's an unmeasured-element fallback. Real
      // width below threshold → sigil.
      setMode(w > 0 && w < LOD_FALLBACK_WIDTH_PX ? 'sigil' : 'full');
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return mode;
}

/**
 * Slice 4-D — small role-keyed sigil that replaces the brackets +
 * inner ring at sub-{@link LOD_FALLBACK_WIDTH_PX} tile widths.
 * Bold serif A/B inside a filled circle, top-right corner of the
 * marker wrapper. Foreground is the dark base color so the role's
 * full-saturation token reads at WCAG 1.4.3 against the sigil
 * background (~7.9:1 attacker, ~5.9:1 blocker — verified in slice
 * 4-A's UI critic pass against the same hex tokens).
 */
function RoleSigil({ role }: { role: CombatRole }) {
  const bg =
    role === 'attacker' ? 'var(--color-attacker)' : 'var(--color-blocker)';
  const letter = role === 'attacker' ? 'A' : 'B';
  // Slice 4-X.0 N-F — shape redundancy at sigil mode. At full LOD
  // the WCAG 1.4.1 redundant signal is bracket geometry (sharp L vs
  // L+stub). At sigil mode the brackets are gone and color-blind
  // viewers were left with only the letter glyph (~8 px tall, hard
  // to discriminate at peek-strip scale). Differentiating the
  // sigil's BACKGROUND shape — circle for attacker, rounded square
  // for blocker — restores the redundant shape signal.
  const sigilRadius = role === 'attacker' ? '50%' : '4px';
  return (
    <div
      data-testid="role-sigil"
      data-role={role}
      aria-hidden="true"
      style={{
        position: 'absolute',
        // Bottom-LEFT corner — chosen in slice 4-D's UI critic pass
        // to avoid colliding with CardFace's existing battlefield
        // chrome: top-LEFT carries ATK/BLK + targetable badges,
        // top-RIGHT carries the mana-cost badge, bottom-RIGHT carries
        // P/T. Bottom-LEFT only has the damage badge (when damage>0)
        // — and the dual-shadow outline below provides separation
        // even on rare overlap.
        bottom: SIGIL_OFFSET,
        left: SIGIL_OFFSET,
        width: SIGIL_SIZE,
        height: SIGIL_SIZE,
        borderRadius: sigilRadius,
        background: bg,
        color: 'var(--color-bg-base)',
        fontFamily: 'serif',
        fontWeight: 'bold',
        fontSize: 11,
        lineHeight: `${SIGIL_SIZE}px`,
        textAlign: 'center',
        // Dual shadow: 1 px dark outline ensures separation from
        // warm-toned cardart corners (UI critic pass — drop shadow
        // alone failed against red rares with warm-toned borders);
        // 0 1px 2px drop shadow lifts the sigil off the surface.
        boxShadow:
          '0 0 0 1px rgb(0 0 0 / 0.4), 0 1px 2px rgb(0 0 0 / 0.45)',
        pointerEvents: 'none',
      }}
    >
      {letter}
    </div>
  );
}

/**
 * Render-time props for one corner of the bracket overlay. The
 * unrotated SVG draws a top-left-oriented bracket; other corners
 * rotate the SVG via CSS transform around its center, which moves
 * the bracket vertex to the appropriate corner of the SVG box.
 */
const CORNER_PLACEMENTS: ReadonlyArray<{
  key: 'tl' | 'tr' | 'br' | 'bl';
  position: { top?: 0; right?: 0; bottom?: 0; left?: 0 };
  rotateDeg: 0 | 90 | 180 | 270;
}> = [
  { key: 'tl', position: { top: 0, left: 0 }, rotateDeg: 0 },
  { key: 'tr', position: { top: 0, right: 0 }, rotateDeg: 90 },
  { key: 'br', position: { bottom: 0, right: 0 }, rotateDeg: 180 },
  { key: 'bl', position: { bottom: 0, left: 0 }, rotateDeg: 270 },
];

/**
 * One corner bracket, oriented top-left. Stroke length is fixed in
 * SVG coordinate space (NOT scaled with tile size) so the bracket
 * stays visually constant across tabletop's stack-shrink range.
 */
function CornerBracket({ role }: { role: CombatRole }) {
  const color =
    role === 'attacker' ? 'var(--color-attacker)' : 'var(--color-blocker)';
  return (
    <svg
      width={SVG_SIZE}
      height={SVG_SIZE}
      viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
      style={{ display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      {/* Vertical leg: vertex at (1,1) → down by BRACKET_LEN */}
      <line
        x1={1}
        y1={1}
        x2={1}
        y2={1 + BRACKET_LEN}
        stroke={color}
        strokeWidth={BRACKET_THICKNESS}
        strokeLinecap="square"
      />
      {/* Horizontal leg: vertex at (1,1) → right by BRACKET_LEN */}
      <line
        x1={1}
        y1={1}
        x2={1 + BRACKET_LEN}
        y2={1}
        stroke={color}
        strokeWidth={BRACKET_THICKNESS}
        strokeLinecap="square"
      />
      {/* Blocker-only redundant signal: 45° inward stub from vertex.
          Pure shape distinction so deuteranopia / monochrome viewers
          still see attacker-vs-blocker at a glance. */}
      {role === 'blocker' && (
        <line
          data-testid="blocker-stub"
          x1={1}
          y1={1}
          x2={1 + BLOCKER_STUB}
          y2={1 + BLOCKER_STUB}
          stroke={color}
          strokeWidth={BRACKET_THICKNESS}
          strokeLinecap="square"
        />
      )}
    </svg>
  );
}

/**
 * Slice 4-B — outer commander-color halo. MUST mount BEFORE
 * {@code <CardFace>} so the cardart paints over the central region
 * and only the {@link OUTER_HALO_THICKNESS} px frame remains
 * visible.
 *
 * <p>Returns {@code null} for non-combat creatures so the entire
 * battlefield doesn't light up under each player's commander color
 * (visual noise). Combat is a learnable attention surface; the halo
 * is its color-keyed wayfinding cue.
 *
 * <p><b>Tabletop-only by mount-site invariant:</b> the only
 * consumer is {@link tabletopBucketStacking#TabletopCardButton},
 * which is mounted exclusively from {@link TabletopBuckets} (gated
 * on {@code variant === 'tabletop'} in {@link PlayerArea}). Legacy
 * `current` variant paths use a separate per-creature button and
 * never instantiate this component. Halo radius math
 * ({@link CARDART_RADIUS} + 2.5 px) assumes the tabletop cardart's
 * `rounded-lg` (8 px) — wiring this into the legacy variant
 * (which uses `rounded`, 4 px) would produce a corner-radius
 * mismatch.
 */
export function RoleOuterHalo({
  combatRole,
  controllerColorIdentity,
  tapped,
}: RoleOuterHaloProps) {
  // Hooks must run unconditionally per rules-of-hooks; ref + LOD
  // measurement happen even when combatRole is null (zero-cost since
  // wrapper isn't mounted, observer never attaches).
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Slice 4-X.0 BH-3 — `useTileLodMode` is still called for the
  // observer side-effect (parent measures + the LOD mode is
  // observable for debugging via the markers' own `data-lod-mode`),
  // but the halo persists at all modes (slice 4-D ratification) so
  // we no longer surface the result on the halo itself. Discarded
  // void-cast keeps eslint happy without the dead `data-lod-mode`
  // attribute the bug-hunter critic flagged as "lying about a
  // non-fact."
  void useTileLodMode(wrapperRef);
  if (combatRole == null) return null;
  const background = controllerOuterRingBackground(
    controllerColorIdentity ?? [],
  );
  return (
    <div
      ref={wrapperRef}
      data-testid="role-outer-halo"
      data-role={combatRole}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: -OUTER_HALO_THICKNESS,
        pointerEvents: 'none',
        background,
        // Slightly larger radius than cardart so the corners stay a
        // uniform-thickness frame (square corners around a rounded
        // card would read as a glitch).
        borderRadius: `calc(${CARDART_RADIUS} + ${OUTER_HALO_THICKNESS}px)`,
        // Slice 4-X.0 B-1 — rotate with the cardart on tap so the
        // halo doesn't leave a portrait-shaped frame behind a
        // sideways creature. transformOrigin: center pivots around
        // the cardart's center (matching CardFace's motion.div).
        transform: tapped ? 'rotate(90deg)' : undefined,
        transformOrigin: 'center',
        transition: TAP_ROTATE_TRANSITION,
      }}
    />
  );
}

/**
 * Slices 4-A + 4-B — inner role-ring + corner brackets. MUST mount
 * AFTER {@code <CardFace>} so both overlays paint on top of the
 * cardart. Renders {@code null} for non-combat creatures.
 */
export function RoleMarkers({ combatRole, tapped }: RoleMarkersProps) {
  // Hooks must run unconditionally per rules-of-hooks; ref + LOD
  // measurement happen even when combatRole is null (zero-cost since
  // the wrapper isn't mounted, observer never attaches).
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lodMode = useTileLodMode(wrapperRef);
  if (combatRole == null) return null;
  const innerRingColor =
    combatRole === 'attacker'
      ? 'var(--color-attacker)'
      : 'var(--color-blocker)';
  return (
    <div
      ref={wrapperRef}
      data-testid="role-markers"
      data-role={combatRole}
      data-lod-mode={lodMode}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: -BRACKET_OUTSET,
        pointerEvents: 'none',
        // Slice 4-X.0 B-1 — same rotate-with-cardart fix as
        // RoleOuterHalo. Brackets + inner ring + sigil all rotate
        // together so the marker chrome stays aligned with the
        // rotated cardart on tap.
        transform: tapped ? 'rotate(90deg)' : undefined,
        transformOrigin: 'center',
        transition: TAP_ROTATE_TRANSITION,
        // Brackets sit OUTSIDE the cardart bounds (negative inset)
        // so they read as a frame around the tile, not a stamp on
        // top of it. T3 — no Scryfall art pixels are occluded.
      }}
    >
      {lodMode === 'sigil' ? (
        // Slice 4-D — at sub-LOD_FALLBACK_WIDTH_PX widths the
        // 4 brackets + inner ring would visually swamp the cardart.
        // Single A/B sigil in the top-right corner replaces them
        // while the existing in-CardFace ATK/BLK text badge in the
        // top-left keeps the screen-reader-readable signal alive.
        <RoleSigil role={combatRole} />
      ) : (
        <>
          {/* Slice 4-B inner ring — sits exactly on the cardart bounds
              (inset: BRACKET_OUTSET cancels the wrapper's negative
              inset). Box-shadow paints a 1.5 px stroke INSIDE the
              cardart's edge — frame-of-painting depth, no pixels of the
              underlying Scryfall art are occluded. */}
          <div
            data-testid="role-inner-ring"
            data-role={combatRole}
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: BRACKET_OUTSET,
              pointerEvents: 'none',
              boxShadow: `inset 0 0 0 ${INNER_RING_THICKNESS}px ${innerRingColor}`,
              borderRadius: CARDART_RADIUS,
            }}
          />
          {CORNER_PLACEMENTS.map(({ key, position, rotateDeg }) => (
            <span
              key={key}
              data-corner={key}
              style={{
                position: 'absolute',
                ...position,
                transform: `rotate(${rotateDeg}deg)`,
                transformOrigin: 'center',
                // SVG-sized container; transform pivots around its
                // center so the bracket vertex relocates to the
                // parent's matching outer corner regardless of
                // rotation.
                width: SVG_SIZE,
                height: SVG_SIZE,
              }}
            >
              <CornerBracket role={combatRole} />
            </span>
          ))}
        </>
      )}
    </div>
  );
}
