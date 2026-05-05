import { useEffect, useState, type FormEvent } from 'react';
import { useAuthStore } from '../auth/store';
import { request } from '../api/client';
import {
  authErrorToMessage,
  rateLimitedCooldownSeconds,
} from '../auth/errorMessages';
import { RecoveryCodeReveal } from '../auth/RecoveryCodeReveal';
import {
  webRecoverResponseSchema,
  webRegisterResponseSchema,
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
 * <p>Slice F24 (2026-05-04) — added a Recover mode + a one-time
 * recovery-code reveal. Register now returns a 24-char Crockford
 * base32 code shown ONCE; users save it off-screen and present it
 * later via the Recover form to reset a forgotten password. Server
 * rotates the code atomically on a successful recover.
 *
 * <p>Slice F24.1 (2026-05-04, post-review) — banners now reference
 * the server-echoed username ({@code res.username}) instead of the
 * React-state username, so a user who edits the input mid-flight
 * sees the truth. The recovery-code reveal UI was extracted to
 * {@link RecoveryCodeReveal} to keep this file under the 400-LOC
 * soft cap.
 */
type Mode = 'login' | 'register' | 'recover';

interface IssuedRecovery {
  code: string;
  username: string;
  context: 'register' | 'recover';
}

export function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [registerOk, setRegisterOk] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // F24 — once a register or recover succeeds we hold the issued
  // recovery code in state and render a "save this somewhere safe"
  // panel. Cleared on mode swap so it never persists into another
  // surface. Render-only state — never sent back to the server.
  const [issued, setIssued] = useState<IssuedRecovery | null>(null);
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

  // Tick `now` every second while a cooldown is active so the
  // visible countdown updates, and self-clear `cooldownUntil` from
  // inside the same interval callback once the deadline has passed
  // (event-context, not effect-body — keeps the auto-clear out of
  // a setState-in-effect pattern).
  useEffect(() => {
    if (cooldownUntil === null) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= cooldownUntil) {
        setCooldownUntil(null);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const cooldownRemaining =
    cooldownUntil !== null
      ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
      : 0;
  const inCooldown = cooldownRemaining > 0;

  const handleApiError = (err: unknown) => {
    setFormError(authErrorToMessage(err));
    const cooldown = rateLimitedCooldownSeconds(err);
    if (cooldown > 0) {
      setCooldownUntil(Date.now() + cooldown * 1000);
    }
  };

  const onSubmitLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (inCooldown) return;
    setFormError(null);
    try {
      await login(username || undefined, password || undefined);
    } catch (err) {
      const cooldown = rateLimitedCooldownSeconds(err);
      if (cooldown > 0) {
        setCooldownUntil(Date.now() + cooldown * 1000);
      }
    }
  };

  const onSubmitRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (inCooldown) return;
    setFormError(null);
    setRegisterOk(null);
    setSubmitting(true);
    try {
      const res = await request(
        '/api/auth/register',
        webRegisterResponseSchema,
        {
          method: 'POST',
          body: { username, password },
        },
      );
      setIssued({
        code: res.recoveryCode,
        username: res.username,
        context: 'register',
      });
      clearStoreError();
    } catch (err) {
      handleApiError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitRecover = async (e: FormEvent) => {
    e.preventDefault();
    if (inCooldown) return;
    setFormError(null);
    setRegisterOk(null);
    setSubmitting(true);
    try {
      const res = await request(
        '/api/auth/recover',
        webRecoverResponseSchema,
        {
          method: 'POST',
          body: {
            username,
            recoveryCode: recoveryCodeInput,
            newPassword: password,
          },
        },
      );
      setIssued({
        code: res.recoveryCode,
        username: res.username,
        context: 'recover',
      });
      clearStoreError();
    } catch (err) {
      handleApiError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onAcknowledgeRecoveryCode = () => {
    if (!issued) return;
    const banner =
      issued.context === 'register'
        ? `Account "${issued.username}" created. Sign in below.`
        : `Password reset for "${issued.username}". Sign in with your new password below.`;
    setIssued(null);
    setRegisterOk(banner);
    setMode('login');
    setRecoveryCodeInput('');
    setUsername(issued.username);
  };

  const isRegister = mode === 'register';
  const isRecover = mode === 'recover';

  const onSubmit = (e: FormEvent) => {
    if (isRegister) return onSubmitRegister(e);
    if (isRecover) return onSubmitRecover(e);
    return onSubmitLogin(e);
  };

  const submitDisabled =
    ((isRegister || isRecover) ? submitting : loading) || inCooldown;
  const submitTestId = isRegister
    ? 'register-submit'
    : isRecover
      ? 'recover-submit'
      : 'login-submit';
  const submitLabel = inCooldown
    ? `Try again in ${cooldownRemaining}s`
    : isRegister
      ? submitting
        ? 'Creating account…'
        : 'Register'
      : isRecover
        ? submitting
          ? 'Resetting…'
          : 'Reset password'
        : loading
          ? 'Signing in…'
          : 'Sign in';

  const switchTo = (next: Mode) => {
    setMode(next);
    setFormError(null);
    if (next === 'login') {
      setRecoveryCodeInput('');
    } else {
      setRegisterOk(null);
    }
    if (next === 'recover') setPassword('');
    clearStoreError();
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-8">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-5 bg-zinc-900 rounded-lg p-8 border border-zinc-800"
      >
        <header className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Mage <span className="text-fuchsia-400">Modern UI</span>
          </h1>
          <p className="text-sm text-zinc-400">
            {isRegister
              ? 'Create an account'
              : isRecover
                ? 'Reset a forgotten password'
                : 'Sign in or play as a guest'}
          </p>
        </header>

        {issued && (
          <RecoveryCodeReveal
            code={issued.code}
            context={issued.context}
            onAcknowledge={onAcknowledgeRecoveryCode}
          />
        )}

        {registerOk && !isRegister && !isRecover && !issued && (
          <p
            role="status"
            data-testid="register-success-banner"
            className="text-sm text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 rounded px-3 py-2"
          >
            {registerOk}
          </p>
        )}

        {!issued && (
          <>
            <div className="space-y-2">
              <label className="block text-sm text-zinc-300" htmlFor="username">
                Username{' '}
                <span className="text-zinc-500">
                  {isRegister || isRecover ? '(required)' : '(optional)'}
                </span>
              </label>
              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={isRegister || isRecover ? '' : 'guest-…'}
                autoComplete="username"
                required={isRegister || isRecover}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-fuchsia-500"
              />
            </div>

            {isRecover && (
              <div className="space-y-2">
                <label
                  className="block text-sm text-zinc-300"
                  htmlFor="recoveryCode"
                >
                  Recovery code{' '}
                  <span className="text-zinc-500">(from registration)</span>
                </label>
                <input
                  id="recoveryCode"
                  name="recoveryCode"
                  type="text"
                  value={recoveryCodeInput}
                  onChange={(e) => setRecoveryCodeInput(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  required
                  data-testid="recovery-code-input"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 font-mono tracking-wider focus:outline-none focus:border-fuchsia-500"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm text-zinc-300" htmlFor="password">
                {isRecover ? 'New password' : 'Password'}{' '}
                <span className="text-zinc-500">
                  {isRegister || isRecover
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
                  isRegister || isRecover ? 'new-password' : 'current-password'
                }
                required={isRegister || isRecover}
                minLength={isRegister || isRecover ? 8 : undefined}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 focus:outline-none focus:border-fuchsia-500"
              />
            </div>

            {((isRegister || isRecover) ? formError : error) && (
              <p role="alert" className="text-sm text-red-400">
                {(isRegister || isRecover) ? formError : error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitDisabled}
              aria-busy={(isRegister || isRecover) ? submitting : loading}
              data-testid={submitTestId}
              className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-medium rounded px-4 py-2 transition-colors"
            >
              {submitLabel}
            </button>

            <div className="text-center text-sm text-zinc-400 space-y-1">
              {isRegister || isRecover ? (
                <button
                  type="button"
                  data-testid="login-mode-toggle"
                  onClick={() => switchTo('login')}
                  className="hover:text-zinc-200 underline"
                >
                  ← Back to sign in
                </button>
              ) : (
                <>
                  <div>
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      data-testid="register-mode-toggle"
                      onClick={() => switchTo('register')}
                      className="text-fuchsia-400 hover:text-fuchsia-300 underline"
                    >
                      Register
                    </button>
                  </div>
                  <div>
                    Forgot your password?{' '}
                    <button
                      type="button"
                      data-testid="recover-mode-toggle"
                      onClick={() => switchTo('recover')}
                      className="text-fuchsia-400 hover:text-fuchsia-300 underline"
                    >
                      Reset with recovery code
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </form>
    </main>
  );
}
