/**
 * Cinematic lab — dev-only page mounted at `?game=cinematic-lab` for
 * triggering each combat-bundle slice's animation on demand. Started
 * as Bundle 5 verification surface; Bundle 6's slice 6-A v2
 * (overlay-path ink draw-in) added a "Declare attackers" trigger
 * (combat-exit → raf → combat-re-enter so the per-arrow
 * arrowsDrawn Set clears via the phase watcher and the ink layer
 * re-mounts fresh). Wraps the existing combat-active fixture (so
 * attackers, defenders, arrows, and commander metadata are all
 * mounted) and adds a floating control panel with one button per
 * cinematic. Each button mutates `useGameStore.setState({ gameView: ... })`
 * directly — frame-diff hooks (`useDamageEvents`, `useGameDelta`,
 * `useCommanderLethalEvents`) react to the state change and fire the
 * cinematic on top of the live DOM. Slice 6-A v2's draw-in fires
 * naturally too (TargetingArrow's drawIn prop, latched-on-mount, runs
 * the ink lifecycle the same way a real-game first-paint would).
 *
 * <p><b>File-size note:</b> 461 LOC at slice 6-A's lab-button addition
 * (was 421 at Bundle 5's lab landing). Past CLAUDE.md's 400 soft cap
 * but under the 500 hard cap. Bundle 6 will add 2 more lab buttons
 * (6-B declare-blockers, 6-C step-transition) which will push the
 * file past 500. Split queued: extract `<ControlPanel>` + `<LabButton>`
 * (~100 LOC) to a sibling `CinematicLabPanel.tsx` BEFORE slice 6-B's
 * lab button lands. Trigger callbacks + the helper stay here.
 *
 * <p>Why a separate page (not gated inside DemoGame): DemoGame is the
 * canonical layout-iteration fixture; bolting the lab controls onto
 * it would obscure the fixture's role. The lab page reuses
 * `buildDemoGameView` and the same chrome (LayoutVariantProvider +
 * MotionConfig + LayoutGroup + GameHeader + GameTable) so the
 * cinematic mountpoints are present, but adds a `position: fixed`
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
 *       The `useDamageEvents` hook detects the life delta + matches
 *       attackers from `gameView.combat[]` to fire `parcel_hit_player`
 *       events. Slice 5-A parcels traverse the arrow path, slice 5-B
 *       portrait bloom fires on the hit player, slice 5-C freeze-frame
 *       blooms from the viewport edges.</li>
 *   <li><b>Creature dies</b> — moves a battlefield creature to its
 *       owner's graveyard. The `useGameDelta` hook detects the
 *       battlefield → graveyard transition, emits a `creature_died`
 *       event, and `CardDeathSequence` applies the 150ms desaturate
 *       to the card during its fly-to-graveyard glide.</li>
 *   <li><b>Lethal commander damage (21)</b> — two-step setState (20 →
 *       21) on an opponent's `commanderDamageReceived` map. Slice 5-E
 *       fires only on the cross from < 21 to ≥ 21; the centered
 *       banner appears + viewport pulse.</li>
 *   <li><b>Reset fixture</b> — restores the baseline fixture so each
 *       cinematic can be re-triggered.</li>
 * </ul>
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { LayoutGroup, MotionConfig } from 'framer-motion';
import { BattlefieldBackground } from '../game/BattlefieldBackground';
import { GameHeader } from '../game/GameHeader';
import { GameTable } from '../game/GameTable';
import { buildDemoGameView } from '../game/devFixtures';
import { useGameStore } from '../game/store';
import { useAuthStore } from '../auth/store';
import { LayoutVariantProvider, getActiveVariant } from '../layoutVariants';
import type {
  WebGameView,
  WebPermanentView,
  WebPlayerView,
} from '../api/schemas';

interface LabState {
  /** Last announcement string shown in the panel (no aria-live). */
  lastAction: string;
}

