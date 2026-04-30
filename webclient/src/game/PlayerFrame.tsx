import { useMemo, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { WebPlayerView } from '../api/schemas';
import { computeHaloBackground } from './halo';
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
 * <p><b>Disconnected state</b> ships in slice 70-H (ADR 0011 D3 /
 * ADR 0010 v2 D11(e)). The schema-1.23 wire field
 * {@code connectionState} is consulted alongside {@code hasLeft};
 * the treatments compose as follows:
 * <ul>
 *   <li>{@code hasLeft=true} (terminal — concession / timeout /
 *       eliminated) renders the slash overlay + 0.45 opacity +
 *       full grayscale. Takes precedence over connectionState.</li>
 *   <li>{@code connectionState="disconnected"} && {@code !hasLeft}
 *       (recoverable — sockets dropped but the player can rejoin)
 *       renders 0.7 opacity + partial grayscale + a centered
 *       "DISCONNECTED" pill. Lighter than eliminated so the
 *       recoverable-vs-terminal distinction reads at a glance.</li>
 *   <li>Both states leave the colorIdentity halo visible (the
 *       commander identity remains the player's signature).</li>
 * </ul>
 * The per-prompt timeout response (TIMEOUT auto-pass to engine) is
 * deferred to slice 70-H.5; this slice ships only the detection +
 * UI surface.
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
  // Slice 70-H — recoverable disconnected state. Suppress when
  // eliminated since hasLeft is the terminal state and takes
  // precedence visually (slash overlay + heavier desaturation
  // already communicates "this player is gone"; layering a
  // recoverable-state pill on top would muddy the read).
  const disconnected =
    !eliminated && player.connectionState === 'disconnected';

  // Critic N11 — aria-label synthesis moves here from PlayerArea.
  // Critic UX-I3 — colorIdentity is included in the SR label so
  // blind users get the strategic-info signal that sighted users
  // get from the halo ring (Atraxa = WUBG threats; Edgar = WB).
  // Slice 70-H — disconnected state appended after eliminated so
  // SR users get the recoverable/terminal distinction by ordering.
  const ariaLabel = [
    player.name || 'Unknown player',
    `${player.life} life`,
    perspective === 'self' ? 'your seat' : null,
    player.isActive ? 'active turn' : null,
    player.hasPriority ? 'has priority' : null,
    eliminated ? 'eliminated' : null,
    disconnected ? 'disconnected' : null,
    formatColorIdentity(player.colorIdentity),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      data-testid={`player-frame-${perspective}`}
      data-eliminated={eliminated || undefined}
      data-disconnected={disconnected || undefined}
      role="group"
      aria-label={ariaLabel}
      // Critic Graphical-G2 fix — `filter: grayscale(...)` is a CSS
      // shorthand that Framer Motion does not interpolate reliably
      // across browsers. Driving it via a CSS class with
      // `transition: filter 800ms ease-in` (in tokens.css / inline
      // class below) gets a guaranteed-smooth animation in every
      // browser without the Framer string-crossfade caveat. The
      // grayscale toggle is paired with the opacity fade.
      //
      // Slice 70-H — disconnected state lands at 0.7 opacity +
      // grayscale(0.6); deliberately LIGHTER than eliminated
      // (0.45 / 1.0) so the recoverable vs terminal distinction
      // is visually obvious. The transition class is shared so
      // socket recovery / loss animates smoothly via the same
      // 700ms ease-in path.
      className={
        'relative transition-[opacity,filter] duration-700 ease-in ' +
        (eliminated
          ? 'opacity-[0.45] [filter:grayscale(1)]'
          : disconnected
            ? 'opacity-[0.7] [filter:grayscale(0.6)]'
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
      {/*
        Slice 70-H (ADR 0011 D3) — DISCONNECTED pill overlay.
        Sibling to the slash, not a wrapper, so it doesn't disturb
        existing focus / event paths. Rendered ABOVE the halo (JSX
        order matches paint order in absolute-positioned siblings)
        and BELOW the slash (which is gated on `eliminated` and
        mutually exclusive with disconnected via the derived var).

        Slice 70-H critic UX-I1 fix — pill is positioned in the
        top-right corner, NOT centered, so the LifeCounter / zone
        chips / mana pool / hand count remain visible on
        disconnected opponents. Strategic info ("can I race a
        disconnected opponent at 3 life?") needs to stay readable;
        a centered overlay would obscure exactly the data players
        plan around. Trade-off: less dramatic than a centered
        treatment, but matches the recoverable-state mental model
        (a corner badge says "status indicator," a full-frame
        treatment says "permanently gone").

        Slice 70-H critic UX-C1 fix — copy is "Disconnected —
        waiting for reconnect" not bare "Disconnected", because
        slice 70-H.5 (the per-prompt auto-pass timer) is deferred.
        Without auto-pass, a disconnected prompt-holder will stall
        the engine. The expanded copy sets the right expectation:
        "the system is waiting, intentionally, for them to come
        back." Bare "Disconnected" implied the system would
        auto-handle it, which today it does not.

        Pointer-events:none keeps the pill from intercepting clicks
        on the underlying frame controls; users with a pending
        target dialog can still try to target a disconnected player
        (the engine routes the target to the disconnected handler's
        buffer and the response surfaces on reconnect — slice
        70-H.5 will add the auto-pass-on-timeout fallback for the
        no-reconnect case).
      */}
      <AnimatePresence>
        {disconnected && (
          <motion.div
            key="disconnected-pill"
            data-testid={`disconnected-pill-${perspective}`}
            data-essential-motion="true"
            aria-hidden="true"
            className="pointer-events-none absolute right-1 top-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeIn' }}
          >
            <span
              className="rounded px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider whitespace-nowrap"
              style={{
                // Slice 70-H critic UI-C1 fix — retarget to extant
                // design-system tokens. tokens.css defines
                // --color-bg-overlay (semi-transparent black, the
                // same value used behind modals — appropriate for a
                // pill that needs to read over arbitrary frame
                // content), --color-text-primary (the body-text
                // contrast token), and --color-text-muted (the
                // decorative-text tier — appropriate for a 1px
                // border that should not compete with the label).
                // Earlier draft invented --color-surface-overlay /
                // --color-text-on-overlay / --color-text-tertiary
                // which don't exist and silently masked the
                // theming via fallback colors.
                backgroundColor: 'var(--color-bg-overlay)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-text-muted)',
              }}
            >
              Disconnected — waiting for reconnect
            </span>
          </motion.div>
        )}
      </AnimatePresence>

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

// Slice 70-J — computeHaloBackground + manaTokenForCode extracted
// to ./halo.ts for reuse by PlayerPortrait's circular halo. Imports
// happen at the top of the file. Slice 70-K will delete the
// HaloRing component above when PlayerPortrait owns the halo.
