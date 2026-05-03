import { useEffect, useState } from 'react';
import { useAuthStore } from './auth/store';
import { useGameStore } from './game/store';
import { NewLobbyScreen } from './lobby/NewLobbyScreen';
import { CardSearch } from './pages/CardSearch';
import { Decks } from './pages/Decks';
import { Game } from './pages/Game';
import { Lobby } from './pages/Lobby';
import { LobbyChat } from './pages/LobbyChat';
import { Login } from './pages/Login';
import { SideboardModal } from './pages/SideboardModal';
import { SpectatorPlaceholder } from './pages/SpectatorPlaceholder';
import { matchSpectatePath } from './pages/spectatorPath';

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
const ACTIVE_LOBBY_STORAGE_KEY = 'xmage.activeLobbyId';

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
 * Slice L4 — initial activeLobbyId. URL param wins (covers fixture
 * dev-entry + paste-the-link flows); falls back to persisted state
 * so a reload while inside the lobby keeps the user there.
 *
 * <p>Slice L8 review fix — persisted entry is also tagged with the
 * username it was stored under. On read, if the current session's
 * username doesn't match, the stale entry is dropped so user A's
 * lobby doesn't follow user B into login.
 */
const ACTIVE_LOBBY_USER_STORAGE_KEY = 'xmage.activeLobbyId.user';

function readInitialLobbyId(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lobby');
    if (fromUrl) return fromUrl;
    return window.localStorage.getItem(ACTIVE_LOBBY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistLobbyId(id: string | null, username?: string): void {
  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_LOBBY_STORAGE_KEY, id);
      if (username) {
        window.localStorage.setItem(ACTIVE_LOBBY_USER_STORAGE_KEY, username);
      }
    } else {
      window.localStorage.removeItem(ACTIVE_LOBBY_STORAGE_KEY);
      window.localStorage.removeItem(ACTIVE_LOBBY_USER_STORAGE_KEY);
    }
  } catch {
    // Ignore.
  }
}