export function CinematicLab() {
  const variant = useMemo(() => getActiveVariant(), []);
  const baselineGameView = useMemo(
    () => buildDemoGameView({ combatActive: true }),
    [],
  );
  const [labState, setLabState] = useState<LabState>(() => ({
    lastAction: 'Ready. Click a button to trigger a Bundle 5 cinematic.',
  }));

  // Seed the store with the combat-active fixture + a fake auth
  // session so every component that reads from useGameStore /
  // useAuthStore lights up. Mirrors DemoGame's pattern (see
  // DemoGame.tsx:104-154) but without the URL-knob branching since
  // the lab always wants the combat-active variant.
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

  const triggerCombatDamage = useCallback(() => {
    const current = useGameStore.getState().gameView;
    if (!current) return;
    // Pick the first non-self player who is the defender of an
    // existing combat group so the parcels have an arrow path to
    // traverse. The fixture seeds combat against goat / momur / alloc
    // (in that order) — pick the first defender appearing in combat[].
    const firstGroup = current.combat[0];
    if (!firstGroup) {
      setLabState({
        lastAction:
          'No combat groups in fixture — Combat damage cinematic unavailable.',
      });
      return;
    }
    const defenderId = firstGroup.defenderId;
    const next: WebGameView = {
      ...current,
      players: current.players.map((p) =>
        p.playerId === defenderId
          ? { ...p, life: Math.max(p.life - 3, 0) }
          : p,
      ),
    };
    useGameStore.setState({ gameView: next });
    setLabState({
      lastAction: `Combat damage hit — ${firstGroup.defenderName} life -3. Watch parcels (5-A), portrait bloom (5-B), viewport freeze-frame (5-C).`,
    });
  }, []);

  const triggerCreatureDies = useCallback(() => {
    const current = useGameStore.getState().gameView;
    if (!current) return;
    // Find any opponent battlefield creature (not the player's own,
    // so the death is "vs an opponent" — clearer narrative).
    const myId = current.myPlayerId;
    let victimPlayerIdx = -1;
    let victimPermId = '';
    let victimPerm: WebPermanentView | undefined;
    for (let i = 0; i < current.players.length; i++) {
      const p = current.players[i]!;
      if (p.playerId === myId) continue;
      const perm = Object.values(p.battlefield).find((bp) =>
        bp.card.types.includes('CREATURE'),
      );
      if (perm) {
        victimPlayerIdx = i;
        victimPermId = perm.card.id;
        victimPerm = perm;
        break;
      }
    }
    if (victimPlayerIdx < 0 || !victimPerm) {
      setLabState({
        lastAction:
          'No opponent creature found — Creature-dies cinematic unavailable.',
      });
      return;
    }
    const victimCard = victimPerm.card;
    const next: WebGameView = {
      ...current,
      players: current.players.map((p, i) => {
        if (i !== victimPlayerIdx) return p;
        // Filter out the victim by key — clearer than destructuring
        // with a discarded binding (lint-friendly without the `void
        // _removed` workaround for `noUnusedLocals`).
        const remainingBf: Record<string, WebPermanentView> = {};
        for (const [permId, perm] of Object.entries(p.battlefield)) {
          if (permId !== victimPermId) {
            remainingBf[permId] = perm;
          }
        }
        const nextGraveyard = { ...p.graveyard, [victimCard.id]: victimCard };
        return {
          ...p,
          battlefield: remainingBf,
          graveyard: nextGraveyard,
        };
      }),
    };
    useGameStore.setState({ gameView: next });
    setLabState({
      lastAction: `${victimCard.name} dies — watch the 150ms desaturate as the card flies to graveyard (5-D).`,
    });
  }, []);

  // Slice CL-1 critic-pass N2 fix — sequence epoch for the
  // raf-driven lethal trigger. Reset (or any other trigger) bumps
  // the epoch so an in-flight raf scheduled before the bump is
  // silently dropped instead of clobbering the new state with the
  // step-2 setState. Without this, "Lethal" then "Reset" before
  // raf flushes would clear the fixture, then the stale raf would
  // re-write 21 onto the fresh post-reset view and re-fire the
  // banner anyway.
  const epochRef = useRef(0);

  const triggerLethalCommanderDamage = useCallback(() => {
    const current = useGameStore.getState().gameView;
    if (!current) return;
    // Pick the first opponent. Slice 5-E threshold-cross requires
    // prev < 21 AND next >= 21, so we two-step: first frame seeds
    // the map at 20 (sub-threshold), next animation frame writes 21
    // (threshold cross). Without the two-step, a one-shot 0 → 21 also
    // crosses, but 20 → 21 better mirrors the real-game pattern of
    // damage accumulating across turns.
    const myId = current.myPlayerId;
    const opponent = current.players.find((p) => p.playerId !== myId);
    if (!opponent) return;
    // Synthesize a stable commander id for the lab — the field's
    // values are number, keyed by commander UUID; the cinematic
    // doesn't read commander metadata back, only the threshold value.
    const fakeCommanderId = '11111111-1111-4111-8111-111111111111';
    const stepOne = applyCommanderDamage(current, opponent.playerId, {
      [fakeCommanderId]: 20,
    });
    useGameStore.setState({ gameView: stepOne });
    const epoch = ++epochRef.current;
    requestAnimationFrame(() => {
      // Drop superseded raf — Reset or another trigger bumped the
      // epoch while we were waiting for the next frame.
      if (epoch !== epochRef.current) return;
      const live = useGameStore.getState().gameView;
      if (!live) return;
      const stepTwo = applyCommanderDamage(live, opponent.playerId, {
        [fakeCommanderId]: 21,
      });
      useGameStore.setState({ gameView: stepTwo });
    });
    setLabState({
      lastAction: `Lethal commander damage — ${opponent.name} crosses 21 (20 → 21). Watch for the centered banner + viewport pulse (5-E).`,
    });
  }, []);

  const triggerDeclareAttackers = useCallback(() => {
    // Slice 6-A demo. Two-step transition exits combat then re-enters
    // it, exercising the arrowIsolationStore phase watcher's COMBAT →
    // non-COMBAT branch which clears the per-arrow ink-draw Set, AND
    // forcing CombatArrows to unmount so the next mount re-runs
    // TargetingArrow's `latchedDrawIn` lazy-init with the new prop
    // (the ink animation depends on the mount lifecycle, not on a
    // prop change to a still-mounted instance).
    //
    // **flushSync is load-bearing** (2026-05-10 fix). The original
    // rAF-deferred pattern (mirroring the lethal trigger) silently
    // batched both setStates into a single React commit, because:
    //   - useSyncExternalStore reads the LATEST snapshot at re-render
    //     time, so by the time React reconciles after the click
    //     handler, the rAF has already fired and store.gameView is
    //     the declared state — React never commits the cleared state.
    //   - CombatArrows therefore never unmounts → TargetingArrow
    //     instances stay mounted → latchedDrawIn (captured on the
    //     lab's initial mount when drawIn was undefined) stays
    //     undefined → ink layer never fires.
    // The lethal trigger doesn't hit this because its cinematic is
    // frame-DIFF based (Zustand subscribe sees every set), not
    // RENDER-MOUNT based.
    //
    // flushSync forces React to commit the cleared state synchronously
    // before the second setState lands, guaranteeing CombatArrows
    // unmounts → re-mounts and the TargetingArrow children capture
    // the fresh drawIn prop on their re-mount.
    flushSync(() => {
      useGameStore.setState({
        gameView: buildDemoGameView({ combatActive: false }),
      });
    });
    useGameStore.setState({
      gameView: buildDemoGameView({ combatActive: true }),
    });
    setLabState({
      lastAction:
        'Declare attackers — combat re-entered after a synchronous unmount. Watch the ink-overlay pen-stroke draw-in (slice 6-A v2) sweep along each attack arrow over 400ms while the dashed Bundle 1 base path stays underneath.',
    });
  }, []);

  const resetFixture = useCallback(() => {
    // Bump the epoch so any in-flight lethal raf is silently dropped
    // (see N2 fix above). Without this, "Lethal" → "Reset" before
    // the next frame would clobber the reset with the step-2 state.
    // (Declare-attackers no longer uses raf — flushSync runs both
    // setStates synchronously inside the click handler — so it can't
    // race against Reset.)
    epochRef.current += 1;
    const fresh = buildDemoGameView({ combatActive: true });
    useGameStore.setState({ gameView: fresh });
    setLabState({
      lastAction: 'Fixture reset to baseline — life 40 / no deaths / no lethal.',
    });
  }, []);

  // Mirror Game.tsx's outer chrome — h-screen + overflow-hidden is
  // load-bearing for GameTable's h-full (otherwise it collapses to 0).
  return (
    <LayoutVariantProvider variant={variant}>
      <MotionConfig reducedMotion="user">
        <LayoutGroup>
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
              onCombatDamage={triggerCombatDamage}
              onCreatureDies={triggerCreatureDies}
              onLethal={triggerLethalCommanderDamage}
              onDeclareAttackers={triggerDeclareAttackers}
              onReset={resetFixture}
            />
          </div>
        </LayoutGroup>
      </MotionConfig>
    </LayoutVariantProvider>
  );
}

