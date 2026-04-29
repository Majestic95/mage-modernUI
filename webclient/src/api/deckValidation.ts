/**
 * Slice 72-B — pre-flight deck validation client. Wraps
 * {@code POST /api/decks/validate?deckType=...} so the Decks page can
 * render an inline legality affordance after every format pick or
 * deck edit, without having to actually attempt a table join.
 *
 * <p>Always resolves with a {@link WebDeckValidationResult} on a
 * 200 OK — even when the deck failed validation. Surfaces
 * {@link ApiError} for the 4xx cases (unknown deckType, invalid deck
 * format, deck too large) so callers can branch on
 * {@code err.code} without reading status numbers.
 */
import { ApiError, request } from './client';
import {
  webDeckValidationResultSchema,
  type WebDeckCardLists,
  type WebDeckValidationResult,
} from './schemas';

/**
 * Validate a deck against a server-known format. The {@code deckType}
 * must match an entry from {@code GET /api/server/state} {@code
 * deckTypes} (e.g. {@code "Variant Magic - Commander"}).
 *
 * @throws {ApiError} with {@code code === "UNKNOWN_DECK_TYPE"} when
 *   the format string is not registered server-side
 * @throws {ApiError} with {@code code === "INVALID_DECK_FORMAT"} when
 *   the deck references cards the server can't resolve
 * @throws {ApiError} with {@code code === "DECK_TOO_LARGE"} (413)
 *   when the entry count exceeds the per-request CPU budget
 *   (see {@code DeckValidationService.MAX_DECK_ENTRIES})
 */
export async function validateDeck(
  deckType: string,
  deck: WebDeckCardLists,
  token: string,
  signal?: AbortSignal,
): Promise<WebDeckValidationResult> {
  const path = `/api/decks/validate?deckType=${encodeURIComponent(deckType)}`;
  const options: Parameters<typeof request>[2] = {
    token,
    method: 'POST',
    body: deck,
  };
  if (signal !== undefined) {
    options.signal = signal;
  }
  const result = await request(
    path,
    webDeckValidationResultSchema,
    options,
  );
  return result;
}

/** Re-export so consumers can {@code instanceof}-check without a separate import. */
export { ApiError };
