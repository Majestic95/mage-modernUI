/**
 * Slice 70-J (redesign push, picture-catalog §2.0) — circular
 * commander portrait with color-identity halo ring. The visual
 * atom that anchors the redesigned PlayerFrame (slice 70-K),
 * GameLog avatars (slice 70-L), and CommanderDamage cells
 * (slice 70-L).
 *
 * <p><b>Anatomy:</b>
 * <ul>
 *   <li>Circular wrapper at one of three sizes — 32 / 80 / 96 px.</li>
 *   <li>Inner image: Scryfall art-crop URL of the player's commander.
 *       Fallback when no commander or art unresolvable: stylized
 *       initial-letter circle in the player's first color identity.</li>
 *   <li>Halo ring around the circle (when {@code haloVariant} is
 *       {@code 'circular'}): solid color when single-color, conic
 *       multicolor band rotation when 2+ colors. Pulse animation
 *       on active player. Greys out when eliminated.</li>
 * </ul>
 *
 * <p><b>State variants composed (state matrix per picture-catalog
 * §2.4):</b>
 * <ul>
 *   <li>Default: full-color portrait + colored halo.</li>
 *   <li>{@code isActive=true}: halo brightens + pulses at 1.9s
 *       period via {@code animate-player-active-halo}. Multicolor
 *       additionally rotates at 12s/rev via
 *       {@code animate-halo-rotate}.</li>
 *   <li>{@code connectionState='disconnected'} (and not hasLeft):
 *       portrait desaturates to 0.6 grayscale at 0.7 opacity.
 *       The "Disconnected — waiting for reconnect" pill is owned
 *       by PlayerFrame at the pod level (slice 70-H), NOT here.</li>
 *   <li>{@code hasLeft=true} (eliminated, terminal): portrait
 *       desaturates to 1.0 grayscale at 0.5 opacity, halo greys.
 *       The slash overlay across the entire pod is owned by
 *       PlayerArea at the pod level (slice 70-D), NOT here.</li>
 * </ul>
 *
 * <p><b>Not consumed by anything yet.</b> This slice ships the
 * component as a reusable atom. PlayerFrame (slice 70-K), GameLog
 * (slice 70-L), and CommanderDamageTracker (slice 70-L) consume
 * it next. The pre-redesign layout continues to use the
 * rectangular-strip PlayerFrame; the feature flag is what gates
 * adoption, not the existence of this file.
 *
 * <p>Reference: docs/design/picture-catalog.md §2.0, §5.A, §5.B.
 */
import { type CSSProperties, useMemo } from 'react';
import type { WebPlayerView } from '../api/schemas';
import { computeHaloBackground, manaTokenForCode } from './halo';
import { scryfallCommanderImageUrl } from './scryfall';
import { usePlayerCommanders } from './usePlayerCommanders';

export type PlayerPortraitSize = 'small' | 'medium' | 'large';

interface Props {
  /** Player view from gameView.players. */
  player: WebPlayerView;
  /**
   * Size variant. Defaults to 'medium' (the opponent-pod size).
   *
   * <ul>
   *   <li>{@code 'small'} — 32px. Game log avatar, commander damage
   *       cell.</li>
   *   <li>{@code 'medium'} — 80px. Opponent pod portrait
   *       (picture-catalog §2.A/B/C).</li>
   *   <li>{@code 'large'} — 96px. Local-player pod portrait
   *       (picture-catalog §2.D — slightly larger than opponents to
   *       emphasize the local pod).</li>
   * </ul>
   */
  size?: PlayerPortraitSize;
  /**
   * Whether to render the halo ring. {@code 'circular'} (default)
   * shows the color-identity ring with all state animations.
   * {@code 'none'} suppresses the halo entirely — used in compact
   * contexts like the game log where 32px portraits without halo
   * are visually less busy.
   */
  haloVariant?: 'circular' | 'none';
  /**
   * Optional override for the aria-label. Default is derived from
   * the player + commander name.
   */
  ariaLabel?: string;
}

/**
 * Pixel sizes per variant. Picture-catalog §2.0:
 *   - small: game log + commander damage cells (~32px)
 *   - medium: opponent portraits (80px per spec §7.3)
 *   - large: local-player portrait (~96px to emphasize local pod)
 */
const SIZE_PX: Record<PlayerPortraitSize, number> = {
  small: 32,
  medium: 80,
  large: 96,
};

