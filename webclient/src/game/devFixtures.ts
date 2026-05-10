/**
 * Dev-only fixture for layout/UI iteration. Builds a 4-player
 * Commander game state with populated battlefields per pod so all
 * layout regions (top + side pods + self pod + central focal zone +
 * hand fan) render with realistic content. Reachable via the URL
 * param {@code ?game=fixture} (see App.tsx routing).
 *
 * <p>Not bundled in tests — stand-up only. Call sites should NOT
 * import from this module in production paths; the URL-param gate in
 * App.tsx is the single guard against fixture data leaking into a
 * live session.
 */
import {
  webGameViewSchema,
  webPlayerViewSchema,
  webPermanentViewSchema,
  webCardViewSchema,
  type WebGameView,
  type WebPermanentView,
} from '../api/schemas';

const TYPE_DEFAULTS = {
  CREATURE: { types: ['CREATURE'], power: '2', toughness: '2', startingLoyalty: '' },
  LAND: { types: ['LAND'], power: '', toughness: '', startingLoyalty: '' },
  ARTIFACT: { types: ['ARTIFACT'], power: '', toughness: '', startingLoyalty: '' },
  PLANESWALKER: { types: ['PLANESWALKER'], power: '', toughness: '', startingLoyalty: '4' },
  ENCHANTMENT: { types: ['ENCHANTMENT'], power: '', toughness: '', startingLoyalty: '' },
} as const;

type CardKind = keyof typeof TYPE_DEFAULTS;

let nextId = 1;
function uid(): string {
  const n = (nextId++).toString(16).padStart(12, '0');
  return `${n.slice(0, 8)}-${n.slice(8, 12)}-4000-8000-${'0'.repeat(8)}${n.slice(0, 4)}`;
}

function makeCard(name: string, kind: CardKind, setCode = 'NEO', cardNumber = '1') {
  const id = uid();
  const defaults = TYPE_DEFAULTS[kind];
  return webCardViewSchema.parse({
    id,
    cardId: id,
    name,
    displayName: name,
    expansionSetCode: setCode,
    cardNumber,
    manaCost: '',
    manaValue: 0,
    typeLine: kind,
    supertypes: [],
    types: defaults.types,
    subtypes: [],
    colors: [],
    rarity: 'COMMON',
    power: defaults.power,
    toughness: defaults.toughness,
    startingLoyalty: defaults.startingLoyalty,
    rules: [],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
    sourceLabel: '',
    source: null,
  });
}

function makePerm(
  name: string,
  kind: CardKind,
  controllerName: string,
  attachedTo = '',
): WebPermanentView {
  return webPermanentViewSchema.parse({
    card: makeCard(name, kind),
    controllerName,
    tapped: false,
    flipped: false,
    transformed: false,
    phasedIn: true,
    summoningSickness: false,
    damage: 0,
    attachments: [],
    attachedTo,
    attachedToPermanent: !!attachedTo,
    goadingPlayerIds: [],
  });
}

function bf(controllerName: string, entries: Array<[string, CardKind]>): Record<string, WebPermanentView> {
  const out: Record<string, WebPermanentView> = {};
  for (const [name, kind] of entries) {
    const p = makePerm(name, kind, controllerName);
    out[p.card.id] = p;
  }
  return out;
}

