import type { WebCardView } from '../api/schemas';

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
