import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Decks } from './Decks';
import { useAuthStore } from '../auth/store';
import { useDecksStore } from '../decks/store';
import { _resetLiveDeckCache } from '../lobby/useLiveDecks';
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

function cardListing(name: string): Response {
  return jsonResponse(200, {
    schemaVersion: '1.28',
    cards: [
      {
        name,
        setCode: 'M21',
        cardNumber: '281',
        manaValue: 0,
        manaCosts: [],
        rarity: 'COMMON',
        types: ['LAND'],
        subtypes: ['Forest'],
        supertypes: ['BASIC'],
        colors: [],
        power: '',
        toughness: '',
        startingLoyalty: '',
        rules: [],
      },
    ],
    truncated: false,
  });
}

const SERVER_STATE_BODY = {
  schemaVersion: '1.21',
  gameTypes: [],
  tournamentTypes: [],
  playerTypes: [],
  deckTypes: ['Constructed - Vintage', 'Variant Magic - Commander'],
  draftCubes: [],
  testMode: false,
};

/**
 * Slice DB-1a — the workbench fires many wire / Scryfall calls on
 * mount (server-state for the format picker, /api/cards for every
 * unique commander + every unique card in the selected deck via
 * useLiveDecks AND useDeckCardData, /api/cards/search via the
 * embedded DeckEditor's CardSearchPanel, Scryfall by-name for the
 * CommanderPreviewPanel). The router returns a sensible default
 * for any URL not explicitly matched so the page doesn't error
 * spam in test output.
 */
function makeRouter(routes: Record<string, () => Response>) {
  return vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, builder] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return Promise.resolve(builder());
      }
    }
    // Generic /api/cards fallback so per-card metadata fetches don't
    // 404-spam the test output. Returns one Forest entry — the byName
    // caches just populate with that fixture, which is fine for our
    // assertions (we don't depend on specific metadata).
    if (url.includes('/api/cards?name=')) {
      return Promise.resolve(cardListing('Forest'));
    }
    if (url.includes('/api/cards/search')) {
      return Promise.resolve(
        jsonResponse(200, {
          schemaVersion: '1.28',
          cards: [],
          truncated: false,
        }),
      );
    }
    if (url.includes('api.scryfall.com')) {
      return Promise.resolve(jsonResponse(200, {}));
    }
    return Promise.resolve(jsonResponse(404, { code: 'NOT_FOUND' }));
  });
}