// User direction (2026-05-03) — "Put 20 cards in each zone and let me
// see how it looks." Each pod's three buckets (lands / creatures /
// artifacts-enchantments) gets exactly 20 entries so B-13-D's 10%
// peek stacking renders at full density across all 4 pods.
const BIG_BOARD_CREATURE_POOL: ReadonlyArray<[string, CardKind]> = [
  ['Llanowar Elves', 'CREATURE'],
  ['Birds of Paradise', 'CREATURE'],
  ['Snapcaster Mage', 'CREATURE'],
  ['Goblin Guide', 'CREATURE'],
  ['Soul Warden', 'CREATURE'],
  ['Mother of Runes', 'CREATURE'],
  ['Eternal Witness', 'CREATURE'],
  ['Monastery Mentor', 'CREATURE'],
  ['Mulldrifter', 'CREATURE'],
  ['Reclamation Sage', 'CREATURE'],
];
const BIG_BOARD_ARTIFACT_POOL: ReadonlyArray<[string, CardKind]> = [
  ['Sol Ring', 'ARTIFACT'],
  ['Mana Crypt', 'ARTIFACT'],
  ["Sensei's Divining Top", 'ARTIFACT'],
  ['Lightning Greaves', 'ARTIFACT'],
  ['Skullclamp', 'ARTIFACT'],
  ['Mind Stone', 'ARTIFACT'],
  ['Arcane Signet', 'ARTIFACT'],
  ["Wayfarer's Bauble", 'ARTIFACT'],
  ['Swiftfoot Boots', 'ARTIFACT'],
  ["Commander's Sphere", 'ARTIFACT'],
];

function bigBoardEntries(landName: string): Array<[string, CardKind]> {
  const out: Array<[string, CardKind]> = [];
  for (let i = 0; i < 20; i++) out.push([landName, 'LAND']);
  for (let i = 0; i < 20; i++) out.push(BIG_BOARD_CREATURE_POOL[i % BIG_BOARD_CREATURE_POOL.length]!);
  for (let i = 0; i < 20; i++) out.push(BIG_BOARD_ARTIFACT_POOL[i % BIG_BOARD_ARTIFACT_POOL.length]!);
  return out;
}

/**
 * Build a 4-player Commander demo game view. Layout-stress-tested:
 * the right pod (goat) gets a deliberately busy board (many lands +
 * creatures + artifacts) so the side-pod containment + shrink + new
 * single-column-stack behavior all surface in one view.
 */
/**
 * Slice 1-X-smoke (Bundle 1 live verification) — opt-in flag that
 * pre-populates the fixture with combat-active state. The default
 * fixture is parked at PRECOMBAT_MAIN with empty combat[], which
 * means Bundle 1's four user-visible features (defender colors +
 * dashes, incoming-tags, wave-reveal stagger, defender beams)
 * never render. Without engine-driven phase advancement in the
 * fixture, the only path to verifying the bundle visually is to
 * seed combat directly. Reachable via `?combat=1` URL param
 * (DemoGame.tsx parses).
 *
 * Dev-only — not consumed by tests, not reachable in production.
 */
export interface BuildDemoGameViewOptions {
  /**
   * When true, the fixture starts in `phase: 'COMBAT'` with 3
   * attacker groups across 3 different defenders (mono-G, multicolor,
   * mono-R) — one group blocked, the others unblocked, so the
   * "incoming N — M unblocked" math surfaces both cases.
   */
  combatActive?: boolean;
  /**
   * Slice 4-X.1 — combat sub-step. Defaults to {@code 'damage'}
   * when {@link combatActive} is true (legacy `?combat=1` behavior:
   * step = COMBAT_DAMAGE, all 3 groups already declared). Set to
   * {@code 'declare'} to park at DECLARE_ATTACKERS with
   * possibleAttackers populated — surfaces Bundle 4 slice 4-C's
   * eligibility pulse + slice 4-X.0 N-E's pulse-off-when-assigned
   * gate. The 'declare' fixture seeds half the attackers as already
   * in combat (pulse OFF, brackets + ring on) and half as eligible-
   * but-not-yet-picked (pulse ON, no brackets), demonstrating both
   * states side-by-side.
   */
  combatPhase?: 'damage' | 'declare' | undefined;
  /**
   * Slice 4-X.1 — when true AND combatActive is true, mark a subset
   * of the attacker perms as tapped so the tap-rotation fix
   * (slice 4-X.0 B-1) is verifiable: the brackets + halo + inner
   * ring should rotate 90° with the cardart, not stay upright as
   * an outline of the un-tapped tile.
   */
  tappedAttackers?: boolean;
  /**
   * Foundation experiment (Option D — z-layer cohabitation,
   * 2026-05-10) — when true AND combatActive is true, seed a
   * Lightning Bolt on the stack so the new cohabit-mode rendering
   * (CombatArrows + StackFan layered) is visible in the live
   * fixture. The default `?combat=1` behavior keeps the stack empty
   * (so arrows render without a stack tile blocking them); set
   * `?stack=1` alongside to verify the new contract where both
   * mount simultaneously and the stack tile sits on top via
   * z-index. Without this knob the cohabit state isn't reachable
   * from the static fixture.
   */
  stackDuringCombat?: boolean;
}