interface ControlPanelProps {
  lastAction: string;
  onCombatDamage: () => void;
  onCreatureDies: () => void;
  onLethal: () => void;
  onDeclareAttackers: () => void;
  onReset: () => void;
}

function ControlPanel({
  lastAction,
  onCombatDamage,
  onCreatureDies,
  onLethal,
  onDeclareAttackers,
  onReset,
}: ControlPanelProps) {
  // Position top-right so it doesn't overlap the action panel
  // (bottom-right per tabletop T2). z-50 sits above all other game
  // chrome including the action panel and dialog overlays.
  return (
    <div
      className="fixed top-20 right-4 w-80 bg-zinc-900/95 border border-zinc-700 rounded-lg shadow-xl p-4 z-50 text-sm"
      data-testid="cinematic-lab-panel"
    >
      <h2 className="text-base font-bold text-zinc-100 mb-2">
        Cinematic lab
      </h2>
      <p className="text-xs text-zinc-400 mb-3">
        Click a button to trigger a Bundle 5 / Bundle 6 effect.
        Reset between runs to re-fire.
      </p>
      <div className="flex flex-col gap-2">
        <LabButton
          testid="trigger-combat-damage"
          slices="5-A · 5-B · 5-C"
          label="Combat damage hit"
          description="Parcels traverse arrow + portrait bloom + viewport freeze-frame."
          onClick={onCombatDamage}
        />
        <LabButton
          testid="trigger-creature-dies"
          slices="5-D"
          label="Creature dies"
          description="Card desaturates 150ms during fly-to-graveyard glide."
          onClick={onCreatureDies}
        />
        <LabButton
          testid="trigger-lethal-commander"
          slices="5-E"
          label="Lethal commander damage (21)"
          description="Centered banner + viewport pulse on threshold cross."
          onClick={onLethal}
        />
        <LabButton
          testid="trigger-declare-attackers"
          slices="6-A v2"
          label="Declare attackers"
          description="Attack arrows ink-overlay pen-stroke draw-in (400ms / arrow)."
          onClick={onDeclareAttackers}
        />
        <LabButton
          testid="trigger-reset"
          slices="reset"
          label="Reset fixture"
          description="Restore life=40, undo deaths and lethal."
          onClick={onReset}
        />
      </div>
      <p
        className="text-xs text-zinc-300 mt-3 border-t border-zinc-800 pt-2 break-words"
        data-testid="cinematic-lab-status"
      >
        {lastAction}
      </p>
    </div>
  );
}

