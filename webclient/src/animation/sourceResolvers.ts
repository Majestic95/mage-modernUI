import type { WebCardView, WebCommandObjectView } from '../api/schemas';

/**
 * Slice 70-Z.3 — DOM-bbox resolution helpers for the animation
 * overlays. Lives in its own file (not next to the React components
 * that consume it) because the {@code react-refresh/only-export-components}
 * lint rule disallows non-component named exports alongside
 * component exports — sharing helpers cross-component requires a
 * dedicated module.
 *
 * <p>All functions read DOM at call time and return null when the
 * target element isn't mounted. Callers (CardAnimationLayer) gate
 * overlay mounts on null returns so a missing source / destination
 * degrades gracefully (no overlay, but no crash).
 */

/**
 * Resolve the source bbox center for a cast. Local hand-cast →
 * the {@code my-hand} container center; opponent cast → the
 * opponent's PlayerArea via {@code data-player-id} (seat-anonymous,
 * survives any seat→position rearrangement). Returns null if no
 * element resolves.
 *
 * <p>Slice 70-Z.3 critic CRIT-1 fix: the previous implementation
 * mapped {@code ownerSeat} → pod position via a hardcoded array
 * {@code ['bottom','top','left','right']}, but {@code ownerSeat} is
 * the engine's {@code players[]} array index, NOT a perspective-
 * relative seat. {@code gridAreaForOpponent} computes pod position
 * from the post-{@code selectOpponents} index, so seat 0 isn't
 * always "bottom" — if the local player sits at engine seat 2, then
 * engine seat 0 is an opponent rendered at top/left/right, and the
 * resolver pointed at the local pod instead. The {@code playerId}
 * is the only stable identifier that survives reseat shuffles.
 */
export function resolveCastSourceCenter(
  from: 'hand' | 'unknown',
  ownerPlayerId: string | null,
): { x: number; y: number } | null {
  if (typeof document === 'undefined') return null;
  let el: Element | null = null;
  if (from === 'hand') {
    el = document.querySelector('[data-testid="my-hand"]');
  } else if (ownerPlayerId) {
    el = document.querySelector(`[data-player-id="${ownerPlayerId}"]`);
  }
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Resolve the central focal zone bbox center. Used as the
 * destination for cinematic-cast pose + ribbon trail so they land
 * at the focal-tile position rather than viewport center (which is
 * offset by side-panel width + header height — slice 70-Z.3 critic
 * IMP-5 fix).
 */
export function resolveFocalZoneCenter(): { x: number; y: number } | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('[data-testid="central-focal-zone"]');
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Resolve a battlefield tile's bbox by cardId. Uses the
 * {@code data-card-id} attribute that BattlefieldRowGroup emits on
 * each motion.div. Used by ImpactOverlay (slice 70-Z.4 critic
 * CRIT-1 fix) to capture the dying tile's screen position at
 * event-handler time, before React re-renders without the card.
 */
export function resolveTileBBox(cardId: string): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(`[data-card-id="${cardId}"]`);
  if (!el) return null;
  const rect = (el as Element).getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Resolve a battlefield tile's rendered card-art image URL by
 * cardId. Used by ShatterOverlay (creature-death cinematic) so
 * the shards can render the tile's ACTUAL art via background-image
 * instead of guessing the Scryfall URL — guarantees consistency
 * with whatever CardFace already painted (any version: 'normal' /
 * 'small' / 'art_crop'), including cache state. Returns null if
 * the tile or its `<img>` is gone, or if src is empty.
 */
export function resolveTileImageUrl(cardId: string): string | null {
  if (typeof document === 'undefined') return null;
  const img = document.querySelector(`[data-card-id="${cardId}"] img`);
  if (!img) return null;
  const src = (img as HTMLImageElement).src;
  return src && src.length > 0 ? src : null;
}

/**
 * Resolve a battlefield tile's FINAL (untransformed) layout bbox
 * by cardId. Walks the offsetLeft/offsetTop/offsetParent chain to
 * compute viewport coordinates without picking up any active
 * CSS transform.
 *
 * <p>Why not getBoundingClientRect: Framer Motion's layout
 * animations apply CSS transforms during the spring interpolation.
 * `getBoundingClientRect` returns the visually-transformed position
 * (mid-glide), not the final slot. For ResolveFlightOverlay we
 * want the slot — the place the card is settling INTO — at event
 * time, before Framer has finished its glide. offsetLeft/Top
 * report the layout position regardless of any active transform.
 *
 * <p>Caveat: offsetParent chains skip elements with `position:
 * static`, so the absolute coords drift if any ancestor between
 * the tile and the document root is unpositioned. The tabletop
 * variant pods + game shell are explicitly positioned, so the
 * chain is sound here. If a future layout change breaks this,
 * GroundCrackOverlay's existing `resolveTileBBox` (gBCR-based) is
 * still the right helper for "where is this tile right now."
 */
export function resolveTileLayoutBBox(cardId: string): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(
    `[data-card-id="${cardId}"]`,
  ) as HTMLElement | null;
  if (!el) return null;
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  const scrollX = typeof window !== 'undefined' ? window.scrollX || 0 : 0;
  const scrollY = typeof window !== 'undefined' ? window.scrollY || 0 : 0;
  return {
    left: x - scrollX,
    top: y - scrollY,
    width: el.offsetWidth,
    height: el.offsetHeight,
  };
}