export function buildDemoGameView(
  opts: BuildDemoGameViewOptions = {},
): WebGameView {
  // Reset id counter so the same fixture renders the same UUIDs
  // every time (helps with React keys + Framer layoutId stability).
  nextId = 1;

  const meId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const goatId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const momurId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const allocId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  // 2026-05-03 user direction — every pod runs the full 60-entry
  // big-board (20 lands + 20 creatures + 20 artifacts) so peek
  // stacking renders at scale on all 4 pods simultaneously.
  const meBf: Record<string, WebPermanentView> = bf('MAJEST1C', bigBoardEntries('Plains'));

  // Slice 4-X.1 — when `?tapped=1` is set alongside combatActive,
  // mark the first 2 me-creatures (which become att1 + att2 in
  // buildCombatGroups' deterministic ordering) as tapped so the
  // tap-rotation fix from slice 4-X.0 B-1 is visible: the marker
  // chrome (halo + brackets + inner ring) should rotate 90° with
  // the cardart, not stay upright as a portrait-shaped frame
  // around a sideways card. Mutates meBf BEFORE the me player is
  // parsed (zod re-parse would otherwise discard the mutation).
  if (opts.combatActive && opts.tappedAttackers) {
    const meCreatures = Object.values(meBf).filter((p) =>
      p.card.types.includes('CREATURE'),
    );
    for (const p of meCreatures.slice(0, 2)) {
      p.tapped = true;
    }
  }

  // Helper — build a Record<id, card> from a list of [name, kind] pairs
  // for graveyard / exile seeding so every player has scannable
  // contents in those zones for layout / interaction testing.
  const zone = (
    entries: Array<[string, CardKind]>,
  ): Record<string, ReturnType<typeof makeCard>> => {
    const out: Record<string, ReturnType<typeof makeCard>> = {};
    for (const [name, kind] of entries) {
      const c = makeCard(name, kind);
      out[c.id] = c;
    }
    return out;
  };

  // Slice B-12-B — minimal commandList entries per player so the
  // commander slots can resolve Scryfall art for visual verification.
  // Real-ish set+collector pairs that should resolve (Scryfall API
  // may rate-limit; fallback ladder is name-text → placeholder).
  const me = webPlayerViewSchema.parse({
    playerId: meId, name: 'MAJEST1C', life: 40, wins: 0, winsNeeded: 1,
    commandList: [
      {
        id: 'cmdr-elsha',
        kind: 'commander',
        name: 'Elsha, Threefold Master',
        expansionSetCode: 'C21',
        imageFileName: '',
        imageNumber: 0,
        cardNumber: '32',
        rules: [],
      },
    ],
    // Slice B-1.5 (refined from B-1's W/U/R) — Boros (W/R), 2-band
    // conic-gradient that reads more clearly than the original Jeskai
    // 3-band on a wide-aspect pod. The white-glow token composites
    // onto dark zinc as warm cream/tan, similar to card-back chrome,
    // so 3 bands tended to muddy each other; 2 bands give cleaner
    // visual separation. Pairs reasonably with the Elsha commander
    // on this player's battlefield (Elsha's full identity is Jeskai
    // WUR but Boros captures the W+R combat-leaning theme).
    colorIdentity: ['W', 'R'],
    libraryCount: 80, handCount: 6,
    graveyard: zone([
      ['Lightning Bolt', 'CREATURE'],
      ['Path to Exile', 'CREATURE'],
      ['Swords to Plowshares', 'CREATURE'],
    ]),
    exile: zone([
      ['Counterspell', 'CREATURE'],
      ['Force of Will', 'CREATURE'],
    ]),
    sideboard: {},
    battlefield: meBf,
    // 2026-05-03 — non-zero mana pool so the floating local mana
    // orbs are visible in fixture mode (Z2). Boros-themed (W/R)
    // matches the player's color identity.
    manaPool: { red: 2, green: 0, blue: 0, white: 1, black: 0, colorless: 1 },
    controlled: true, isHuman: true, isActive: false, hasPriority: true,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });

  // Right pod — the layout-stress case the user reported.
  const goat = webPlayerViewSchema.parse({
    playerId: goatId, name: 'goat', life: 40, wins: 0, winsNeeded: 1,
    commandList: [
      {
        id: 'cmdr-ghalta',
        kind: 'commander',
        name: 'Ghalta, Primal Hunger',
        expansionSetCode: 'RIX',
        imageFileName: '',
        imageNumber: 0,
        cardNumber: '130',
        rules: [],
      },
    ],
    // Mono-green — board has Forests + Llanowar Elves + Ghalta etc.
    colorIdentity: ['G'],
    libraryCount: 90, handCount: 6,
    graveyard: zone([
      ['Birds of Paradise', 'CREATURE'],
      ['Eternal Witness', 'CREATURE'],
      ['Cultivate', 'CREATURE'],
      ['Rampant Growth', 'CREATURE'],
    ]),
    exile: zone([
      ['Worldly Tutor', 'CREATURE'],
    ]),
    sideboard: {},
    battlefield: bf('goat', bigBoardEntries('Forest')),
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false, isHuman: true, isActive: true, hasPriority: false,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });

  // Top pod — modest board.
  const momur = webPlayerViewSchema.parse({
    playerId: momurId, name: 'momur', life: 40, wins: 0, winsNeeded: 1,
    commandList: [
      {
        id: 'cmdr-talrand',
        kind: 'commander',
        name: 'Talrand, Sky Summoner',
        expansionSetCode: 'M13',
        imageFileName: '',
        imageNumber: 0,
        cardNumber: '75',
        rules: [],
      },
    ],
    // Mono-blue — board has Islands + Snapcaster Mage + Brainstorm.
    colorIdentity: ['U'],
    libraryCount: 91, handCount: 5,
    graveyard: zone([
      ['Brainstorm', 'CREATURE'],
      ['Ponder', 'CREATURE'],
    ]),
    exile: zone([
      ['Snapcaster Mage', 'CREATURE'],
      ['Mystical Tutor', 'CREATURE'],
    ]),
    sideboard: {},
    battlefield: bf('momur', bigBoardEntries('Island')),
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false, isHuman: true, isActive: false, hasPriority: false,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });

  // Left pod — also busy, mirror of right to test left-pod stacking.
  const alloc = webPlayerViewSchema.parse({
    playerId: allocId, name: 'Alloc', life: 35, wins: 0, winsNeeded: 1,
    commandList: [
      {
        id: 'cmdr-krenko',
        kind: 'commander',
        name: 'Krenko, Mob Boss',
        expansionSetCode: 'M13',
        imageFileName: '',
        imageNumber: 0,
        cardNumber: '142',
        rules: [],
      },
    ],
    // Mono-red — board has Mountains + Goblin Guides + Lava Spike.
    colorIdentity: ['R'],
    libraryCount: 85, handCount: 4,
    graveyard: zone([
      ['Lava Spike', 'CREATURE'],
      ['Goblin Grenade', 'CREATURE'],
      ['Searing Blaze', 'CREATURE'],
    ]),
    exile: zone([
      ['Chandra, Torch of Defiance', 'CREATURE'],
    ]),
    sideboard: {},
    battlefield: bf('Alloc', bigBoardEntries('Mountain')),
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false, isHuman: true, isActive: false, hasPriority: false,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });

  // Slice 1-X-smoke — combat-active fixture state, opt-in via opts.
  // Pull 4 attacker permanents from the local player's battlefield
  // (so they have real `data-permanent-id` attributes the
  // CombatArrows + DefenderBeams geometry hooks can target) plus
  // 1 blocker from alloc's battlefield. 3 combat groups exercise
  // mono-G defender (goat), multicolor defender (momur, B/R),
  // mono-R defender (alloc), with the alloc group having a
  // blocker so the "incoming N — M unblocked" math surfaces both
  // M < N and M = N cases.
  //
  // Slice 4-X.1 — `combatPhase: 'declare'` parks at
  // DECLARE_ATTACKERS with a SUBSET of attackers in combat (just
  // att1 vs goat). The remaining 3 me-creatures (att2-att4) are
  // surfaced as eligible-but-not-yet-picked via possibleAttackers
  // in DemoGame.tsx's pendingDialog seed, demonstrating both the
  // "pulse OFF on already-assigned" (att1 with brackets+ring) AND
  // "pulse ON on eligible-unassigned" (att2-4 with amber breath)
  // pulse-gate states from slice 4-X.0 N-E.
  const combatPhase = opts.combatPhase ?? 'damage';
  const isDeclarePhase = opts.combatActive && combatPhase === 'declare';
  const combat = !opts.combatActive
    ? []
    : isDeclarePhase
      ? buildPartialCombatGroups(meBf, goatId)
      : buildCombatGroups(meBf, alloc.battlefield, goatId, momurId, allocId);

  return webGameViewSchema.parse({
    turn: 4,
    phase: opts.combatActive ? 'COMBAT' : 'PRECOMBAT_MAIN',
    step: !opts.combatActive
      ? 'PRECOMBAT_MAIN'
      : isDeclarePhase
        ? 'DECLARE_ATTACKERS'
        : 'COMBAT_DAMAGE',
    activePlayerName: 'goat',
    priorityPlayerName: 'MAJEST1C',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: me.playerId,
    myHand: (() => {
      const hand: Record<string, ReturnType<typeof makeCard>> = {};
      for (const name of [
        "Teferi's Protection",
        'Treasure Cruise',
        'Archmage Emeritus',
        'Pact of Negation',
        'Caldera Pyremaw',
        'Deflecting Swat',
      ]) {
        const c = makeCard(name, 'CREATURE');
        hand[c.id] = c;
      }
      return hand;
    })(),
    // Slice 1-X-smoke — when combatActive, the stack must be empty
    // so StackZoneRedesigned mounts CombatArrows alone (legacy
    // mutex behavior: `stackEmpty && combatActive`). The default
    // fixture seeds a Lightning Bolt on the stack for stack-zone
    // iteration.
    //
    // Foundation Option D (2026-05-10) — `stackDuringCombat=true`
    // overrides the empty-stack default so BOTH a stack entry and
    // combat groups are present, surfacing the new cohabit-mode
    // rendering for live verification.
    stack:
      opts.combatActive && !opts.stackDuringCombat
        ? ({} as Record<string, ReturnType<typeof makeCard>>)
        : (() => {
            const stack: Record<string, ReturnType<typeof makeCard>> = {};
            const lightning = makeCard(
              'Lightning Bolt',
              'CREATURE',
              'M21',
              '162',
            );
            stack[lightning.id] = lightning;
            return stack;
          })(),
    combat,
    players: [me, goat, momur, alloc],
  });
}