interface LabButtonProps {
  testid: string;
  slices: string;
  label: string;
  description: string;
  onClick: () => void;
}

function LabButton({
  testid,
  slices,
  label,
  description,
  onClick,
}: LabButtonProps) {
  return (
    <button
      type="button"
      data-testid={testid}
      data-cinematic-trigger={slices}
      onClick={onClick}
      className="text-left px-3 py-2 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 border border-zinc-600 rounded text-zinc-100 transition-colors"
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="font-semibold">{label}</span>
        <span className="text-[10px] text-zinc-400 font-mono">{slices}</span>
      </div>
      <span className="text-xs text-zinc-400 block leading-snug">
        {description}
      </span>
    </button>
  );
}

/**
 * Pure helper: returns a new game view with the named player's
 * `commanderDamageReceived` map replaced by the given map. Other
 * players' state is untouched. Module-private — kept as a free
 * function so the trigger callbacks above stay tight; not exported
 * because the only caller is the lethal trigger in this file.
 *
 * <p>The spread + map preserves every required `WebPlayerView` field
 * (no `as` cast). If `webPlayerViewSchema` gains a new required
 * field in a future schema bump, TypeScript's structural-types check
 * surfaces it here at compile time so the lab can't ship a broken
 * mutation silently.
 */
function applyCommanderDamage(
  view: WebGameView,
  defenderId: string,
  damageByCommanderId: Record<string, number>,
): WebGameView {
  return {
    ...view,
    players: view.players.map((p): WebPlayerView =>
      p.playerId === defenderId
        ? { ...p, commanderDamageReceived: damageByCommanderId }
        : p,
    ),
  };
}
