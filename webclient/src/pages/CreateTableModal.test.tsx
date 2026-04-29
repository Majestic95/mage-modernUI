import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateTableModal } from './CreateTableModal';
import { useAuthStore } from '../auth/store';
import type { WebServerState } from '../api/schemas';

const ANON_SESSION = {
  schemaVersion: '1.15',
  token: 'tok-anon',
  username: 'guest-deadbeef',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

const SERVER_STATE: WebServerState = {
  schemaVersion: '1.15',
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
      seats: ['HUMAN', 'COMPUTER_MAD'],
    });

    const aiCall = fetchMock.mock.calls[1];
    const aiUrl = String(aiCall?.[0] ?? '');
    expect(aiUrl).toMatch(/\/tables\/[^/]+\/ai$/);
    const aiBody = aiCall?.[1]
      ? JSON.parse(aiCall[1].body as string) as Record<string, unknown>
      : null;
    expect(aiBody).toEqual({ playerType: 'COMPUTER_MAD' });

    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows MCTS crash warning only when Monte Carlo is selected', async () => {
    const user = userEvent.setup();
    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    // Default is Mad — no warning visible.
    expect(screen.queryByText(/MCTS player has a known crash/i)).not.toBeInTheDocument();

    // Switch to Monte Carlo — warning surfaces.
    await user.selectOptions(
      screen.getAllByRole('combobox').find((el) =>
        (el as HTMLSelectElement).value === 'COMPUTER_MAD',
      )!,
      'COMPUTER_MONTE_CARLO',
    );
    expect(screen.getByText(/MCTS player has a known crash/i)).toBeInTheDocument();
  });

  it('keeps modal open with warning when AI add fails after create', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse())
      .mockResolvedValueOnce(
        jsonResponse(422, {
          schemaVersion: '1.15',
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
      /seat 1 failed to join/i,
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

  it('enables the AI checkbox for >2-seat games (slice 69d multi-AI)', async () => {
    // Slice 69d (re-scoped) — multi-AI seat fill. Pre-69d, AI was
    // available only on 2-seat games which made FFA-against-AI
    // literally unbuildable from the lobby. Now: 4p FFA fills 1
    // human + 3 AI; the checkbox is enabled.
    const user = userEvent.setup();
    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    await user.selectOptions(
      screen.getByRole('combobox', { name: /game type/i }),
      'Free For All',
    );

    expect(screen.getByLabelText(/add ai opponent/i)).not.toBeDisabled();
    // FFA in the fixture has maxPlayers=4 → 1 human + 3 AI.
    expect(
      screen.getByText(/3 AI opponents will fill the remaining seats/i),
    ).toBeInTheDocument();
  });

  it('FFA submission posts seats=[HUMAN, AI×3] then 3 AI fills', async () => {
    // Canonical 4p-FFA-vs-AI flow. Verifies (a) the seats array on
    // the create-table body is exactly 4 entries (1 human + 3 AI),
    // (b) the AI POST is called 3 times (one per AI seat). 1v1
    // unchanged (single AI POST).
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse()) // POST /tables
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // POST /ai #1
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // POST /ai #2
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // POST /ai #3
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

    await user.selectOptions(
      screen.getByRole('combobox', { name: /game type/i }),
      'Free For All',
    );
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    // 1 create-table + 3 add-ai = 4 calls
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const createCall = fetchMock.mock.calls[0];
    const createBody = createCall?.[1]
      ? JSON.parse(createCall[1].body as string) as Record<string, unknown>
      : null;
    expect(createBody?.['gameType']).toBe('Free For All');
    expect(createBody?.['seats']).toEqual([
      'HUMAN', 'COMPUTER_MAD', 'COMPUTER_MAD', 'COMPUTER_MAD',
    ]);

    // All three AI POST calls hit the right URL with the right body.
    for (let i = 1; i <= 3; i++) {
      const call = fetchMock.mock.calls[i];
      expect(String(call?.[0] ?? '')).toMatch(/\/tables\/[^/]+\/ai$/);
      const body = call?.[1]
        ? JSON.parse(call[1].body as string) as Record<string, unknown>
        : null;
      expect(body).toEqual({ playerType: 'COMPUTER_MAD' });
    }

    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('caps AI fill at 4 players when game type allows up to 10 (slice 69d playtest follow-up)', async () => {
    // Real upstream FreeForAll reports minPlayers=3, maxPlayers=10.
    // Pre-fix the lobby would fill 9 AI on default — unplayable due
    // to AI thinking time, mismatched ADR v2 scope ("3-4 player FFA").
    // Now the default seat count caps at 4; user can manually bump
    // up to maxPlayers via the seat-count input.
    const tenPlayerFfaState = {
      ...SERVER_STATE,
      gameTypes: [
        SERVER_STATE.gameTypes[0]!, // Two Player Duel (default)
        {
          ...SERVER_STATE.gameTypes[1]!,
          name: 'Free For All',
          minPlayers: 3,
          maxPlayers: 10,
        },
      ],
    };
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse())
      // Three AI POSTs (default cap is 4, so 1 human + 3 AI)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={tenPlayerFfaState}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    await user.selectOptions(
      screen.getByRole('combobox', { name: /game type/i }),
      'Free For All',
    );
    // Helper text shows the capped count, NOT the maxPlayers value.
    expect(
      screen.getByText(/1 human \+ 3 AI = 4-player game/i),
    ).toBeInTheDocument();
    // The seat-count input is visible (variable-seat format) and
    // bounded so the user can opt up to a 10p game if they really
    // want to. Bounds visible in the label.
    expect(screen.getByLabelText(/number of players/i)).toBeInTheDocument();
    expect(
      screen.getByText(/number of players \(3.*10\)/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    // 1 create + 3 AI fills = 4 calls total.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const createBody = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect((createBody['seats'] as string[]).length).toBe(4);
  });

  it('FFA partial-fill failure surfaces the seat-number that broke', async () => {
    // Failure mode: 2nd AI POST fails after 1st succeeds. User sees
    // a precise count ("1 of 3 filled — seat 2 failed") so they
    // know how partial the table is.
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // AI 1 ok
      .mockResolvedValueOnce(
        jsonResponse(422, {
          schemaVersion: '1.15',
          code: 'UPSTREAM_REJECTED',
          message: 'Server full',
        }),
      ); // AI 2 fails — loop bails before AI 3
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

    await user.selectOptions(
      screen.getByRole('combobox', { name: /game type/i }),
      'Free For All',
    );
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /1 of 3 AI seats filled.*seat 2 failed to join/i,
    );
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Loop bailed at seat 2 — only 3 calls (table + AI 1 + AI 2).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  /* ---------- slice 10: advanced options ---------- */

  it('submits advanced fields when the user changes them from defaults', async () => {
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

    // Drop the AI seat to keep the test focused on the create-table call.
    await user.click(screen.getByLabelText(/add ai opponent/i));

    // Open the Advanced section and tweak every field.
    await user.click(screen.getByTestId('advanced-summary'));

    await user.type(screen.getByLabelText(/table name/i), 'My duel');
    await user.type(screen.getByLabelText(/^password/i), 'hunter2');
    await user.selectOptions(screen.getByLabelText(/skill level/i), 'SERIOUS');
    await user.selectOptions(screen.getByLabelText(/match time limit/i), 'MIN__30');
    const freeMull = screen.getByLabelText(/free mulligans/i);
    await user.clear(freeMull);
    await user.type(freeMull, '2');
    await user.selectOptions(screen.getByLabelText(/mulligan type/i), 'LONDON');
    await user.click(screen.getByLabelText(/spectators allowed/i));
    await user.click(screen.getByLabelText(/^rated$/i));

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const call = fetchMock.mock.calls[0];
    const body = call?.[1]
      ? JSON.parse(call[1].body as string) as Record<string, unknown>
      : null;
    expect(body).toMatchObject({
      gameType: 'Two Player Duel',
      deckType: 'Constructed - Vintage',
      winsNeeded: 1,
      tableName: 'My duel',
      password: 'hunter2',
      skillLevel: 'SERIOUS',
      matchTimeLimit: 'MIN__30',
      freeMulligans: 2,
      mulliganType: 'LONDON',
      spectatorsAllowed: false,
      rated: true,
    });
    expect('seats' in (body ?? {})).toBe(false);
  });

  it('omits unchanged advanced fields from the request body', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tableResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const call = fetchMock.mock.calls[0];
    const body = call?.[1]
      ? JSON.parse(call[1].body as string) as Record<string, unknown>
      : null;
    // Only the required fields + seats (AI is on by default).
    expect(Object.keys(body ?? {}).sort()).toEqual(
      ['deckType', 'gameType', 'seats', 'winsNeeded'].sort(),
    );
  });

  it('hides attackOption / range fields on games that do not use them', async () => {
    const user = userEvent.setup();
    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={SERVER_STATE}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    await user.click(screen.getByTestId('advanced-summary'));

    expect(screen.queryByLabelText(/attack option/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/range of influence/i)).not.toBeInTheDocument();
  });

  it('shows attackOption / range when the selected game uses them', async () => {
    const user = userEvent.setup();
    const multiplayerState: WebServerState = {
      ...SERVER_STATE,
      gameTypes: [
        ...SERVER_STATE.gameTypes,
        {
          name: 'Free For All MP',
          minPlayers: 3,
          maxPlayers: 5,
          numTeams: 0,
          playersPerTeam: 0,
          useRange: true,
          useAttackOption: true,
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(tableResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CreateTableModal
        roomId={ROOM_ID}
        serverState={multiplayerState}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    await user.selectOptions(
      screen.getByRole('combobox', { name: /game type/i }),
      'Free For All MP',
    );
    await user.click(screen.getByTestId('advanced-summary'));

    await user.selectOptions(screen.getByLabelText(/attack option/i), 'RIGHT');
    await user.selectOptions(screen.getByLabelText(/range of influence/i), 'TWO');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const call = fetchMock.mock.calls[0];
    const body = call?.[1]
      ? JSON.parse(call[1].body as string) as Record<string, unknown>
      : null;
    expect(body).toMatchObject({
      attackOption: 'RIGHT',
      range: 'TWO',
    });
  });

  it('shows the WebError message on a 422 rejection', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(422, {
          schemaVersion: '1.15',
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
