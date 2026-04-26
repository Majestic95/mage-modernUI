import { useEffect, useState } from 'react';
import { useAuthStore } from './auth/store';
import { CardSearch } from './pages/CardSearch';
import { Decks } from './pages/Decks';
import { Game } from './pages/Game';
import { Lobby } from './pages/Lobby';
import { LobbyChat } from './pages/LobbyChat';
import { Login } from './pages/Login';

type Tab = 'lobby' | 'decks' | 'cards';

/**
 * localStorage key for persisting the user's active game across page
 * reloads. The Swing client achieves the same outcome via
 * {@code User.reconnect()} pushing GAME_INIT back to the existing
 * session; the webclient remembers the gameId locally and re-opens
 * the WebSocket on next boot — the server's {@code joinGame}
 * idempotently re-initializes the session. Cleared on explicit
 * Leave or auth signout.
 */
const ACTIVE_GAME_STORAGE_KEY = 'xmage.activeGameId';

function readStoredGameId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_GAME_STORAGE_KEY);
  } catch {
    // localStorage may throw in private-browsing or denied contexts.
    return null;
  }
}

function persistGameId(id: string | null): void {
  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_GAME_STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_GAME_STORAGE_KEY);
    }
  } catch {
    // Ignore — at worst, a reload won't auto-resume.
  }
}

/**
 * Auth-gated tab shell.
 *
 * <p>Slice 4.1 had two screens; we used a tab switcher. Slice 5 adds
 * a full-screen game window that takes over the main area when
 * {@code activeGameId} is set. Auto-navigation from {@code startGame}
 * frames lands in slice 5B; for slice 5A the user opens a game by
 * pasting an ID into the dev-only entry on the Lobby and clicking
 * "Open game window."
 */
export function App() {
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const verify = useAuthStore((s) => s.verify);
  const [tab, setTab] = useState<Tab>('lobby');
  const [activeGameId, setActiveGameIdState] = useState<string | null>(
    () => readStoredGameId(),
  );

  // Wrap setter so every transition writes localStorage.
  const setActiveGameId = (id: string | null) => {
    persistGameId(id);
    setActiveGameIdState(id);
  };

  useEffect(() => {
    void verify();
  }, [verify]);

  // Drop any persisted gameId when the session goes away (logout or
  // server-side token expiry) so the next login doesn't auto-jump
  // into a stale game window. Pure side effect — no setState — so
  // it's safe inside an effect.
  useEffect(() => {
    if (!session) {
      persistGameId(null);
    }
  }, [session]);

  if (!session) {
    return <Login />;
  }

  if (activeGameId) {
    return (
      <Game
        gameId={activeGameId}
        onLeave={() => setActiveGameId(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">
          Mage <span className="text-fuchsia-400">Modern UI</span>
        </h1>
        <nav className="flex gap-2 text-sm">
          <TabButton current={tab} value="lobby" onClick={setTab}>
            Lobby
          </TabButton>
          <TabButton current={tab} value="decks" onClick={setTab}>
            Decks
          </TabButton>
          <TabButton current={tab} value="cards" onClick={setTab}>
            Cards
          </TabButton>
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-400">
            {session.username}
            {session.isAdmin && (
              <span className="ml-1 text-xs bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
                ADMIN
              </span>
            )}
            {session.isAnonymous && !session.isAdmin && (
              <span className="ml-1 text-xs text-zinc-500">(guest)</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm text-zinc-400 hover:text-zinc-100"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-4">
        {tab === 'lobby' && (
          <>
            <Lobby />
            <LobbyChat />
            <DevOpenGame onOpen={setActiveGameId} />
          </>
        )}
        {tab === 'decks' && <Decks />}
        {tab === 'cards' && <CardSearch />}
      </main>
    </div>
  );
}

function TabButton({
  current,
  value,
  onClick,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: (tab: Tab) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={
        'px-3 py-1.5 rounded transition-colors ' +
        (active
          ? 'bg-fuchsia-600 text-white'
          : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800')
      }
    >
      {children}
    </button>
  );
}

/**
 * Slice 5A entry-point: paste a gameId, click Open. Slice 5B will
 * auto-navigate when a {@code startGame} frame arrives.
 */
function DevOpenGame({ onOpen }: { onOpen: (id: string) => void }) {
  const [value, setValue] = useState('');
  const valid = /^[0-9a-f-]{36}$/i.test(value);
  return (
    <section className="rounded border border-zinc-800 p-3 text-sm">
      <div className="text-xs text-zinc-500 mb-2 uppercase tracking-wide">
        Dev — open game window
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="game UUID"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-100 font-mono text-xs"
        />
        <button
          type="button"
          disabled={!valid}
          onClick={() => onOpen(value.trim())}
          className="px-3 py-1 rounded bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 text-white"
        >
          Open
        </button>
      </div>
    </section>
  );
}

export default App;
