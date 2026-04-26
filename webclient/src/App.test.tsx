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
  schemaVersion: '1.4',
  token: 'tok-anon',
  username: 'guest-deadbeef',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

describe('App shell', () => {
  beforeEach(() => {
    useAuthStore.setState({ session: null, loading: false, error: null });
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
    // Stub fetch so the Lobby's auto-load doesn't blow up.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, {
            schemaVersion: '1.4',
            roomId: '00000000-0000-0000-0000-000000000000',
            chatId: '00000000-0000-0000-0000-000000000001',
          }),
        ),
      ),
    );

    render(<App />);

    expect(screen.getByRole('button', { name: /lobby/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cards$/i })).toBeInTheDocument();
    expect(screen.getByText(/guest-deadbeef/)).toBeInTheDocument();
  });

  it('switches to the Cards tab when clicked', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ session: ANON_SESSION });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, {
            schemaVersion: '1.4',
            roomId: '00000000-0000-0000-0000-000000000000',
            chatId: '00000000-0000-0000-0000-000000000001',
          }),
        ),
      ),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    expect(screen.getByPlaceholderText(/exact card name/i)).toBeInTheDocument();
  });

  it('Sign out clears the session', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ session: ANON_SESSION });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );

    render(<App />);
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    expect(useAuthStore.getState().session).toBeNull();
  });
});
