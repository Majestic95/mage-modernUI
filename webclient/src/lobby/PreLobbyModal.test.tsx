/**
 * Slice L4 — locks the slim PreLobbyModal's create flow:
 * - default format / mode selection
 * - HUMAN-only vs AI-fill seats array shape
 * - sequential /ai POST loop when AI checkbox is on
 * - onCreated(tableId) callback receives the new id
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreLobbyModal } from './PreLobbyModal';
import { useAuthStore } from '../auth/store';
import type { WebServerState } from '../api/schemas';

const ANON_SESSION = {
  schemaVersion: '1.27',
  token: 'tok-anon',
  username: 'guest-deadbeef',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-05-09T00:00:00Z',
};

const SERVER_STATE: WebServerState = {
  schemaVersion: '1.27',
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
  deckTypes: [
    'Constructed - Vintage',
    'Constructed - Standard',
    'Commander',
  ],
  draftCubes: [],
  testMode: false,
  registrationEnabled: false,
};

const ROOM_ID = '00000000-0000-0000-0000-000000000000';
const NEW_TABLE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function tableResponse(): Response {
  return new Response(
    JSON.stringify({
      tableId: NEW_TABLE_ID,
      tableName: "guest-deadbeef's table",
      gameType: 'Free For All',
      deckType: 'Commander',
      tableState: 'WAITING',
      createTime: '2026-05-02T00:00:00Z',
      controllerName: 'guest-deadbeef',
      skillLevel: 'CASUAL',
      isTournament: false,
      passworded: false,
      spectatorsAllowed: true,
      rated: false,
      limited: false,
      seats: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('PreLobbyModal', () => {
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

  it('defaults to Commander format and Free For All mode when present', () => {
    render(
      <PreLobbyModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    expect(
      (screen.getByTestId('pre-lobby-deck-type') as HTMLSelectElement).value,
    ).toBe('Commander');
    expect(
      (screen.getByTestId('pre-lobby-game-type') as HTMLSelectElement).value,
    ).toBe('Free For All');
  });

  it('builds a HUMAN-only seats array when AI checkbox is off', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse());
    vi.stubGlobal('fetch', fetchMock);

    const onCreated = vi.fn();
    render(
      <PreLobbyModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );

    await user.click(screen.getByTestId('pre-lobby-create'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      gameType: 'Free For All',
      deckType: 'Commander',
      winsNeeded: 1,
      seats: ['HUMAN', 'HUMAN', 'HUMAN', 'HUMAN'],
    });
    expect(onCreated).toHaveBeenCalledWith(NEW_TABLE_ID);
  });

  it('builds COMPUTER seats and posts /ai for each when AI seat count is set to max', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse()) // POST /tables
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // POST /ai #1
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // POST /ai #2
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // POST /ai #3
    vi.stubGlobal('fetch', fetchMock);

    render(
      <PreLobbyModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    // Set AI seat count to 3 (= max for a 4-player table).
    const aiSeatCount = screen.getByTestId(
      'pre-lobby-ai-seat-count',
    ) as HTMLInputElement;
    await user.clear(aiSeatCount);
    await user.type(aiSeatCount, '3');

    await user.click(screen.getByTestId('pre-lobby-create'));

    // 1 create + 3 AI fills (4 players, slot 0 = HUMAN host)
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const createBody = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    // 2026-05-04 — default AI type flipped from COMPUTER_MONTE_CARLO
    // to COMPUTER_MAD; a dropdown lets the user pick MCTS instead.
    expect(createBody).toMatchObject({
      seats: [
        'HUMAN',
        'COMPUTER_MAD',
        'COMPUTER_MAD',
        'COMPUTER_MAD',
      ],
    });

    // Each /ai POST carries the playerType.
    for (let i = 1; i <= 3; i++) {
      const aiBody = JSON.parse(
        fetchMock.mock.calls[i]?.[1]?.body as string,
      ) as Record<string, unknown>;
      expect(aiBody).toEqual({ playerType: 'COMPUTER_MAD' });
    }
  });

  it('lets the user pick a non-default AI type from the dropdown (Monte Carlo)', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse())
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <PreLobbyModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    // Bump AI seat count above 0 so the type dropdown appears.
    const aiSeatCount = screen.getByTestId(
      'pre-lobby-ai-seat-count',
    ) as HTMLInputElement;
    await user.clear(aiSeatCount);
    await user.type(aiSeatCount, '3');

    const aiTypeSelect = screen.getByTestId('pre-lobby-ai-type') as HTMLSelectElement;
    expect(aiTypeSelect.value).toBe('COMPUTER_MAD');
    await user.selectOptions(aiTypeSelect, 'COMPUTER_MONTE_CARLO');

    await user.click(screen.getByTestId('pre-lobby-create'));

    // Default 4 players → 3 AI fills (slot 0 = HUMAN host).
    const createBody = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(createBody).toMatchObject({
      seats: [
        'HUMAN',
        'COMPUTER_MONTE_CARLO',
        'COMPUTER_MONTE_CARLO',
        'COMPUTER_MONTE_CARLO',
      ],
    });
    for (let i = 1; i <= 3; i++) {
      const aiBody = JSON.parse(
        fetchMock.mock.calls[i]?.[1]?.body as string,
      ) as Record<string, unknown>;
      expect(aiBody).toEqual({ playerType: 'COMPUTER_MONTE_CARLO' });
    }
  });

  it('hides the AI-type dropdown when AI seat count is 0', () => {
    render(
      <PreLobbyModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    expect(screen.queryByTestId('pre-lobby-ai-type')).not.toBeInTheDocument();
  });

  it('builds a split lobby (1 AI + open HUMAN seats) when AI seat count is between 0 and max', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse()) // POST /tables
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // POST /ai #1 only
    vi.stubGlobal('fetch', fetchMock);

    render(
      <PreLobbyModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    // Set AI seat count to 1 (default 4-player game → 1 host + 1 AI
    // + 2 open HUMAN slots for friends to join).
    const aiSeatCount = screen.getByTestId(
      'pre-lobby-ai-seat-count',
    ) as HTMLInputElement;
    await user.clear(aiSeatCount);
    await user.type(aiSeatCount, '1');

    await user.click(screen.getByTestId('pre-lobby-create'));

    // 1 create + 1 AI fill (only one AI seat declared).
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const createBody = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(createBody).toMatchObject({
      // Slot 0 = host HUMAN; slot 1 = AI; slots 2-3 = open HUMAN
      // (friends will join from inside the lobby).
      seats: ['HUMAN', 'COMPUTER_MAD', 'HUMAN', 'HUMAN'],
    });

    const aiBody = JSON.parse(
      fetchMock.mock.calls[1]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(aiBody).toEqual({ playerType: 'COMPUTER_MAD' });
  });

  it('clamps player count to the selected mode min/max', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(
      <PreLobbyModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    // Switch to Two Player Duel — minPlayers === maxPlayers === 2,
    // so the player-count input is replaced by a fixed indicator.
    await user.selectOptions(
      screen.getByTestId('pre-lobby-game-type'),
      'Two Player Duel',
    );
    expect(screen.getByTestId('pre-lobby-player-count-fixed')).toHaveTextContent(
      /2 players/,
    );

    await user.click(screen.getByTestId('pre-lobby-create'));
    const createBody = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(createBody.seats).toEqual(['HUMAN', 'HUMAN']);
  });

  it('renders the format-info panel for a known format and hides it for an unknown one', async () => {
    const user = userEvent.setup();
    // SERVER_STATE.deckTypes[0] === 'Constructed - Vintage' (known);
    // we add a fake "Some Custom Format" so we can switch to an unknown
    // entry and verify the panel disappears.
    const stateWithCustom: WebServerState = {
      ...SERVER_STATE,
      deckTypes: [...SERVER_STATE.deckTypes, 'Some Custom Format'],
    };
    render(
      <PreLobbyModal
        roomId={ROOM_ID}
        serverState={stateWithCustom}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    // Default selection is Commander (matches SERVER_STATE) — info
    // panel should be visible with a banlist link.
    expect(screen.getByTestId('pre-lobby-format-info')).toBeInTheDocument();
    const banlistLink = screen.getByTestId('pre-lobby-format-banlist');
    expect(banlistLink).toHaveAttribute(
      'href',
      expect.stringContaining('mtgcommander.net'),
    );
    // External-link safety pins: target=_blank lets the link open in
    // a new tab; rel="noopener noreferrer" prevents the new tab from
    // accessing window.opener (security) and from leaking referrer.
    // A future refactor that drops either would silently regress
    // until this assertion fails.
    expect(banlistLink).toHaveAttribute('target', '_blank');
    expect(banlistLink).toHaveAttribute('rel', 'noopener noreferrer');

    // Switch to the unknown format — panel should disappear.
    await user.selectOptions(
      screen.getByTestId('pre-lobby-deck-type'),
      'Some Custom Format',
    );
    expect(screen.queryByTestId('pre-lobby-format-info')).not.toBeInTheDocument();
  });

  it('surfaces a server error and does not invoke onCreated', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schemaVersion: '1.27',
            code: 'BAD_REQUEST',
            message: 'Invalid game type.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onCreated = vi.fn();
    render(
      <PreLobbyModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );

    await user.click(screen.getByTestId('pre-lobby-create'));

    expect(screen.getByTestId('pre-lobby-error')).toHaveTextContent(/Invalid game type/);
    expect(onCreated).not.toHaveBeenCalled();
  });
});
