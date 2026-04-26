/**
 * Zustand auth store. Holds the current {@link WebSession} (if any) and
 * exposes actions for login / logout. Persistent storage is deferred —
 * tokens are wiped on page reload, matching the WebApi's "tokens lost on
 * server restart" model (ADR 0004 D2).
 */
import { create } from 'zustand';
import { ApiError, request } from '../api/client';
import { webSessionSchema, type WebSession } from '../api/schemas';

interface AuthState {
  session: WebSession | null;
  loading: boolean;
  error: string | null;
  login: (username?: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  loading: false,
  error: null,

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const session = await request('/api/session', webSessionSchema, {
        body: { username, password },
      });
      set({ session, loading: false });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Login failed.';
      set({ error: message, loading: false });
      throw err;
    }
  },

  logout: async () => {
    const token = get().session?.token;
    set({ session: null, error: null });
    if (!token) {
      return;
    }
    try {
      await request('/api/session', null, { method: 'DELETE', token });
    } catch {
      // Local logout already happened; ignore network/server failures.
    }
  },

  clearError: () => set({ error: null }),
}));
