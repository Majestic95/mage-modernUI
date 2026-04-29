import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Decks } from './Decks';
import { useAuthStore } from '../auth/store';
import { useDecksStore } from '../decks/store';

const ANON_SESSION = {
  schemaVersion: '1.15',
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
    schemaVersion: '1.15',
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
 * Slice 72-B — Decks page now fires {@code /api/server/state} on mount
 * (for the format-picker dropdown), in addition to per-card lookups.
 * Use a router that returns a FRESH Response per call so different
 * URLs get different bodies and mockResolvedValue's "same object
 * reference" body-already-read trap doesn't fire.
 */
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

describe('Decks page', () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: ANON_SESSION,
      loading: false,
      error: null,
      verifying: false,
    });
    useDecksStore.getState().clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the import form and empty saved-list state', () => {
    render(<Decks />);
    expect(screen.getByPlaceholderText(/Deck name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import deck/i })).toBeInTheDocument();
    expect(screen.getByText(/No decks yet/i)).toBeInTheDocument();
  });

  it('imports a parsed deck end-to-end', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
        '/api/cards': () => cardListing('Forest'),
      }),
    );

    render(<Decks />);

    await user.type(screen.getByPlaceholderText(/Deck name/i), 'Mono Green');
    await user.type(
      screen.getByPlaceholderText(/Lightning Bolt/i),
      '4 Forest{enter}20 Forest',
    );
    await user.click(screen.getByRole('button', { name: /import deck/i }));

    await waitFor(() => {
      expect(useDecksStore.getState().decks).toHaveLength(1);
    });
    const deck = useDecksStore.getState().decks[0]!;
    expect(deck.name).toBe('Mono Green');
    // Resolver merges duplicate names: 4 Forest + 20 Forest → 24 Forest.
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0]?.amount).toBe(24);
  });

  it('shows parser errors without persisting', async () => {
    const user = userEvent.setup();
    render(<Decks />);
    await user.type(screen.getByPlaceholderText(/Lightning Bolt/i), 'garbage');
    await user.click(screen.getByRole('button', { name: /import deck/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Line 1/);
    expect(useDecksStore.getState().decks).toHaveLength(0);
  });

  it('shows a missing-cards error when resolution returns empty', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      makeRouter({
        '/api/server/state': () => jsonResponse(200, SERVER_STATE_BODY),
        '/api/cards': () =>
          jsonResponse(200, {
            schemaVersion: '1.15',
            cards: [],
            truncated: false,
          }),
      }),
    );

    render(<Decks />);
    await user.type(screen.getByPlaceholderText(/Lightning Bolt/i), '4 Nonexistent');
    await user.click(screen.getByRole('button', { name: /import deck/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Nonexistent/);
    expect(useDecksStore.getState().decks).toHaveLength(0);
  });

  it('removes a deck via the delete button', async () => {
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
    expect(screen.getByText('Burn')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /delete burn/i }));

    expect(useDecksStore.getState().decks).toHaveLength(0);
  });

  // Slice 72-B
  it('renders a format picker per saved deck once server-state loads', async () => {
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
    // The picker shows a placeholder option until the user picks a
    // format; legality affordance only fires once a non-empty
    // deckType is selected.
    const picker = await screen.findByRole('combobox', { name: /Format for Burn/ });
    expect(picker).toBeInTheDocument();
    // Both server-side deckTypes are options under their respective
    // optgroups (Constructed / Variant Magic).
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
    const picker = await screen.findByRole('combobox', { name: /Format for Burn/ });
    await user.selectOptions(picker, 'Constructed - Vintage');

    // The validate fetch is debounced 250 ms — wait for it.
    await waitFor(
      () => {
        expect(validateCalled).toBe(true);
      },
      { timeout: 1500 },
    );
    expect(await screen.findByText(/Legal/)).toBeInTheDocument();
  });
});
