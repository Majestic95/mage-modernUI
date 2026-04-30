import { useEffect, useMemo, useState } from 'react';
import { LayoutGroup, MotionConfig } from 'framer-motion';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';
import { GameHeader } from '../game/GameHeader';
import { GameTable } from '../game/GameTable';
import { buildScenario, type DemoScenario } from './demoFixtures';

/**
 * Slice 70-Z polish-phase preview harness. Renders the full
 * redesigned game window (GameHeader + GameTable + LayoutGroup)
 * driven by a hardcoded fixture instead of a live xmage backend.
 *
 * <p>Wiring:
 * <ul>
 *   <li>Sets a fake {@code WebSession} on auth store so the
 *       redesigned children's {@code session?.username} reads
 *       resolve. The session is unauthenticated server-side; no
 *       network calls succeed (which is fine — demo mode also
 *       doesn't construct a {@link GameStream}).</li>
 *   <li>Pushes the fixture {@code WebGameView} into the game
 *       store via the dev-only setter so consumers reading from
 *       the store (ActionButton, GameLog, etc.) see the same
 *       snapshot as the GameTable's prop.</li>
 *   <li>Mounts {@link GameHeader} + {@link GameTable} with
 *       {@code stream={null}} — clicks won't dispatch to the
 *       engine but visual state is what we want to inspect.</li>
 * </ul>
 *
 * <p><b>Not shipped to production.</b> The route is gated in
 * {@link App} by {@code import.meta.env.DEV} + the
 * {@code ?demo=...} URL flag; outside DEV the URL silently
 * returns to the normal lobby flow.
 */
export function DemoGame({
  scenario,
  onLeave,
}: {
  scenario: DemoScenario;
  onLeave: () => void;
}) {
  const setAuthSession = useAuthStore.setState;
  const [{ gameView, myPlayerName }] = useState(() => {
    // Slice 70-Z polish — `?stack=N` URL flag (1..12) controls how
    // many cards sit on the active stack. Default 1 (just Lightning
    // Bolt focal). With 2+ the focal rotates through Counterspell /
    // Path to Exile / etc., and earlier spells fan behind the
    // topmost per picture-catalog §3.1.
    const stackOverride =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('stack')
        : null;
    const stackCount = stackOverride
      ? Math.max(1, Math.min(parseInt(stackOverride, 10) || 1, 12))
      : 1;
    const scenarioBuild = buildScenario(scenario, { stackCount });
    // Slice 70-Z polish — `?priority=<name>` URL param flips priority
    // + active turn to a named player so the screenshot reviewer can
    // exercise multicolor particle-drift / halo-rotate without
    // editing fixtures or hand-tinkering with the store. Param name
    // matches a player's `name` in the fixture (e.g. "atraxa",
    // "korvold", "meren", or the local player name).
    const priorityOverride =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('priority')
        : null;
    if (priorityOverride) {
      const target = scenarioBuild.gameView.players.find(
        (p) => p.name === priorityOverride,
      );
      if (target) {
        const adjustedPlayers = scenarioBuild.gameView.players.map((p) => ({
          ...p,
          isActive: p.playerId === target.playerId,
          hasPriority: p.playerId === target.playerId,
        }));
        return {
          ...scenarioBuild,
          gameView: {
            ...scenarioBuild.gameView,
            players: adjustedPlayers,
            activePlayerName: target.name,
            priorityPlayerName: target.name,
          },
        };
      }
    }
    return scenarioBuild;
  });

  // Inject a fake session + fixture gameView once on mount. Direct
  // setState bypasses the schema-validating actions; safe in DEV
  // since the fixture builder is the only writer.
  //
  // Slice 70-Z polish — also expose the game store on window so the
  // dev console can poke at state directly. DEV-only via the
  // {@code import.meta.env.DEV} gate at the route level (see
  // {@link App}). Convenient for testing priority transitions /
  // disconnected toggles / etc. without rebuilding fixtures.
  useEffect(() => {
    const prevSession = useAuthStore.getState().session;
    setAuthSession({
      session: {
        schemaVersion: '1.0',
        token: 'demo-token',
        username: myPlayerName,
        isAnonymous: true,
        isAdmin: false,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    useGameStore.setState({
      gameView,
      connection: 'open',
      closeReason: '',
      protocolError: null,
      // Slice 70-Z visual critic IMP-3 — wrap card-name spans in
      // <font color="..."> markup so GameLog's renderUpstreamMarkup
      // path actually fires and the screenshot reviewer sees the
      // catalog §5.A "card name highlight" treatment.
      gameLog: [
        {
          ts: Date.now() - 60_000,
          messageId: 1,
          message:
            'korvold played <font color="#9F75F0">Blood Crypt</font>',
        },
        {
          ts: Date.now() - 45_000,
          messageId: 2,
          message:
            'atraxa cast <font color="#9F75F0">Toxic Deluge</font>',
        },
        {
          ts: Date.now() - 30_000,
          messageId: 3,
          message:
            'meren returned <font color="#9F75F0">Sakura-Tribe Elder</font> to hand',
        },
        {
          ts: Date.now() - 5_000,
          messageId: 4,
          message: `${myPlayerName} cast <font color="#9F75F0">The Locust God</font>`,
        },
      ],
    });
    // Window-side debug hooks. Drop on unmount.
    interface DemoWindowExtensions {
      __useGameStore?: typeof useGameStore;
      __useAuthStore?: typeof useAuthStore;
    }
    const w = window as unknown as DemoWindowExtensions;
    w.__useGameStore = useGameStore;
    w.__useAuthStore = useAuthStore;

    return () => {
      // Restore prior auth + clear injected gameView when leaving.
      setAuthSession({ session: prevSession });
      useGameStore.getState().reset();
      delete w.__useGameStore;
      delete w.__useAuthStore;
    };
  }, [gameView, myPlayerName, setAuthSession]);

  // Memoize the gameId used by GameTable's labels — GameTable
  // doesn't reach into a stream when the prop is null.
  const gameId = useMemo(() => 'demo-game', []);

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
          <GameHeader
            gameId={gameId}
            connection="open"
            closeReason=""
            gameView={gameView}
            onLeave={onLeave}
            stream={null}
          />
          <div className="flex-1 min-h-0">
            <GameTable
              gameId={gameId}
              gameView={gameView}
              stream={null}
            />
          </div>
          <DemoBanner scenario={scenario} onLeave={onLeave} />
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}

/**
 * Tiny corner badge so the user (and screenshots) always see that
 * this is a fixture-driven preview, not a live game.
 */
function DemoBanner({
  scenario,
  onLeave,
}: {
  scenario: DemoScenario;
  onLeave: () => void;
}) {
  return (
    <div
      data-testid="demo-banner"
      className="fixed bottom-2 left-2 z-50 flex items-center gap-2 rounded
        bg-fuchsia-900/70 backdrop-blur-sm px-2 py-1 text-[10px]
        font-medium uppercase tracking-wider text-fuchsia-100
        shadow-md ring-1 ring-fuchsia-700"
    >
      <span>DEMO · {scenario}</span>
      <button
        type="button"
        onClick={onLeave}
        className="text-fuchsia-200 hover:text-white underline-offset-2 hover:underline"
      >
        exit
      </button>
    </div>
  );
}
