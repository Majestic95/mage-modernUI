import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeckEditor } from './DeckEditor';
import { useAuthStore } from '../auth/store';
import { useDecksStore } from '../decks/store';
import { _resetDeckCardDataCache } from '../decks/useDeckCardData';

const ANON_SESSION = {
  schemaVersion: '1.28',
  token: 'tok-anon',
  username: 'guest-deadbeef',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cardInfo(
  name: string,
  types: string[],
  manaValue = 0,
  setCode = 'M21',
  cardNumber = '1',
) {
  return {
    name,
    setCode,
    cardNumber,
    manaValue,
    manaCosts: [],
    rarity: 'COMMON',
    types,
    subtypes: [],
    supertypes: [],
    colors: [],
    power: '',
    toughness: '',
    startingLoyalty: '',
    rules: [],
  };
}

function cardListing(cards: ReturnType<typeof cardInfo>[]): Response {
  return jsonResponse(200, {
    schemaVersion: '1.28',
    cards,
    truncated: false,
  });
}

function makeRouter(routes: Record<string, () => Response>) {
  return vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, builder] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return Promise.resolve(builder());
      }
    }
    return Promise.resolve(jsonResponse(404, { code: 'NOT_FOUND' }));
  });
}

describe('DeckEditor', () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: ANON_SESSION,
      loading: false,
      error: null,
      verifying: false,
    });
    useDecksStore.getState().clear();
    _resetDeckCardDataCache();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows "Deck not found" when deckId is unknown', () => {
    render(<DeckEditor deckId="missing" onClose={() => {}} />);
    expect(screen.getByText('Deck not found.')).toBeInTheDocument();
  });

  it('renders mainboard cards grouped by type bucket', async () => {
    const deck = useDecksStore.getState().add('Test Deck', [
      { cardName: 'Llanowar Elves', setCode: 'M21', cardNumber: '174', amount: 4 },
      { cardName: 'Forest', setCode: 'M21', cardNumber: '281', amount: 24 },
      { cardName: 'Lightning Bolt', setCode: 'M21', cardNumber: '162', amount: 4 },
    ]);

    vi.stubGlobal(
      'fetch',
      makeRouter({
        'name=Llanowar%20Elves': () =>
          cardListing([cardInfo('Llanowar Elves', ['CREATURE'], 1)]),
        'name=Forest': () => cardListing([cardInfo('Forest', ['LAND'], 0)]),
        'name=Lightning%20Bolt': () =>
          cardListing([cardInfo('Lightning Bolt', ['INSTANT'], 1)]),
      }),
    );

    render(<DeckEditor deckId={deck.id} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('deck-bucket-Creature')).toBeInTheDocument();
      expect(screen.getByTestId('deck-bucket-Land')).toBeInTheDocument();
      expect(screen.getByTestId('deck-bucket-Instant/Sorcery')).toBeInTheDocument();
    });
  });

  it('+/− mutates qty in the saved deck', async () => {
    const user = userEvent.setup();
    const deck = useDecksStore.getState().add('Test Deck', [
      { cardName: 'Forest', setCode: 'M21', cardNumber: '281', amount: 4 },
    ]);

    vi.stubGlobal(
      'fetch',
      makeRouter({
        'name=Forest': () => cardListing([cardInfo('Forest', ['LAND'], 0)]),
      }),
    );

    render(<DeckEditor deckId={deck.id} onClose={() => {}} />);

    // Wait for the card to settle into its real bucket so button refs
    // are stable across clicks (cache-fill re-mounts the row).
    await screen.findByTestId('deck-bucket-Land');

    await user.click(screen.getByTestId('deck-editor-increment'));
    expect(useDecksStore.getState().decks[0]?.cards[0]?.amount).toBe(5);

    await user.click(screen.getByTestId('deck-editor-decrement'));
    await user.click(screen.getByTestId('deck-editor-decrement'));
    expect(useDecksStore.getState().decks[0]?.cards[0]?.amount).toBe(3);
  });

  it('delete removes a card entry from the saved deck', async () => {
    const user = userEvent.setup();
    const deck = useDecksStore.getState().add('Test Deck', [
      { cardName: 'Forest', setCode: 'M21', cardNumber: '281', amount: 4 },
      { cardName: 'Mountain', setCode: 'M21', cardNumber: '286', amount: 4 },
    ]);

    vi.stubGlobal(
      'fetch',
      makeRouter({
        'name=Forest': () =>
          cardListing([cardInfo('Forest', ['LAND'], 0, 'M21', '281')]),
        'name=Mountain': () =>
          cardListing([cardInfo('Mountain', ['LAND'], 0, 'M21', '286')]),
      }),
    );

    render(<DeckEditor deckId={deck.id} onClose={() => {}} />);

    // Wait for byName cache to fill — both cards re-mount under 'Land'
    // once metadata arrives. Querying before then would grab refs to
    // soon-to-be-unmounted rows in the 'Other' bucket.
    await screen.findByTestId('deck-bucket-Land');

    const forestRow = screen.getAllByTestId('deck-editor-card-row').find(
      (el) => el.getAttribute('data-card') === 'Forest',
    )!;
    await user.click(within(forestRow).getByTestId('deck-editor-delete'));

    expect(useDecksStore.getState().decks[0]?.cards).toHaveLength(1);
    expect(useDecksStore.getState().decks[0]?.cards[0]?.cardName).toBe('Mountain');
  });

  it('art picker swap mutates setCode + cardNumber preserving cardName + amount', async () => {
    const user = userEvent.setup();
    const deck = useDecksStore.getState().add('Test Deck', [
      { cardName: 'Forest', setCode: 'M21', cardNumber: '281', amount: 24 },
    ]);

    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/cards/printings': () =>
          cardListing([
            cardInfo('Forest', ['LAND'], 0, 'M21', '281'),
            cardInfo('Forest', ['LAND'], 0, 'UNF', '347'),
            cardInfo('Forest', ['LAND'], 0, 'WOC', '120'),
          ]),
        'name=Forest': () =>
          cardListing([cardInfo('Forest', ['LAND'], 0, 'M21', '281')]),
      }),
    );

    render(<DeckEditor deckId={deck.id} onClose={() => {}} />);

    // Wait for the deck-card-data fetch to settle — until then the
    // card sits in the 'Other' bucket; once metadata arrives it
    // re-mounts under 'Land', invalidating any earlier button ref.
    await screen.findByTestId('deck-bucket-Land');

    await user.click(screen.getByTestId('deck-editor-swap-art'));
    await screen.findByTestId('art-picker-modal');
    await waitFor(() => {
      expect(screen.getAllByTestId('art-picker-tile')).toHaveLength(3);
    });

    // Pick the UNF printing.
    const unfTile = screen
      .getAllByTestId('art-picker-tile')
      .find((el) => el.getAttribute('data-set') === 'UNF')!;
    await user.click(unfTile);

    // Modal closes; saved deck reflects new printing; cardName + amount preserved.
    expect(screen.queryByTestId('art-picker-modal')).not.toBeInTheDocument();
    const after = useDecksStore.getState().decks[0]?.cards[0];
    expect(after?.cardName).toBe('Forest');
    expect(after?.setCode).toBe('UNF');
    expect(after?.cardNumber).toBe('347');
    expect(after?.amount).toBe(24);
  });

  it('rename deck updates the saved name on Enter', async () => {
    const user = userEvent.setup();
    const deck = useDecksStore.getState().add('Original Name', [
      { cardName: 'Forest', setCode: 'M21', cardNumber: '281', amount: 4 },
    ]);

    vi.stubGlobal(
      'fetch',
      makeRouter({
        'name=Forest': () => cardListing([cardInfo('Forest', ['LAND'], 0)]),
      }),
    );

    render(<DeckEditor deckId={deck.id} onClose={() => {}} />);

    await user.click(await screen.findByTestId('deck-editor-rename'));
    const input = screen.getByTestId('deck-editor-rename-input');
    await user.clear(input);
    await user.type(input, 'New Name{enter}');

    expect(useDecksStore.getState().decks[0]?.name).toBe('New Name');
  });

  it('back button calls onClose', async () => {
    const user = userEvent.setup();
    const deck = useDecksStore.getState().add('Test', [
      { cardName: 'Forest', setCode: 'M21', cardNumber: '281', amount: 4 },
    ]);
    const onClose = vi.fn();

    vi.stubGlobal(
      'fetch',
      makeRouter({
        'name=Forest': () => cardListing([cardInfo('Forest', ['LAND'], 0)]),
      }),
    );

    render(<DeckEditor deckId={deck.id} onClose={onClose} />);

    await user.click(screen.getByTestId('deck-editor-back'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sideboard slot 0 is labeled Commander when commanderHint applies', async () => {
    const deck = useDecksStore.getState().add(
      'Commander Deck',
      Array(99)
        .fill(0)
        .map((_, i) => ({
          cardName: 'Forest',
          setCode: 'M21',
          cardNumber: '281',
          amount: 1,
          // index used to deduplicate in React keys; not on wire
          ...(i === 0 ? {} : {}),
        })),
      [
        { cardName: 'Krenko, Mob Boss', setCode: 'M14', cardNumber: '147', amount: 1 },
      ],
    );

    vi.stubGlobal(
      'fetch',
      makeRouter({
        'name=Forest': () => cardListing([cardInfo('Forest', ['LAND'], 0)]),
        'name=Krenko': () =>
          cardListing([cardInfo('Krenko, Mob Boss', ['CREATURE'], 4)]),
      }),
    );

    render(<DeckEditor deckId={deck.id} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('deck-bucket-Commander')).toBeInTheDocument();
    });
  });
});

describe('end-to-end printing identity through deck submission', () => {
  beforeEach(() => {
    useDecksStore.getState().clear();
    localStorage.clear();
  });

  it('art swap persists in toRequestBody output (what gets sent to server)', async () => {
    const { toRequestBody } = await import('../decks/store');
    const deck = useDecksStore.getState().add('Forest Test', [
      { cardName: 'Forest', setCode: 'M21', cardNumber: '281', amount: 24 },
    ]);
    // Simulate the art swap that DeckEditor performs.
    useDecksStore.getState().update(deck.id, {
      cards: [
        { cardName: 'Forest', setCode: 'UNF', cardNumber: '347', amount: 24 },
      ],
    });
    const updated = useDecksStore.getState().decks[0]!;
    const body = toRequestBody(updated, 'alice');
    // The wire body MUST carry the user's chosen printing — server's
    // DeckMapper reads exactly these fields and builds the engine
    // Card from them, so end-to-end printing identity depends on
    // these values being preserved through the store mutation.
    expect(body.cards[0]).toEqual({
      cardName: 'Forest',
      setCode: 'UNF',
      cardNumber: '347',
      amount: 24,
    });
  });
});
