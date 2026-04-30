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
    // Slice 70-Z.3 critic IMP-4 fix — commandList exposes imageNumber
    // (numeric) but CardFace's scryfall image lookup keys off
    // cardNumber (string). Stringify so the card art actually
    // renders during the 600ms glide instead of a blank gradient.
    cardNumber: String(commanderEntry.imageNumber ?? ''),
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
    rules: [...commanderEntry.rules],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
    sourceLabel: '',
  };
}