/**
 * Halo ring thickness scales with portrait size — a 32px portrait
 * needs a thinner ring than a 96px portrait for visual balance.
 */
const HALO_PADDING_PX: Record<PlayerPortraitSize, number> = {
  small: 1.5,
  medium: 2,
  large: 2.5,
};

export function PlayerPortrait({
  player,
  size = 'medium',
  haloVariant = 'circular',
  ariaLabel,
}: Props) {
  const sizePx = SIZE_PX[size];
  // Slice 70-X.14 (Bug 4) — read from the store's commander snapshot
  // so the portrait survives the cast → leaves-command-zone flow.
  // First commander wins for portrait rendering; Partner/Background
  // pairings show only the first commander's art (matching slice 70-Z's
  // single-portrait-per-seat picture-catalog spec).
  const commanders = usePlayerCommanders(player);
  const commander = commanders[0] ?? null;
  const imageUrl = commander
    ? scryfallCommanderImageUrl(commander, 'art_crop')
    : null;

  const eliminated = player.hasLeft;
  const disconnected =
    !eliminated && player.connectionState === 'disconnected';

  // Derived label. SR users get the player name + commander
  // identity (which is the strategic hint sighted users get from
  // the portrait art). Halo color identity is conveyed via the
  // surrounding PlayerFrame's aria-label per slice 70-D critic
  // UX-I3 — the portrait itself doesn't repeat that signal.
  const label =
    ariaLabel ??
    (commander
      ? `${player.name || 'Unknown player'} portrait, commander ${commander.name}`
      : `${player.name || 'Unknown player'} portrait`);

  // Portrait filter for state variants. Eliminated is heavier
  // than disconnected per picture-catalog §2.4.
  const portraitFilter = stateFilter(eliminated, disconnected);

  return (
    <div
      data-testid="player-portrait"
      data-size={size}
      // Slice 70-N — exposes the player's UUID on the portrait
      // wrapper specifically, so the combat-arrow geometry hook in
      // StackZone can target the PORTRAIT (per picture-catalog §3.2:
      // "Arrow target: the defending player's portrait OR the
      // blocking creature's BattlefieldTile") rather than the
      // outer pod center. Preserves the data-player-id on PlayerArea
      // as a fallback for legacy or pod-level selectors.
      data-portrait-target-player-id={player.playerId}
      data-eliminated={eliminated || undefined}
      data-disconnected={disconnected || undefined}
      role="img"
      aria-label={label}
      style={{
        position: 'relative',
        // Slice 70-Z polish — `isolation: isolate` establishes a
        // stacking context here so the halo bloom's `z-index: -1`
        // can't escape the wrapper into a parent context. Without
        // it, position:relative alone doesn't create a stacking
        // context (z-index: auto), and we'd be relying on the
        // PlayerFrame's `[filter:grayscale(0)]` to confine the
        // bloom — fragile to Tailwind class churn (code critic C1).
        isolation: 'isolate',
        width: sizePx,
        height: sizePx,
        borderRadius: '50%',
        flexShrink: 0,
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          data-testid="player-portrait-image"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            objectFit: 'cover',
            display: 'block',
            filter: portraitFilter,
            transition: 'filter 700ms ease-in-out',
          }}
        />
      ) : (
        <FallbackInitial
          name={player.name}
          colorIdentity={player.colorIdentity}
          sizePx={sizePx}
          eliminated={eliminated}
          disconnected={disconnected}
        />
      )}
      {haloVariant === 'circular' && (
        <CircularHalo
          colorIdentity={player.colorIdentity}
          isActive={player.isActive}
          eliminated={eliminated}
          paddingPx={HALO_PADDING_PX[size]}
        />
      )}
    </div>
  );
}

/**
 * Slice 70-J — fallback portrait when no commander art is available
 * (non-Commander format, partner pairing without art, or Scryfall
 * URL unresolvable). Renders the player's initial letter on a flat
 * color background derived from their first color identity (or a
 * neutral surface color for empty colorIdentity).
 *
 * <p>This is intentionally simple — the picture target is commander
 * portraits, and any frame without one is a degraded-experience
 * case. A stylized initial circle is "polished placeholder" rather
 * than "carefully designed avatar." Slice 70-Z polish may revisit
 * if the fallback paints awkwardly next to art-crop portraits in
 * mixed-format games.
 */
