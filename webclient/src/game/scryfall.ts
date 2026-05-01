import type { WebCardView, WebCommandObjectView } from '../api/schemas';

/**
 * Build a Scryfall image URL from a card's set + collector number.
 * Returns {@code null} when either field is missing — the
 * {@link CardDetail} renders without an image in that case.
 *
 * <p>{@code ?format=image&version=normal} is the redirect-to-CDN
 * endpoint Scryfall provides; the browser follows the 302 once
 * and caches the result. Set codes are upper-cased upstream;
 * Scryfall's URL space is lowercase, so we normalize here.
 *
 * <p>Per ADR 0002 / PATH_C_PLAN.md "Image strategy": Scryfall is
 * the source of truth for card art, fetched on demand and cached
 * by the browser HTTP cache. A Service Worker overlay can come
 * later if rate limits or offline-play matter; for now the
 * native cache is sufficient.
 */
export type ScryfallVersion = 'normal' | 'small' | 'art_crop';

export function scryfallImageUrl(
  card: WebCardView,
  version: ScryfallVersion = 'normal',
): string | null {
  if (!card.expansionSetCode || !card.cardNumber) return null;
  const set = card.expansionSetCode.toLowerCase();
  const num = encodeURIComponent(card.cardNumber);
  return `https://api.scryfall.com/cards/${set}/${num}?format=image&version=${version}`;
}

/**
 * Slice 70-J — Scryfall image URL for a player's commander entry.
 *
 * <p>{@link WebCommandObjectView} carries set + collector number
 * data; this helper builds the Scryfall URL so {@link PlayerPortrait}
 * can resolve commander art without manual field-juggling.
 *
 * <p>Slice 70-X.2 — prefer {@code cardNumber} (collector-number
 * string) over {@code imageNumber} (int). xmage's
 * {@code MageObject.imageNumber} defaults to 0 for ordinary cards
 * (only tokens / face-down stand-ins get explicit values), so
 * {@code imageNumber} alone produces broken URLs like
 * {@code /cards/woc/0} → 404. {@code cardNumber} mirrors what
 * Scryfall expects in {@code /cards/{set}/{collector_number}}
 * and matches the WebCardView path used elsewhere in the UI.
 * Falls back to {@code imageNumber} when cardNumber is missing
 * (1.23-and-earlier server compat during rolling upgrade).
 *
 * <p>Default version is {@code 'art_crop'} (just the artwork, no
 * card frame) — that's the right shape for the circular portrait
 * crop used by player pods + game-log avatars + commander-damage
 * cells. Callers that need the full card image (hover preview,
 * stack focal) pass {@code 'normal'} explicitly.
 */
export function scryfallCommanderImageUrl(
  commander: WebCommandObjectView,
  version: ScryfallVersion = 'art_crop',
): string | null {
  if (!commander.expansionSetCode) return null;
  const collectorNumber =
    commander.cardNumber || (commander.imageNumber ? String(commander.imageNumber) : '');
  if (!collectorNumber) return null;
  const set = commander.expansionSetCode.toLowerCase();
  const num = encodeURIComponent(collectorNumber);
  return `https://api.scryfall.com/cards/${set}/${num}?format=image&version=${version}`;
}
