import { useMemo, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { WebPlayerView } from '../api/schemas';
import { REDESIGN } from '../featureFlags';
import { computeHaloBackground } from './halo';
import { LifeCounter } from './LifeCounter';
import { ManaPool } from './ManaPool';
import { hasAnyMana } from './manaPoolUtil';
import { PlayerPortrait } from './PlayerPortrait';
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
   * Slice 70-K — pod position in the 4-pod grid. Drives the
   * REDESIGN branch's portrait sizing (large for self, medium for
   * opponents) and label-stack orientation (vertical for top/bottom,
   * may differ for left/right in 70-Z polish). Defaults to
   * 'bottom' so legacy tests don't need updating; in legacy mode
   * the prop is ignored entirely (the strip layout is
   * position-independent).
   */
  position?: 'top' | 'left' | 'right' | 'bottom';
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
  position = 'bottom',
  onPlayerClick,
  targetable,
}: Props) {
  // Slice 70-K — REDESIGN branch dispatches before any legacy
  // computation. The two paths are mutually exclusive at render
  // time but share the player view-object; everything heavy-weight
  // (HaloRing, slash overlay, disconnected pill) only runs in the
  // legacy branch below.
  if (REDESIGN) {
    return (
      <PlayerFrameRedesigned
        player={player}
        perspective={perspective}
        position={position}
        onPlayerClick={onPlayerClick}
        targetable={targetable}
      />
    );
  }

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
// HaloRing component above when PlayerPortrait owns the halo —
// today the legacy branch still consumes HaloRing.

/* ============================================================
 * Slice 70-K (redesign branch) — picture-catalog §2 anatomy
 *
 * Vertical stack:
 *   - PlayerPortrait (size depends on perspective)
 *   - Life numeral overlaid INSIDE the portrait at lower-portion
 *   - Player name (semibold, body size)
 *   - Commander name (caption, secondary color)
 *
 * State composition:
 *   - PriorityTag floats above the portrait (when player has priority)
 *   - Disconnected pill in top-right of frame (when disconnected)
 *   - Eliminated state desaturates the entire frame + slash
 *     overlay (slash position is portrait-area-only here, polished
 *     to whole-pod coverage in 70-Z)
 *
 * What's NOT in the redesigned PlayerFrame:
 *   - ACTIVE pill (replaced by halo pulse on the portrait)
 *   - Inline mana pool (relocated to top-right of hand region in 70-P)
 *   - Inline ZoneIcons (relocated to a small cluster adjacent in 70-P)
 *   - Inline LifeCounter (life is now overlaid on the portrait)
 *   - The bordered/padded panel chrome (PlayerArea drops it too)
 * ============================================================ */
function PlayerFrameRedesigned({
  player,
  perspective,
  position,
  onPlayerClick,
  targetable,
}: {
  player: WebPlayerView;
  perspective: 'self' | 'opponent';
  position: 'top' | 'left' | 'right' | 'bottom';
  onPlayerClick: (id: string) => void;
  targetable: boolean;
}) {
  const eliminated = player.hasLeft;
  const disconnected =
    !eliminated && player.connectionState === 'disconnected';

  // Picture-catalog §2.D — local pod uses 'large' (96px), opponent
  // pods use 'medium' (80px). Position prop is reserved for further
  // per-position tuning in slice 70-Z polish (e.g., portrait scale
  // for left/right pods that share horizontal real estate with
  // their battlefield rows).
  void position;
  const portraitSize = perspective === 'self' ? 'large' : 'medium';

  // Aria-label preserved verbatim from the legacy branch — same
  // composition rules per slice 70-D + 70-H critic UX-I3 / I1.
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

  // Find the first commander entry for the displayed commander name
  // beneath the player name. Partner pairings show only the first
  // commander's name; slice 70-Z may revisit if the partner is
  // load-bearing visually (e.g., "Tymna / Thrasios" combined).
  const commander = useMemo(
    () =>
      player.commandList.find((co) => co.kind === 'commander') ?? null,
    [player.commandList],
  );

  // Targetable name → button (clickable to dispatch as target).
  // Same rules as legacy: only when targetable AND not eliminated.
  // Inlined into the JSX below to satisfy
  // react-hooks/static-components — declaring a sub-component
  // inside the render function is treated as "created during
  // render" and would defeat React's component identity tracking.
  const nameIsTargetable = targetable && !eliminated;

  return (
    <div
      data-testid={`player-frame-${perspective}`}
      data-redesign="true"
      data-perspective={perspective}
      data-eliminated={eliminated || undefined}
      data-disconnected={disconnected || undefined}
      role="group"
      aria-label={ariaLabel}
      className={
        'relative flex flex-col items-center gap-1 transition-[opacity,filter] duration-700 ease-in ' +
        (eliminated
          ? 'opacity-[0.45] [filter:grayscale(1)]'
          : disconnected
            ? 'opacity-[0.7] [filter:grayscale(0.6)]'
            : 'opacity-100 [filter:grayscale(0)]')
      }
    >
      {/* Portrait + life overlay. The portrait wrapper is the
          positioning context for both the life numeral (overlay
          inside the circle, lower-portion per picture-catalog
          §2.0) and the PriorityTag (floats above-right per spec
          §Player states / picture-catalog §2.4). */}
      <div className="relative" data-testid="player-portrait-wrapper">
        <PlayerPortrait
          player={player}
          size={portraitSize}
          haloVariant="circular"
        />
        {/* Slice 70-Z polish round 22 (user direction 2026-04-30) —
            Hearthstone-style floating life badge: a circular black
            disc sits at the bottom-center of the portrait, half-
            overlapping the portrait's lower edge. Replaces the
            slice-70-D in-portrait white numeral (which was getting
            lost against varied commander art). The badge is a
            self-contained read regardless of art tonality.
            - bg-zinc-900: solid dark disc.
            - ring-2 ring-zinc-700: subtle outline so the disc
              reads as separate from the portrait halo.
            - shadow-lg: floating affordance.
            - left-1/2 -translate-x-1/2: horizontal center.
            - -bottom-{N}: center of the badge sits at the
              portrait's bottom edge (badge half-height = bottom
              offset). h-10 = 40px → -bottom-5 (=-20px); h-8 = 32px
              → -bottom-4 (=-16px). */}
        <div
          data-testid={`life-numeral-${perspective}`}
          aria-hidden="true"
          className={
            'absolute left-1/2 -translate-x-1/2 z-10 flex items-center justify-center rounded-full bg-zinc-900 ring-2 ring-zinc-700 shadow-lg font-bold text-white tabular-nums leading-none ' +
            (perspective === 'self'
              ? 'h-10 w-10 -bottom-5 text-base'
              : 'h-8 w-8 -bottom-4 text-sm')
          }
        >
          {player.life}
        </div>
        {/* Priority tag floats above the portrait so it doesn't
            obscure the commander art or compete with the life
            numeral. Same component as legacy; only the position
            anchor changes. */}
        <AnimatePresence>
          {player.hasPriority && (
            <span
              key="priority"
              className="absolute -top-2 left-1/2 -translate-x-1/2"
            >
              <PriorityTag />
            </span>
          )}
        </AnimatePresence>
        {/* Disconnected pill — top-right corner of the frame, NOT
            of the portrait, so it stays visible alongside the
            commander art. Picture-catalog §2.4 (recoverable state). */}
        <AnimatePresence>
          {disconnected && (
            <motion.div
              key="disconnected-pill"
              data-testid={`disconnected-pill-${perspective}`}
              data-essential-motion="true"
              aria-hidden="true"
              className="pointer-events-none absolute -right-1 -top-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeIn' }}
            >
              <span
                className="rounded px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wider whitespace-nowrap"
                style={{
                  backgroundColor: 'var(--color-bg-overlay)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-text-muted)',
                }}
              >
                Disconnected
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Name + commander stack. Picture-catalog §2.0:
          Player name in --font-weight-semibold, --font-size-heading-sm
          (14px). Commander name in --font-size-caption (12px),
          --color-text-secondary. Center-aligned for top/bottom pods.

          Slice 70-Z polish round 22 (user direction 2026-04-30) —
          extra top margin so the floating life badge (which
          dangles 20px below the portrait for self, 16px for
          opponent) clears the player-name baseline. Without this
          mt-, the parent's gap-1 (4px) leaves the name overlapping
          the badge. mt-6 (self) / mt-5 (opponent) lands the name
          ~4-6px below the badge's bottom edge. The cluster below
          (absolute `top-full mt-1` of the outer frame) auto-
          tracks because it's anchored to the frame bottom, not to
          this stack. */}
      <div
        className={
          'flex flex-col items-center gap-0.5 max-w-full px-1 ' +
          (perspective === 'self' ? 'mt-6' : 'mt-5')
        }
        data-testid="player-name-stack"
      >
        {nameIsTargetable ? (
          <button
            type="button"
            data-testid={`target-player-${perspective}`}
            onClick={() => onPlayerClick(player.playerId)}
            className="font-medium text-fuchsia-300 hover:text-fuchsia-200 underline underline-offset-2 truncate max-w-full"
            title="Click to target this player"
          >
            {player.name || '<unknown>'}
          </button>
        ) : (
          <span
            className="font-medium text-zinc-100 truncate max-w-full"
            title={
              eliminated && targetable
                ? 'Eliminated — cannot be targeted'
                : undefined
            }
          >
            {player.name || '<unknown>'}
          </span>
        )}
        {commander && (
          <span
            data-testid="commander-name-label"
            // Slice 70-Z polish round 21 (user direction 2026-04-30) —
            // commander label bumped text-xs (12px) → text-sm (14px)
            // for legibility on the corner-mount local frame.
            className="text-sm text-zinc-400 truncate max-w-full"
            title={commander.name}
          >
            {commander.name}
          </span>
        )}
      </div>

      {/* Slice 70-P (picture-catalog §2.2 + §2.3) — zone icons +
          opponent mana pool cluster, adjacent to the player frame.
          Catalog: "Adjacent to the portrait — a small horizontal
          cluster near the player frame, NOT attached to the
          portrait stack."

          For the LOCAL player the floating mana pool lives in the
          hand region top-right (catalog §2.3 + slice 70-P MyHand
          mount), so PlayerFrame here only carries the zone icons.
          For OPPONENTS the mana pool sits in this cluster too
          (catalog §2.3: "Position for opponents: Small cluster
          adjacent to their player frame"). Empty pool renders
          nothing. */}
      <PlayerFrameInfoCluster
        player={player}
        perspective={perspective}
      />

      {/* Eliminated slash overlay — picture-catalog §2.4. Today
          covers the PlayerFrame area only (portrait + name stack);
          slice 70-Z polish moves this to the whole-pod coverage
          per spec §Player states. Same SVG geometry as legacy. */}
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
 * Slice 70-P (picture-catalog §2.2 + §2.3) — secondary info cluster
 * mounted beneath the name stack on every redesigned PlayerFrame.
 *
 * <p>Composition:
 * <ul>
 *   <li><b>Zone icons</b> (graveyard / exile / library) — small
 *       horizontal row of count chips with the variant prop
 *       routing self vs opponent rendering inside {@link ZoneIcon}
 *       (clickable modal vs hover tooltip).</li>
 *   <li><b>Mana pool</b> — for opponents only, when non-empty.
 *       Local player's pool floats in the hand region top-right
 *       per §2.3.</li>
 * </ul>
 *
 * <p>Per catalog §2.2: "Not prominently visible — they're tucked
 * near the player frame, low-priority chrome. Don't overdesign
 * these." Caption-sized text, no chrome around the cluster, just
 * adjacent to the portrait + name stack.
 */
function PlayerFrameInfoCluster({
  player,
  perspective,
}: {
  player: WebPlayerView;
  perspective: 'self' | 'opponent';
}) {
  // Slice 70-P critic Tech-IMP-1 cleanup — schema-tied empty check
  // beats the 6-field repeat. ManaPool already filters non-zero
  // cells internally; this gate also avoids mounting the wrapper
  // <span> when the pool is empty (catalog §2.3 "Empty pool: Don't
  // render anything").
  const opponentPoolNonEmpty =
    perspective === 'opponent' && hasAnyMana(player.manaPool);

  return (
    // Slice 70-P critic UI/UX-C2 fix — absolute-positioned just
    // below the parent frame's bbox, NOT a third row of the
    // flex-col. Catalog §2.2: "Adjacent to the portrait — a small
    // horizontal cluster near the player frame, NOT attached to
    // the portrait stack." `top-full` anchors below the parent
    // (which is `relative` per the redesigned PlayerFrame outer
    // div); the cluster floats adjacent rather than peer-stacked
    // with the portrait + name. whitespace-nowrap prevents the
    // chips from wrapping into a second row at narrow viewports.
    <div
      data-testid={`player-frame-info-${perspective}`}
      // Slice 70-Z polish round 21 (user direction 2026-04-30) —
      // cluster font bumped text-[11px] → text-[13px] for legibility
      // alongside the bigger commander name. Hierarchy preserved:
      // player name (text-base ≈ 16px, font-medium) > commander
      // (text-sm 14px) > cluster (text-[13px]).
      className="absolute top-full left-1/2 -translate-x-1/2 mt-1
        flex items-center gap-2 text-[13px] text-text-secondary
        whitespace-nowrap"
    >
      <ZoneIcon
        zone="library"
        count={player.libraryCount}
        playerName={player.name}
        variant={perspective}
      />
      {/* Slice 70-P.1 (user directive 2026-04-30) — Hand N chip.
          Strategic info that the legacy strip surfaced inline; the
          redesigned anatomy didn't have a home for it until now.
          Cluster is the natural fit per catalog §2.2 "small
          horizontal cluster near the player frame." Display-only
          (the local hand is rendered visually as the fan; opponent
          hands are private cards but public count). */}
      <ZoneIcon
        zone="hand"
        count={player.handCount}
        playerName={player.name}
        variant={perspective}
      />
      <ZoneIcon
        zone="graveyard"
        cards={player.graveyard}
        playerName={player.name}
        variant={perspective}
      />
      <ZoneIcon
        zone="exile"
        cards={player.exile}
        playerName={player.name}
        variant={perspective}
      />
      {opponentPoolNonEmpty && (
        // Slice 70-P critic UI/UX-I3 fix — opponent cluster uses
        // size="small" per catalog §2.3 "Visible but smaller." No
        // glow on opponent pools — keeps the cluster low-priority
        // chrome and saves a layer per orb at 4-pod density.
        <span data-testid={`opponent-mana-pool-${player.playerId}`}>
          <ManaPool player={player} size="small" />
        </span>
      )}
    </div>
  );
}
