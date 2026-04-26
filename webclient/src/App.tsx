import { useEffect, useState } from 'react';
import { useAuthStore } from './auth/store';
import { CardSearch } from './pages/CardSearch';
import { Lobby } from './pages/Lobby';
import { Login } from './pages/Login';

type Tab = 'lobby' | 'cards';

/**
 * Auth-gated tab shell. No router yet — slice 4.1 has just two
 * authenticated screens, so a tab switch is enough. React Router
 * comes when the screen count justifies it.
 *
 * <p>On mount, the persisted session (if any) is verified against
 * the server. Stale tokens are cleared so the user lands on Login;
 * valid tokens stay in place and the user lands directly on the
 * lobby (slice 4.2 — persistent session).
 */
export function App() {
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const verify = useAuthStore((s) => s.verify);
  const [tab, setTab] = useState<Tab>('lobby');

  useEffect(() => {
    void verify();
  }, [verify]);

  if (!session) {
    return <Login />;
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

      <main className="max-w-4xl mx-auto p-6">
        {tab === 'lobby' && <Lobby />}
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

export default App;
