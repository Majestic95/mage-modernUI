/**
 * Slice L6 — derives a {@link LobbyDeck}[] from the user's saved
 * decks for live use in the new lobby. Three concerns layered:
 *
 * <ol>
 *   <li>Read from {@link useDecksStore} (the existing localStorage-
 *       backed Zustand store).</li>
 *   <li>Fetch the commander card for each deck so the My Decks list
 *       can render the color-identity pips. One round-trip per
 *       unique commander; cached process-globally so re-entering
 *       the lobby doesn't re-fetch.</li>
 *   <li>For the SELECTED deck only, additionally fetch every unique
 *       mainboard card so {@link computeStats} can build the full
 *       mana curve / type counts / pip counts. This is the
 *       expensive bit (~50–80 fetches for a 100-card Commander
 *       deck); the cache makes it a one-time cost per session.</li>
 * </ol>
 */
import { useEffect, useMemo, useState } from 'react';
import { ApiError, request } from '../api/client';
import {
  webCardListingSchema,
  type WebCardInfo,
  type WebDeckCardInfo,
} from '../api/schemas';
import { useAuthStore } from '../auth/store';
import { useDecksStore, type SavedDeck } from '../decks/store';
import { computeStats } from './computeStats';
import type { LobbyColor, LobbyDeck } from './fixtures';

// Process-global cache. Survives across NewLobbyScreen mounts within
// the same session, so re-opening the lobby doesn't re-fetch every
// card. Keyed by exact card name.
const cardCache = new Map<string, WebCardInfo | null>();
// In-flight promise dedup so two callers asking for the same name
// converge on a single request.
const inFlight = new Map<string, Promise<void>>();

async function fetchCard(name: string, token: string): Promise<void> {
  if (cardCache.has(name)) return;
  if (inFlight.has(name)) {
    await inFlight.get(name);
    return;
  }
  const promise = (async () => {
    try {
      const result = await request(
        `/api/cards?name=${encodeURIComponent(name)}`,
        webCardListingSchema,
        { token },
      );
      cardCache.set(name, result.cards[0] ?? null);
    } catch (err) {
      if (err instanceof ApiError) {
        cardCache.set(name, null);
        return;
      }
      throw err;
    } finally {
      inFlight.delete(name);
    }
  })();
  inFlight.set(name, promise);
  await promise;
}

async function fetchAll(names: string[], token: string): Promise<void> {
  await Promise.all(names.map((n) => fetchCard(n, token)));
}

interface UseLiveDecksResult {
  decks: LobbyDeck[];
  selectedDeck: LobbyDeck | null;
  /**
   * Slice L7 polish — true when the selected deck still has unresolved
   * card metadata in flight. The deck-preview can show a skeleton /
   * "calculating stats…" indicator instead of zeroes that look like
   * a buggy curve.
   */
  selectedStatsLoading: boolean;
}

const SCRYFALL = 'https://api.scryfall.com/cards/named';

function scryfallByName(name: string, kind: 'art_crop' | 'normal'): string {
  return `${SCRYFALL}?format=image&version=${kind}&exact=${encodeURIComponent(name)}`;
}

function commanderName(deck: SavedDeck): string {
  return deck.sideboard[0]?.cardName ?? '';
}

