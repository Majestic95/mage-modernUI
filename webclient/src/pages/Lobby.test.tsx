import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lobby } from './Lobby';
import { useAuthStore } from '../auth/store';
import type { WebTable } from '../api/schemas';

const ANON_SESSION = {
  schemaVersion: '1.11',
  token: 'tok-anon',
  username: 'guest-deadbeef',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

const ROOM_ID = '00000000-0000-0000-0000-000000000000';
const TABLE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tableWith(overrides: Partial<WebTable>): WebTable {
  return {
    tableId: TABLE_ID,
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
    seats: [
      { playerName: 'guest-deadbeef', playerType: 'HUMAN', occupied: true },
      { playerName: 'COMPUTER_MONTE_CARLO', playerType: 'COMPUTER_MONTE_CARLO', occupied: true },
    ],
    ...overrides,
  };
}

const MAIN_ROOM = {
  schemaVersion: '1.11',
  roomId: ROOM_ID,
  chatId: '11111111-1111-1111-1111-111111111111',
};

const SERVER_STATE = {
  schemaVersion: '1.11',
  gameTypes: [],
  tournamentTypes: [],
  playerTypes: [],
  deckTypes: [],
  draftCubes: [],
  testMode: false,
};

function stubFetch(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    for (const [prefix, build] of Object.entries(routes)) {
      if (url.includes(prefix)) {
        return Promise.resolve(build());
      }
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Lobby — Start button', () => {
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

  it('shows the Start button when current user controls a READY_TO_START table', async () => {
    stubFetch({
      '/api/server/main-room': () => jsonResponse(200, MAIN_ROOM),
      '/api/server/state': () => jsonResponse(200, SERVER_STATE),
      '/api/rooms/': () =>
        jsonResponse(200, {
          schemaVersion: '1.11',
          tables: [tableWith({ tableState: 'READY_TO_START' })],
        }),
    });

    render(<Lobby />);

    expect(
      await screen.findByRole('button', { name: /^start$/i }),
    ).toBeInTheDocument();
  });

  it('hides the Start button when current user is NOT the controller', async () => {
    stubFetch({
      '/api/server/main-room': () => jsonResponse(200, MAIN_ROOM),
      '/api/server/state': () => jsonResponse(200, SERVER_STATE),
      '/api/rooms/': () =>
        jsonResponse(200, {
          schemaVersion: '1.11',
          tables: [
            tableWith({
              tableState: 'READY_TO_START',
              controllerName: 'someone-else',
            }),
          ],
        }),
    });

    render(<Lobby />);

    await screen.findByText("guest-deadbeef's table");
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull();
  });

  it('hides the Start button while table state is still WAITING', async () => {
    stubFetch({
      '/api/server/main-room': () => jsonResponse(200, MAIN_ROOM),
      '/api/server/state': () => jsonResponse(200, SERVER_STATE),
      '/api/rooms/': () =>
        jsonResponse(200, {
          schemaVersion: '1.11',
          tables: [tableWith({ tableState: 'WAITING' })],
        }),
    });

    render(<Lobby />);

    await screen.findByText("guest-deadbeef's table");
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull();
  });

  it('clicking Start posts to the start endpoint', async () => {
    const user = userEvent.setup();
    const startCalls: string[] = [];

    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes('/start')) {
        startCalls.push(`${init?.method ?? 'GET'} ${url}`);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes('/api/server/main-room')) {
        return Promise.resolve(jsonResponse(200, MAIN_ROOM));
      }
      if (url.includes('/api/server/state')) {
        return Promise.resolve(jsonResponse(200, SERVER_STATE));
      }
      if (url.includes('/api/rooms/')) {
        return Promise.resolve(
          jsonResponse(200, {
            schemaVersion: '1.11',
            tables: [tableWith({ tableState: 'READY_TO_START' })],
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<Lobby />);
    const startBtn = await screen.findByRole('button', { name: /^start$/i });
    await user.click(startBtn);

    await waitFor(() => {
      expect(startCalls).toHaveLength(1);
    });
    expect(startCalls[0]).toMatch(/POST .*\/api\/rooms\/[^/]+\/tables\/[^/]+\/start$/);
  });

  it('surfaces a 422 UPSTREAM_REJECTED message when start fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.includes('/start')) {
          return Promise.resolve(
            jsonResponse(422, {
              schemaVersion: '1.11',
              code: 'UPSTREAM_REJECTED',
              message: 'Server refused to start the match.',
            }),
          );
        }
        if (url.includes('/api/server/main-room')) {
          return Promise.resolve(jsonResponse(200, MAIN_ROOM));
        }
        if (url.includes('/api/server/state')) {
          return Promise.resolve(jsonResponse(200, SERVER_STATE));
        }
        if (url.includes('/api/rooms/')) {
          return Promise.resolve(
            jsonResponse(200, {
              schemaVersion: '1.11',
              tables: [tableWith({ tableState: 'READY_TO_START' })],
            }),
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      }),
    );

    render(<Lobby />);
    await user.click(await screen.findByRole('button', { name: /^start$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /refused to start/i,
    );
  });
});
