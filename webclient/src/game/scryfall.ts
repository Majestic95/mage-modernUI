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
  if (!card.expansionSetCode) return null;
  const set = card.expansionSetCode.toLowerCase();

  // Schema 1.32 — tokens route through Scryfall's named-lookup endpoint
  // with `t`-prefixed set codes. Engine-stamped imageNumber is 0 for
  // most TOK-database rows (the third column is empty), so the
  // cardNumber-based path returns the wrong card or 404. Named-lookup
  // eliminates the imageNumber dependency entirely. The legacy Swing
  // client maintained a hardcoded set/name → URL map
  // (Mage.Client/.../ScryfallImageSupportTokens.java with rows like
  // "DOM/Goblin → tdom/9"); we get the same resolution from Scryfall
  // directly without the maintenance burden. Companion to the FB#13
  // mapper fix — FB#13 forwarded a useful imageNumber for the
  // XMAGE-token subset, this routes the broader MTG TOK subset.
  //
  // Uses `?exact=` (not `?fuzzy=`) for consistency with the rest of
  // the webclient — token names from the engine are well-formed and
  // exact-matched in Scryfall's database. The double-`t` prefix
  // (e.g. `tthb` for Theros Beyond Death tokens) is correct and
  // distinct from the regular set code `thb`; verified against
  // Scryfall's set listing.
  //
  // Out of scope: XMAGE-namespaced tokens (Copy / Morph / Manifest)
  // whose set code can't be `t`-prefixed usefully — those still 404
  // and need a separate URL pre-resolution path.
  if (card.isToken) {
    if (!card.name) return null;
    const name = encodeURIComponent(card.name);
    return `https://api.scryfall.com/cards/named?exact=${name}&set=t${set}&format=image&version=${version}`;
  }

  if (!card.cardNumber) return null;
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