export function useLiveDecks(selectedDeckId: string | null): UseLiveDecksResult {
  const session = useAuthStore((s) => s.session);
  const savedDecks = useDecksStore((s) => s.decks);
  const [bumpKey, setBumpKey] = useState(0);

  // Fetch all commander cards once per change to the deck list.
  useEffect(() => {
    if (!session || savedDecks.length === 0) return;
    const names = savedDecks
      .map((d) => commanderName(d))
      .filter((n): n is string => !!n);
    if (names.length === 0) return;
    let cancelled = false;
    void fetchAll(names, session.token).then(() => {
      if (!cancelled) setBumpKey((k) => k + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [session, savedDecks]);

  // Fetch every unique card in the selected deck so we can compute
  // full stats. Skipped when no deck is selected.
  const selectedSaved = useMemo(
    () => savedDecks.find((d) => d.id === selectedDeckId) ?? null,
    [savedDecks, selectedDeckId],
  );

  // Slice L6 — fetch every unique card in the selected deck so we
  // can compute full stats. Cached process-globally; subsequent
  // selections of the same deck are instant. We don't expose a
  // loading boolean — the UI re-renders via {@code bumpKey} when
  // the cache fills, and the deck preview tolerates partial
  // metadata (computeStats skips cache-misses).
  useEffect(() => {
    if (!session || !selectedSaved) return;
    const missing = uniqueCardNames(selectedSaved).filter(
      (n) => !cardCache.has(n),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    void fetchAll(missing, session.token).then(() => {
      if (!cancelled) setBumpKey((k) => k + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [session, selectedSaved]);

  const decks = useMemo(
    () => savedDecks.map((d) => savedToLobbyDeck(d, selectedSaved?.id === d.id)),
    // Re-derive when the cache fills (bumpKey) so newly-fetched
    // commanders show their color pips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savedDecks, selectedSaved?.id, bumpKey],
  );

  const selectedDeck = useMemo(
    () => decks.find((d) => d.id === selectedDeckId) ?? null,
    [decks, selectedDeckId],
  );

  // Slice L7 polish — derive loading from cache state rather than
  // tracking it via setState (avoids the cascading-render lint).
  // The deck is "loading stats" iff at least one of its unique card
  // names is still missing from the cache.
  const selectedStatsLoading = (() => {
    if (!selectedSaved) return false;
    for (const name of uniqueCardNames(selectedSaved)) {
      if (!cardCache.has(name)) return true;
    }
    return false;
  })();

  return {
    decks,
    selectedDeck,
    selectedStatsLoading,
  };
}

function uniqueCardNames(deck: SavedDeck): string[] {
  const set = new Set<string>();
  for (const c of deck.cards) set.add(c.cardName);
  for (const c of deck.sideboard) set.add(c.cardName);
  return Array.from(set);
}

function savedToLobbyDeck(deck: SavedDeck, isSelected: boolean): LobbyDeck {
  const cmdrName = commanderName(deck);
  const cmdrCard = cmdrName ? cardCache.get(cmdrName) ?? null : null;

  // Default empty stats — populated only for the selected deck.
  let mainboardSize = deck.cards.reduce((sum, c) => sum + c.amount, 0);
  let manaCurve = new Array<number>(8).fill(0);
  let typeCounts = {
    creatures: 0,
    artifacts: 0,
    enchantments: 0,
    instantsAndSorceries: 0,
  };
  let colorPipCounts: Record<LobbyColor, number> = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
  };
  let colorIdentity: LobbyColor[] = (cmdrCard?.colors ?? []).filter(
      (c): c is LobbyColor => ['W', 'U', 'B', 'R', 'G'].includes(c),
  );

  if (isSelected) {
    const stats = computeStats({
      mainboard: deck.cards,
      commander: deck.sideboard[0] ?? null,
      cards: cardCacheToMap(deck),
    });
    mainboardSize = stats.mainboardSize;
    manaCurve = stats.manaCurve;
    typeCounts = stats.typeCounts;
    colorPipCounts = stats.colorPipCounts;
    if (stats.colorIdentity.length > 0) {
      colorIdentity = stats.colorIdentity;
    }
  }

  // Required size — Commander = 100, otherwise 60. The deck's wire
  // shape doesn't carry a format; we infer by sideboard convention
  // (Commander format always has a sideboard with the commander).
  const requiredSize = deck.sideboard.length > 0 ? 100 : 60;

  return {
    id: deck.id,
    name: deck.name || 'Untitled',
    commanderName: cmdrName,
    commanderArtUrl: cmdrName ? scryfallByName(cmdrName, 'art_crop') : null,
    mainboardSize,
    requiredSize,
    colorIdentity,
    manaCurve,
    typeCounts,
    colorPipCounts,
  };
}

function cardCacheToMap(
  deck: SavedDeck,
): Map<string, WebCardInfo> {
  // Project the global cache into a deck-scoped Map of resolved
  // (non-null) cards. computeStats accepts misses (skips them) so
  // a partial fill renders partial stats rather than crashing.
  const out = new Map<string, WebCardInfo>();
  const allEntries: WebDeckCardInfo[] = [...deck.cards, ...deck.sideboard];
  for (const entry of allEntries) {
    const cached = cardCache.get(entry.cardName);
    if (cached) out.set(entry.cardName, cached);
  }
  return out;
}

/** Test/debug accessor — clear the cache to force re-fetch. */
export function _resetLiveDeckCache(): void {
  cardCache.clear();
  inFlight.clear();
}
