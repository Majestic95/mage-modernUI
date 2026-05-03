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

  // MAJEST1C — build battlefield then bolt attachments onto specific
  // hosts so the layout-locked +N badge has something to demo against.
  // Elsha gets equipment + an aura; Monastery Mentor gets an aura.
  const meBf: Record<string, WebPermanentView> = {};
  const baseEntries: Array<[string, CardKind]> = [
    ['Plains', 'LAND'], ['Plains', 'LAND'], ['Plains', 'LAND'],
    ['Mountain', 'LAND'], ['Mountain', 'LAND'],
    ['Sacred Foundry', 'LAND'], ['Reliquary Tower', 'LAND'],
    ['Soul Warden', 'CREATURE'],
    ['Goblin Guide', 'CREATURE'],
    ['Monastery Mentor', 'CREATURE'],
    ['Mother of Runes', 'CREATURE'],
    ['Elsha, Threefold Master', 'CREATURE'],
    ['Sol Ring', 'ARTIFACT'],
    ['Mana Crypt', 'ARTIFACT'],
  ];
  let elshaId = '';
  let mentorId = '';
  for (const [name, kind] of baseEntries) {
    const p = makePerm(name, kind, 'MAJEST1C');
    meBf[p.card.id] = p;
    if (name === 'Elsha, Threefold Master') elshaId = p.card.id;
    if (name === 'Monastery Mentor') mentorId = p.card.id;
  }
  // Attach two equipment + one aura to Elsha (3 attachments → +3 badge).
  for (const [name, kind] of [
    ['Lightning Greaves', 'ARTIFACT'],
    ['Sword of Fire and Ice', 'ARTIFACT'],
    ['Daybreak Coronet', 'ENCHANTMENT'],
  ] as Array<[string, CardKind]>) {
    const p = makePerm(name, kind, 'MAJEST1C', elshaId);
    meBf[p.card.id] = p;
  }
  // Attach one aura to Monastery Mentor (+1 badge).
  {
    const p = makePerm('Pacifism', 'ENCHANTMENT', 'MAJEST1C', mentorId);
    meBf[p.card.id] = p;
  }

  const me = webPlayerViewSchema.parse({
    playerId: meId, name: 'MAJEST1C', life: 40, wins: 0, winsNeeded: 1,
    libraryCount: 80, handCount: 6,
    graveyard: {}, exile: {}, sideboard: {},
    battlefield: meBf,
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true, isHuman: true, isActive: false, hasPriority: true,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });

  // Right pod — the layout-stress case the user reported.
  const goat = webPlayerViewSchema.parse({
    playerId: goatId, name: 'goat', life: 40, wins: 0, winsNeeded: 1,
    libraryCount: 90, handCount: 6,
    graveyard: {}, exile: {}, sideboard: {},
    battlefield: bf('goat', [
      ['Forest', 'LAND'], ['Forest', 'LAND'], ['Forest', 'LAND'],
      ['Forest', 'LAND'], ['Forest', 'LAND'], ['Forest', 'LAND'],
      ['Mosswort Bridge', 'LAND'], ['Reliquary Tower', 'LAND'],
      ['Llanowar Elves', 'CREATURE'], ['Deadly Recluse', 'CREATURE'],
      ['Ghalta, Primal Hunger', 'CREATURE'],
      ['Nissa, Vital Force', 'PLANESWALKER'],
      ['Elemental Bond', 'ENCHANTMENT'],
      ['Agatha\'s Soul Cauldron', 'ARTIFACT'],
      ['Relic of Legends', 'ARTIFACT'],
      ['Sol Ring', 'ARTIFACT'],
    ]),
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false, isHuman: true, isActive: true, hasPriority: false,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });

  // Top pod — modest board.
  const momur = webPlayerViewSchema.parse({
    playerId: momurId, name: 'momur', life: 40, wins: 0, winsNeeded: 1,
    libraryCount: 91, handCount: 5,
    graveyard: {}, exile: {}, sideboard: {},
    battlefield: bf('momur', [
      ['Island', 'LAND'], ['Island', 'LAND'], ['Island', 'LAND'],
      ['Sensei\'s Divining Top', 'ARTIFACT'],
      ['Snapcaster Mage', 'CREATURE'],
    ]),
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false, isHuman: true, isActive: false, hasPriority: false,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });

  // Left pod — also busy, mirror of right to test left-pod stacking.
  const alloc = webPlayerViewSchema.parse({
    playerId: allocId, name: 'Alloc', life: 35, wins: 0, winsNeeded: 1,
    libraryCount: 85, handCount: 4,
    graveyard: {}, exile: {}, sideboard: {},
    battlefield: bf('Alloc', [
      ['Mountain', 'LAND'], ['Mountain', 'LAND'], ['Mountain', 'LAND'],
      ['Mountain', 'LAND'],
      ['Goblin Guide', 'CREATURE'], ['Goblin Guide', 'CREATURE'],
      ['Lightning Greaves', 'ARTIFACT'],
      ['Kratos, God of War', 'CREATURE'],
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
    stack: {},
    combat: [],
    players: [me, goat, momur, alloc],
  });
}
