import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinTableModal } from './JoinTableModal';
import { useAuthStore } from '../auth/store';
import { useDecksStore } from '../decks/store';
import type { WebDeckCardInfo } from '../api/schemas';

const ANON_SESSION = {
  schemaVersion: '1.7',
  token: 'tok-anon',
  username: 'guest-deadbeef',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

const FOREST: WebDeckCardInfo = {
  cardName: 'Forest',
  setCode: 'M21',
  cardNumber: '281',
  amount: 60,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('JoinTableModal', () => {
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

  it('shows an empty-state hint when no saved decks exist', () => {
    render(
      <JoinTableModal
        roomId="r"
        tableId="t"
        tableName="alice's table"
        onClose={() => {}}
        onJoined={() => {}}
      />,
    );
    expect(screen.getByText(/No saved decks/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^join$/i })).toBeDisabled();
  });

  it('submits the selected deck when Join is clicked', async () => {
    const user = userEvent.setup();
    useDecksStore.getState().add('Mono Green', [FOREST]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const onClose = vi.fn();
    const onJoined = vi.fn();
    render(
      <JoinTableModal
        roomId="r"
        tableId="t"
        tableName="alice's table"
        onClose={onClose}
        onJoined={onJoined}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^join$/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const url = String(call?.[0] ?? '');
    expect(url).toContain('/api/rooms/r/tables/t/join');
    const init = call?.[1];
    const body = init
      ? JSON.parse(init.body as string) as Record<string, unknown>
      : null;
    expect(body).toMatchObject({
      name: 'guest-deadbeef',
      skill: 1,
      deck: {
        name: 'Mono Green',
        author: 'guest-deadbeef',
        cards: [FOREST],
        sideboard: [],
      },
    });
    expect(onJoined).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces 422 UPSTREAM_REJECTED message in an alert', async () => {
    const user = userEvent.setup();
    useDecksStore.getState().add('Bad Deck', [FOREST]);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(422, {
          schemaVersion: '1.7',
          code: 'UPSTREAM_REJECTED',
          message: 'Server rejected the join (illegal deck).',
        }),
      ),
    );

    const onClose = vi.fn();
    render(
      <JoinTableModal
        roomId="r"
        tableId="t"
        tableName="alice's table"
        onClose={onClose}
        onJoined={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^join$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/illegal deck/i);
    expect(onClose).not.toHaveBeenCalled();
  });
});