function FallbackInitial({
  name,
  colorIdentity,
  sizePx,
  eliminated,
  disconnected,
}: {
  name: string;
  colorIdentity: readonly string[];
  sizePx: number;
  eliminated: boolean;
  disconnected: boolean;
}) {
  const initial = (name?.[0] ?? '?').toUpperCase();
  const bgColor = useMemo(() => {
    if (eliminated || colorIdentity.length === 0) {
      return 'var(--color-surface-card)';
    }
    // Single first color of identity. Multicolor commanders are
    // expected to have art so this fallback is rare for them; if
    // we land here for a multicolor case, just use the first.
    return manaTokenForCode(colorIdentity[0]!);
  }, [colorIdentity, eliminated]);

  // Same desaturation / opacity treatment as the real portrait
  // for state variants — keeps the visual contract consistent
  // whether art loads or not. Shared helper so the two paths
  // (img + fallback) can't drift if the catalog values change
  // (code critic Dup2).
  const filterValue = stateFilter(eliminated, disconnected);

  // Font size scales with the portrait — large portraits get
  // proportionally larger initials. Roughly half the portrait
  // dimension for a balanced look.
  const fontSize = Math.max(12, Math.round(sizePx * 0.5));

  return (
    <div
      data-testid="player-portrait-fallback"
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        backgroundColor: bgColor,
        color: 'var(--color-text-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 600,
        fontSize: `${fontSize}px`,
        lineHeight: 1,
        userSelect: 'none',
        filter: filterValue,
        transition: 'filter 700ms ease-in-out',
      }}
    >
      {initial}
    </div>
  );
}

/**
 * Slice 70-Z polish (code critic Dup2) — shared helper for the
 * eliminated/disconnected portrait filter string. Both the real-art
 * path and the fallback-initial path apply the SAME desaturation
 * treatment per picture-catalog §2.4; centralizing the values here
 * means the catalog can be retuned with a single edit instead of
 * two parallel literals.
 */
function stateFilter(
  eliminated: boolean,
  disconnected: boolean,
): string | undefined {
  if (eliminated) return 'grayscale(1) opacity(0.5)';
  if (disconnected) return 'grayscale(0.6) opacity(0.7)';
  return undefined;
}

/**
 * Slice 70-J — circular halo ring around the portrait. Re-uses the
 * same mask-composite mechanism as the rectangular HaloRing in
 * PlayerFrame (slice 70-D) — the geometry is independent of the
 * mask shape; only the wrapper's {@code border-radius} changes.
 *
 * <p>The {@code animate-player-active-halo} CSS keyframe (slice
 * 70-G) is always-on while {@code isActive} is true, regardless
 * of color count. The {@code animate-halo-rotate} keyframe is
 * only on when colorIdentity has 2+ colors AND the player is not
 * eliminated — single-color rings look identical at every angle
 * (rotation would burn paint cycles), and eliminated state's
 * grey halo shouldn't spin (would distract from the slash overlay
 * in PlayerArea).
 */
