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
  // Wire contract (see CardViewMapper.toStackMap + WebGameView.stack
  // Javadoc): the server emits the stack newest-first — the FIRST key
  // is the topmost / next-to-resolve spell. This helper inserts in
  // input order, so the FIRST card in the input array becomes the
  // topmost (focal). Tests that need a specific top/fan layout should
  // pass the topmost card first.
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

  it('renders a spinning white-gold spotlight ring around the focal card edge', () => {
    // Slice 70-Z polish round 9 — `animate-stack-glow-pulse`
    // (breathing opacity) replaced by a spinning white-gold
    // spotlight (`animate-stack-spotlight-rotate`) on a sibling
    // ring element. The spotlight is the active-attention mechanism
    // for the topmost stack card.
    const card = makeCard({ id: 'spell-1', cardId: 'spell-1' });
    render(<StackZone stack={makeStack([card])} combat={[]} />);
    const spotlight = screen.getByTestId('stack-focal-spotlight');
    expect(spotlight.className).toMatch(/animate-stack-spotlight-rotate/);
    // Halo div no longer carries the breathing pulse class.
    const halo = screen.getByTestId('stack-focal-glow');
    expect(halo.className).not.toMatch(/animate-stack-glow-pulse/);
  });

  it('renders the focal halo via blurred conic-gradient sibling div (single color)', () => {
    // Slice 70-Z polish — FocalCard halo migrated to the same
    // blurred-gradient bloom approach as PlayerPortrait. The
    // single halo div carries a solid `var(--color-mana-X)`
    // background + filter:blur softening; bloom and ring rotate
    // in lockstep on the shared --halo-angle.
    const card = makeCard({
      id: 'spell-1',
      cardId: 'spell-1',
      colors: ['R'],
    });
    render(<StackZone stack={makeStack([card])} combat={[]} />);
    const halo = screen.getByTestId('stack-focal-glow');
    expect(halo.style.background).toContain('--color-mana-red');
    expect(halo.style.filter).toMatch(/blur\(\d+px\)/);
  });

  it('renders the focal halo as conic-gradient for multicolor (universal halo-glow rule)', () => {
    const card = makeCard({
      id: 'spell-1',
      cardId: 'spell-1',
      colors: ['W', 'U', 'B'],
    });
    render(<StackZone stack={makeStack([card])} combat={[]} />);
    const halo = screen.getByTestId('stack-focal-glow');
    expect(halo.style.background).toMatch(/^conic-gradient\(/);
  });

  it('falls back to neutral team color when colors is empty', () => {
    const card = makeCard({
      id: 'spell-1',
      cardId: 'spell-1',
      colors: [],
    });
    render(<StackZone stack={makeStack([card])} combat={[]} />);
    const halo = screen.getByTestId('stack-focal-glow');
    expect(halo.style.background).toContain('--color-team-neutral');
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
    // Slice 70-Z polish round 12 — queue tiles use a multiplicative
    // shrink schedule: distance 1 = 0.80, distance 2 = 0.80 × 0.85
    // = 0.68, distance 3 = 0.68 × 0.85 = 0.578. Produces a
    // perspective-stack effect where each successive (older) card
    // is 15% smaller than the one before it. Test asserts the
    // first three positions; the same formula extends to deeper
    // distances.
    const cards = Array.from({ length: 4 }, (_, i) =>
      makeCard({ id: `spell-${i}`, cardId: `spell-${i}` }),
    );
    render(<StackZone stack={makeStack(cards)} combat={[]} />);
    const fans = screen.getAllByTestId('stack-fan-card');
    // Pair each tile's distance + scale and sort by distance so
    // the assertion is order-stable regardless of DOM/React
    // mounting order.
    const pairs = fans
      .map((f) => ({
        distance: Number(f.dataset['fanDistance']),
        scale: f.dataset['fanScale'],
      }))
      .sort((a, b) => a.distance - b.distance);
    expect(pairs).toEqual([
      { distance: 1, scale: '0.80' },
      { distance: 2, scale: '0.68' },
      { distance: 3, scale: '0.58' }, // 0.578 → toFixed(2)
    ]);
  });

  it('renders the most-recently-cast spell as the focal (newest = top of stack)', () => {
    // Regression for the bug where a stale .reverse() on the entries
    // list flipped the focal to the OLDEST stack entry. Cast order:
    // alpha (cast first, oldest, resolves LAST) → beta → gamma (cast
    // last, newest, resolves FIRST). Server wire-order convention:
    // newest = first key. Focal must be gamma; fan must be [beta,
    // alpha] in that order (newer fan tile closer to the focal).
    const alpha = makeCard({
      id: 'spell-alpha',
      cardId: 'spell-alpha',
      name: 'Alpha',
    });
    const beta = makeCard({
      id: 'spell-beta',
      cardId: 'spell-beta',
      name: 'Beta',
    });
    const gamma = makeCard({
      id: 'spell-gamma',
      cardId: 'spell-gamma',
      name: 'Gamma',
    });
    render(
      <StackZone stack={makeStack([gamma, beta, alpha])} combat={[]} />,
    );
    const focal = screen.getByTestId('stack-focal-card');
    expect(focal.textContent).toContain('Gamma');
    expect(focal.textContent).not.toContain('Alpha');
    // Fan ordering: distance 1 (closest to focal) = beta (2nd-newest);
    // distance 2 (further out) = alpha (oldest visible).
    const fans = screen.getAllByTestId('stack-fan-card');
    const byDistance = new Map(
      fans.map((f) => [Number(f.dataset['fanDistance']), f.textContent ?? '']),
    );
    expect(byDistance.get(1)).toContain('Beta');
    expect(byDistance.get(2)).toContain('Alpha');
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

// --- Slice 70-Z / schema 1.26 — ability stack-source swap ---------

describe('StackZone — ability source-card swap (slice 70-Z)', () => {
  beforeEach(() => {
    flagState.redesign = true;
  });

  it('renders the source card visual when an ability has source set', () => {
    // Ability stack object — name="Ability" placeholder, source carries
    // the full Soul Warden card. The focal CardFace must render Soul
    // Warden, not the blank placeholder.
    const sourceCard = makeCard({
      id: 'soul-warden-1',
      cardId: 'soul-warden-1',
      name: 'Soul Warden',
      colors: ['W'],
    });
    const ability = makeCard({
      id: 'trigger-1',
      cardId: 'trigger-1',
      name: 'Ability',
      displayName: 'Ability',
      colors: [],
      source: sourceCard,
    });
    render(<StackZone stack={makeStack([ability])} combat={[]} />);
    // CardFace renders by display name in test (real renderer uses
    // image, but the placeholder text path is the test-readable
    // surface).
    const focal = screen.getByTestId('stack-focal-card');
    expect(focal.textContent).toContain('Soul Warden');
    expect(focal.textContent).not.toContain('Ability');
  });

  it('falls back to the entry itself when source is null (spells)', () => {
    // Spells on the stack come through with source === null. The
    // focal must render the spell's own card (existing behavior).
    const spell = makeCard({
      id: 'bolt-1',
      cardId: 'bolt-1',
      name: 'Lightning Bolt',
      colors: ['R'],
      source: null,
    });
    render(<StackZone stack={makeStack([spell])} combat={[]} />);
    const focal = screen.getByTestId('stack-focal-card');
    expect(focal.textContent).toContain('Lightning Bolt');
  });

  it('keeps the entry-own cardId for layoutId, not the source cardId', () => {
    // Critical: source permanent stays on the battlefield; we must NOT
    // animate it off-board to the focal stack. layoutId tracks the
    // entry's own cardId (a unique-per-trigger id), not the source's.
    const sourceCard = makeCard({
      id: 'soul-warden-1',
      cardId: 'soul-warden-cardId',
      name: 'Soul Warden',
    });
    const ability = makeCard({
      id: 'trigger-1',
      cardId: 'trigger-cardId',
      name: 'Ability',
      source: sourceCard,
    });
    render(<StackZone stack={makeStack([ability])} combat={[]} />);
    const focal = screen.getByTestId('stack-focal-card');
    expect(focal.dataset['layoutId']).toBe('trigger-cardId');
    expect(focal.dataset['layoutId']).not.toBe('soul-warden-cardId');
  });

  it('renders three independent visuals when three identical-source triggers stack', () => {
    // Three creatures with "when this ETB, draw a card" entering
    // simultaneously → three triggers on the stack. User confirmed
    // (slice 70-Z question #5): three independent visuals, no badge
    // collapse. They are independent stack objects.
    const sourceCard = makeCard({
      id: 'src',
      cardId: 'src-cardId',
      name: 'Soul Warden',
    });
    const t1 = makeCard({ id: 't1', cardId: 't1', name: 'Ability', source: sourceCard });
    const t2 = makeCard({ id: 't2', cardId: 't2', name: 'Ability', source: sourceCard });
    const t3 = makeCard({ id: 't3', cardId: 't3', name: 'Ability', source: sourceCard });
    render(<StackZone stack={makeStack([t1, t2, t3])} combat={[]} />);
    expect(screen.getByTestId('stack-focal-card')).toBeInTheDocument();
    // The non-topmost two are fan tiles.
    expect(screen.getAllByTestId('stack-fan-card')).toHaveLength(2);
  });

  it('fan tiles also swap to the source card when source is set', () => {
    const sourceCard = makeCard({
      id: 'src',
      cardId: 'src-cardId',
      name: 'Soul Warden',
    });
    const top = makeCard({
      id: 'top',
      cardId: 'top',
      name: 'Lightning Bolt',
      source: null,
    });
    const fanAbility = makeCard({
      id: 'fan-1',
      cardId: 'fan-1',
      name: 'Ability',
      source: sourceCard,
    });
    // Server wire-order: newest = first key. The spell `top` is the
    // newest stack entry (focal); `fanAbility` was on the stack first
    // and is now the lone fan tile. Pass [top, fanAbility] so the
    // focal renders Lightning Bolt and the fan renders Soul Warden.
    render(<StackZone stack={makeStack([top, fanAbility])} combat={[]} />);
    // Top is the spell, fan is the ability whose visual must be Soul
    // Warden.
    const fan = screen.getByTestId('stack-fan-card');
    expect(fan.textContent).toContain('Soul Warden');
  });
});

describe('StackZone — legacy strip ability source-card swap', () => {
  beforeEach(() => {
    flagState.redesign = false;
  });

  it('legacy branch also swaps to source when present', () => {
    const sourceCard = makeCard({
      id: 'src',
      cardId: 'src-cardId',
      name: 'Soul Warden',
    });
    const ability = makeCard({
      id: 'trigger-1',
      cardId: 'trigger-1',
      name: 'Ability',
      source: sourceCard,
    });
    render(<StackZone stack={makeStack([ability])} />);
    const entry = screen.getByTestId('stack-entry');
    expect(entry.textContent).toContain('Soul Warden');
  });
});
