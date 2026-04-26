import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './store';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.setState({ session: null, loading: false, error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login on success stores the session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, {
            schemaVersion: '1.4',
            token: 'tok-1234',
            username: 'alice',
            isAnonymous: false,
            isAdmin: false,
            expiresAt: '2026-04-27T00:00:00Z',
          }),
        ),
      ),
    );

    await useAuthStore.getState().login('alice', 'pw');

    const state = useAuthStore.getState();
    expect(state.session?.token).toBe('tok-1234');
    expect(state.session?.username).toBe('alice');
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('login on 401 sets error and rethrows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(401, {
            schemaVersion: '1.4',
            code: 'INVALID_CREDENTIALS',
            message: 'Login failed.',
          }),
        ),
      ),
    );

    await expect(
      useAuthStore.getState().login('bad', 'wrong'),
    ).rejects.toThrow();

    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.error).toContain('Login failed');
    expect(state.loading).toBe(false);
  });

  it('logout clears the session and calls the DELETE endpoint', async () => {
    useAuthStore.setState({
      session: {
        schemaVersion: '1.4',
        token: 'tok-zzz',
        username: 'alice',
        isAnonymous: false,
        isAdmin: false,
        expiresAt: '2026-04-27T00:00:00Z',
      },
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().session).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const init = call?.[1];
    expect(init?.method).toBe('DELETE');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok-zzz',
    );
  });

  it('logout without a session is a no-op', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await useAuthStore.getState().logout();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('clearError resets the error field', () => {
    useAuthStore.setState({ error: 'something went wrong' });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });
});