const TILE_OPACITY_RESTORE_FADE_MS = 200;
const TILE_OPACITY_CLEAR_AFTER_FADE_MS = 250;

/**
 * Set an inline opacity on a battlefield tile by cardId. Used by
 * the resolve-flight handler to hide Framer's LAYOUT_GLIDE
 * interpolation while ResolveFlightOverlay paints the arc on top —
 * otherwise the user sees two copies of the card (Framer's spring-
 * glided original + the overlay's arcing copy).
 *
 * <p><b>API:</b>
 * <ul>
 *   <li>{@code setTileOpacity(cardId, 0)} — applies inline
 *       {@code opacity: 0} + a 200ms ease-out transition rule. Tile
 *       becomes invisible.</li>
 *   <li>{@code setTileOpacity(cardId, null)} — restores by setting
 *       inline {@code opacity: 1} (explicitly, NOT clearing to
 *       empty string), so the 200ms transition runs visibly from
 *       0 → 1. After the fade settles (250ms safety window), a
 *       follow-up timer clears the inline rules to ''. React's
 *       natural render value (also 1) takes over after the clear,
 *       so no visual pop.</li>
 * </ul>
 *
 * <p><b>Why explicit '1' on restore (CSS-critic fix 2026-05-12):</b>
 * clearing inline {@code style.opacity} to {@code ''} immediately
 * lets React's next render assign whatever its prop says — usually
 * 1, but the timing race could pop the tile to visible before the
 * 200ms transition runs. Setting an explicit '1' lets the CSS
 * transition interpolate from 0 → 1 first, THEN the deferred clear
 * removes the inline rule once the visual end-state already
 * matches React's natural value.
 */
export function setTileOpacity(cardId: string, value: number | null): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector(
    `[data-card-id="${cardId}"]`,
  ) as HTMLElement | null;
  if (!el) return;
  if (value === null) {
    // Restore — explicit '1' so the 200ms transition is visible.
    // Then clear the inline rule once the fade has settled so React
    // reclaims control of the property naturally.
    el.style.opacity = '1';
    el.style.transition = `opacity ${TILE_OPACITY_RESTORE_FADE_MS}ms ease-out`;
    setTimeout(() => {
      // Re-query in case the tile was re-keyed; bail if gone.
      const stillEl = document.querySelector(
        `[data-card-id="${cardId}"]`,
      ) as HTMLElement | null;
      if (!stillEl) return;
      stillEl.style.opacity = '';
      stillEl.style.transition = '';
    }, TILE_OPACITY_CLEAR_AFTER_FADE_MS);
    return;
  }
  el.style.opacity = String(value);
  el.style.transition = `opacity ${TILE_OPACITY_RESTORE_FADE_MS}ms ease-out`;
}

/**
 * Resolve the destination portrait center for a commander_returned
 * event. Uses {@code data-portrait-target-player-id} (the same
 * selector StackZone's combat arrows use, slice 70-N).
 */
export function resolveCommanderReturnTarget(
  playerId: string,
): { x: number; y: number } | null {
  if (typeof document === 'undefined') return null;
  const sel = `[data-portrait-target-player-id="${playerId}"]`;
  const el = document.querySelector(sel);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Reconstruct a minimal {@link WebCardView} from a commander
 * commandList entry. The diff fires {@code commander_returned}
 * AFTER the card left the battlefield (so the WebCardView from the
 * battlefield is gone), and commandList carries only the printed
 * card's name + expansion + rules. We synthesize the missing
 * fields with defaults sufficient to render {@code CardFace size=
 * "battlefield"} during the brief 600ms glide.
 */
export function stubCardFromCommandList(
  cardId: string,
  commanderEntry: WebCommandObjectView,
): WebCardView {
  return {
    id: cardId,
    cardId,
    name: commanderEntry.name,
    displayName: commanderEntry.name,
    expansionSetCode: commanderEntry.expansionSetCode,
    // P1 audit fix — prefer the schema-1.24 string `cardNumber` over
    // the numeric `imageNumber`. Upstream's MageObject.imageNumber
    // defaults to 0 for ordinary cards (only tokens / face-down get
    // explicit values), so the pre-fix
    // `String(commanderEntry.imageNumber ?? '')` produced "0" for
    // every commander → Scryfall 404 → blank gradient mid-glide.
    // Same fallback chain MyHand.tsx uses for command-zone art.
    cardNumber:
      commanderEntry.cardNumber ||
      (commanderEntry.imageNumber ? String(commanderEntry.imageNumber) : ''),
    manaCost: '',
    manaValue: 0,
    typeLine: '',
    supertypes: [],
    // P1 audit fix — was hardcoded to ['CREATURE'], which mis-renders
    // P/T overlays on planeswalker / partner-background commanders
    // during the return-to-command-zone glide. Drop the hardcoded
    // type; CardFace's battlefield-variant rendering is robust to an
    // empty types array (no badge, just art + name).
    types: [],
    subtypes: [],
    colors: [],
    rarity: '',
    power: '',
    toughness: '',
    startingLoyalty: '',
    rules: [...commanderEntry.rules],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
    sourceLabel: '',
    source: null,
    isToken: false,
  };
}
