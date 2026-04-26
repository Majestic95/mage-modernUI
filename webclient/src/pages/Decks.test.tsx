import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Decks } from './Decks';
import { useAuthStore } from '../auth/store';
import { useDecksStore } from '../decks/store';

const ANON_SESSION = {
  schemaVersion: '1.4',
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
    schemaVersion: '1.4',
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
      vi.fn<typeof fetch>().mockResolvedValue(cardListing('Forest')),
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
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(200, {
          schemaVersion: '1.4',
          cards: [],
          truncated: false,
        }),
      ),
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

    render(<Decks />);
    expect(screen.getByText('Burn')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /delete burn/i }));

    expect(useDecksStore.getState().decks).toHaveLength(0);
  });
});
