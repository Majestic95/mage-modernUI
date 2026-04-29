import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../auth/store';

/**
 * Sign-in screen. Empty username + empty password = guest session
 * (anonymous mode is the WebApi default per ADR 0004 D4).
 */
export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await login(username || undefined, password || undefined);
    } catch {
      // Error already in store.error; nothing else to do.
    }
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
            Sign in or play as a guest
          </p>
        </header>

        <div className="space-y-2">
          <label className="block text-sm text-zinc-300" htmlFor="username">
            Username <span className="text-zinc-500">(optional)</span>
          </label>
          <input
            id="username"
            name="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="guest-…"
            autoComplete="username"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-fuchsia-500"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-zinc-300" htmlFor="password">
            Password <span className="text-zinc-500">(leave blank for guest)</span>
          </label>
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 focus:outline-none focus:border-fuchsia-500"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          data-testid="login-submit"
          className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-medium rounded px-4 py-2 transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
