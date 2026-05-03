/**
 * Fetch + cache full card metadata for every unique card in a deck.
 * Mirrors the lobby's useLiveDecks pattern: process-global cache,
 * inflight dedup, single render-bump when the cache fills. The
 * DeckEditor needs card type / mana value / mana cost to render
 * grouped buckets and per-card chrome; without this it would be
 * one /api/cards?name=X round-trip per render.
 *
 * <p>Cache survives across DeckEditor mounts within a session, so
 * re-opening the same (or related-card) deck is instant.
 */
import { useEffect, useMemo, useState } from 'react';
import { ApiError, request } from '../api/client';
import { webCardListingSchema, type WebCardInfo } from '../api/schemas';
import { useAuthStore } from '../auth/store';
import type { SavedDeck } from './store';

const cache = new Map<string, WebCardInfo | null>();
const inflight = new Map<string, Promise<void>>();

// Audit fix — clear the global card cache when the auth session goes
// away. Card metadata isn't user-scoped today, but if the server ever
// adds per-user card visibility (custom sets, preview cards) the next
// user-on-this-device would see the prior user's view. Defensive,
// cheap, runs once per logout. The subscription is a module-level
// side effect installed on first import — same pattern as the cache
// itself.
useAuthStore.subscribe((state, prev) => {
  if (prev.session && !state.session) {
    cache.clear();
    inflight.clear();
  }
});

async function fetchOne(name: string, token: string): Promise<void> {
  if (cache.has(name)) return;
  const existing = inflight.get(name);
  if (existing) {
    await existing;
    return;
  }
  const promise = (async () => {
    try {
      const result = await request(
        `/api/cards?name=${encodeURIComponent(name)}`,
        webCardListingSchema,
        { token },
      );
      cache.set(name, result.cards[0] ?? null);
    } catch {
      // Audit fix (HIGH #4) — write null on ANY failure (ApiError,
      // network error, schema mismatch, etc.) so the cache always
      // settles for this name. Pre-fix the non-ApiError path re-threw,
      // leaving the entry permanently un-cached and the consumer's
      // {@code loading} flag stuck on {@code true} forever.
      cache.set(name, null);
    } finally {
      inflight.delete(name);
    }
  })();
  inflight.set(name, promise);
  await promise;
}

interface Result {
  /** Lookup table — cardName → metadata (null = engine doesn't know). */
  byName: ReadonlyMap<string, WebCardInfo | null>;
  /** True while at least one unique card name is still in flight. */
  loading: boolean;
}

export function useDeckCardData(deck: SavedDeck | null): Result {
  const token = useAuthStore((s) => s.session?.token ?? null);
  const [bumpKey, setBumpKey] = useState(0);

  const uniqueNames = useMemo(() => {
    if (!deck) return [] as string[];
    const set = new Set<string>();
    for (const c of deck.cards) set.add(c.cardName);
    for (const c of deck.sideboard) set.add(c.cardName);
    return Array.from(set);
  }, [deck]);

  useEffect(() => {
    if (!token || uniqueNames.length === 0) return;
    const missing = uniqueNames.filter((n) => !cache.has(n));
    if (missing.length === 0) return;
    let cancelled = false;
    // Use .finally so the bump fires even on a rejection path —
    // belt-and-suspenders since fetchOne now always writes to cache,
    // but a future caller that throws shouldn't be able to leave the
    // UI stuck in loading state.
    Promise.all(missing.map((n) => fetchOne(n, token))).finally(() => {
      if (!cancelled) setBumpKey((k) => k + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [token, uniqueNames]);

  // bumpKey forces re-derivation when the cache fills.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const byName = useMemo(() => {
    const map = new Map<string, WebCardInfo | null>();
    for (const n of uniqueNames) map.set(n, cache.get(n) ?? null);
    return map;
  }, [uniqueNames, bumpKey]);

  const loading = uniqueNames.some((n) => !cache.has(n));

  return { byName, loading };
}

/** Test-only — reset the module cache between tests. */
export function _resetDeckCardDataCache(): void {
  cache.clear();
  inflight.clear();
}
