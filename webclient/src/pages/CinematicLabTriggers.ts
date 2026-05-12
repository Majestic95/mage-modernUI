/**
 * Cinematic lab trigger callbacks — extracted from
 * {@link ./CinematicLab} in slice 6-Y.1 because adding the two new
 * Bundle 6 buttons (declare-blockers / damage-step) pushed
 * `CinematicLab.tsx` past the 500 LOC hard cap. Per CLAUDE.md Rule 5
 * ("If a file is trending past 400, plan the split now — don't wait"),
 * we extract the trigger surface to land both files comfortably under
 * the soft cap with headroom for future Bundle 6-Y / Bundle 2 lab
 * affordances.
 *
 * <p>Each trigger is a stable {@link useCallback} returned from a
 * single {@link useCinematicLabTriggers} hook. They share three
 * closures — {@link announce} (writes to the panel's status text),
 * {@link epochRef} (sequence guard for async triggers — lethal +
 * damage-step), and {@link originalBlockers} (captured at mount so
 * declare-blockers can re-attach blockers to the right combat group
 * after the baseline stripped them off).
 *
 * <p>The hook also returns {@link baselineGameView} (with blockers
 * stripped) and {@link baselineWithBlockers} (the original fixture,
 * needed only for the originalBlockers capture). The page component
 * uses {@link baselineGameView} for the header + table mount; tests
 * read the same value via {@link useGameStore.getState().gameView}
 * after the lab's seeding effect runs.
 */
import { useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { buildDemoGameView } from '../game/devFixtures';
import { useGameStore } from '../game/store';
import type {
  WebGameView,
  WebPermanentView,
  WebPlayerView,
} from '../api/schemas';

/**
 * Slice 6-Y.1 — captured blocker shape. Records which combat-group
 * index a blocker was originally seeded against, so the declare-
 * blockers trigger can re-attach the blocker to the right group
 * after the baseline has stripped blockers off.
 */
interface OriginalBlocker {
  groupIdx: number;
  perm: WebPermanentView;
}

export interface CinematicLabTriggers {
  baselineGameView: WebGameView;
  triggerCombatDamage: () => void;
  triggerHeavyCombatDamage: () => void;
  triggerCreatureDies: () => void;
  triggerLethalCommanderDamage: () => void;
  triggerDeclareAttackers: () => void;
  triggerDeclareBlockers: () => void;
  triggerDamageStep: () => void;
  triggerEnterCombat: () => void;
  triggerExitCombat: () => void;
  triggerCycleSubSteps: () => void;
  resetFixture: () => void;
}

export function useCinematicLabTriggers(
  announce: (lastAction: string) => void,
): CinematicLabTriggers {
  // Slice 6-Y.1 — the seeded fixture's alloc group has a baked-in
  // blocker, so the legacy lab showed BOTH attack ink AND block ink
  // on every declare-attackers click — making 6-B's snap-in inseparable
  // from 6-A v2's pen-stroke for live A/B. We strip blockers from the
  // baseline (and capture them in `originalBlockers` so the new
  // declare-blockers button can re-attach them) to isolate the two
  // animations: declare-attackers now shows ONLY attack ink; declare-
  // blockers ADDS the block arrow on top with its 200ms snap-in fresh.
  const baselineWithBlockers = useMemo(
    () => buildDemoGameView({ combatActive: true }),
    [],
  );
  const baselineGameView = useMemo(
    () => stripBlockers(baselineWithBlockers),
    [baselineWithBlockers],
  );
  const originalBlockers = useMemo<ReadonlyArray<OriginalBlocker>>(() => {
    const out: OriginalBlocker[] = [];
    for (let i = 0; i < baselineWithBlockers.combat.length; i++) {
      const group = baselineWithBlockers.combat[i]!;
      for (const perm of Object.values(group.blockers)) {
        out.push({ groupIdx: i, perm });
      }
    }
    return out;
  }, [baselineWithBlockers]);

  // Slice CL-1 critic-pass N2 fix — sequence epoch for the raf/timer
  // driven triggers (lethal + damage-step). Reset (or any other
  // trigger) bumps the epoch so an in-flight async callback scheduled
  // before the bump is silently dropped instead of clobbering the new
  // state with stale state.
  const epochRef = useRef(0);

  const triggerCombatDamage = useCallback(() => {
    const current = useGameStore.getState().gameView;
    if (!current) return;
    // Pick the first non-self player who is the defender of an
    // existing combat group so the parcels have an arrow path to
    // traverse. The fixture seeds combat against goat / momur / alloc
    // (in that order) — pick the first defender appearing in combat[].
    const firstGroup = current.combat[0];
    if (!firstGroup) {
      announce(
        'No combat groups in fixture — Combat damage cinematic unavailable.',
      );
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
    announce(
      `Combat damage hit — ${firstGroup.defenderName} life -3. Watch parcels (5-A), portrait bloom (5-B), viewport freeze-frame (5-C).`,
    );
  }, [announce]);

  const triggerHeavyCombatDamage = useCallback(() => {
    // 2026-05-12 — 20-damage feel-check for the LifeBadge per-tick
    // motion. Mutates the first combat group to a single attacker
    // with power "20" so useDamageEvents synthesizes ONE event with
    // amount=20 (parcelSchedule packs 20 parcels into the 3s HEAVY
    // window with the 150ms inter-landing floor; total event ≈
    // 3.85s). Other attackers in the group are stripped so total
    // parcels === life delta and the displayed-life lag store
    // converges cleanly. Other groups (different defenders)
    // untouched.
    const current = useGameStore.getState().gameView;
    if (!current) return;
    const firstGroup = current.combat[0];
    if (!firstGroup) {
      announce(
        'No combat groups in fixture — Heavy combat damage cinematic unavailable.',
      );
      return;
    }
    const attackerIds = Object.keys(firstGroup.attackers);
    const firstAttackerId = attackerIds[0];
    if (!firstAttackerId) {
      announce(
        'No attacker in the first combat group — Heavy combat damage unavailable.',
      );
      return;
    }
    const firstAttacker = firstGroup.attackers[firstAttackerId]!;
    const defenderId = firstGroup.defenderId;
    const next: WebGameView = {
      ...current,
      combat: current.combat.map((g, i) =>
        i === 0
          ? {
              ...g,
              attackers: {
                [firstAttackerId]: {
                  ...firstAttacker,
                  card: { ...firstAttacker.card, power: '20' },
                },
              },
            }
          : g,
      ),
      players: current.players.map((p) =>
        p.playerId === defenderId
          ? { ...p, life: Math.max(p.life - 20, 0) }
          : p,
      ),
    };
    useGameStore.setState({ gameView: next });
    announce(
      `Heavy combat damage — ${firstGroup.defenderName} life -20. 20 parcels stream across the HEAVY tier (~150ms per tick, ~3.85s total); life ticks 1-by-1 from 40 → 20.`,
    );
  }, [announce]);

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
      announce(
        'No opponent creature found — Creature-dies cinematic unavailable.',
      );
      return;
    }
    const victimCard = victimPerm.card;
    const next: WebGameView = {
      ...current,
      players: current.players.map((p, i) => {
        if (i !== victimPlayerIdx) return p;
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
    announce(
      `${victimCard.name} dies — watch the 150ms desaturate as the card flies to graveyard (5-D).`,
    );
  }, [announce]);

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
    const fakeCommanderId = '11111111-1111-4111-8111-111111111111';
    const stepOne = applyCommanderDamage(current, opponent.playerId, {
      [fakeCommanderId]: 20,
    });
    useGameStore.setState({ gameView: stepOne });
    const epoch = ++epochRef.current;
    requestAnimationFrame(() => {
      if (epoch !== epochRef.current) return;
      const live = useGameStore.getState().gameView;
      if (!live) return;
      const stepTwo = applyCommanderDamage(live, opponent.playerId, {
        [fakeCommanderId]: 21,
      });
      useGameStore.setState({ gameView: stepTwo });
    });
    announce(
      `Lethal commander damage — ${opponent.name} crosses 21 (20 → 21). Watch for the centered banner + viewport pulse (5-E).`,
    );
  }, [announce]);

  const triggerDeclareAttackers = useCallback(() => {
    // Slice 6-A demo. Two-step transition exits combat then re-enters
    // it, exercising the arrowIsolationStore phase watcher's COMBAT →
    // non-COMBAT branch which clears the per-arrow ink-draw Set, AND
    // forcing CombatArrows to unmount so the next mount re-runs
    // TargetingArrow's `latchedDrawIn` lazy-init with the new prop.
    //
    // **flushSync is load-bearing** (2026-05-10). useSyncExternalStore
    // reads the latest store snapshot at re-render time, so without
    // a synchronous flush React batches both setStates into a single
    // commit and CombatArrows never unmounts → ink layer never fires.
    flushSync(() => {
      useGameStore.setState({
        gameView: buildDemoGameView({ combatActive: false }),
      });
    });
    // Slice 6-Y.1 — restore the STRIPPED fixture (no blockers) so the
    // declare-attackers cinematic shows pure 400ms attack ink without
    // 6-B's block snap-in muddying the demo.
    useGameStore.setState({
      gameView: stripBlockers(buildDemoGameView({ combatActive: true })),
    });
    announce(
      'Declare attackers — combat re-entered after a synchronous unmount. Watch the ink-overlay pen-stroke draw-in (slice 6-A v2) sweep along each attack arrow over 400ms while the dashed Bundle 1 base path stays underneath.',
    );
  }, [announce]);

  const triggerDeclareBlockers = useCallback(() => {
    // Slice 6-Y.1 — 6-B isolation demo. The baseline starts with
    // blockers stripped (all combat groups unblocked), so clicking this
    // button ADDS the original blocker(s) to the relevant combat group.
    // Per slice 6-B's tracking key (blocker permanent id, not attacker
    // id), the block ink fires only because the blocker id is new to
    // the arrowsDrawn Set. Reset → declare-attackers → declare-blockers
    // is the recommended A/B sequence: see 400ms symmetric ease first,
    // then 200ms cubic-bezier overshoot.
    if (originalBlockers.length === 0) return;
    const current = useGameStore.getState().gameView;
    if (!current) return;
    const blockersByGroup = new Map<number, Record<string, WebPermanentView>>();
    for (const { groupIdx, perm } of originalBlockers) {
      const existing = blockersByGroup.get(groupIdx) ?? {};
      existing[perm.card.id] = perm;
      blockersByGroup.set(groupIdx, existing);
    }
    const next: WebGameView = {
      ...current,
      combat: current.combat.map((g, idx) => {
        const blockers = blockersByGroup.get(idx);
        return blockers ? { ...g, blockers, blocked: true } : g;
      }),
    };
    useGameStore.setState({ gameView: next });
    announce(
      'Declare blockers — block-arrow snap-in (200ms cubic-bezier(0.5,0,0.4,1.4) overshoot) fires on the alloc group. Compare to the 400ms symmetric attack ink: blocker visibly "answers" mid-conversation.',
    );
  }, [originalBlockers, announce]);

  const triggerDamageStep = useCallback(() => {
    // Slice 6-Y.1 — 6-C cross-dissolve demo. Sets gameView.step to
    // 'FIRST_COMBAT_DAMAGE' (cool cyan shimmer mounts), then 1500ms
    // later transitions to 'COMBAT_DAMAGE' (warm amber, cross-dissolving
    // via the 300ms stroke transition added in slice 6-X.0). The 1500ms
    // hold gives the user time to read the cool palette before the
    // cross-dissolve fires. epochRef supersession lets reset cancel an
    // in-flight transition mid-hold.
    const current = useGameStore.getState().gameView;
    if (!current) return;
    useGameStore.setState({
      gameView: { ...current, step: 'FIRST_COMBAT_DAMAGE' },
    });
    const epoch = ++epochRef.current;
    setTimeout(() => {
      if (epoch !== epochRef.current) return;
      const live = useGameStore.getState().gameView;
      if (!live) return;
      useGameStore.setState({
        gameView: { ...live, step: 'COMBAT_DAMAGE' },
      });
    }, 1500);
    announce(
      'Damage step — first-strike palette (cool cyan, 200ms shimmer) for 1500ms, then cross-dissolves to regular (warm amber, 350ms shimmer) via the 300ms stroke transition.',
    );
  }, [announce]);

  const triggerEnterCombat = useCallback(() => {
    // Bundle 2 / Slice 2-A — combat-stage entry demo. Sets phase to
    // PRECOMBAT_MAIN for one frame, then to COMBAT/BEGIN_COMBAT. The
    // combatStageStore subscription sees the transition and fires the
    // slate-pulse counter; CombatStage's vignette ramps in.
    //
    // Pattern mirrors declare-attackers: flushSync the cleared state
    // so React commits + actually updates the store before the second
    // setState lands, guaranteeing the transition is observable.
    const current = useGameStore.getState().gameView;
    if (!current) return;
    flushSync(() => {
      useGameStore.setState({
        gameView: { ...current, phase: 'PRECOMBAT_MAIN', step: 'PRECOMBAT_MAIN' },
      });
    });
    const live = useGameStore.getState().gameView;
    if (!live) return;
    useGameStore.setState({
      gameView: { ...live, phase: 'COMBAT', step: 'BEGIN_COMBAT' },
    });
    announce(
      'Enter combat — slate-pulse fires (counter increments), vignette ramps in over 350ms. Watch the outer pods dim while the central focal area stays lit.',
    );
  }, [announce]);

  const triggerExitCombat = useCallback(() => {
    // Bundle 2 / Slice 2-A — combat-stage exit demo. Sets phase to
    // POSTCOMBAT_MAIN, firing the COMBAT → POSTCOMBAT_MAIN transition
    // that emits a slate-pulse + ramps the vignette out over 250ms.
    //
    // Slice 2-X.0 F-T-N1 fix — early-return when the lab is not in
    // COMBAT phase. The prior implementation snapped to COMBAT first
    // (via flushSync) then to POSTCOMBAT_MAIN, firing TWO slate-pulses
    // back-to-back when the user had clicked Exit from a non-combat
    // state — read as a confusing in-then-out flicker rather than a
    // clean exit. Now: when the lab isn't in combat, the button is
    // a no-op with an announce explaining what happened.
    const current = useGameStore.getState().gameView;
    if (!current) return;
    if (current.phase !== 'COMBAT') {
      announce(
        'Exit combat — already outside combat. Click Enter combat first to fire the entry cinematic.',
      );
      return;
    }
    useGameStore.setState({
      gameView: {
        ...current,
        phase: 'POSTCOMBAT_MAIN',
        step: 'POSTCOMBAT_MAIN',
      },
    });
    announce(
      'Exit combat — slate-pulse fires (counter increments), vignette ramps out over 250ms.',
    );
  }, [announce]);

  const triggerCycleSubSteps = useCallback(() => {
    // Bundle 2 / Slice 2-A — combat sub-step cycler. Walks through the
    // six combat sub-steps with a 1500ms hold each so 2-C's
    // cross-fade tint (not yet shipped — placeholder for live A/B)
    // fires N times consecutively. epochRef supersession lets reset
    // cancel an in-flight cycle.
    const subSteps: ReadonlyArray<string> = [
      'BEGIN_COMBAT',
      'DECLARE_ATTACKERS',
      'DECLARE_BLOCKERS',
      'FIRST_COMBAT_DAMAGE',
      'COMBAT_DAMAGE',
      'END_COMBAT',
    ];
    const current = useGameStore.getState().gameView;
    if (!current) return;
    // Ensure we're in COMBAT phase first; if not, snap there.
    if (current.phase !== 'COMBAT') {
      useGameStore.setState({
        gameView: { ...current, phase: 'COMBAT', step: subSteps[0]! },
      });
    } else {
      useGameStore.setState({
        gameView: { ...current, step: subSteps[0]! },
      });
    }
    const epoch = ++epochRef.current;
    for (let i = 1; i < subSteps.length; i++) {
      const stepName = subSteps[i]!;
      setTimeout(() => {
        if (epoch !== epochRef.current) return;
        const live = useGameStore.getState().gameView;
        if (!live) return;
        useGameStore.setState({
          gameView: { ...live, step: stepName },
        });
      }, i * 1500);
    }
    announce(
      'Cycle sub-steps — BEGIN_COMBAT → DECLARE_ATTACKERS → DECLARE_BLOCKERS → FIRST_COMBAT_DAMAGE → COMBAT_DAMAGE → END_COMBAT, 1500ms hold per step. Watch the central focal area for 2-C cross-fade behavior once that slice ships.',
    );
  }, [announce]);

  const resetFixture = useCallback(() => {
    // Bump the epoch so any in-flight lethal raf or damage-step timer
    // is silently dropped.
    epochRef.current += 1;
    // Slice 6-Y.1 — reset to the STRIPPED baseline (no blockers) so
    // declare-attackers and declare-blockers stay orthogonal. Also
    // clears any in-flight damage step transition.
    const fresh = stripBlockers(buildDemoGameView({ combatActive: true }));
    useGameStore.setState({ gameView: fresh });
    announce(
      'Fixture reset to baseline — life 40 / no deaths / no lethal / no blockers / step cleared.',
    );
  }, [announce]);

  return {
    baselineGameView,
    triggerCombatDamage,
    triggerHeavyCombatDamage,
    triggerCreatureDies,
    triggerLethalCommanderDamage,
    triggerDeclareAttackers,
    triggerDeclareBlockers,
    triggerDamageStep,
    triggerEnterCombat,
    triggerExitCombat,
    triggerCycleSubSteps,
    resetFixture,
  };
}

/**
 * Slice 6-Y.1 — strip blockers from every combat group. Used to
 * derive the lab's baseline view from the fixture builder: legacy
 * fixtures pre-seed a blocked group (alloc), but the lab needs the
 * baseline to start with NO blockers so the declare-blockers trigger
 * can demonstrate 6-B's snap-in in isolation. All other fields on
 * each combat group are preserved unmodified.
 */
function stripBlockers(view: WebGameView): WebGameView {
  return {
    ...view,
    combat: view.combat.map((g) => ({ ...g, blockers: {}, blocked: false })),
  };
}

/**
 * Pure helper: returns a new game view with the named player's
 * `commanderDamageReceived` map replaced by the given map. Other
 * players' state is untouched. Module-private to this file — the only
 * caller is the lethal trigger above.
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