function CircularHalo({
  colorIdentity,
  isActive,
  eliminated,
  paddingPx,
}: {
  colorIdentity: readonly string[];
  isActive: boolean;
  eliminated: boolean;
  paddingPx: number;
}) {
  const haloBackground = useMemo(
    () => computeHaloBackground(colorIdentity, eliminated),
    [colorIdentity, eliminated],
  );

  // Slice 70-Z polish (user feedback 2026-04-30 — bloom should
  // MATCH the ring's rotating colors, not be a static color sum).
  //
  // Approach: render the bloom as a BLURRED COPY of the same
  // conic-gradient the ring uses, expanded outward beyond the
  // portrait via negative inset. The blur softens the gradient
  // bands into a colored bloom that retains the rotational color
  // information. When the ring rotates 12s/rev, the bloom rotates
  // in lockstep (both consume the same {@code --halo-angle}
  // animated CSS var via {@code animate-halo-rotate}), so the
  // bloom color at any angle matches the ring color at that angle
  // — fixing the previous "static rainbow sum vs rotating bands"
  // mismatch.
  //
  // Earlier slices 70-N.1 and 70-Z used layered box-shadows that
  // composited additively as a static color mush. The new
  // blurred-gradient approach gives directional color (blue at
  // top, red at right, green at bottom, etc., rotating) that
  // mirrors what the ring shows at each instant.
  // Slice 70-Z polish (user feedback 2026-04-30 round 6) — bloom
  // radiation distance halved (extent: 8/16/22 → 4/8/11; blur:
  // 7/14/18 → 4/7/9). Same strength at the ring edge (the peak
  // alpha lives at the gradient's intrinsic 0% stop which is the
  // inset boundary), just terminates sooner so the bloom hugs
  // the portrait closer rather than radiating broadly outward.
  // Opacity stays at 0.75 from earlier — only the falloff radius
  // shrinks.
  const bloomExtentPx = paddingPx <= 1.5 ? 4 : paddingPx <= 2 ? 8 : 11;
  const bloomBlurPx = paddingPx <= 1.5 ? 4 : paddingPx <= 2 ? 7 : 9;

  const rotates = colorIdentity.length > 1 && !eliminated;
  const pulses = isActive && !eliminated;

  // Slice 70-Z polish (code critic I2) — longhand top/right/bottom/
  // left instead of `inset` shorthand. jsdom's CSSOM serialization
  // for the logical-properties shorthand is inconsistent across
  // versions; longhands are stable for tests + cross-browser.
  const bloomStyle: CSSProperties = {
    position: 'absolute',
    top: `-${bloomExtentPx}px`,
    right: `-${bloomExtentPx}px`,
    bottom: `-${bloomExtentPx}px`,
    left: `-${bloomExtentPx}px`,
    borderRadius: '50%',
    background: haloBackground,
    filter: `blur(${bloomBlurPx}px)`,
    opacity: 0.75,
    zIndex: -1,
  };

  const ringStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    background: haloBackground,
    padding: `${paddingPx}px`,
    WebkitMask:
      'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    maskComposite: 'exclude',
    borderRadius: '50%',
  };

  // Slice 70-Z polish (user-feedback round 7 — bloom-on-top fix) —
  // ROTATION lives on the shared parent so both children inherit
  // the same animated `--halo-angle` for guaranteed lockstep, but
  // the OPACITY pulse lives on each child individually.
  //
  // Why split: animating opacity creates a CSS stacking context on
  // the animated element. If the pulse were on the parent halo-
  // stack, the parent would gain a stacking context and bloom's
  // `z-index: -1` would resolve INSIDE the parent's context — the
  // entire halo-stack (bloom + ring) would paint as a unit at step 6
  // (positioned z=auto) of the wrapper's stacking context, ON TOP
  // OF the in-flow img. That visually hoisted the bloom over the
  // portrait. Keeping the parent rotation-only (animating
  // `--halo-angle` doesn't create a stacking context) leaves
  // bloom's z=-1 resolving in the wrapper's stacking context where
  // it correctly paints behind the img.
  const parentAnim = rotates ? 'animate-halo-rotate' : '';
  const childAnim = pulses ? 'animate-player-active-halo' : '';

  return (
    <div
      aria-hidden="true"
      data-testid="player-portrait-halo-stack"
      // P2 audit fix — `data-essential-motion` on the halo wrapper so
      // the rotation + pulse keyframes survive prefers-reduced-motion.
      // The active-player halo is strategic information ("whose turn
      // is it?"), and the multicolor rotating ring conveys commander
      // color identity at a glance — both classify as "spec-essential
      // card-zone movement that conveys game state" per slice 70-B's
      // reduced-motion contract. The descendant exclusion in the CSS
      // rule means a single attribute on the wrapper covers both
      // child layers (bloom + ring).
      data-essential-motion="true"
      className={'pointer-events-none absolute inset-0 ' + parentAnim}
    >
      {/* Bloom layer — blurred copy of the conic-gradient
          extended outward via negative inset. Sits BEHIND the
          portrait image via z-index: -1 + the wrapper's
          `isolation: isolate` stacking context. Rotates in
          lockstep with the ring via the parent's animated
          `--halo-angle` (cascaded). Pulse opacity applied here
          per-child so the parent doesn't gain a stacking
          context. */}
      <div
        data-testid="player-portrait-halo-bloom"
        data-rotating={rotates || undefined}
        className={'pointer-events-none ' + childAnim}
        style={bloomStyle}
      />
      {/* Ring layer — masked color band. Pulse opacity applied
          per-child for the same stacking-context reason. */}
      <div
        data-testid="player-portrait-halo"
        data-color-count={colorIdentity.length}
        data-eliminated={eliminated || undefined}
        data-active={isActive || undefined}
        data-rotating={rotates || undefined}
        data-pulsing={pulses || undefined}
        className={'pointer-events-none ' + childAnim}
        style={ringStyle}
      />
    </div>
  );
}
