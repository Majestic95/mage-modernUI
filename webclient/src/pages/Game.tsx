import { useEffect, useMemo } from 'react';
import { useAuthStore } from '../auth/store';
import { GameStream } from '../game/stream';
import { useGameStore } from '../game/store';
import type {
  WebCardView,
  WebCommandObjectView,
  WebGameView,
  WebPermanentView,
  WebPlayerView,
} from '../api/schemas';
import { ActionPanel } from './ActionPanel';
import { GameDialog } from './GameDialog';

interface Props {
  gameId: string;
  onLeave: () => void;
}

/**
 * Slice A static game window — read-only render of the latest
 * {@link WebGameView} (per ADR 0005 §5.1).
 *
 * <p>Layout: opponent at top, controlling player at bottom. Each side
 * shows life total, hand count (or hand cards for self), zone counts,
 * mana pool, and battlefield as named cards with tapped/sick markers.
 * Stack, combat groups, graveyard / exile / sideboard panels and chat
 * land in slice B; player input lands in slice C (ADR §5.2).
 *
 * <p>The component owns one {@link GameStream} for its lifetime — open
 * on mount, close on unmount or {@code onLeave}. Frame dispatch goes
 * to {@link useGameStore}; this component just reads.
 */
export function Game({ gameId, onLeave }: Props) {
  const session = useAuthStore((s) => s.session);
  const connection = useGameStore((s) => s.connection);
  const closeReason = useGameStore((s) => s.closeReason);
  const protocolError = useGameStore((s) => s.protocolError);
  const gameView = useGameStore((s) => s.gameView);
  const reset = useGameStore((s) => s.reset);

  // Memoized so children that need to send (ActionPanel, GameDialog)
  // get a stable reference. useMemo computes pre-render so the
  // lifecycle effect doesn't have to setState.
  const stream = useMemo(
    () => (session ? new GameStream({ gameId, token: session.token }) : null),
    [gameId, session],
  );

  useEffect(() => {
    if (!stream) return;
    stream.open();
    return () => {
      stream.close();
      reset();
    };
  }, [stream, reset]);

  if (!session) {
    return (
      <div className="p-6 text-zinc-300">
        Not signed in.{' '}
        <button
          type="button"
          className="text-fuchsia-400 hover:text-fuchsia-300"
          onClick={onLeave}
        >
          Back to lobby
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <Header
        gameId={gameId}
        connection={connection}
        closeReason={closeReason}
        gameView={gameView}
        onLeave={onLeave}
      />
      {protocolError && (
        <div role="alert" className="bg-red-900/40 border-b border-red-800 px-6 py-2 text-sm text-red-200">
          {protocolError}
        </div>
      )}
      <main className="flex-1 flex flex-col">
        {gameView ? (
          <Battlefield gv={gameView} />
        ) : (
          <Waiting connection={connection} />
        )}
      </main>
      {gameView && <ActionPanel stream={stream} />}
      <GameDialog stream={stream} />
    </div>
  );
}

/* ---------- header ---------- */

function Header({
  gameId,
  connection,
  closeReason,
  gameView,
  onLeave,
}: {
  gameId: string;
  connection: string;
  closeReason: string;
  gameView: WebGameView | null;
  onLeave: () => void;
}) {
  return (
    <header className="border-b border-zinc-800 px-6 py-2 flex items-center justify-between">
      <div className="flex items-baseline gap-4 text-sm">
        <span className="text-zinc-500">Game</span>
        <span className="font-mono text-xs text-zinc-400">{gameId}</span>
      </div>
      {gameView && (
        <div className="text-sm text-zinc-300 flex items-baseline gap-3">
          <span>Turn {gameView.turn}</span>
          <span className="text-zinc-500">{phaseLabel(gameView)}</span>
          {gameView.priorityPlayerName && (
            <span className="text-fuchsia-300">
              Priority: {gameView.priorityPlayerName}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs">
        <ConnectionDot state={connection} reason={closeReason} />
        <button
          type="button"
          onClick={onLeave}
          className="text-zinc-400 hover:text-zinc-100"
        >
          Leave
        </button>
      </div>
    </header>
  );
}

function ConnectionDot({ state, reason }: { state: string; reason: string }) {
  const color =
    state === 'open'
      ? 'bg-emerald-400'
      : state === 'connecting'
        ? 'bg-amber-400 animate-pulse'
        : state === 'error'
          ? 'bg-red-500'
          : 'bg-zinc-600';
  const label = state === 'closed' && reason ? `closed: ${reason}` : state;
  return (
    <span className="flex items-center gap-1.5 text-zinc-500" title={label}>
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

/* ---------- waiting ---------- */

function Waiting({ connection }: { connection: string }) {
  if (connection === 'connecting') {
    return <Centered>Connecting…</Centered>;
  }
  if (connection === 'error' || connection === 'closed') {
    return <Centered>Connection {connection}.</Centered>;
  }
  return <Centered>Waiting for game state…</Centered>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center text-zinc-500">
      {children}
    </div>
  );
}

/* ---------- battlefield ---------- */

function Battlefield({ gv }: { gv: WebGameView }) {
  const me = useMemo(
    () => gv.players.find((p) => p.playerId === gv.myPlayerId) ?? null,
    [gv.players, gv.myPlayerId],
  );
  const opponents = useMemo(
    () => gv.players.filter((p) => p.playerId !== gv.myPlayerId),
    [gv.players, gv.myPlayerId],
  );

  return (
    <div className="flex-1 flex flex-col">
      {/* Opponents row(s) — top */}
      <section className="flex-1 border-b border-zinc-800 p-4 space-y-4 overflow-auto">
        {opponents.map((p) => (
          <PlayerArea key={p.playerId} player={p} perspective="opponent" />
        ))}
        {opponents.length === 0 && (
          <p className="text-zinc-500 italic">No opponents in this view.</p>
        )}
      </section>

      {/* Self — bottom */}
      <section className="flex-1 p-4 space-y-4 overflow-auto">
        {me ? (
          <>
            <PlayerArea player={me} perspective="self" />
            <MyHand hand={gv.myHand} />
          </>
        ) : (
          <p className="text-zinc-500 italic">
            Spectator view — no controlling player.
          </p>
        )}
      </section>
    </div>
  );
}

function PlayerArea({
  player,
  perspective,
}: {
  player: WebPlayerView;
  perspective: 'self' | 'opponent';
}) {
  const battlefield = Object.values(player.battlefield);
  return (
    <div
      data-testid={`player-area-${perspective}`}
      className="rounded border border-zinc-800 bg-zinc-900/40 p-3"
    >
      <header className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-3">
          <span className="font-medium">{player.name || '<unknown>'}</span>
          {player.isActive && (
            <span className="text-xs bg-fuchsia-500/20 text-fuchsia-300 px-1.5 py-0.5 rounded">
              ACTIVE
            </span>
          )}
          {player.hasPriority && (
            <span className="text-xs bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
              PRIORITY
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-4 text-sm text-zinc-400">
          <span>
            <span className="text-zinc-500">Life</span>{' '}
            <span className="text-zinc-100 font-mono">{player.life}</span>
          </span>
          <span>
            <span className="text-zinc-500">Lib</span>{' '}
            <span className="font-mono">{player.libraryCount}</span>
          </span>
          <span>
            <span className="text-zinc-500">Hand</span>{' '}
            <span className="font-mono">{player.handCount}</span>
          </span>
          <span>
            <span className="text-zinc-500">Grave</span>{' '}
            <span className="font-mono">
              {Object.keys(player.graveyard).length}
            </span>
          </span>
          <ManaPool player={player} />
        </div>
      </header>
      <div className="flex flex-wrap gap-1.5">
        {battlefield.length === 0 ? (
          <span className="text-xs text-zinc-600 italic">
            No permanents yet.
          </span>
        ) : (
          battlefield.map((perm) => (
            <PermanentChip key={perm.card.id} perm={perm} />
          ))
        )}
      </div>
      <CommandZone entries={player.commandList} />
    </div>
  );
}

/**
 * Command-zone strip — renders any commanders / emblems / dungeons /
 * planes the player has, keyed by upstream UUID. Slice 11 ships the
 * placeholder shape (chip with kind tag + name + tooltip on rules);
 * full card art lookup for the {@code commander} kind lands later
 * alongside the broader card-art initiative.
 */
function CommandZone({ entries }: { entries: WebCommandObjectView[] }) {
  if (!entries || entries.length === 0) {
    return null;
  }
  return (
    <div
      data-testid="command-zone"
      className="mt-2 flex flex-wrap gap-1.5 border-t border-zinc-800 pt-2"
    >
      <span className="text-xs uppercase tracking-wide text-zinc-500 mr-1">
        Command
      </span>
      {entries.map((entry) => (
        <CommandChip key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function CommandChip({ entry }: { entry: WebCommandObjectView }) {
  const kindStyle =
    entry.kind === 'commander'
      ? 'border-amber-700/60 text-amber-200'
      : entry.kind === 'emblem'
        ? 'border-fuchsia-700/60 text-fuchsia-200'
        : entry.kind === 'dungeon'
          ? 'border-emerald-700/60 text-emerald-200'
          : entry.kind === 'plane'
            ? 'border-sky-700/60 text-sky-200'
            : 'border-zinc-700 text-zinc-200';
  return (
    <span
      data-testid="command-chip"
      data-kind={entry.kind}
      className={`inline-flex items-baseline gap-1 px-2 py-1 rounded text-xs border bg-zinc-900 ${kindStyle}`}
      title={entry.rules.join('\n') || entry.kind}
    >
      <span className="uppercase text-[10px] tracking-wide opacity-70">
        {entry.kind}
      </span>
      <span className="font-medium">{entry.name || '<unknown>'}</span>
    </span>
  );
}

function ManaPool({ player }: { player: WebPlayerView }) {
  const pool = player.manaPool;
  const total =
    pool.red + pool.green + pool.blue + pool.white + pool.black + pool.colorless;
  if (total === 0) return null;
  const cells: Array<[string, number, string]> = [
    ['W', pool.white, 'text-amber-100'],
    ['U', pool.blue, 'text-sky-300'],
    ['B', pool.black, 'text-zinc-300'],
    ['R', pool.red, 'text-red-400'],
    ['G', pool.green, 'text-emerald-400'],
    ['C', pool.colorless, 'text-zinc-400'],
  ];
  return (
    <span className="flex gap-1 font-mono text-xs">
      {cells
        .filter(([, n]) => n > 0)
        .map(([sym, n, cls]) => (
          <span key={sym} className={cls}>
            {n}
            {sym}
          </span>
        ))}
    </span>
  );
}

function PermanentChip({ perm }: { perm: WebPermanentView }) {
  const tapped = perm.tapped;
  const sick = perm.summoningSickness;
  return (
    <span
      data-testid="permanent"
      data-tapped={tapped}
      className={
        'inline-flex items-baseline gap-1 px-2 py-1 rounded text-xs ' +
        'border border-zinc-700 bg-zinc-900 ' +
        (tapped ? 'opacity-60 rotate-3' : '') +
        (sick ? ' italic' : '')
      }
      title={perm.card.typeLine}
    >
      <span className="font-medium text-zinc-100">{perm.card.name}</span>
      {tapped && <span className="text-zinc-500">(T)</span>}
      {perm.damage > 0 && (
        <span className="text-red-300">−{perm.damage}</span>
      )}
    </span>
  );
}

function MyHand({ hand }: { hand: Record<string, WebCardView> }) {
  const cards = Object.values(hand);
  return (
    <div
      data-testid="my-hand"
      className="rounded border border-zinc-800 bg-zinc-900/40 p-3"
    >
      <div className="text-xs text-zinc-500 mb-2 uppercase tracking-wide">
        Your hand ({cards.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cards.length === 0 ? (
          <span className="text-xs text-zinc-600 italic">Empty hand.</span>
        ) : (
          cards.map((card) => (
            <span
              key={card.id}
              className="inline-flex items-baseline gap-1 px-2 py-1 rounded text-xs border border-zinc-700 bg-zinc-900"
              title={card.typeLine}
            >
              <span className="font-medium">{card.name}</span>
              {card.manaCost && (
                <span className="text-zinc-500 font-mono">{card.manaCost}</span>
              )}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function phaseLabel(gv: WebGameView): string {
  if (!gv.phase) return '';
  if (gv.step && gv.step !== gv.phase) {
    return `${gv.phase} · ${gv.step}`;
  }
  return gv.phase;
}
