/**
 * Dev fixture renderer — no auth, no server, no WebSocket. Renders
 * GameTable with a stress-tested 4-player Commander view from
 * {@link buildDemoGameView}. Used for layout iteration where standing
 * up a real game would be slow / require AI bots / etc.
 *
 * <p>Wrapped in MotionConfig + LayoutGroup the same way Game.tsx does
 * in production so motion components don't warn. The {@code stream}
 * passed to GameTable is intentionally null — no priority dispatch,
 * no responses; this is a STATIC view for layout review. Click
 * affordances render but do nothing actionable beyond local state
 * (ZoneBrowser modals, hover tooltips, etc.).
 *
 * <p><b>Slice A</b> — mounts the {@link LayoutVariantProvider} +
 * {@link VariantSwitcher} so layout-variant work happens entirely
 * inside the fixture surface without polluting the production game
 * window. The variant lives in React state above the provider; the
 * switcher updates both state (re-render) and URL (share-link /
 * reload persistence). Today only {@code 'current'} exists — adding
 * a variant is mechanical (extend LAYOUT_VARIANTS, branch inside the
 * consuming component).
 *
 * <p>Extracted from App.tsx in slice A to bring App.tsx back under
 * the 500-LOC hard cap (App.tsx hit 509 LOC pre-extraction with no
 * documented exception).
 */
import { useEffect, useMemo, useState } from 'react';
import { LayoutGroup, MotionConfig } from 'framer-motion';
import { GameHeader } from '../game/GameHeader';
import { GameTable } from '../game/GameTable';
import { buildDemoGameView } from '../game/devFixtures';
import { VariantSwitcher } from '../game/VariantSwitcher';
import { useGameStore } from '../game/store';
import { useAuthStore } from '../auth/store';
import {
  LayoutVariantProvider,
  getActiveVariant,
  setVariantInUrl,
  type LayoutVariant,
} from '../layoutVariants';

export function DemoGame() {
  const gameView = useMemo(() => buildDemoGameView(), []);
  // Source-of-truth for the active variant lives here — above the
  // Provider — so the switcher can update both React state (forces
  // re-render through the context) and the URL (shareable + survives
  // reload) in one operation.
  const [variant, setVariant] = useState<LayoutVariant>(() =>
    getActiveVariant(),
  );

  // Z3 (2026-05-03) — write the fixture gameView into useGameStore
  // and seed a fake auth session so components that read directly
  // from the stores (ActionButton, MyHand priority indicator, etc.)
  // light up in fixture mode. Without this, ActionButton returned
  // null because both `gameView` and `session` selectors resolved
  // to null and the user couldn't see the morphing "Next Step"
  // button. Username matches the fixture's MAJEST1C so the
  // myPriority derivation reads true.
  useEffect(() => {
    useGameStore.setState({ gameView, connection: 'open' });
    useAuthStore.setState({
      session: {
        schemaVersion: '1.15',
        token: 'tok-fixture',
        username: gameView.players.find((p) => p.playerId === gameView.myPlayerId)?.name ?? 'MAJEST1C',
        isAnonymous: true,
        isAdmin: false,
        expiresAt: '2099-01-01T00:00:00Z',
      },
    });
  }, [gameView]);

  const onVariantChange = (next: LayoutVariant) => {
    setVariantInUrl(next);
    setVariant(next);
  };

  // Mirror Game.tsx's outer chrome — h-screen + overflow-hidden is
  // load-bearing: GameTable uses h-full which collapses to 0 without
  // a parent that has a defined height. Pre-extraction the demo
  // route let body scroll vertically because GameTable content
  // overflowed an undefined-height root, violating the battlefield's
  // "no scroll wheel" rule.
  //
  // Slice B-7 (element #8) — fixture mode now mounts GameHeader as a
  // sibling above GameTable, mirroring real Game.tsx (line 160-167).
  // GameHeader hosts the PhaseTimeline at the top of the screen
  // (slice 70-O REDESIGN treatment) — the same "TOP strip" position
  // tabletop's element #8 spec calls for. Without this, the fixture
  // had no phase timeline visible at all. The header takes constants
  // for connection / closeReason / onLeave since the fixture has no
  // real WebSocket; clicking Leave/Concede etc. is a no-op in the
  // fixture by design.
  return (
    <LayoutVariantProvider variant={variant}>
      <MotionConfig reducedMotion="user">
        <LayoutGroup>
          <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
            <VariantSwitcher current={variant} onChange={onVariantChange} />
            <GameHeader
              gameId="demo-fixture"
              connection="open"
              closeReason=""
              gameView={gameView}
              onLeave={() => {}}
              stream={null}
            />
            <div className="flex-1 min-h-0">
              <GameTable
                gameId="demo-fixture"
                gameView={gameView}
                stream={null}
              />
            </div>
          </div>
        </LayoutGroup>
      </MotionConfig>
    </LayoutVariantProvider>
  );
}
