/**
 * Cinematic lab — dev-only page mounted at `?game=cinematic-lab` for
 * triggering each combat-bundle slice's animation on demand. Started
 * as Bundle 5 verification surface; Bundle 6's slice 6-A v2
 * (overlay-path ink draw-in) added a "Declare attackers" trigger;
 * slice 6-Y.1 added "Declare blockers" + "Damage step (cross-
 * dissolve)" triggers so Bundle 6 slices 6-B + 6-C are demoable for
 * live A/B without firing a real game.
 *
 * <p><b>File-size discipline:</b> trigger callbacks live in
 * {@link ./CinematicLabTriggers} (extracted in slice 6-Y.1 when adding
 * the 2 new buttons would have pushed this file past the 500 LOC hard
 * cap). Panel chrome lives in {@link ./CinematicLabPanel} (slice
 * 6-A.2). This file is now just the page-level wrapper: variant
 * provider + motion config + layout group + minimal-chrome provider +
 * GameHeader + GameTable mounts + initial store seeding + lab status
 * state.
 *
 * <p>Why a separate page (not gated inside DemoGame): DemoGame is the
 * canonical layout-iteration fixture; bolting the lab controls onto
 * it would obscure the fixture's role. The lab page reuses
 * `buildDemoGameView` (via the triggers hook) and the same chrome so
 * the cinematic mountpoints are present, but adds a `position: fixed`
 * control panel on top.
 *
 * <p><b>Tabletop load-bearing rules respected:</b>
 *   T1 — pod-zone footprints unchanged (lab uses the same fixture);
 *   T2 — control panel is `position: fixed` (action panel is bottom-
 *        right; lab panel is top-right to avoid overlap);
 *   T3 — full Scryfall art via existing CardFace;
 *   T4 — 1440p target;
 *   T5 — no engine code, no wire change, no schema bump;
 *   T6 — tabletop variant default;
 *   T7 — cross/plus 4-pod arrangement.
 *
 * <p><b>What each button triggers:</b>
 * <ul>
 *   <li><b>Combat damage hit</b> — decrements an opponent's life by 3.
 *       Slice 5-A parcels traverse the arrow path; 5-B portrait bloom;
 *       5-C freeze-frame blooms from viewport edges.</li>
 *   <li><b>Creature dies</b> — moves a battlefield creature to its
 *       owner's graveyard; 5-D 150ms desaturate during fly-to-grave.</li>
 *   <li><b>Lethal commander damage (21)</b> — two-step setState
 *       (20 → 21) crossing the threshold; 5-E banner + viewport
 *       pulse.</li>
 *   <li><b>Declare attackers</b> — slice 6-A v2's attack-arrow ink
 *       draw-in (400ms symmetric ease). flushSync unmount so
 *       TargetingArrow's latched drawIn captures fresh props.</li>
 *   <li><b>Declare blockers</b> — slice 6-Y.1 / 6-B isolation demo.
 *       The lab's baseline strips blockers; clicking re-attaches the
 *       captured blocker to its original combat group; 6-B's snap-in
 *       fires (200ms cubic-bezier overshoot).</li>
 *   <li><b>Damage step (cross-dissolve)</b> — slice 6-Y.1 / 6-C demo.
 *       Sets `gameView.step` to FIRST_COMBAT_DAMAGE (cool shimmer
 *       mounts), holds 1500ms, then transitions to COMBAT_DAMAGE
 *       (warm cross-dissolve via 300ms stroke transition added in
 *       6-X.0).</li>
 *   <li><b>Reset fixture</b> — restores the stripped baseline (no
 *       blockers, no damage step, life 40); also bumps the trigger
 *       epoch so any in-flight async cinematic is cancelled.</li>
 * </ul>
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGroup, MotionConfig } from 'framer-motion';
import { BattlefieldBackground } from '../game/BattlefieldBackground';
import { GameHeader } from '../game/GameHeader';
import { MinimalChromeProvider } from '../game/MinimalChromeContext';
import { ControlPanel } from './CinematicLabPanel';
import { useCinematicLabTriggers } from './CinematicLabTriggers';
import { GameTable } from '../game/GameTable';
import { useGameStore } from '../game/store';
import { useAuthStore } from '../auth/store';
import { LayoutVariantProvider, getActiveVariant } from '../layoutVariants';

interface LabState {
  /** Last announcement string shown in the panel (no aria-live). */
  lastAction: string;
}

export function CinematicLab() {
  const variant = useMemo(() => getActiveVariant(), []);
  const [labState, setLabState] = useState<LabState>(() => ({
    lastAction: 'Ready. Click a button to trigger a Bundle 5 cinematic.',
  }));
  const announce = useCallback((lastAction: string) => {
    setLabState({ lastAction });
  }, []);
  const triggers = useCinematicLabTriggers(announce);
  const { baselineGameView } = triggers;

  // Seed the store with the (stripped) combat-active fixture + a fake
  // auth session so every component that reads from useGameStore /
  // useAuthStore lights up. Mirrors DemoGame's pattern (see
  // DemoGame.tsx:104-154) but without the URL-knob branching since the
  // lab always wants the combat-active variant.
  useEffect(() => {
    useGameStore.setState({
      gameView: baselineGameView,
      connection: 'open',
      pendingDialog: null,
    });
    const me = baselineGameView.players.find(
      (p) => p.playerId === baselineGameView.myPlayerId,
    );
    useAuthStore.setState({
      session: {
        schemaVersion: '1.15',
        token: 'tok-cinematic-lab',
        username: me?.name ?? 'MAJEST1C',
        isAnonymous: true,
        isAdmin: false,
        expiresAt: '2099-01-01T00:00:00Z',
      },
    });
  }, [baselineGameView]);

  // Mirror Game.tsx's outer chrome — h-screen + overflow-hidden is
  // load-bearing for GameTable's h-full (otherwise it collapses to 0).
  return (
    <LayoutVariantProvider variant={variant}>
      <MotionConfig reducedMotion="user">
        <LayoutGroup>
          <MinimalChromeProvider enabled>
            <div
              className="relative h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden"
              data-testid="cinematic-lab"
            >
              <BattlefieldBackground />
              <GameHeader
                gameId="cinematic-lab"
                connection="open"
                closeReason=""
                gameView={baselineGameView}
                onLeave={() => {}}
                stream={null}
              />
              <div className="flex-1 min-h-0">
                <GameTable
                  gameId="cinematic-lab"
                  gameView={baselineGameView}
                  stream={null}
                />
              </div>
              <ControlPanel
                lastAction={labState.lastAction}
                onCombatDamage={triggers.triggerCombatDamage}
                onCreatureDies={triggers.triggerCreatureDies}
                onLethal={triggers.triggerLethalCommanderDamage}
                onDeclareAttackers={triggers.triggerDeclareAttackers}
                onDeclareBlockers={triggers.triggerDeclareBlockers}
                onDamageStep={triggers.triggerDamageStep}
                onEnterCombat={triggers.triggerEnterCombat}
                onExitCombat={triggers.triggerExitCombat}
                onCycleSubSteps={triggers.triggerCycleSubSteps}
                onReset={triggers.resetFixture}
              />
            </div>
          </MinimalChromeProvider>
        </LayoutGroup>
      </MotionConfig>
    </LayoutVariantProvider>
  );
}
