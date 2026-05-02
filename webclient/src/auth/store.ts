/**
 * Zustand auth store. Holds the current {@link WebSession} (if any) and
 * exposes login / logout / verify actions. Persists to localStorage so
 * refresh doesn't drop the user.
 *
 * <p>On startup, the App calls {@link AuthState#verify} once. If the
 * persisted token is still valid server-side, the session stays.
 * If the server has restarted, the token has expired, or another login
 * with the same username has bumped this one (newest-wins per ADR 0004
 * D7), {@code verify} clears the session and the user re-authenticates.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ApiError, request } from '../api/client';
import { webSessionSchema, type WebSession } from '../api/schemas';

interface AuthState {
  session: WebSession | null;
  loading: boolean;
  error: string | null;
  /** True until the first verify call completes after rehydration. */
  verifying: boolean;
  login: (username?: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
  verify: () => Promise<void>;
  clearError: () => void;
}

/**
 * P1 audit fix — module-scoped guard so the offline-retry listener
 * is installed at most once across multiple concurrent verify failures.
 * Without this, repeated `verify` calls during a long offline window
 * would each push an `online` listener onto the document, all firing
 * re-verifies in parallel when connectivity returns.
 */
let onlineRetryArmed = false;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      loading: false,
      error: null,
      verifying: false,

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

      verify: async () => {
        const token = get().session?.token;
        if (!token) {
          set({ verifying: false });
          return;
        }
        set({ verifying: true });
        try {
          const session = await request('/api/session/me', webSessionSchema, { token });
          set({ session, verifying: false });
        } catch (err) {
          // Any failure (401 INVALID_TOKEN, MISSING_TOKEN, network, etc.)
          // means we should drop the persisted session and let the user
          // sign in again. We swallow the error rather than rethrowing
          // because verify runs at startup and shouldn't crash the app.
          if (err instanceof ApiError && err.status === 0) {
            // Network failure — keep the session optimistically; the next
            // real request will surface the issue.
            //
            // P1 audit fix — install a one-shot 'online' listener so
            // we re-verify automatically when connectivity returns.
            // Without this, an offline-at-startup user would stay
            // authenticated client-side forever; every subsequent
            // request would 401 silently and the user would never
            // get a clean re-login prompt. The module-level
            // `onlineRetryArmed` flag prevents stacking listeners
            // across repeated verify failures during a long offline
            // window.
            set({ verifying: false });
            if (
              typeof window !== 'undefined' &&
              !onlineRetryArmed &&
              typeof window.addEventListener === 'function'
            ) {
              onlineRetryArmed = true;
              const onOnline = () => {
                onlineRetryArmed = false;
                window.removeEventListener('online', onOnline);
                // Defer to a microtask so the browser's `online` event
                // handlers all run before our re-verify hits the wire.
                Promise.resolve().then(() => {
                  void get().verify();
                });
              };
              window.addEventListener('online', onOnline);
            }
            return;
          }
          set({ session: null, verifying: false });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'mage-auth',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only persist the session itself; transient flags reset on reload.
      partialize: (state) => ({ session: state.session }),
    },
  ),
);
