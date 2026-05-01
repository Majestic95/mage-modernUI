import { describe, expect, it, vi } from 'vitest';
import {
  isBoardClickable,
  routeObjectClick,
  type OutboundActions,
} from './clickRouter';
import type { InteractionMode } from './interactionMode';

function mockOut(): OutboundActions & {
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    sendObjectClick: (id) => calls.push({ method: 'sendObjectClick', args: [id] }),
    sendPlayerResponse: (mid, kind, value) =>
      calls.push({ method: 'sendPlayerResponse', args: [mid, kind, value] }),
    clearDialog: () => calls.push({ method: 'clearDialog', args: [] }),
  };
}

describe('routeObjectClick', () => {
  it('free + canAct → sendObjectClick', () => {
    const out = mockOut();
    const r = routeObjectClick({ kind: 'free' }, 'oid', true, out);
    expect(r.dispatched).toBe(true);
    expect(out.calls).toEqual([
      { method: 'sendObjectClick', args: ['oid'] },
    ]);
  });

  it('free + !canAct → no dispatch', () => {
    const out = mockOut();
    const r = routeObjectClick({ kind: 'free' }, 'oid', false, out);
    expect(r.dispatched).toBe(false);
    expect(out.calls).toEqual([]);
  });

  it('target + eligible id → sendPlayerResponse + clearDialog', () => {
    const out = mockOut();
    const mode: InteractionMode = {
      kind: 'target',
      messageId: 7,
      eligibleIds: new Set(['oid']),
      optional: false,
    };
    const r = routeObjectClick(mode, 'oid', false, out);
    expect(r.dispatched).toBe(true);
    expect(out.calls).toEqual([
      { method: 'sendPlayerResponse', args: [7, 'uuid', 'oid'] },
      { method: 'clearDialog', args: [] },
    ]);
  });

  it('target + ineligible id → no dispatch', () => {
    const out = mockOut();
    const mode: InteractionMode = {
      kind: 'target',
      messageId: 7,
      eligibleIds: new Set(['otherid']),
      optional: false,
    };
    const r = routeObjectClick(mode, 'oid', true, out);
    expect(r.dispatched).toBe(false);
    expect(out.calls).toEqual([]);
  });

  // Slice 70-X.12 lock (Wave 2) — when the wire ships an empty
  // eligibleIds set (Fortified Village reveal-from-hand bug, etc.),
  // the router permits ANY click and lets the engine validate. Without
  // this branch the user gets stuck — the engine fired gameTarget but
  // possibleTargets didn't make it to the wire so eligibleIds came up
  // empty, and the strict eligibility check would have dropped every
  // click silently. Drop this test and a regression that re-tightens
  // the check reverts the user-facing fix without any failing assertion.
  //
  // Slice 70-X.13 (Wave 3) — the permissive path does NOT call
  // clearDialog. If the engine rejects the pick (gameError fires) the
  // user keeps the prompt context to retry; on accept, the fresh
  // gameView frame replaces pendingDialog server-side. The strict-
  // eligible path still clearDialogs (covered by the test above —
  // 'target + eligible id → sendPlayerResponse + clearDialog').
  it('target + empty eligibleIds → permissive: dispatches BUT does NOT clearDialog', () => {
    const out = mockOut();
    const mode: InteractionMode = {
      kind: 'target',
      messageId: 9,
      eligibleIds: new Set(),
      optional: false,
    };
    const r = routeObjectClick(mode, 'whatever-id', true, out);
    expect(r.dispatched).toBe(true);
    expect(out.calls).toEqual([
      { method: 'sendPlayerResponse', args: [9, 'uuid', 'whatever-id'] },
    ]);
    expect(
      out.calls.some((c) => c.method === 'clearDialog'),
    ).toBe(false);
  });

  it('declareAttackers → sendObjectClick (toggle); does NOT clearDialog', () => {
    // The combat-defining property: dialog stays open across N
    // toggles. clearDialog must NOT fire on each click — only when
    // the OK button explicitly commits via boolean true.
    const out = mockOut();
    const mode: InteractionMode = {
      kind: 'declareAttackers',
      messageId: 11,
    };
    routeObjectClick(mode, 'attacker1', false, out);
    routeObjectClick(mode, 'attacker2', false, out);
    expect(out.calls).toEqual([
      { method: 'sendObjectClick', args: ['attacker1'] },
      { method: 'sendObjectClick', args: ['attacker2'] },
    ]);
    // No clearDialog calls anywhere.
    expect(
      out.calls.some((c) => c.method === 'clearDialog'),
    ).toBe(false);
  });

  it('declareBlockers → same as declareAttackers (toggle, no clear)', () => {
    const out = mockOut();
    const r = routeObjectClick(
      { kind: 'declareBlockers', messageId: 12 },
      'blocker1',
      false,
      out,
    );
    expect(r.dispatched).toBe(true);
    expect(out.calls).toEqual([
      { method: 'sendObjectClick', args: ['blocker1'] },
    ]);
  });

  it('manaPay → sendObjectClick; does NOT clearDialog', () => {
    // Same dialog-stays-open property as combat. The user clicks
    // a tapped land → engine takes one mana → may fire another
    // gamePlayMana for the next mana owed. The current dialog
    // gets replaced by the new one (handled in store), not
    // cleared by the click.
    const out = mockOut();
    routeObjectClick(
      {
        kind: 'manaPay',
        messageId: 21,
        message: 'Pay {1}{R}',
        isXMana: false,
      },
      'forest1',
      false,
      out,
    );
    expect(out.calls).toEqual([
      { method: 'sendObjectClick', args: ['forest1'] },
    ]);
  });

  it('modal → no dispatch; click suppressed', () => {
    const out = mockOut();
    const r = routeObjectClick(
      { kind: 'modal', messageId: 33, method: 'gameAsk' },
      'oid',
      true,
      out,
    );
    expect(r.dispatched).toBe(false);
    expect(out.calls).toEqual([]);
  });

  /* ---------- slice 26 / ADR 0009: orderTriggers ---------- */

  it('orderTriggers + eligible ability id → sendPlayerResponse + clearDialog', () => {
    const out = mockOut();
    const mode: InteractionMode = {
      kind: 'orderTriggers',
      messageId: 42,
      abilityIds: new Set(['ability-x']),
    };
    const r = routeObjectClick(mode, 'ability-x', false, out);
    expect(r.dispatched).toBe(true);
    expect(out.calls).toEqual([
      { method: 'sendPlayerResponse', args: [42, 'uuid', 'ability-x'] },
      { method: 'clearDialog', args: [] },
    ]);
  });

  it('orderTriggers + ineligible id → no dispatch (board click suppressed)', () => {
    const out = mockOut();
    const mode: InteractionMode = {
      kind: 'orderTriggers',
      messageId: 42,
      abilityIds: new Set(['ability-x']),
    };
    const r = routeObjectClick(mode, 'permanent-y', true, out);
    expect(r.dispatched).toBe(false);
    if (r.dispatched) return;
    expect(r.reason).toBe('not-eligible-ability');
    expect(out.calls).toEqual([]);
  });
});

