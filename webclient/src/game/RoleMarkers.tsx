/**
 * Bundle 4 / Slice 4-A — combat role markers.
 *
 * <p>Pinned-corner SVG brackets that sit on every battlefield creature
 * with a non-undefined {@code combatRole}. Warm amber-orange for
 * attackers ({@code var(--color-attacker)}), cool steel-blue for
 * blockers ({@code var(--color-blocker)}). Mounted as a sibling of
 * {@code <CardFace>} inside {@code <TabletopCardButton>}; sits on a
 * negative inset so brackets read as a frame around the cardart
 * rather than a stamp on top of it (T3 — full Scryfall art preserved).
 *
 * <p><b>Why a separate sibling component:</b> {@code CardFace.tsx} is
 * already over the 500 LOC hard cap as a documented exception. Bundle
 * 4's policy is to NOT make it worse — markers live here, not as new
 * branches inside CardFace.
 *
 * <p><b>Color-blind redundant signal (WCAG 2.1 SC 1.4.1):</b> attacker
 * brackets are a sharp 90° L; blocker brackets add a short 45°
 * inward stub at the L's vertex. The shape itself differentiates
 * attacker from blocker even when both are rendered in the same hue
 * (deuteranopia simulation).
 *
 * <p><b>T1 footprint preservation:</b> wrapper is {@code position:
 * absolute; pointer-events: none}. The parent button's bounding box
 * is unchanged whether {@code combatRole} is defined or not.
 *
 * <p><b>Future slices:</b> 4-B will extend this file with an inner
 * role-ring + outer commander-color halo; 4-D will wrap the rendered
 * output in an LOD threshold check that swaps to an A/B sigil at
 * sub-{@code LOD_FALLBACK_WIDTH_PX} tile widths.
 */

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
 * Battlefield creature combat-role overlay. Renders 4 corner
 * brackets when the creature is an attacker or blocker; renders
 * nothing otherwise.
 */
export function RoleMarkers({ combatRole }: RoleMarkersProps) {
  if (combatRole == null) return null;
  return (
    <div
      data-testid="role-markers"
      data-role={combatRole}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: -BRACKET_OUTSET,
        pointerEvents: 'none',
        // Brackets sit OUTSIDE the cardart bounds (negative inset)
        // so they read as a frame around the tile, not a stamp on
        // top of it. T3 — no Scryfall art pixels are occluded.
      }}
    >
      {CORNER_PLACEMENTS.map(({ key, position, rotateDeg }) => (
        <span
          key={key}
          data-corner={key}
          style={{
            position: 'absolute',
            ...position,
            transform: `rotate(${rotateDeg}deg)`,
            transformOrigin: 'center',
            // SVG-sized container; transform pivots around its center
            // so the bracket vertex relocates to the parent's matching
            // outer corner regardless of rotation.
            width: SVG_SIZE,
            height: SVG_SIZE,
          }}
        >
          <CornerBracket role={combatRole} />
        </span>
      ))}
    </div>
  );
}
