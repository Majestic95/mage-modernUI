/**
 * Slice 70-N — StackZone test coverage. Splits the legacy slice-50
 * strip layout from the new REDESIGN focal-zone modes (focal stack
 * fan, combat-mode arrows, empty state) per picture-catalog §3.
 *
 * <p>Flag-mock pattern mirrors GameLog.test.tsx — toggle
 * {@code flagState.redesign} per test to exercise both branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  webCardViewSchema,
  webCombatGroupViewSchema,
  webPermanentViewSchema,
  type WebCardView,
  type WebCombatGroupView,
  type WebPermanentView,
} from '../api/schemas';

const flagState = vi.hoisted(() => ({ redesign: false }));
vi.mock('../featureFlags', () => ({
  get REDESIGN() {
    return flagState.redesign;
  },
}));

import { StackZone } from './StackZone';

function makeCard(overrides: Partial<WebCardView> = {}): WebCardView {
  return webCardViewSchema.parse({
    id: overrides.id ?? '11111111-1111-1111-1111-111111111111',
    cardId: overrides.cardId ?? '22222222-2222-2222-2222-222222222222',
    name: 'Test Spell',
    displayName: 'Test Spell',
    expansionSetCode: 'TST',
    cardNumber: '001',
    manaCost: '{2}{U}',
    manaValue: 3,
    typeLine: 'Sorcery',
    supertypes: [],
    types: ['SORCERY'],
    subtypes: [],
    colors: ['U'],
    rarity: 'COMMON',
    power: '',
    toughness: '',
    startingLoyalty: '',
    rules: [],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
    ...overrides,
  });
}

function makeStack(cards: WebCardView[]): Record<string, WebCardView> {
  // Order preserved by Object.values + reversed inside StackZone, so
  // the LAST card in the input array is the topmost (resolves first).
  const out: Record<string, WebCardView> = {};
  for (const c of cards) {
    out[c.id] = c;
  }
  return out;
}

function makePerm(card: WebCardView): WebPermanentView {
  return webPermanentViewSchema.parse({
    card,
    controllerName: 'alice',
    tapped: false,
    flipped: false,
    transformed: false,
    phasedIn: true,
    summoningSickness: false,
    damage: 0,
    attachments: [],
    attachedTo: '',
    attachedToPermanent: false,
  });
}

function makeCombatGroup(
  overrides: Partial<WebCombatGroupView>,
): WebCombatGroupView {
  return webCombatGroupViewSchema.parse({
    defenderId: '00000000-0000-0000-0000-000000000aaa',
    defenderName: 'bob',
    attackers: {},
    blockers: {},
    blocked: false,
    ...overrides,
  });
}

afterEach(() => {
  flagState.redesign = false;
  document.body.innerHTML = '';
});

// --- Legacy branch (REDESIGN=false) ----------------------------------

describe('StackZone — legacy strip layout (slice 50)', () => {
  beforeEach(() => {
    flagState.redesign = false;
  });

  it('renders the "Stack (N) — top resolves first" header when non-empty', () => {
    const card = makeCard({
      id: 'spell-1',
      cardId: 'spell-1',
      name: 'Lightning Bolt',
    });
    render(<StackZone stack={makeStack([card])} />);
    expect(screen.getByText(/Stack \(1\)/)).toBeInTheDocument();
    expect(screen.getByTestId('stack-top-marker')).toBeInTheDocument();
  });

  it('collapses to opacity-0 when the stack is empty', () => {
    render(<StackZone stack={{}} />);
    const zone = screen.getByTestId('stack-zone');
    expect(zone.className).toMatch(/h-0/);
  });
});

// --- REDESIGN focal mode (§3.1) --------------------------------------

describe('StackZone — REDESIGN focal mode (picture-catalog §3.1)', () => {
  beforeEach(() => {
    flagState.redesign = true;
  });

  it('renders nothing visible when stack and combat are both empty', () => {
    render(<StackZone stack={{}} combat={[]} />);
    const zone = screen.getByTestId('stack-zone');
    expect(zone.dataset['stackMode']).toBe('empty');
    expect(screen.queryByTestId('stack-focal-card')).toBeNull();
    expect(screen.queryByTestId('stack-fan-card')).toBeNull();
    expect(screen.queryByTestId('targeting-arrow')).toBeNull();
  });

  it('renders only the focal card when stack has 1 entry', () => {
    const card = makeCard({
      id: 'spell-1',
      cardId: 'spell-1',
      name: 'Lightning Bolt',
      colors: ['R'],
    });
    render(<StackZone stack={makeStack([card])} combat={[]} />);
    expect(screen.getByTestId('stack-focal-card')).toBeInTheDocument();
    expect(screen.queryByTestId('stack-fan-card')).toBeNull();
    expect(screen.queryByTestId('stack-overflow-pill')).toBeNull();
    // Drops the legacy "Stack (N) — top resolves first" header.
    expect(screen.queryByText(/Stack \(\d+\)/)).toBeNull();
    // Drops the legacy TOP marker badge.
    expect(screen.queryByTestId('stack-top-marker')).toBeNull();
  });

  it('uses the single-color mana token via computeHaloBackground for single-color spells', () => {
    const card = makeCard({
      id: 'spell-1',
      cardId: 'spell-1',
      colors: ['G'],
    });
    render(<StackZone stack={makeStack([card])} combat={[]} />);
    const focal = screen.getByTestId('stack-focal-card');
    // Single-color path → solid var(--color-mana-green) per halo.ts.
    // (Different from the initial slice-70-N pre-critic-pass behavior
    // which mapped to the -glow alpha token; the halo div now carries
    // the color via background, with box-shadow providing the feather.)
    expect(focal.dataset['stackGlow']).toBe('var(--color-mana-green)');
    expect(focal.dataset['haloMulticolor']).toBeUndefined();
  });

  it('uses a conic-gradient when the topmost is multicolor (catalog §3.1 alternating bands)', () => {
    const card = makeCard({
      id: 'spell-1',
      cardId: 'spell-1',
      colors: ['W', 'U', 'B'],
    });
    render(<StackZone stack={makeStack([card])} combat={[]} />);
    const focal = screen.getByTestId('stack-focal-card');
    // Multicolor → conic-gradient(...) per halo.ts. The catalog
    // mandates "alternating bands" — single gold halo was a
    // critic-flagged deviation.
    expect(focal.dataset['stackGlow']).toMatch(/^conic-gradient\(/);
    expect(focal.dataset['haloMulticolor']).toBe('true');
  });

  it('falls back to neutral team color when colors is empty', () => {
    const card = makeCard({
      id: 'spell-1',
      cardId: 'spell-1',
      colors: [],
    });
    render(<StackZone stack={makeStack([card])} combat={[]} />);
    const focal = screen.getByTestId('stack-focal-card');
    expect(focal.dataset['stackGlow']).toBe('var(--color-team-neutral)');
  });

  it('applies the stack-glow-pulse animation class on the halo', () => {
    const card = makeCard({ id: 'spell-1', cardId: 'spell-1' });
    render(<StackZone stack={makeStack([card])} combat={[]} />);
    const halo = screen.getByTestId('stack-focal-glow');
    expect(halo.className).toMatch(/animate-stack-glow-pulse/);
  });

  it('adds animate-halo-rotate only when the topmost is multicolor', () => {
    const single = makeCard({
      id: 'spell-1',
      cardId: 'spell-1',
      colors: ['R'],
    });
    const { rerender } = render(
      <StackZone stack={makeStack([single])} combat={[]} />,
    );
    expect(screen.getByTestId('stack-focal-glow').className).not.toMatch(
      /animate-halo-rotate/,
    );

    const multi = makeCard({
      id: 'spell-1',
      cardId: 'spell-1',
      colors: ['W', 'B'],
    });
    rerender(<StackZone stack={makeStack([multi])} combat={[]} />);
    expect(screen.getByTestId('stack-focal-glow').className).toMatch(
      /animate-halo-rotate/,
    );
  });

  it('renders fan tiles for entries 2-5 and no overflow pill at 5 entries total (FAN_CAP=4)', () => {
    // 5 cards total: idx 0 = topmost, idx 1-4 = fan (4 tiles per
    // FAN_CAP=4 critic-pass adjustment).
    const cards = Array.from({ length: 5 }, (_, i) =>
      makeCard({
        id: `spell-${i}`,
        cardId: `spell-${i}`,
        name: `Spell ${i}`,
      }),
    );
    render(<StackZone stack={makeStack(cards)} combat={[]} />);
    expect(screen.getByTestId('stack-focal-card')).toBeInTheDocument();
    expect(screen.getAllByTestId('stack-fan-card')).toHaveLength(4);
    // 5 total = 1 topmost + 4 fan = no overflow.
    expect(screen.queryByTestId('stack-overflow-pill')).toBeNull();
  });

  it('caps fan at 4 tiles and shows "+N more" pill when stack > 5', () => {
    const cards = Array.from({ length: 9 }, (_, i) =>
      makeCard({
        id: `spell-${i}`,
        cardId: `spell-${i}`,
        name: `Spell ${i}`,
      }),
    );
    render(<StackZone stack={makeStack(cards)} combat={[]} />);
    expect(screen.getAllByTestId('stack-fan-card')).toHaveLength(4);
    const pill = screen.getByTestId('stack-overflow-pill');
    expect(pill.textContent).toBe('+4 more');
  });

  it('namespaces fan tile layoutId to avoid collision with the focal card', () => {
    // UI critic C3 — focal layoutId stays on plain cardId; fan tiles
    // prefix with 'stack-fan-' so two copies of the same card on the
    // stack don't collapse into one Framer layout slot.
    const cards = [
      makeCard({ id: 'spell-1', cardId: 'shared-card-id', name: 'A' }),
      makeCard({ id: 'spell-2', cardId: 'shared-card-id', name: 'B' }),
    ];
    render(<StackZone stack={makeStack(cards)} combat={[]} />);
    const focal = screen.getByTestId('stack-focal-card');
    const fan = screen.getByTestId('stack-fan-card');
    expect(focal.dataset['layoutId']).toBe('shared-card-id');
    expect(fan.dataset['layoutId']).toBe('stack-fan-shared-card-id');
  });

  it('reports fan-distance and fan-scale data attributes for diagnostics', () => {
    const cards = Array.from({ length: 4 }, (_, i) =>
      makeCard({ id: `spell-${i}`, cardId: `spell-${i}` }),
    );
    render(<StackZone stack={makeStack(cards)} combat={[]} />);
    const fans = screen.getAllByTestId('stack-fan-card');
    // distances 1..3 mapped to scales 0.85, 0.70, 0.55 per the
    // 1 - distance × 0.15 curve (picture-catalog §3.1).
    const scales = fans.map((f) => f.dataset['fanScale']).sort();
    expect(scales).toEqual(['0.55', '0.70', '0.85']);
  });

  it('exposes data-stack-count for e2e diagnostics', () => {
    const cards = Array.from({ length: 4 }, (_, i) =>
      makeCard({ id: `spell-${i}`, cardId: `spell-${i}` }),
    );
    render(<StackZone stack={makeStack(cards)} combat={[]} />);
    const zone = screen.getByTestId('stack-zone');
    expect(zone.dataset['stackMode']).toBe('focal');
    expect(zone.dataset['stackCount']).toBe('4');
  });
});

// --- REDESIGN combat mode (§3.2) -------------------------------------

describe('StackZone — REDESIGN combat mode (picture-catalog §3.2)', () => {
  beforeEach(() => {
    flagState.redesign = true;
  });

  it('renders a combat-pending container when attacker DOM nodes are not yet mounted', () => {
    const attackerCard = makeCard({
      id: 'creat-1',
      cardId: 'creat-1',
      name: 'Grizzly Bear',
    });
    const group = makeCombatGroup({
      attackers: { 'creat-1': makePerm(attackerCard) },
    });
    render(<StackZone stack={{}} combat={[group]} />);
    const zone = screen.getByTestId('stack-zone');
    expect(zone.dataset['stackMode']).toBe('combat-pending');
    expect(screen.queryByTestId('targeting-arrow')).toBeNull();
  });

  it('emits one arrow per attacker when the group has no blockers (unblocked → defender portrait)', () => {
    const attackerNode = document.createElement('div');
    attackerNode.setAttribute('data-permanent-id', 'creat-1');
    document.body.appendChild(attackerNode);
    // Tech critic IMPORTANT-4 — defender selector prefers the
    // PlayerPortrait's data-portrait-target-player-id over the
    // pod-level data-player-id.
    const portraitNode = document.createElement('div');
    portraitNode.setAttribute(
      'data-portrait-target-player-id',
      '00000000-0000-0000-0000-000000000aaa',
    );
    document.body.appendChild(portraitNode);

    const attackerCard = makeCard({
      id: 'creat-1',
      cardId: 'creat-1',
    });
    const group = makeCombatGroup({
      attackers: { 'creat-1': makePerm(attackerCard) },
      blockers: {},
    });
    render(<StackZone stack={{}} combat={[group]} />);
    const zone = screen.getByTestId('stack-zone');
    expect(zone.dataset['stackMode']).toBe('combat');
    expect(zone.dataset['arrowCount']).toBe('1');
    expect(screen.getAllByTestId('targeting-arrow')).toHaveLength(1);
  });

  it('falls back to pod-level data-player-id when the portrait target is missing', () => {
    const attackerNode = document.createElement('div');
    attackerNode.setAttribute('data-permanent-id', 'creat-1');
    document.body.appendChild(attackerNode);
    // No data-portrait-target-player-id, only the pod-level
    // data-player-id — the legacy / non-redesign-PlayerArea
    // compatibility path.
    const podNode = document.createElement('div');
    podNode.setAttribute(
      'data-player-id',
      '00000000-0000-0000-0000-000000000aaa',
    );
    document.body.appendChild(podNode);

    const attackerCard = makeCard({ id: 'creat-1', cardId: 'creat-1' });
    const group = makeCombatGroup({
      attackers: { 'creat-1': makePerm(attackerCard) },
    });
    render(<StackZone stack={{}} combat={[group]} />);
    expect(screen.getByTestId('stack-zone').dataset['arrowCount']).toBe('1');
  });

  it('emits one arrow per (attacker × blocker) pair when the group is blocked', () => {
    const attackerNode = document.createElement('div');
    attackerNode.setAttribute('data-permanent-id', 'creat-1');
    document.body.appendChild(attackerNode);
    const blocker1Node = document.createElement('div');
    blocker1Node.setAttribute('data-permanent-id', 'creat-2');
    document.body.appendChild(blocker1Node);
    const blocker2Node = document.createElement('div');
    blocker2Node.setAttribute('data-permanent-id', 'creat-3');
    document.body.appendChild(blocker2Node);

    const attacker = makeCard({ id: 'creat-1', cardId: 'creat-1' });
    const blocker1 = makeCard({ id: 'creat-2', cardId: 'creat-2' });
    const blocker2 = makeCard({ id: 'creat-3', cardId: 'creat-3' });
    const group = makeCombatGroup({
      attackers: { 'creat-1': makePerm(attacker) },
      blockers: {
        'creat-2': makePerm(blocker1),
        'creat-3': makePerm(blocker2),
      },
      blocked: true,
    });
    render(<StackZone stack={{}} combat={[group]} />);
    const zone = screen.getByTestId('stack-zone');
    expect(zone.dataset['stackMode']).toBe('combat');
    expect(zone.dataset['arrowCount']).toBe('2');
    expect(screen.getAllByTestId('targeting-arrow')).toHaveLength(2);
  });

  it('prefers stack mode when both stack and combat are non-empty (combat-trick caveat §3.2)', () => {
    // Per §3.2: "If a spell is cast during combat, switch BACK to
    // stack mode for the duration of that spell on the stack, then
    // return to combat mode."
    const spell = makeCard({ id: 'spell-1', cardId: 'spell-1' });
    const attackerNode = document.createElement('div');
    attackerNode.setAttribute('data-permanent-id', 'creat-1');
    document.body.appendChild(attackerNode);
    const attacker = makeCard({ id: 'creat-1', cardId: 'creat-1' });
    const group = makeCombatGroup({
      attackers: { 'creat-1': makePerm(attacker) },
    });
    render(<StackZone stack={makeStack([spell])} combat={[group]} />);
    expect(screen.getByTestId('stack-focal-card')).toBeInTheDocument();
    const zone = screen.getByTestId('stack-zone');
    expect(zone.dataset['stackMode']).toBe('focal');
  });
});
