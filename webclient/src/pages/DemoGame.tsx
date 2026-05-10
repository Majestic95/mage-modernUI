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
import {
  buildDemoGameView,
  getPossibleAttackerIds,
} from '../game/devFixtures';
import { VariantSwitcher } from '../game/VariantSwitcher';
import { useGameStore } from '../game/store';
import { useAuthStore } from '../auth/store';
import { webGameClientMessageSchema } from '../api/schemas';
import {
  LayoutVariantProvider,
  getActiveVariant,
  setVariantInUrl,
  type LayoutVariant,
} from '../layoutVariants';

export function DemoGame() {
  // Slice 1-X-smoke — `?combat=1` URL knob seeds the fixture with
  // 3 attacker groups across 3 different defenders so Bundle 1's
  // combat-active features (defender-color + dash arrows,
  // IncomingTag badges, wave-reveal stagger, DefenderBeams) all
  // light up at once for live verification.
  //
  // Slice 4-X.1 — `?combat=declare` parks at DECLARE_ATTACKERS
  // with possibleAttackers populated, surfacing Bundle 4's
  // eligibility pulse (4-C) + pulse-off-when-assigned gate (4-X.0
  // N-E) — neither was reachable under the static `?combat=1`
  // damage-step fixture. `?tapped=1` taps a subset of attackers
  // to verify the tap-rotation fix (4-X.0 B-1).
  //
  // Default-off keeps the pre-combat layout-iteration behavior
  // intact for other tests.
  const fixtureOpts = useMemo(() => {
    if (typeof window === 'undefined') {
      return { combatActive: false } as const;
    }
    const params = new URLSearchParams(window.location.search);
    const combat = params.get('combat');
    const combatActive = combat === '1' || combat === 'declare';
    const combatPhase: 'damage' | 'declare' | undefined =
      combat === 'declare' ? 'declare' : undefined;
    const tappedAttackers = params.get('tapped') === '1';
    // Foundation Option D (2026-05-10) — `?stack=1` seeds a
    // Lightning Bolt on the stack alongside combat groups so the
    // new z-layer cohabit-mode rendering is reachable from the
    // static fixture.
    const stackDuringCombat = params.get('stack') === '1';
    return {
      combatActive,
      combatPhase,
      tappedAttackers,
      stackDuringCombat,
    };
  }, []);
  const gameView = useMemo(
    () => buildDemoGameView(fixtureOpts),
    [fixtureOpts],
  );
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
    // Slice 4-X.1 — when `?combat=declare`, seed a pendingDialog
    // gameSelect message with possibleAttackers populated so
    // interactionMode resolves to `declareAttackers`, eligibleCombatIds
    // populates, and Bundle 4 slice 4-C's eligibility pulse fires on
    // the eligible-but-unassigned creatures (att2-att4). att1 sits in
    // combat already → pulse-off path (4-X.0 N-E gate) demonstrated
    // side-by-side with the pulse-on path.
    const possibleAttackers =
      fixtureOpts.combatPhase === 'declare'
        ? getPossibleAttackerIds(gameView)
        : [];
    const pendingDialog =
      possibleAttackers.length > 0
        ? {
            method: 'gameSelect' as const,
            messageId: 1,
            data: webGameClientMessageSchema.parse({
              gameView: null,
              message: 'Select attackers',
              targets: [],
              cardsView1: {},
              cardsView2: {},
              min: 0,
              max: 0,
              flag: false,
              choice: null,
              options: {
                leftBtnText: '',
                rightBtnText: '',
                possibleAttackers,
                possibleBlockers: [],
                specialButton: '',
                isTriggerOrder: false,
              },
              multiAmount: null,
            }),
          }
        : null;
    useGameStore.setState({ gameView, connection: 'open', pendingDialog });
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
  }, [gameView, fixtureOpts]);

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
