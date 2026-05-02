import { AnimatePresence, motion } from 'framer-motion';
import type { WebPlayerView } from '../api/schemas';
import { HoverCardDetail } from './HoverCardDetail';
import { ManaPool } from './ManaPool';
import { hasAnyMana } from './manaPoolUtil';
import { PlayerPortrait } from './PlayerPortrait';
import { usePlayerCommanders } from './usePlayerCommanders';
import { PriorityTag } from './PriorityTag';
import { ZoneIcon } from './ZoneIcon';
import { slow } from '../animation/debug';
import { ELIMINATION_SLASH } from '../animation/transitions';
import { formatColorIdentity } from './PlayerFrame.helpers';

/**
 * Slice 70-Z (P2 audit) — extracted from PlayerFrame.tsx so the
 * 953-LOC merged file can shrink to a focused dispatcher + legacy
 * branch. Function bodies are byte-preserved from the pre-split file
 * at lines 506-924; only imports were trimmed to what this module
 * actually uses.
 */

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
export function PlayerFrameRedesigned({
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

  // Slice 70-X.14 (Bug 4) — read from the store's commander snapshot
  // so the displayed commander name survives cast → leaves-command-zone.
  // Partner pairings show only the first commander's name; slice 70-Z
  // may revisit if the partner is load-bearing visually (e.g.,
  // "Tymna / Thrasios" combined).
  const commanders = usePlayerCommanders(player);
  const commander = commanders[0] ?? null;

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
      data-position={position}
      data-eliminated={eliminated || undefined}
      data-disconnected={disconnected || undefined}
      role="group"
      aria-label={ariaLabel}
      className={
        // Slice 70-Y / Issue 1 (2026-05-01) — `self-start` on side
        // pods (left/right) keeps the frame's bbox at portrait+name
        // height instead of stretching to match the tall cards
        // column sibling. Without this the absolute-positioned
        // chip strip (top-full of the frame) ends up below all the
        // cards, getting pushed off-screen as more lands hit play.
        // Top/bottom pods are unaffected — flex-col parents already
        // give the frame fixed height naturally.
        'relative flex flex-col items-center gap-1 transition-[opacity,filter] duration-700 ease-in ' +
        (position === 'left' || position === 'right' ? 'self-start ' : '') +
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
          <HoverCardDetail
            card={{
              id: commander.id,
              cardId: commander.id,
              name: commander.name,
              displayName: commander.name,
              expansionSetCode: commander.expansionSetCode,
              cardNumber:
                commander.cardNumber ||
                (commander.imageNumber ? String(commander.imageNumber) : ''),
              manaCost: '',
              manaValue: 0,
              typeLine: '',
              supertypes: [],
              types: ['CREATURE'],
              subtypes: [],
              colors: [],
              rarity: '',
              power: '',
              toughness: '',
              startingLoyalty: '',
              rules: [...commander.rules],
              faceDown: false,
              counters: {},
              transformable: false,
              transformed: false,
              secondCardFace: null,
              sourceLabel: '',
              source: null,
            }}
          >
            <span
              data-testid="commander-name-label"
              // Slice 70-Z polish round 21 — text-sm (14px) for
              // legibility. Round 24 (user direction 2026-04-30):
              // wrapped in HoverCardDetail so any player can hover
              // an opponent's commander label and see the card art
              // + rules text. Cursor-help signals it's interactive.
              className="text-sm text-zinc-400 truncate max-w-full
                cursor-help underline-offset-2
                hover:text-zinc-200 hover:underline decoration-dotted"
              title={`Hover to inspect ${commander.name}`}
            >
              {commander.name}
            </span>
          </HoverCardDetail>
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