/**
 * Slice 1-X-smoke — assembles 3 combat groups from existing
 * fixture battlefield permanents so Bundle 1's combat-active
 * surfaces (CombatArrows colors/dashes, IncomingTag badges,
 * wave-reveal stagger, DefenderBeams) all light up at once
 * when the fixture is loaded with `?combat=1`.
 *
 * Pulls real permanent objects from the maps so the rendered
 * `data-permanent-id` DOM attributes match the IDs the geometry
 * hooks query. Returns an empty array if any required permanent
 * isn't present (defensive — fixture always has enough but
 * future fixture refactors could shrink the battlefields).
 */
/**
 * Slice 4-X.1 — partial combat groups for the `?combat=declare`
 * fixture mode. Only att1 is committed to combat (vs goat); the
 * remaining 3 me-creatures (att2-att4) are surfaced separately via
 * `getPossibleAttackerIds` + DemoGame.tsx's pendingDialog seed so
 * they pulse as eligible-but-not-yet-picked candidates. Demonstrates
 * both pulse-gate states (slice 4-X.0 N-E) side-by-side: att1
 * shows brackets+ring without pulse (already assigned); att2-4
 * show pulse without brackets (eligible but unassigned).
 */
function buildPartialCombatGroups(
  meBf: Record<string, WebPermanentView>,
  goatId: string,
) {
  const meCreatures = Object.values(meBf).filter((p) =>
    p.card.types.includes('CREATURE'),
  );
  if (meCreatures.length < 1) return [];
  const att1 = meCreatures[0]!;
  return [
    {
      defenderId: goatId,
      defenderName: 'goat',
      attackers: { [att1.card.id]: att1 },
      blockers: {},
      blocked: false,
    },
  ];
}

