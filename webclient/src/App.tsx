/**
 * Phase 4.0 placeholder. Confirms the scaffold renders and Tailwind
 * is wired. Real screens (login, lobby, card library) land in the
 * next slices and will replace this.
 */
export function App() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight">
          Mage <span className="text-fuchsia-400">Modern UI</span>
        </h1>
        <p className="text-zinc-400">
          Webclient scaffold ready. Phase 4 begins here.
        </p>
        <p className="text-sm text-zinc-500">
          Backend: <code className="text-zinc-300">http://localhost:18080</code>
        </p>
      </div>
    </main>
  );
}

export default App;
