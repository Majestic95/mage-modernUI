import { useMemo, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { WebPlayerView } from '../api/schemas';
import { LifeCounter } from './LifeCounter';
import { ManaPool } from './ManaPool';
import { PriorityTag } from './PriorityTag';
import { ZoneIcon } from './ZoneIcon';
import { slow } from '../animation/debug';
import { ELIMINATION_SLASH } from '../animation/transitions';

/**
 * Slice 70-D (ADR 0011 D5) — PlayerFrame extracted from PlayerArea
 * per design-system §7.3. Owns the player's identity surface: name +
 * commander name + life total + active/priority indicators + zone
 * chips + mana pool + colorIdentity halo + eliminated-state overlay.
 *
 * <p>PlayerArea retains battlefield rows + drop-target affordance +
 * command zone — slice 70-E's layout shell will continue refactoring.
 *
 * <p>The colorIdentity halo state matrix (ADR 0011 D5):
 * <ul>
 *   <li>{@code []} (non-commander format) — neutral team-ring</li>
 *   <li>1 color — solid ring in that mana color</li>
 *   <li>2-5 colors — alternating multicolor band ring</li>
 *   <li>colorless commander (also empty list) — neutral team-ring</li>
 *   <li>eliminated — ring fades to grey + slash overlay
 *       ({@link ELIMINATION_SLASH}) animates across the pod</li>
 * </ul>
 *
 * <p><b>Disconnected state</b> is intentionally NOT rendered here
 * yet — {@code WebPlayerView.hasLeft} conflates concession +
 * timeout + disconnect (upstream {@code Player.hasLeft()} TODO at
 * Mage/Player.java:289-297). A separate wire signal (e.g.
 * {@code connectionState}) lands with slice 70-H or earlier; until
 * then, hasLeft renders only the eliminated treatment. Documented
 * as a critic-I5 deferral.
 *
 * <p><b>Active-player signaling</b> stays as the existing inline
 * ACTIVE pill from PlayerArea — slice 70-E routes it through the
 * halo-pulse alongside the layout-shell rollout, so this slice
 * leaves the pill in place.
 */
interface Props {
  player: WebPlayerView;
  /** Used by the modal targetable-name affordance and SR labels. */
  perspective: 'self' | 'opponent';
  /**
   * Click-handler for the player's name when {@code targetable}.
   * Dispatches the player's UUID as a target response (slice 15).
   */
  onPlayerClick: (id: string) => void;
  /**
   * True when a target dialog is pending and the player is a legal
   * target. Drives the underlined-clickable name affordance.
   */
  targetable: boolean;
}

export function PlayerFrame({
  player,
  perspective,
  onPlayerClick,
  targetable,
}: Props) {
  const eliminated = player.hasLeft;

  // Critic N11 — aria-label synthesis moves here from PlayerArea.
  // Critic UX-I3 — colorIdentity is included in the SR label so
  // blind users get the strategic-info signal that sighted users
  // get from the halo ring (Atraxa = WUBG threats; Edgar = WB).
  const ariaLabel = [
    player.name || 'Unknown player',
    `${player.life} life`,
    perspective === 'self' ? 'your seat' : null,
    player.isActive ? 'active turn' : null,
    player.hasPriority ? 'has priority' : null,
    eliminated ? 'eliminated' : null,
    formatColorIdentity(player.colorIdentity),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      data-testid={`player-frame-${perspective}`}
      data-eliminated={eliminated || undefined}
      role="group"
      aria-label={ariaLabel}
      // Critic Graphical-G2 fix — `filter: grayscale(...)` is a CSS
      // shorthand that Framer Motion does not interpolate reliably
      // across browsers. Driving it via a CSS class with
      // `transition: filter 800ms ease-in` (in tokens.css / inline
      // class below) gets a guaranteed-smooth animation in every
      // browser without the Framer string-crossfade caveat. The
      // grayscale toggle is paired with the opacity fade.
      className={
        'relative transition-[opacity,filter] duration-700 ease-in ' +
        (eliminated
          ? 'opacity-[0.45] [filter:grayscale(1)]'
          : 'opacity-100 [filter:grayscale(0)]')
      }
    >
      {/*
        Critic UI-N10 — life total stays readable at 0.45 opacity
        (~4.5:1 contrast against the dark teal-black bg, satisfies
        WCAG AA 4.5:1 normal-text minimum). Earlier draft used 0.35
        which dropped to ~3.1:1 and failed AA.
      */}
      <header className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-3">
          {targetable && !eliminated ? (
            <button
              type="button"
              data-testid={`target-player-${perspective}`}
              onClick={() => onPlayerClick(player.playerId)}
              className="font-medium text-fuchsia-300 hover:text-fuchsia-200 underline underline-offset-2"
              title="Click to target this player"
            >
              {player.name || '<unknown>'}
            </button>
          ) : (
            <span
              className="font-medium"
              // Critic UX-C2 — when a target dialog is pending and
              // this player is eliminated, the suppressed-button
              // path silently disables targeting. Surface the
              // reason via title so sighted users get a hint.
              title={
                eliminated && targetable
                  ? 'Eliminated — cannot be targeted'
                  : undefined
              }
            >
              {player.name || '<unknown>'}
            </span>
          )}
          {player.isActive && (
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: 'var(--color-team-active-glow)',
                color: 'var(--color-text-on-accent)',
              }}
            >
              ACTIVE
            </span>
          )}
          <AnimatePresence>
            {player.hasPriority && <PriorityTag key="priority" />}
          </AnimatePresence>
        </div>
        <div className="flex items-baseline gap-4 text-sm text-zinc-400">
          <LifeCounter
            value={player.life}
            testId={`life-counter-value-${perspective}`}
          />
          <ZoneIcon
            zone="library"
            count={player.libraryCount}
            playerName={player.name}
            variant={perspective}
          />
          <span>
            <span className="text-text-secondary">Hand</span>{' '}
            <span className="font-mono">{player.handCount}</span>
          </span>
          <ZoneIcon
            label="Grave"
            zone="graveyard"
            playerName={player.name}
            cards={player.graveyard}
            variant={perspective}
          />
          <ZoneIcon
            label="Exile"
            zone="exile"
            playerName={player.name}
            cards={player.exile}
            variant={perspective}
          />
          <ManaPool player={player} />
        </div>
      </header>

      {/*
        Critic UI-C2 / Graphical-G8 — JSX order is content → halo
        → slash so the slash always paints ON TOP of the halo. With
        the halo now a true ring (mask-based, see HaloRing below),
        the previous z-stacking ambiguity is resolved.
      */}
      <HaloRing colorIdentity={player.colorIdentity} eliminated={eliminated} />

      {/*
        Slice 70-D (ADR 0011 D2) — eliminated-slash overlay. SVG
        diagonal claw-rip with high-contrast outline (paired
        --color-eliminated-slash + --color-eliminated-slash-outline
        tokens) so the diagonal SHAPE signals elimination even
        under deuteranopia / protanopia / tritanopia.

        Critic Graphical-G1 — explicit transformOrigin so the
        scale-from-1.05 animation (no inward-then-outward swing)
        is anchored on the geometric center.

        Critic Graphical-G4 — data-essential-motion preserves the
        slash entry under prefers-reduced-motion. Slash IS the
        state, so it must remain visually present even when motion
        is silenced (slice 70-B reduced-motion contract).

        Critic UI-N8 — preserveAspectRatio="xMidYMid meet" keeps
        the slash diagonal at any frame aspect ratio (wide opponent
        strips would otherwise squish it horizontally with
        preserveAspectRatio="none").

        Critic Graphical-G7 — outline width 8 (vs 6) gives a 2.5px
        halo on each side of the 3px fill, more resilient over
        bright pod content.
      */}
      <AnimatePresence>
        {eliminated && (
          <motion.svg
            key="elimination-slash"
            data-testid={`elimination-slash-${perspective}`}
            data-essential-motion="true"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid meet"
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={slow(ELIMINATION_SLASH)}
            style={{ transformOrigin: '50% 50%' }}
          >
            <line
              x1="5" y1="95" x2="95" y2="5"
              stroke="var(--color-eliminated-slash-outline)"
              strokeWidth="8"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1="5" y1="95" x2="95" y2="5"
              stroke="var(--color-eliminated-slash)"
              strokeWidth="3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </motion.svg>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Slice 70-D — convert a colorIdentity array into an SR-friendly
 * suffix (UX-I3). Empty list returns null so the join can drop it;
 * otherwise produces "white, blue, black, green" in WUBRG order
 * (the wire format already arrives sorted).
 */
function formatColorIdentity(colorIdentity: readonly string[]): string | null {
  if (colorIdentity.length === 0) {
    return null;
  }
  return colorIdentity.map(colorWordFor).join(', ');
}

function colorWordFor(code: string): string {
  switch (code) {
    case 'W':
      return 'white';
    case 'U':
      return 'blue';
    case 'B':
      return 'black';
    case 'R':
      return 'red';
    case 'G':
      return 'green';
    default:
      return code;
  }
}

/**
 * Slice 70-D — colorIdentity-driven halo ring.
 *
 * Critic UI-C1 / Graphical-G6 fix — both single-color and
 * multi-color paths render through the SAME mechanism: a
 * background-tinted div that's masked to show only the 2px outer
 * ring. The mask uses CSS `mask-composite: exclude` to subtract the
 * inner content-box from the outer border-box, leaving only the
 * 2px-wide perimeter visible. This guarantees:
 *   - Multi-color halos read as RINGS, not full pod tints (the
 *     prior implementation painted a conic gradient over the entire
 *     pod, hiding name + life + zones).
 *   - Single + multi paths produce visually consistent shapes — no
 *     render-mechanism swap on color count change.
 *
 * <p>Eliminated state replaces the colorIdentity background with the
 * neutral team-ring token. Empty colorIdentity (non-commander
 * format) also uses the neutral team-ring — NOT grey, per ADR 0011
 * D5 (grey collides with the disconnected/eliminated treatment).
 *
 * <p>Slice 70-E's layout shell will likely give each frame a
 * dedicated portrait surface; until then the ring is anchored to
 * the frame's bounding box.
 */
function HaloRing({
  colorIdentity,
  eliminated,
}: {
  colorIdentity: readonly string[];
  eliminated: boolean;
}) {
  // Critic Graphical-G5 — memoize the gradient string so a re-render
  // with the same colorIdentity doesn't re-allocate + re-parse.
  const haloBackground = useMemo(
    () => computeHaloBackground(colorIdentity, eliminated),
    [colorIdentity, eliminated],
  );

  // CSS mask-composite trick: the mask is two stacked layers, both
  // solid black. The first layer fills the content-box only; the
  // second fills the border-box. `mask-composite: exclude` subtracts
  // the first from the second, leaving only the 2px perimeter
  // visible — i.e., a true 2px ring no matter how many colors are
  // in the gradient.
  const ringStyle: CSSProperties = {
    background: haloBackground,
    padding: '2px',
    WebkitMask:
      'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    maskComposite: 'exclude',
  };

  // Slice 70-G — spec §7.3 calls for multicolor halos to "rotate at
  // 12s/revolution" so the alternating bands read as a spinning
  // ring rather than a static pie chart. Apply rotation only when
  // the halo is actually multicolor (single-color rings are
  // visually identical at every angle; rotating them would just
  // burn paint cycles). Eliminated state is also static (the halo
  // desaturates to a neutral ring; rotation would distract from
  // the slash overlay).
  const rotates = colorIdentity.length > 1 && !eliminated;
  return (
    <div
      data-testid="player-halo"
      data-color-count={colorIdentity.length}
      data-eliminated={eliminated || undefined}
      data-rotating={rotates || undefined}
      aria-hidden="true"
      className={
        'pointer-events-none absolute inset-0 rounded ' +
        (rotates ? 'animate-halo-rotate' : '')
      }
      style={ringStyle}
    />
  );
}

function computeHaloBackground(
  colorIdentity: readonly string[],
  eliminated: boolean,
): string {
  if (eliminated || colorIdentity.length === 0) {
    return 'var(--color-team-neutral)';
  }
  if (colorIdentity.length === 1) {
    return manaTokenForCode(colorIdentity[0]!);
  }
  const stops = colorIdentity
    .map((code, i) => {
      const start = (i * 360) / colorIdentity.length;
      const end = ((i + 1) * 360) / colorIdentity.length;
      return `${manaTokenForCode(code)} ${start}deg ${end}deg`;
    })
    .join(', ');
  // Slice 70-G critic Graph-C1 — `from var(--halo-angle, 0deg)` so
  // the @keyframes halo-rotate animates the gradient ORIGIN rather
  // than the element's transform. The box stays static; only the
  // color seam rotates. The default `0deg` keeps non-rotating
  // halos visually identical to the prior static rendering.
  return `conic-gradient(from var(--halo-angle, 0deg), ${stops})`;
}

function manaTokenForCode(code: string): string {
  switch (code) {
    case 'W':
      return 'var(--color-mana-white)';
    case 'U':
      return 'var(--color-mana-blue)';
    case 'B':
      return 'var(--color-mana-black)';
    case 'R':
      return 'var(--color-mana-red)';
    case 'G':
      return 'var(--color-mana-green)';
    default:
      // Unknown color code — server should never emit this, but
      // default to neutral so a future engine upgrade with a 6th
      // color doesn't render as transparent.
      return 'var(--color-team-neutral)';
  }
}