/**
 * Slice 4-X.1 — extracts the first 4 me-creature ids from the
 * fixture's gameView. DemoGame.tsx feeds this into the pendingDialog
 * seed for the `?combat=declare` mode so all 4 me-creatures show
 * up as `possibleAttackers` (driving `eligibleCombatIds` →
 * `isEligibleCombat` → 4-C eligibility-pulse + 4-X.0 N-E pulse
 * gate). Returns an empty array if the fixture's me-battlefield
 * doesn't have at least 4 creatures (defensive — current fixture
 * always has 20 me-creatures from bigBoardEntries).
 */
export function getPossibleAttackerIds(gameView: WebGameView): string[] {
  const me = gameView.players.find(
    (p) => p.playerId === gameView.myPlayerId,
  );
  if (!me) return [];
  const creatures = Object.values(me.battlefield).filter((p) =>
    p.card.types.includes('CREATURE'),
  );
  return creatures.slice(0, 4).map((p) => p.card.id);
}

function buildCombatGroups(
  meBf: Record<string, WebPermanentView>,
  allocBf: Record<string, WebPermanentView>,
  goatId: string,
  momurId: string,
  allocId: string,
) {
  const meCreatures = Object.values(meBf).filter(
    (p) => p.card.types.includes('CREATURE'),
  );
  const allocCreatures = Object.values(allocBf).filter(
    (p) => p.card.types.includes('CREATURE'),
  );
  if (meCreatures.length < 4 || allocCreatures.length < 1) return [];

  const att1 = meCreatures[0]!;
  const att2 = meCreatures[1]!;
  const att3 = meCreatures[2]!;
  const att4 = meCreatures[3]!;
  const blocker = allocCreatures[0]!;

  return [
    // Goat (mono-G) — 2 unblocked attackers. Tag should read
    // "incoming 2 — 2 unblocked"; arrow stroke = green; dash = '8 6'
    // (defender index 1 in players-order).
    {
      defenderId: goatId,
      defenderName: 'goat',
      attackers: { [att1.card.id]: att1, [att2.card.id]: att2 },
      blockers: {},
      blocked: false,
    },
    // Momur (multicolor B/R) — 1 unblocked attacker. Tag should
    // read "incoming 1 — 1 unblocked"; arrow stroke = banded
    // black/red gradient; dash = '2 5' (defender index 2).
    {
      defenderId: momurId,
      defenderName: 'momur',
      attackers: { [att3.card.id]: att3 },
      blockers: {},
      blocked: false,
    },
    // Alloc (mono-R) — 1 attacker, BLOCKED by an alloc creature.
    // Tag should read "incoming 1" (suffix dropped because
    // unblocked = 0); arrow stroke = red; dash = '1 6' (defender
    // index 3); arrow points to the blocker tile, not the portrait.
    {
      defenderId: allocId,
      defenderName: 'Alloc',
      attackers: { [att4.card.id]: att4 },
      blockers: { [blocker.card.id]: blocker },
      blocked: true,
    },
  ];
}
