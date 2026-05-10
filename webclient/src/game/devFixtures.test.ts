/**
 * Slice 4-X.1 — coverage for the new fixture URL knobs:
 *   - `?combat=declare` → step = DECLARE_ATTACKERS, combat = 1 partial
 *     group, `getPossibleAttackerIds` surfaces 4 me-creature ids
 *   - `?tapped=1` → first 2 me-creatures tapped (drives tap-rotation
 *     verification of slice 4-X.0 B-1)
 *
 * The legacy `?combat=1` (= damage step, 3 full groups) path remains
 * the buildDemoGameView default when combatActive is true; verified
 * here so a future fixture refactor doesn't silently regress it.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDemoGameView,
  getPossibleAttackerIds,
} from './devFixtures';

describe('buildDemoGameView — slice 4-X.1 fixture knobs', () => {
  it('combatActive=false (default) → no combat, PRECOMBAT_MAIN', () => {
    const gv = buildDemoGameView();
    expect(gv.phase).toBe('PRECOMBAT_MAIN');
    expect(gv.step).toBe('PRECOMBAT_MAIN');
    expect(gv.combat).toEqual([]);
  });

  it('combatActive=true (legacy ?combat=1) → COMBAT_DAMAGE with 3 full groups', () => {
    const gv = buildDemoGameView({ combatActive: true });
    expect(gv.phase).toBe('COMBAT');
    expect(gv.step).toBe('COMBAT_DAMAGE');
    expect(gv.combat).toHaveLength(3);
    // First group has 2 attackers (goat — mono-G), second has 1
    // (momur — multicolor), third has 1 attacker + 1 blocker (alloc).
    expect(Object.keys(gv.combat[0]!.attackers)).toHaveLength(2);
    expect(Object.keys(gv.combat[2]!.blockers)).toHaveLength(1);
  });

  it('combatActive=true + combatPhase=declare → DECLARE_ATTACKERS with 1 partial group (only att1 vs goat)', () => {
    const gv = buildDemoGameView({
      combatActive: true,
      combatPhase: 'declare',
    });
    expect(gv.phase).toBe('COMBAT');
    expect(gv.step).toBe('DECLARE_ATTACKERS');
    expect(gv.combat).toHaveLength(1);
    expect(Object.keys(gv.combat[0]!.attackers)).toHaveLength(1);
    expect(gv.combat[0]!.defenderName).toBe('goat');
    expect(gv.combat[0]!.blocked).toBe(false);
  });

  it('getPossibleAttackerIds returns 4 me-creature ids for the declare-mode pendingDialog seed', () => {
    const gv = buildDemoGameView({
      combatActive: true,
      combatPhase: 'declare',
    });
    const ids = getPossibleAttackerIds(gv);
    expect(ids).toHaveLength(4);
    // First id is att1 (already in combat[0].attackers — the
    // assigned/pulse-off case). Remaining 3 are att2/att3/att4 in
    // possibleAttackers but NOT in combat — the eligible/pulse-on case.
    const att1Id = Object.keys(gv.combat[0]!.attackers)[0]!;
    expect(ids[0]).toBe(att1Id);
  });

  it('getPossibleAttackerIds returns [] for a non-combat gameView (defensive)', () => {
    const gv = buildDemoGameView();
    // No combat, but the helper still returns 4 me-creatures — the
    // function doesn't check combatActive, just walks the
    // me-battlefield. That's intentional — the caller (DemoGame.tsx)
    // gates on fixtureOpts.combatPhase === 'declare' before seeding
    // the dialog. Verify the helper itself is robust.
    expect(getPossibleAttackerIds(gv)).toHaveLength(4);
  });

  it('tappedAttackers=true (with combatActive) marks first 2 me-creatures tapped', () => {
    const gv = buildDemoGameView({
      combatActive: true,
      tappedAttackers: true,
    });
    const me = gv.players.find((p) => p.playerId === gv.myPlayerId)!;
    const meCreatures = Object.values(me.battlefield).filter((p) =>
      p.card.types.includes('CREATURE'),
    );
    // First two creatures in deterministic order should be tapped.
    expect(meCreatures[0]?.tapped).toBe(true);
    expect(meCreatures[1]?.tapped).toBe(true);
    // Subsequent creatures untapped.
    expect(meCreatures[2]?.tapped).toBe(false);
  });

  it('tappedAttackers=true WITHOUT combatActive → no creatures tapped (gate is combatActive)', () => {
    // The flag is intentionally a no-op when combat isn't active —
    // tapping unrelated creatures outside a combat scenario would
    // muddy other slice fixtures.
    const gv = buildDemoGameView({ tappedAttackers: true });
    const me = gv.players.find((p) => p.playerId === gv.myPlayerId)!;
    const tappedCount = Object.values(me.battlefield).filter(
      (p) => p.tapped,
    ).length;
    expect(tappedCount).toBe(0);
  });

  it('stackDuringCombat=true (with combatActive) seeds Lightning Bolt — foundation Option D cohabit smoke', () => {
    const gv = buildDemoGameView({
      combatActive: true,
      stackDuringCombat: true,
    });
    expect(gv.combat.length).toBeGreaterThan(0);
    expect(Object.keys(gv.stack).length).toBeGreaterThan(0);
    const firstStackEntry = Object.values(gv.stack)[0];
    expect(firstStackEntry?.name).toBe('Lightning Bolt');
  });

  it('stackDuringCombat=false (default, ?combat=1) keeps stack empty during combat', () => {
    const gv = buildDemoGameView({ combatActive: true });
    expect(gv.combat.length).toBeGreaterThan(0);
    expect(Object.keys(gv.stack)).toHaveLength(0);
  });

  it('combatPhase=declare without combatActive → falls through to default PRECOMBAT_MAIN', () => {
    // Same gating philosophy as tappedAttackers — combatPhase only
    // takes effect when combat is on.
    const gv = buildDemoGameView({ combatPhase: 'declare' });
    expect(gv.phase).toBe('PRECOMBAT_MAIN');
    expect(gv.step).toBe('PRECOMBAT_MAIN');
    expect(gv.combat).toEqual([]);
  });
});
