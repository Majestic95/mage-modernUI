import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDecksStore, toRequestBody } from './store';
import type { WebDeckCardInfo } from '../api/schemas';

const FOREST: WebDeckCardInfo = {
  cardName: 'Forest',
  setCode: 'M21',
  cardNumber: '281',
  amount: 60,
};

describe('useDecksStore', () => {
  beforeEach(() => {
    useDecksStore.getState().clear();
    localStorage.clear();
  });

  afterEach(() => {
    useDecksStore.getState().clear();
  });

  it('adds a deck with a generated id and timestamp', () => {
    const deck = useDecksStore.getState().add('Forest Test', [FOREST]);
    expect(deck.id).toMatch(/[0-9a-f]{8}-/);
    expect(deck.name).toBe('Forest Test');
    expect(deck.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deck.cards).toEqual([FOREST]);
    expect(useDecksStore.getState().decks).toHaveLength(1);
  });

  it('inserts new decks at the front of the list', () => {
    useDecksStore.getState().add('First', [FOREST]);
    useDecksStore.getState().add('Second', [FOREST]);
    const decks = useDecksStore.getState().decks;
    expect(decks[0]?.name).toBe('Second');
    expect(decks[1]?.name).toBe('First');
  });

  it('falls back to "Untitled deck" on a blank name', () => {
    const deck = useDecksStore.getState().add('   ', [FOREST]);
    expect(deck.name).toBe('Untitled deck');
  });

  it('removes a deck by id', () => {
    const a = useDecksStore.getState().add('A', [FOREST]);
    useDecksStore.getState().add('B', [FOREST]);
    useDecksStore.getState().remove(a.id);
    const remaining = useDecksStore.getState().decks;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.name).toBe('B');
  });

  it('persists decks to localStorage', () => {
    useDecksStore.getState().add('Persist Me', [FOREST]);
    const raw = localStorage.getItem('mage-decks');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { state: { decks: unknown[] } };
    expect(parsed.state.decks).toHaveLength(1);
  });
});

describe('toRequestBody', () => {
  it('builds a WebDeckCardLists with author and empty sideboard', () => {
    const deck = useDecksStore.getState().add('Burn', [FOREST]);
    const body = toRequestBody(deck, 'alice');
    expect(body).toEqual({
      name: 'Burn',
      author: 'alice',
      cards: [FOREST],
      sideboard: [],
    });
  });
});
