import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../auth/store';
import { ApiError, request } from '../api/client';
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
 * the same form chrome; in register mode an email field appears
 * and the submit button hits {@code POST /api/auth/register}
 * instead of {@code POST /api/session}. Registration is gated
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
  const [email, setEmail] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerOk, setRegisterOk] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);

  const onSubmitLogin = async (e: FormEvent) => {
    e.preventDefault();
    setRegisterError(null);
    try {
      await login(username || undefined, password || undefined);
    } catch {
      // Error already in store.error; nothing else to do.
    }
  };

  const onSubmitRegister = async (e: FormEvent) => {
    e.preventDefault();
    setRegisterError(null);
    setRegisterOk(null);
    setRegistering(true);
    try {
      await request<WebRegisterResponse>(
        '/api/auth/register',
        webRegisterResponseSchema,
        {
          method: 'POST',
          body: { username, password, email },
        },
      );
      // Success → flip back to login mode with username + a banner.
      setRegisterOk(
        `Account "${username}" created. Sign in below.`,
      );
      setMode('login');
      setEmail('');
      // Keep username + password in state so the user can hit Sign In
      // immediately without retyping.
    } catch (err) {
      if (err instanceof ApiError) {
        setRegisterError(err.message);
      } else {
        setRegisterError('Registration failed. Please try again.');
      }
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

        {isRegister && (
          <div className="space-y-2">
            <label className="block text-sm text-zinc-300" htmlFor="email">
              Email <span className="text-zinc-500">(required)</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 focus:outline-none focus:border-fuchsia-500"
            />
          </div>
        )}

        {(isRegister ? registerError : error) && (
          <p role="alert" className="text-sm text-red-400">
            {isRegister ? registerError : error}
          </p>
        )}

        <button
          type="submit"
          disabled={isRegister ? registering : loading}
          data-testid={isRegister ? 'register-submit' : 'login-submit'}
          className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-medium rounded px-4 py-2 transition-colors"
        >
          {isRegister
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
