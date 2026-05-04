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

/**
 * Build a 4-player Commander demo game view. Layout-stress-tested:
 * the right pod (goat) gets a deliberately busy board (many lands +
 * creatures + artifacts) so the side-pod containment + shrink + new
 * single-column-stack behavior all surface in one view.
 */
export function buildDemoGameView(): WebGameView {
  // Reset id counter so the same fixture renders the same UUIDs
  // every time (helps with React keys + Framer layoutId stability).
  nextId = 1;

  const meId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const goatId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const momurId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const allocId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  // Slice B-13-D verify — bumped MAJEST1C's board to ~14 permanents
  // so the 10% peek stacking from B-13-D is visible at scale.
  // 7 lands → Lands bucket overflow; 5 creatures → Creatures bucket
  // overflow; 2 artifacts → Artifacts bucket has room. Cards in
  // overflowing buckets stack with each subsequent card showing
  // only its leftmost 10%. Other players keep small fixtures so the
  // contrast is visible (top/bottom ~14 cards stacked vs side ~5
  // not stacked).
  const meBf: Record<string, WebPermanentView> = bf('MAJEST1C', [
    ['Plains', 'LAND'],
    ['Plains', 'LAND'],
    ['Plains', 'LAND'],
    ['Mountain', 'LAND'],
    ['Mountain', 'LAND'],
    ['Sacred Foundry', 'LAND'],
    ['Reliquary Tower', 'LAND'],
    ['Soul Warden', 'CREATURE'],
    ['Goblin Guide', 'CREATURE'],
    ['Monastery Mentor', 'CREATURE'],
    ['Mother of Runes', 'CREATURE'],
    ['Elsha, Threefold Master', 'CREATURE'],
    ['Sol Ring', 'ARTIFACT'],
    ['Mana Crypt', 'ARTIFACT'],
  ]);

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
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
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
    // Slice B-13-C-1 — small varied board to verify partition
    // (PLANESWALKER → creatures; ENCHANTMENT → artifactsEnchantments).
    battlefield: bf('goat', [
      ['Forest', 'LAND'],
      ['Forest', 'LAND'],
      ['Llanowar Elves', 'CREATURE'],
      ['Nissa, Vital Force', 'PLANESWALKER'],
      ['Elemental Bond', 'ENCHANTMENT'],
    ]),
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
    // Slice B-13-C-1 — small mono-blue board.
    battlefield: bf('momur', [
      ['Island', 'LAND'],
      ['Island', 'LAND'],
      ['Snapcaster Mage', 'CREATURE'],
      ['Sensei\'s Divining Top', 'ARTIFACT'],
    ]),
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
    // Slice B-13-C-1 — small mono-red board.
    battlefield: bf('Alloc', [
      ['Mountain', 'LAND'],
      ['Mountain', 'LAND'],
      ['Goblin Guide', 'CREATURE'],
      ['Lightning Greaves', 'ARTIFACT'],
    ]),
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false, isHuman: true, isActive: false, hasPriority: false,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });

  return webGameViewSchema.parse({
    turn: 4,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
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
    stack: (() => {
      const stack: Record<string, ReturnType<typeof makeCard>> = {};
      const lightning = makeCard('Lightning Bolt', 'CREATURE', 'M21', '162');
      stack[lightning.id] = lightning;
      return stack;
    })(),
    combat: [],
    players: [me, goat, momur, alloc],
  });
}
