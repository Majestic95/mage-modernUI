import { useEffect, useState, type FormEvent } from 'react';
import { useAuthStore } from '../auth/store';
import { request } from '../api/client';
import {
  authErrorToMessage,
  rateLimitedCooldownSeconds,
} from '../auth/errorMessages';
import {
  webRegisterResponseSchema,
  type WebRegisterResponse,
} from '../api/schemas';

/**
 * Sign-in screen. Empty username + empty password = guest session
 * (anonymous mode is the WebApi default per ADR 0004 D4).
 *
 * <p>Slice F18 (2026-05-04) — added a Register mode behind the
 * "Don't have an account? Register" toggle. The mode swap reuses
 * the same form chrome; in register mode the submit button hits
 * {@code POST /api/auth/register} instead of {@code POST /api/session}.
 *
 * <p>Slice F23 (2026-05-04) — dropped the email field on user
 * privacy direction. Just username + password.
 *
 * <p>Registration is gated
 * server-side by {@code XMAGE_REGISTRATION_ENABLED}; if the flag
 * is off the server returns 403 and we surface a friendly message
 * inline. After a successful register, the form auto-flips back
 * to Sign-in mode with the username pre-filled and a confirmation
 * banner so the user can immediately log in.
 */
type Mode = 'login' | 'register';

export function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerOk, setRegisterOk] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  // F20 (audit UX C4) — when the server returns 429 RATE_LIMITED, we
  // pin a cooldownUntil timestamp + tick a countdown so the submit
  // button is visibly disabled with a "Try again in Ns" label. A 1Hz
  // ticker drives re-render; cleared on unmount.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const clearStoreError = useAuthStore((s) => s.clearError);

  useEffect(() => {
    if (cooldownUntil === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const cooldownRemaining =
    cooldownUntil !== null
      ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
      : 0;
  const inCooldown = cooldownRemaining > 0;
  // Auto-clear cooldown state once the timer expires so the next
  // submit attempt isn't gated by the stale value.
  useEffect(() => {
    if (cooldownUntil !== null && now >= cooldownUntil) {
      setCooldownUntil(null);
    }
  }, [now, cooldownUntil]);

  const handleApiError = (err: unknown, setLocal: (msg: string) => void) => {
    setLocal(authErrorToMessage(err));
    const cooldown = rateLimitedCooldownSeconds(err);
    if (cooldown > 0) {
      setCooldownUntil(Date.now() + cooldown * 1000);
    }
  };

  const onSubmitLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (inCooldown) return;
    setRegisterError(null);
    try {
      await login(username || undefined, password || undefined);
    } catch (err) {
      // Login store already wrote a friendly message into
      // useAuthStore.error via authErrorToMessage. Capture the cooldown
      // signal here without overriding the store-managed error text.
      const cooldown = rateLimitedCooldownSeconds(err);
      if (cooldown > 0) {
        setCooldownUntil(Date.now() + cooldown * 1000);
      }
    }
  };

  const onSubmitRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (inCooldown) return;
    setRegisterError(null);
    setRegisterOk(null);
    setRegistering(true);
    try {
      await request<WebRegisterResponse>(
        '/api/auth/register',
        webRegisterResponseSchema,
        {
          method: 'POST',
          body: { username, password },
        },
      );
      // Success → flip back to login mode with username + a banner.
      setRegisterOk(
        `Account "${username}" created. Sign in below.`,
      );
      setMode('login');
      // Also clear any stale store error from a previous failed login.
      clearStoreError();
      // Keep username + password in state so the user can hit Sign In
      // immediately without retyping.
    } catch (err) {
      handleApiError(err, setRegisterError);
    } finally {
      setRegistering(false);
    }
  };

  const isRegister = mode === 'register';

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-8">
      <form
        onSubmit={isRegister ? onSubmitRegister : onSubmitLogin}
        className="w-full max-w-sm space-y-5 bg-zinc-900 rounded-lg p-8 border border-zinc-800"
      >
        <header className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Mage <span className="text-fuchsia-400">Modern UI</span>
          </h1>
          <p className="text-sm text-zinc-400">
            {isRegister
              ? 'Create an account'
              : 'Sign in or play as a guest'}
          </p>
        </header>

        {registerOk && !isRegister && (
          <p
            role="status"
            data-testid="register-success-banner"
            className="text-sm text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 rounded px-3 py-2"
          >
            {registerOk}
          </p>
        )}

        <div className="space-y-2">
          <label className="block text-sm text-zinc-300" htmlFor="username">
            Username{' '}
            <span className="text-zinc-500">
              {isRegister ? '(required)' : '(optional)'}
            </span>
          </label>
          <input
            id="username"
            name="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={isRegister ? '' : 'guest-…'}
            autoComplete="username"
            required={isRegister}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-fuchsia-500"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-zinc-300" htmlFor="password">
            Password{' '}
            <span className="text-zinc-500">
              {isRegister
                ? '(at least 8 characters)'
                : '(leave blank for guest)'}
            </span>
          </label>
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={
              isRegister ? 'new-password' : 'current-password'
            }
            required={isRegister}
            minLength={isRegister ? 8 : undefined}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 focus:outline-none focus:border-fuchsia-500"
          />
        </div>

        {(isRegister ? registerError : error) && (
          <p role="alert" className="text-sm text-red-400">
            {isRegister ? registerError : error}
          </p>
        )}

        <button
          type="submit"
          disabled={(isRegister ? registering : loading) || inCooldown}
          aria-busy={isRegister ? registering : loading}
          data-testid={isRegister ? 'register-submit' : 'login-submit'}
          className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-medium rounded px-4 py-2 transition-colors"
        >
          {inCooldown
            ? `Try again in ${cooldownRemaining}s`
            : isRegister
              ? registering
                ? 'Creating account…'
                : 'Register'
              : loading
                ? 'Signing in…'
                : 'Sign in'}
        </button>

        <div className="text-center text-sm text-zinc-400">
          {isRegister ? (
            <button
              type="button"
              data-testid="login-mode-toggle"
              onClick={() => {
                setMode('login');
                setRegisterError(null);
                // F20 (audit UX A3) — clear stale auth-store error so
                // a prior failed login doesn't linger when the user
                // returns from register mode.
                clearStoreError();
              }}
              className="hover:text-zinc-200 underline"
            >
              ← Back to sign in
            </button>
          ) : (
            <>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                data-testid="register-mode-toggle"
                onClick={() => {
                  setMode('register');
                  setRegisterOk(null);
                  // F20 — same hygiene on the other direction.
                  clearStoreError();
                }}
                className="text-fuchsia-400 hover:text-fuchsia-300 underline"
              >
                Register
              </button>
            </>
          )}
        </div>
      </form>
    </main>
  );
}
