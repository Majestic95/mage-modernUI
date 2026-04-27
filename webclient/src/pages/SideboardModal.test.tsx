import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SideboardModal } from './SideboardModal';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';

const ANON_SESSION = {
  schemaVersion: '1.15',
  token: 'tok-anon',
  username: 'alice',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

const TABLE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function buildSideboardInfo(overrides: Record<string, unknown> = {}) {
  return {
    deck: {
      name: 'Mono-green',
      mainList: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Forest',
          expansionSetCode: 'M21',
          cardNumber: '281',
          usesVariousArt: true,
        },
        {
          id: '11111111-1111-1111-1111-111111111112',
          name: 'Forest',
          expansionSetCode: 'M21',
          cardNumber: '281',
          usesVariousArt: true,
        },
      ],
      sideboard: [
        {
          id: '22222222-2222-2222-2222-222222222222',
          name: 'Naturalize',
          expansionSetCode: 'M21',
          cardNumber: '199',
          usesVariousArt: false,
        },
      ],
    },
    tableId: TABLE_ID,
    parentTableId: '',
    time: 600,
    limited: false,
    ...overrides,
  };
}

describe('SideboardModal', () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: ANON_SESSION,
      loading: false,
      error: null,
      verifying: false,
    });
    useGameStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when there is no pending sideboard frame', () => {
    const { container } = render(<SideboardModal />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no session, even with a pending frame', () => {
    useAuthStore.setState({ session: null });
    act(() => {
      useGameStore.setState({ pendingSideboard: buildSideboardInfo() });
    });
    const { container } = render(<SideboardModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders both main and sideboard panes with card names', () => {
    act(() => {
      useGameStore.setState({ pendingSideboard: buildSideboardInfo() });
    });
    render(<SideboardModal />);
    expect(screen.getByTestId('sideboard-main')).toHaveTextContent('Forest');
    expect(screen.getByTestId('sideboard-side')).toHaveTextContent('Naturalize');
    // Counts in pane headers.
    expect(screen.getByTestId('sideboard-main')).toHaveTextContent('Main (2)');
    expect(screen.getByTestId('sideboard-side')).toHaveTextContent('Sideboard (1)');
  });

  it('shows seconds remaining + limited flag in the header', () => {
    act(() => {
      useGameStore.setState({
        pendingSideboard: buildSideboardInfo({ time: 300, limited: true }),
      });
    });
    render(<SideboardModal />);
    expect(screen.getByText(/300s remaining/)).toBeInTheDocument();
    expect(screen.getByText(/limited/i)).toBeInTheDocument();
  });

  it('moves a card from main to sideboard on arrow click', async () => {
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ pendingSideboard: buildSideboardInfo() });
    });
    render(<SideboardModal />);

    const mainPane = screen.getByTestId('sideboard-main');
    const moveButtons = mainPane.querySelectorAll('[data-testid="sideboard-move"]');
    expect(moveButtons).toHaveLength(2);

    await user.click(moveButtons[0] as HTMLElement);

    expect(screen.getByTestId('sideboard-main')).toHaveTextContent('Main (1)');
    expect(screen.getByTestId('sideboard-side')).toHaveTextContent('Sideboard (2)');
  });

  it('submit posts collapsed deck shape to the deck-submit endpoint', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    act(() => {
      useGameStore.setState({ pendingSideboard: buildSideboardInfo() });
    });
    render(<SideboardModal />);
    await user.click(screen.getByRole('button', { name: /submit deck/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const url = String(call?.[0] ?? '');
    expect(url).toMatch(new RegExp(`/api/tables/${TABLE_ID}/deck$`));

    const body = call?.[1]
      ? JSON.parse(call[1].body as string) as Record<string, unknown>
      : null;
    expect(body).toMatchObject({
      name: 'Mono-green',
      author: '',
    });
    // Two Forest entries in the fixture roll up into one with amount=2
    // because they share name+set+number.
    const cards = (body as { cards: unknown[] }).cards as Array<Record<string, unknown>>;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      cardName: 'Forest',
      setCode: 'M21',
      cardNumber: '281',
      amount: 2,
    });
    const sb = (body as { sideboard: unknown[] }).sideboard as Array<Record<string, unknown>>;
    expect(sb).toHaveLength(1);
    expect(sb[0]).toMatchObject({ cardName: 'Naturalize', amount: 1 });
  });

  it('clears pendingSideboard on successful submit', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
    );
    act(() => {
      useGameStore.setState({ pendingSideboard: buildSideboardInfo() });
    });
    render(<SideboardModal />);

    await user.click(screen.getByRole('button', { name: /submit deck/i }));

    await waitFor(() => {
      expect(useGameStore.getState().pendingSideboard).toBeNull();
    });
  });

  it('shows the WebError message on a 422 rejection and keeps the modal open', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            schemaVersion: '1.15',
            code: 'UPSTREAM_REJECTED',
            message: 'Server refused the deck.',
          }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    act(() => {
      useGameStore.setState({ pendingSideboard: buildSideboardInfo() });
    });
    render(<SideboardModal />);
    await user.click(screen.getByRole('button', { name: /submit deck/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Server refused/);
    // Still open — pending wasn't cleared.
    expect(useGameStore.getState().pendingSideboard).not.toBeNull();
  });
});
