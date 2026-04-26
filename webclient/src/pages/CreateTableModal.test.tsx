import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateTableModal } from './CreateTableModal';
import { useAuthStore } from '../auth/store';
import type { WebServerState } from '../api/schemas';

const ANON_SESSION = {
  schemaVersion: '1.8',
  token: 'tok-anon',
  username: 'guest-deadbeef',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

const SERVER_STATE: WebServerState = {
  schemaVersion: '1.8',
  gameTypes: [
    {
      name: 'Two Player Duel',
      minPlayers: 2,
      maxPlayers: 2,
      numTeams: 0,
      playersPerTeam: 0,
      useRange: false,
      useAttackOption: false,
    },
    {
      name: 'Free For All',
      minPlayers: 3,
      maxPlayers: 4,
      numTeams: 0,
      playersPerTeam: 0,
      useRange: false,
      useAttackOption: false,
    },
  ],
  tournamentTypes: [],
  playerTypes: ['Human'],
  deckTypes: ['Constructed - Vintage', 'Constructed - Standard'],
  draftCubes: [],
  testMode: false,
};

const ROOM_ID = '00000000-0000-0000-0000-000000000000';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tableResponse(): Response {
  return jsonResponse(200, {
    tableId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    tableName: "guest-deadbeef's table",
    gameType: 'Two Player Duel',
    deckType: 'Constructed - Vintage',
    tableState: 'WAITING',
    createTime: '2026-04-26T00:00:00Z',
    controllerName: 'guest-deadbeef',
    skillLevel: 'CASUAL',
    isTournament: false,
    passworded: false,
    spectatorsAllowed: true,
    rated: false,
    limited: false,
    seats: [],
  });
}

describe('CreateTableModal', () => {
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

  it('renders the form with game type and deck type dropdowns', () => {
    const noop = () => {};
    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={noop}
        onCreated={noop}
      />,
    );

    expect(screen.getByRole('heading', { name: /create table/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Two Player Duel' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Constructed - Vintage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('submits HUMAN+COMPUTER seats then auto-fills the AI seat', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse()) // POST /tables
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // POST /ai
    vi.stubGlobal('fetch', fetchMock);

    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    // Two sequential calls: create-table then add-ai.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const createCall = fetchMock.mock.calls[0];
    const createUrl = String(createCall?.[0] ?? '');
    expect(createUrl).toMatch(/\/api\/rooms\/[^/]+\/tables$/);
    const createBody = createCall?.[1]
      ? JSON.parse(createCall[1].body as string) as Record<string, unknown>
      : null;
    expect(createBody).toMatchObject({
      gameType: 'Two Player Duel',
      deckType: 'Constructed - Vintage',
      winsNeeded: 1,
      seats: ['HUMAN', 'COMPUTER_MONTE_CARLO'],
    });

    const aiCall = fetchMock.mock.calls[1];
    const aiUrl = String(aiCall?.[0] ?? '');
    expect(aiUrl).toMatch(/\/tables\/[^/]+\/ai$/);
    const aiBody = aiCall?.[1]
      ? JSON.parse(aiCall[1].body as string) as Record<string, unknown>
      : null;
    expect(aiBody).toEqual({ playerType: 'COMPUTER_MONTE_CARLO' });

    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps modal open with warning when AI add fails after create', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse())
      .mockResolvedValueOnce(
        jsonResponse(422, {
          schemaVersion: '1.8',
          code: 'UPSTREAM_REJECTED',
          message: 'Server rejected the AI seat.',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /AI failed to join/i,
    );
    // Lobby refresh fires so user sees the partial table.
    expect(onCreated).toHaveBeenCalled();
    // Modal stays open so the user can react.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('omits the seats field when AI checkbox is unchecked', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(tableResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    await user.click(screen.getByLabelText(/add ai opponent/i));
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const call = fetchMock.mock.calls[0];
    const init = call?.[1];
    const body = init ? JSON.parse(init.body as string) as Record<string, unknown> : null;
    expect(body && 'seats' in body).toBe(false);
  });

  it('disables the AI checkbox for >2-seat games', async () => {
    const user = userEvent.setup();
    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    // Switch to Free For All (3-4 players)
    await user.selectOptions(
      screen.getByRole('combobox', { name: /game type/i }),
      'Free For All',
    );

    expect(screen.getByLabelText(/add ai opponent/i)).toBeDisabled();
  });

  it('shows the WebError message on a 422 rejection', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(422, {
          schemaVersion: '1.8',
          code: 'UPSTREAM_REJECTED',
          message: 'Server refused to create the table.',
        }),
      ),
    );

    const onClose = vi.fn();
    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={onClose}
        onCreated={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Server refused to create the table/,
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