describe('isBoardClickable', () => {
  it('returns canAct for free mode', () => {
    expect(isBoardClickable({ kind: 'free' }, true)).toBe(true);
    expect(isBoardClickable({ kind: 'free' }, false)).toBe(false);
  });

  it('returns true for target/combat/manaPay regardless of canAct', () => {
    expect(
      isBoardClickable(
        { kind: 'target', messageId: 1, eligibleIds: new Set(), optional: false },
        false,
      ),
    ).toBe(true);
    expect(
      isBoardClickable({ kind: 'declareAttackers', messageId: 1 }, false),
    ).toBe(true);
    expect(
      isBoardClickable({ kind: 'declareBlockers', messageId: 1 }, false),
    ).toBe(true);
    expect(
      isBoardClickable(
        { kind: 'manaPay', messageId: 1, message: '', isXMana: false },
        false,
      ),
    ).toBe(true);
  });

  it('returns false for modal mode', () => {
    expect(
      isBoardClickable(
        { kind: 'modal', messageId: 1, method: 'gameAsk' },
        true,
      ),
    ).toBe(false);
  });

  it('returns false for orderTriggers mode (slice 26)', () => {
    expect(
      isBoardClickable(
        { kind: 'orderTriggers', messageId: 1, abilityIds: new Set() },
        true,
      ),
    ).toBe(false);
  });
});

/**
 * The combat-mode regression net: scripted sequence simulating
 * declare-attackers loop. The router must NOT clearDialog across
 * the toggles; the dialog persists until OK / next prompt.
 */
describe('combat regression — dialog stays open across toggles', () => {
  it('multi-click declareAttackers fires sendObjectClick N times, never clearDialog', () => {
    const out = mockOut();
    const mode: InteractionMode = {
      kind: 'declareAttackers',
      messageId: 99,
    };
    // Simulate user clicking 4 attackers in succession.
    ['a1', 'a2', 'a3', 'a4'].forEach((id) =>
      routeObjectClick(mode, id, false, out),
    );
    expect(out.calls).toHaveLength(4);
    expect(out.calls.every((c) => c.method === 'sendObjectClick')).toBe(true);
    expect(out.calls.map((c) => c.args[0])).toEqual([
      'a1',
      'a2',
      'a3',
      'a4',
    ]);
  });
});

/**
 * Sanity check: the routeObjectClick contract on a mock that returns
 * void from each method (matching real GameStream) — used to ensure
 * the OutboundActions shape matches GameStream's actual surface.
 */
describe('OutboundActions interface compatibility', () => {
  it('accepts a shape mirroring GameStream + clearDialog', () => {
    const fake: OutboundActions = {
      sendObjectClick: vi.fn(),
      sendPlayerResponse: vi.fn(),
      clearDialog: vi.fn(),
    };
    routeObjectClick({ kind: 'free' }, 'oid', true, fake);
    expect(fake.sendObjectClick).toHaveBeenCalledWith('oid');
  });
});
