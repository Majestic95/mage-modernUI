/**
 * Resolve a list of {@link ParsedEntry} (count + name only) into
 * {@link WebDeckCardInfo} (count + name + setCode + cardNumber) by
 * looking up each card via {@code GET /api/cards?name=X}.
 *
 * <p>Resolution is parallel — all card lookups fire at once and we
 * await the batch. Acceptable for typical 60-card decks against a
 * local server (sub-second). If we ever hit a real concurrency
 * limit, gate this behind a small concurrency pool.
 */
import { request, ApiError } from '../api/client';
import { webCardListingSchema, type WebDeckCardInfo } from '../api/schemas';
import type { ParsedEntry } from './parse';

export interface ResolveResult {
  cards: WebDeckCardInfo[];
  /** Names that did not resolve to any card. */
  missing: string[];
}

export async function resolveDeck(
  entries: ParsedEntry[],
  token: string,
): Promise<ResolveResult> {
  // Sum counts for repeated entries — "4 Forest" + "20 Forest" → 24 Forest.
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.cardName, (totals.get(entry.cardName) ?? 0) + entry.count);
  }

  // Resolve each unique name in parallel.
  const uniqueNames = Array.from(totals.keys());
  const lookups = await Promise.all(
    uniqueNames.map(async (name) => {
      try {
        const result = await request(
          `/api/cards?name=${encodeURIComponent(name)}`,
          webCardListingSchema,
          { token },
        );
        return { name, card: result.cards[0] ?? null };
      } catch (err) {
        if (err instanceof ApiError) {
          return { name, card: null };
        }
        throw err;
      }
    }),
  );

  const cards: WebDeckCardInfo[] = [];
  const missing: string[] = [];
  for (const { name, card } of lookups) {
    if (!card) {
      missing.push(name);
      continue;
    }
    cards.push({
      cardName: card.name,
      setCode: card.setCode,
      cardNumber: card.cardNumber,
      amount: totals.get(name) ?? 0,
    });
  }

  return { cards, missing };
}