describe('Decks workbench (slice DB-1a)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: ANON_SESSION,
      loading: false,
      error: null,
      verifying: false,
    });
    useDecksStore.getState().clear();
    _resetLiveDeckCache();
    _resetDeckCardDataCache();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the workbench with empty rail state when no decks', () => {
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
      }),
    );
    render(<Decks />);
    expect(screen.getByTestId('decks-workbench')).toBeInTheDocument();
    expect(screen.getByTestId('my-decks-panel')).toBeInTheDocument();
    expect(screen.getByTestId('my-decks-empty')).toBeInTheDocument();
    expect(screen.getByTestId('decks-workbench-editor-empty')).toBeInTheDocument();
  });

  it('clicking New Deck in the rail opens the import modal', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
      }),
    );
    render(<Decks />);
    await user.click(screen.getByTestId('my-decks-new-deck-button'));
    expect(screen.getByTestId('new-deck-modal')).toBeInTheDocument();
    expect(screen.getByTestId('new-deck-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('new-deck-text-input')).toBeInTheDocument();
  });

  it('importing a parsed deck via the modal adds it, closes modal, and opens it', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
        '/api/cards?name=Forest': () => cardListing('Forest'),
      }),
    );
    render(<Decks />);
    await user.click(screen.getByTestId('my-decks-new-deck-button'));
    await user.type(screen.getByTestId('new-deck-name-input'), 'Mono Green');
    await user.type(
      screen.getByTestId('new-deck-text-input'),
      '4 Forest{enter}20 Forest',
    );
    await user.click(screen.getByTestId('new-deck-submit'));

    await waitFor(() => {
      expect(useDecksStore.getState().decks).toHaveLength(1);
    });
    const deck = useDecksStore.getState().decks[0]!;
    expect(deck.name).toBe('Mono Green');
    // Resolver merges duplicate names: 4 Forest + 20 Forest → 24 Forest.
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0]?.amount).toBe(24);

    // Modal closes, header binds to the new deck.
    expect(screen.queryByTestId('new-deck-modal')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('deck-builder-rename')).toHaveTextContent(
        'Mono Green',
      );
    });
  });

  it('parser errors keep the modal open with an alert', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
      }),
    );
    render(<Decks />);
    await user.click(screen.getByTestId('my-decks-new-deck-button'));
    await user.type(screen.getByTestId('new-deck-text-input'), 'garbage');
    await user.click(screen.getByTestId('new-deck-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Line 1/);
    expect(useDecksStore.getState().decks).toHaveLength(0);
    expect(screen.getByTestId('new-deck-modal')).toBeInTheDocument();
  });

  it('missing-cards errors keep the modal open with an alert', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
        '/api/cards?name=Nonexistent': () =>
          jsonResponse(200, {
            schemaVersion: '1.28',
            cards: [],
            truncated: false,
          }),
      }),
    );
    render(<Decks />);
    await user.click(screen.getByTestId('my-decks-new-deck-button'));
    await user.type(
      screen.getByTestId('new-deck-text-input'),
      '4 Nonexistent',
    );
    await user.click(screen.getByTestId('new-deck-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Nonexistent/);
    expect(useDecksStore.getState().decks).toHaveLength(0);
    expect(screen.getByTestId('new-deck-modal')).toBeInTheDocument();
  });

  it('deletes the active deck via the header button (with confirm)', async () => {
    const user = userEvent.setup();
    useDecksStore.getState().add('Burn', [
      { cardName: 'Lightning Bolt', setCode: 'LEA', cardNumber: '161', amount: 4 },
    ]);
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
      }),
    );

    render(<Decks />);
    expect(screen.getByTestId('deck-builder-rename')).toHaveTextContent('Burn');

    await user.click(screen.getByTestId('deck-builder-delete'));
    expect(screen.getByTestId('delete-confirm-modal')).toBeInTheDocument();
    await user.click(screen.getByTestId('delete-confirm-confirm'));

    expect(useDecksStore.getState().decks).toHaveLength(0);
    await waitFor(() => {
      expect(screen.getByTestId('decks-workbench-editor-empty')).toBeInTheDocument();
    });
  });

  it('renders a format picker in the header once server-state loads', async () => {
    useDecksStore.getState().add('Burn', [
      { cardName: 'Lightning Bolt', setCode: 'LEA', cardNumber: '161', amount: 4 },
    ]);
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
      }),
    );

    render(<Decks />);
    const picker = await screen.findByTestId('deck-builder-format-picker');
    expect(picker).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Vintage/ })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Commander/ })).toBeInTheDocument();
    });
  });

  it('fires pre-flight validate when the user picks a format', async () => {
    useDecksStore.getState().add('Burn', [
      { cardName: 'Lightning Bolt', setCode: 'LEA', cardNumber: '161', amount: 4 },
    ]);
    let validateCalled = false;
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
        '/api/decks/validate': () => {
          validateCalled = true;
          return jsonResponse(200, {
            schemaVersion: '1.21',
            valid: true,
            partlyLegal: true,
            errors: [],
          });
        },
      }),
    );

    const user = userEvent.setup();
    render(<Decks />);
    const picker = await screen.findByTestId('deck-builder-format-picker');
    await user.selectOptions(picker, 'Constructed - Vintage');

    await waitFor(
      () => {
        expect(validateCalled).toBe(true);
      },
      { timeout: 1500 },
    );
    await screen.findByText(/Legal/);
  });

  it('selecting a different deck in the rail switches the active deck', async () => {
    const user = userEvent.setup();
    useDecksStore.getState().add('Burn', [
      { cardName: 'Lightning Bolt', setCode: 'LEA', cardNumber: '161', amount: 4 },
    ]);
    useDecksStore.getState().add('Mono Green', [
      { cardName: 'Forest', setCode: 'M21', cardNumber: '281', amount: 24 },
    ]);
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
      }),
    );

    render(<Decks />);
    // useDecksStore.add unshifts, so the most-recently-added deck
    // ("Mono Green") is at index 0 and is the workbench's initial
    // active deck.
    expect(screen.getByTestId('deck-builder-rename')).toHaveTextContent(
      'Mono Green',
    );

    const rows = screen.getAllByTestId('my-decks-row');
    const burnRow = rows.find((r) => within(r).queryByText('Burn'));
    expect(burnRow).toBeDefined();
    await user.click(burnRow!);

    await waitFor(() => {
      expect(screen.getByTestId('deck-builder-rename')).toHaveTextContent('Burn');
    });
  });

  it('renames the active deck via the header rename button', async () => {
    const user = userEvent.setup();
    useDecksStore.getState().add('Old Name', [
      { cardName: 'Forest', setCode: 'M21', cardNumber: '281', amount: 4 },
    ]);
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
      }),
    );

    render(<Decks />);
    await user.click(screen.getByTestId('deck-builder-rename'));
    const input = screen.getByTestId('deck-builder-rename-input');
    await user.clear(input);
    await user.type(input, 'New Name{enter}');

    expect(useDecksStore.getState().decks[0]?.name).toBe('New Name');
    await waitFor(() => {
      expect(screen.getByTestId('deck-builder-rename')).toHaveTextContent(
        'New Name',
      );
    });
  });

  it('cancelling the New Deck modal closes it without side effects', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
      }),
    );
    render(<Decks />);
    await user.click(screen.getByTestId('my-decks-new-deck-button'));
    expect(screen.getByTestId('new-deck-modal')).toBeInTheDocument();
    await user.click(screen.getByTestId('new-deck-cancel'));
    expect(screen.queryByTestId('new-deck-modal')).not.toBeInTheDocument();
    expect(useDecksStore.getState().decks).toHaveLength(0);
  });

  // fix-2 A1 — switching rail rows during an in-flight rename must
  // commit the typed name to the ORIGINAL deck, not silently lose it
  // or write it to the newly-selected deck.
  it('rail-switch mid-rename commits the typed name to the original deck', async () => {
    const user = userEvent.setup();
    useDecksStore.getState().add('Burn', [
      { cardName: 'Lightning Bolt', setCode: 'LEA', cardNumber: '161', amount: 4 },
    ]);
    useDecksStore.getState().add('Mono Green', [
      { cardName: 'Forest', setCode: 'M21', cardNumber: '281', amount: 24 },
    ]);
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
      }),
    );

    render(<Decks />);
    // useDecksStore.add unshifts → "Mono Green" is active first.
    expect(screen.getByTestId('deck-builder-rename')).toHaveTextContent(
      'Mono Green',
    );

    // Open the rename input, type a new name, but DON'T press Enter
    // or blur. Then click the other deck in the rail.
    await user.click(screen.getByTestId('deck-builder-rename'));
    const input = screen.getByTestId('deck-builder-rename-input');
    await user.clear(input);
    await user.type(input, 'Forest Stomp');

    const rows = screen.getAllByTestId('my-decks-row');
    const burnRow = rows.find((r) => within(r).queryByText('Burn'));
    await user.click(burnRow!);

    // The rename should have committed to the ORIGINAL deck ("Mono
    // Green" → "Forest Stomp"), not corrupted "Burn".
    await waitFor(() => {
      const decks = useDecksStore.getState().decks;
      const monoGreen = decks.find((d) =>
        d.cards.some((c) => c.cardName === 'Forest'),
      );
      const burn = decks.find((d) =>
        d.cards.some((c) => c.cardName === 'Lightning Bolt'),
      );
      expect(monoGreen?.name).toBe('Forest Stomp');
      expect(burn?.name).toBe('Burn');
    });
  });

  // fix-2 B1 — Cmd/Ctrl+Enter inside NewDeckModal submits the form.
  it('Cmd+Enter inside NewDeckModal submits the import', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
        '/api/cards?name=Forest': () => cardListing('Forest'),
      }),
    );
    render(<Decks />);
    await user.click(screen.getByTestId('my-decks-new-deck-button'));
    await user.type(screen.getByTestId('new-deck-name-input'), 'Hotkey Deck');
    await user.click(screen.getByTestId('new-deck-text-input'));
    await user.type(screen.getByTestId('new-deck-text-input'), '4 Forest');
    // Cmd+Enter (mac) — userEvent's keyboard supports modifier syntax.
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => {
      expect(useDecksStore.getState().decks).toHaveLength(1);
    });
    expect(useDecksStore.getState().decks[0]?.name).toBe('Hotkey Deck');
  });

  // fix-2 A3 — color-identity gate blocks adds outside the
  // commander's color identity in a Commander deck (sideboard[0]
  // present). Surfaces an alert and does NOT mutate the mainboard.
  it('color-identity gate blocks off-color adds when a commander is present', async () => {
    const user = userEvent.setup();
    // Seed a mono-green commander deck: commander in sideboard slot 0,
    // an existing mainboard card so the editor renders, and we'll try
    // to add a red card via search.
    useDecksStore.getState().add(
      'Mono-Green EDH',
      [{ cardName: 'Forest', setCode: 'M21', cardNumber: '281', amount: 1 }],
      [{ cardName: 'Yeva, Nature\'s Herald', setCode: 'M13', cardNumber: '203', amount: 1 }],
    );

    // Router: server state, byName lookups for the seeded cards,
    // search returns a single red card (Lightning Bolt).
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation((input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/server/state')) {
          return Promise.resolve(jsonResponse(200, SERVER_STATE_BODY));
        }
        if (url.includes("name=Yeva")) {
          return Promise.resolve(
            jsonResponse(200, {
              schemaVersion: '1.28',
              cards: [{
                name: "Yeva, Nature's Herald",
                setCode: 'M13', cardNumber: '203',
                manaValue: 3, manaCosts: ['{2}{G}'], rarity: 'RARE',
                types: ['CREATURE'], subtypes: ['Elf', 'Druid'], supertypes: ['LEGENDARY'],
                colors: ['G'], power: '2', toughness: '4', startingLoyalty: '', rules: [],
              }],
              truncated: false,
            }),
          );
        }
        if (url.includes('name=Forest')) {
          return Promise.resolve(cardListing('Forest'));
        }
        if (url.includes('/api/cards/search')) {
          return Promise.resolve(jsonResponse(200, {
            schemaVersion: '1.28',
            cards: [{
              name: 'Lightning Bolt',
              setCode: 'M21', cardNumber: '162',
              manaValue: 1, manaCosts: ['{R}'], rarity: 'COMMON',
              types: ['INSTANT'], subtypes: [], supertypes: [],
              colors: ['R'], power: '', toughness: '', startingLoyalty: '', rules: [],
            }],
            truncated: false,
          }));
        }
        return Promise.resolve(jsonResponse(404, { code: 'NOT_FOUND' }));
      }),
    );

    render(<Decks />);
    // Wait for the commander metadata to land so the gate has the
    // colors lookup populated.
    await screen.findByTestId('deck-builder-rename');
    await waitFor(() => {
      // search for the red card
      // - Type into card-search input
      // - The result should appear with "+ Add"
    });
    await user.type(screen.getByTestId('card-search-input'), 'Lightning');
    await screen.findByTestId('card-search-result');
    await user.click(screen.getByTestId('card-search-add'));

    // Add was blocked: mainboard still just has Forest.
    await screen.findByTestId('deck-editor-add-blocked');
    const after = useDecksStore.getState().decks[0]?.cards ?? [];
    expect(after.map((c) => c.cardName)).toEqual(['Forest']);
  });
});
