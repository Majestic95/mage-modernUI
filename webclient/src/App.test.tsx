import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { useAuthStore } from './auth/store';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ANON_SESSION = {
  schemaVersion: '1.8',
  token: 'tok-anon',
  username: 'guest-deadbeef',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

const MAIN_ROOM = {
  schemaVersion: '1.8',
  roomId: '00000000-0000-0000-0000-000000000000',
  chatId: '00000000-0000-0000-0000-000000000001',
};

/**
 * URL-aware fetch mock. App startup hits /api/session/me, the Lobby
 * hits /api/server/main-room (then /api/rooms/.../tables), CardSearch
 * hits /api/cards. Each test stubs the routes it needs.
 */
function stubFetchByPath(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
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
    }),
  );
}

describe('App shell', () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: null,
      loading: false,
      error: null,
      verifying: false,
    });
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the Login screen when not authenticated', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  });

  it('renders the tabbed shell when authenticated', () => {
    useAuthStore.setState({ session: ANON_SESSION });
    stubFetchByPath({
      '/api/session/me': () => jsonResponse(200, ANON_SESSION),
      '/api/server/main-room': () => jsonResponse(200, MAIN_ROOM),
    });

    render(<App />);

    expect(screen.getByRole('button', { name: /lobby/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cards$/i })).toBeInTheDocument();
    expect(screen.getByText(/guest-deadbeef/)).toBeInTheDocument();
  });

  it('switches to the Cards tab when clicked', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ session: ANON_SESSION });
    stubFetchByPath({
      '/api/session/me': () => jsonResponse(200, ANON_SESSION),
      '/api/server/main-room': () => jsonResponse(200, MAIN_ROOM),
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    expect(screen.getByPlaceholderText(/exact card name/i)).toBeInTheDocument();
  });

  it('Sign out clears the session', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ session: ANON_SESSION });
    stubFetchByPath({
      '/api/session/me': () => jsonResponse(200, ANON_SESSION),
      '/api/server/main-room': () => jsonResponse(200, MAIN_ROOM),
      '/api/session': () => new Response(null, { status: 204 }),
    });

    render(<App />);
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    expect(useAuthStore.getState().session).toBeNull();
  });
});
