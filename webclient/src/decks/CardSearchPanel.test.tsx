import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardSearchPanel } from './CardSearchPanel';
import { useAuthStore } from '../auth/store';

const ANON_SESSION = {
  schemaVersion: '1.29',
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

function cardResult(name: string, setCode = 'M21', cardNumber = '1') {
  return {
    name,
    setCode,
    cardNumber,
    manaValue: 1,
    manaCosts: ['{R}'],
    rarity: 'COMMON',
    types: ['INSTANT'],
    subtypes: [],
    supertypes: [],
    colors: ['R'],
    power: '',
    toughness: '',
    startingLoyalty: '',
    rules: [],
  };
}

function listing(cards: ReturnType<typeof cardResult>[], truncated = false): Response {
  return jsonResponse(200, {
    schemaVersion: '1.29',
    cards,
    truncated,
  });
}

describe('CardSearchPanel', () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: ANON_SESSION,
      loading: false,
      error: null,
      verifying: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the input and stays empty until 2-char query', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      listing([cardResult('Lightning Bolt')]),
    );
    vi.stubGlobal('fetch', fetchSpy);

    render(<CardSearchPanel onAdd={() => {}} />);
    expect(screen.getByTestId('card-search-input')).toBeInTheDocument();
    // 1 char must NOT trigger a fetch (server-side gate is mirrored).
    await user.type(screen.getByTestId('card-search-input'), 'L');
    // Wait past the debounce + a buffer to be sure no fetch fired.
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('debounces typing and fires one search per quiescent query', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      listing([cardResult('Lightning Bolt')]),
    );
    vi.stubGlobal('fetch', fetchSpy);

    render(<CardSearchPanel onAdd={() => {}} />);
    await user.type(screen.getByTestId('card-search-input'), 'Bolt');
    // Wait for debounce.
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    // URL hits the search endpoint with the typed query.
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain('/api/cards/search');
    expect(url).toContain('q=Bolt');
  });

  it('renders results and "+ Add" emits onAdd with the picked card', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        listing([cardResult('Lightning Bolt', 'M21', '162')]),
      ),
    );

    render(<CardSearchPanel onAdd={onAdd} />);
    await user.type(screen.getByTestId('card-search-input'), 'Bolt');
    await screen.findByTestId('card-search-result');

    await user.click(screen.getByTestId('card-search-add'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Lightning Bolt',
        setCode: 'M21',
        cardNumber: '162',
      }),
    );
  });

  it('clearing query via X button resets results', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        listing([cardResult('Lightning Bolt')]),
      ),
    );

    render(<CardSearchPanel onAdd={() => {}} />);
    await user.type(screen.getByTestId('card-search-input'), 'Bolt');
    await screen.findByTestId('card-search-result');

    await user.click(screen.getByTestId('card-search-clear'));
    expect(screen.getByTestId('card-search-input')).toHaveValue('');
    expect(screen.queryByTestId('card-search-results')).not.toBeInTheDocument();
  });

  it('shows truncation notice when server flags truncated', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        listing([cardResult('Goblin King'), cardResult('Goblin Guide')], true),
      ),
    );

    render(<CardSearchPanel onAdd={() => {}} />);
    await user.type(screen.getByTestId('card-search-input'), 'Goblin');
    await screen.findByTestId('card-search-results');
    expect(screen.getByText(/Showing the first/)).toBeInTheDocument();
  });

  it('shows empty-state when zero results and no error', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(listing([])),
    );

    render(<CardSearchPanel onAdd={() => {}} />);
    await user.type(screen.getByTestId('card-search-input'), 'Zzzznonexistent');
    expect(await screen.findByTestId('card-search-empty')).toHaveTextContent(
      'Zzzznonexistent',
    );
  });

  it('drops stale responses if a faster later query arrives', async () => {
    const user = userEvent.setup();
    let resolveFirst: (v: Response) => void = () => {};
    const slowFirst = new Promise<Response>((res) => { resolveFirst = res; });
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => slowFirst)
      .mockResolvedValueOnce(listing([cardResult('Forest', 'M21', '281')]));
    vi.stubGlobal('fetch', fetchSpy);

    render(<CardSearchPanel onAdd={() => {}} />);
    // Type "Bo" → first slow fetch fires after debounce.
    await user.type(screen.getByTestId('card-search-input'), 'Bo');
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // Type more to trigger a second fetch (will resolve immediately).
    await user.clear(screen.getByTestId('card-search-input'));
    await user.type(screen.getByTestId('card-search-input'), 'Forest');
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    // Wait for the second fetch's results to render.
    await screen.findByTestId('card-search-result');
    // Now resolve the stale first fetch with a different result —
    // the panel must NOT replace the visible results with stale data.
    resolveFirst(listing([cardResult('Bolt', 'M21', '162')]));
    // Give microtasks a chance to flush.
    await new Promise((r) => setTimeout(r, 10));
    // Visible result is still the Forest from the second query.
    expect(
      screen.getByTestId('card-search-result').getAttribute('data-card'),
    ).toBe('Forest');
  });
});