function readPersistedLobbyUser(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_LOBBY_USER_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Auth-gated tab shell.
 *
 * <p>Slice 4.1 had two screens; we used a tab switcher. Slice 5 adds
 * a full-screen game window that takes over the main area when
 * {@code activeGameId} is set. Slice 12 wires auto-navigation: when
 * the LobbyChat's room WebSocket receives a {@code startGame} frame
 * (upstream's {@code User.ccGameStarted}), the game store stashes a
 * {@code pendingStartGame} entry, and this component routes into
 * the Game window automatically. Manual override remains available
 * via the dev-only {@code DevOpenGame} entry.
 */
export function App() {
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const verify = useAuthStore((s) => s.verify);
  const [tab, setTab] = useState<Tab>('lobby');
  const [activeGameId, setActiveGameIdState] = useState<string | null>(
    () => readStoredGameId(),
  );
  const [activeLobbyId, setActiveLobbyIdState] = useState<string | null>(
    () => readInitialLobbyId(),
  );
  // 2026-05-02 polish — when a guest joins a passworded table the
  // password is collected by Lobby's PasswordPromptModal and threaded
  // through here so NewLobbyScreen can attach it to the first
  // PUT /seat/deck. Not persisted — a reload of a passworded-table
  // lobby will require the user to re-enter the password (acceptable
  // — passwords in localStorage would be a worse trade).
  const [joinPassword, setJoinPassword] = useState<string | undefined>(undefined);

  // Wrap setter so every transition writes localStorage.
  const setActiveGameId = (id: string | null) => {
    persistGameId(id);
    setActiveGameIdState(id);
  };
  // Slice L4 — same persistence pattern for the new lobby. Special
  // case: 'fixture' is dev-only and shouldn't persist (a stale
  // entry would force fixture mode after a reload even when the
  // user wanted to leave). L8 — persist alongside the username so a
  // login-as-different-user doesn't inherit the stale lobbyId.
  const setActiveLobbyId = (id: string | null, password?: string) => {
    persistLobbyId(
      id === 'fixture' ? null : id,
      session?.username,
    );
    setActiveLobbyIdState(id);
    setJoinPassword(password);
  };

  useEffect(() => {
    void verify();
  }, [verify]);

  // Auto-navigate when the lobby's room WS reports that a game
  // started for this user. We subscribe to the Zustand store as an
  // external event source rather than reading pendingStartGame via
  // React state — the setState lives in the subscription callback,
  // which is the recommended pattern for external systems pushing
  // into React (vs. synchronously reacting to React-driven state in
  // the effect body, which the linter flags as a cascading render).
  useEffect(() => {
    return useGameStore.subscribe((state, prev) => {
      if (
        state.pendingStartGame !== null &&
        state.pendingStartGame !== prev.pendingStartGame
      ) {
        const info = useGameStore.getState().consumeStartGame();
        if (info && info.gameId) {
          persistGameId(info.gameId);
          setActiveGameIdState(info.gameId);
        }
      }
    });
  }, []);

  // Drop any persisted gameId when the session goes away (logout or
  // server-side token expiry) so the next login doesn't auto-jump
  // into a stale game window. Pure side effect — no setState — so
  // it's safe inside an effect.
  useEffect(() => {
    if (!session) {
      persistGameId(null);
      persistLobbyId(null);
    }
  }, [session]);

  // Slice L8 review fix — when a session is established, validate
  // that the persisted activeLobbyId belongs to THIS user (not a
  // prior login that left state behind). Mismatch → clear so the
  // new user starts at the table list, not someone else's lobby.
  // Same lint exemption as the DUELING effect above — the cascading
  // render fires once per session-change, not on a hot path.
  useEffect(() => {
    if (!session) return;
    const storedUser = readPersistedLobbyUser();
    if (storedUser && storedUser !== session.username) {
      persistLobbyId(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveLobbyIdState(null);
    }
  }, [session]);

  // Slice L8 review (UX HIGH #7 + architecture HIGH #3) — would
  // hoist the room WebSocket to App-level so lobby↔game transitions
  // don't drop room frames. Pulled back from this batch because the
  // existing LobbyChat tests assert ownership of the connection;
  // moving it would require rewriting App.test + LobbyChat.test
  // contract assertions. Tracked as a focused tech-debt slice; the
  // singleton file at src/lobby/roomStreamSingleton.ts is the
  // scaffold for the eventual migration.

  // Slice L8 — when the lobby's start-match transition completes the
  // game store sets pendingStartGame, the existing subscriber above
  // sets activeGameId, and we clear the lobby state so the route
  // swap is clean. Without this, NewLobbyScreen and Game would
  // briefly fight to render (lobby wins per the precedence below).
  // The lint rule against setState in effects fires here; this is
  // the canonical "reconcile derived state from two external
  // signals" use case and the cascading-render cost is a single
  // extra paint at game-start, not a hot-path concern.
  useEffect(() => {
    if (activeGameId && activeLobbyId) {
      persistLobbyId(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveLobbyIdState(null);
    }
  }, [activeGameId, activeLobbyId]);

  // Slice 70-A (ADR 0011 D1) — spectator placeholder route. Resolved
  // BEFORE the auth gate so a user pasting a spectate URL sees the
  // "shipping in v2.x" placeholder regardless of auth state. The
  // server-side spectator WebSocket route is live (slice 71); only
  // the client UI is deferred. Pasting `/spectate/<uuid>` without
  // this matcher would 404 or fall back to the lobby — both
  // indistinguishable from a bug. Custom path matcher (~5 LOC)
  // avoids adding react-router-dom as a new dep; if slice 70-E later
  // needs a real router, that's its own decision.
  const spectateGameId = matchSpectatePath(window.location.pathname);
  if (spectateGameId) {
    return <SpectatorPlaceholder gameId={spectateGameId} />;
  }

  if (!session) {
    return <Login />;
  }

  // Slice L4 — programmatic lobby entry. PreLobbyModal calls
  // setActiveLobbyId(tableId) on create; the param-init path
  // (slice L1/L2 dev entry, ?lobby=fixture / ?lobby=<UUID>) seeds
  // this state at first mount via readInitialLobbyId(). Active
  // lobby takes precedence over an active game window since users
  // entering the lobby intentionally are above any persisted game
  // resumption — except: when the table state has advanced to
  // DUELING the user belongs in the game window, not the lobby.
  // The DUELING transition is handled via the existing
  // pendingStartGame flow (NewLobbyScreen keeps a room-WS open
  // for that purpose); when activeGameId gets set elsewhere we
  // clear activeLobbyId here so the route swap is clean.
  if (activeLobbyId) {
    return (
      <NewLobbyScreen
        tableId={activeLobbyId}
        joinPassword={joinPassword}
        onLeave={() => setActiveLobbyId(null)}
      />
    );
  }

  if (activeGameId) {
    return (
      <>
        <Game
          gameId={activeGameId}
          onLeave={() => setActiveGameId(null)}
        />
        <SideboardModal />
      </>
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
            <Lobby onEnterLobby={setActiveLobbyId} />
            <LobbyChat />
            <DevOpenGame onOpen={setActiveGameId} />
          </>
        )}
        {tab === 'decks' && <Decks />}
        {tab === 'cards' && <CardSearch />}
      </main>

      <Footer />
      <SideboardModal />
    </div>
  );
}

/**
 * Trademark + attribution footer. Links to LICENSE-NOTICES.md in the
 * repo for the full text. The disclaimer is also load-bearing for the
 * "not affiliated with WotC" framing called out in the audit.
 */
function Footer() {
  return (
    <footer
      data-testid="app-footer"
      className="max-w-4xl mx-auto px-6 pb-6 text-center text-xs text-zinc-500 space-y-1"
    >
      <p>
        Magic: The Gathering is a trademark of Wizards of the Coast LLC.
        This project is not produced, endorsed, supported by, or
        affiliated with Wizards of the Coast.
      </p>
      <p>
        Built on the{' '}
        <a
          href="https://github.com/magefree/mage"
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-zinc-300 underline underline-offset-2"
        >
          XMage
        </a>{' '}
        rules engine (MIT). See{' '}
        <a
          href="https://github.com/Majestic95/mage-modernUI/blob/main/LICENSE-NOTICES.md"
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-zinc-300 underline underline-offset-2"
        >
          LICENSE-NOTICES
        </a>{' '}
        for full attributions.
      </p>
    </footer>
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
