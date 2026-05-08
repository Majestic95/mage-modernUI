import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSetByCode } from './scryfallClient';

const originalFetch = globalThis.fetch;

describe('scryfallClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('fetches every page for a set search', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('/sets/tst')) {
        return jsonResponse({
          code: 'tst',
          name: 'Test Set',
          released_at: '2026-01-01',
          set_type: 'expansion',
        });
      }
      if (href.includes('page=2')) {
        return jsonResponse({
          data: [scryfallCard('Second Card', '2')],
          has_more: false,
        });
      }
      return jsonResponse({
        data: [scryfallCard('First Card', '1')],
        has_more: true,
        next_page: 'https://api.scryfall.com/cards/search?page=2',
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const promise = fetchSetByCode('TST');
    await vi.advanceTimersByTimeAsync(100);
    const set = await promise;

    expect(set.cards.map((card) => card.name)).toEqual(['First Card', 'Second Card']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function scryfallCard(name: string, collectorNumber: string) {
  return {
    name,
    set: 'tst',
    collector_number: collectorNumber,
    rarity: 'common',
    layout: 'normal',
    mana_cost: '',
    type_line: 'Sorcery',
    oracle_text: '',
    keywords: [],
    reprint: false,
  };
}
