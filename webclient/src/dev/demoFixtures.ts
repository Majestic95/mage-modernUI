/**
 * Slice 70-Z polish-phase demo fixtures. Hardcoded {@link WebGameView}
 * snapshots that exercise every region of the redesigned UI without
 * needing a live xmage backend. Loaded by {@link DemoGame} when the
 * URL carries a {@code ?demo=<scenario>} query param.
 *
 * <p>Fixtures intentionally span the full state matrix: 4-player
 * commander FFA, single-color + multicolor halos (rotation visible),
 * disconnected pill, active-player halo pulse, focal stack item with
 * color-identity glow, mana pools (local glowing top-right + opponent
 * inline cluster), opponents with graveyards (hover-tooltip + cap
 * test), and battlefield rows with creatures / non-creatures / lands
 * for the bucketing rules.
 *
 * <p><b>NOT shipped to production.</b> Bundle gating happens at the
 * import site ({@link DemoGame} only mounts when the URL flag is
 * present, and the URL flag is silently ignored outside DEV builds);
 * the fixtures themselves are static data so dead-code elimination
 * can drop them from the production bundle.
 */
import type {
  WebCardView,
  WebCommandObjectView,
  WebGameView,
  WebPermanentView,
  WebPlayerView,
} from '../api/schemas';

// --- Helper builders -----------------------------------------------

/**
 * Slice 70-Z polish (code critic I4) — counter lives in a CLOSURE
 * inside {@link buildScenario}, not at module scope, so repeated
 * fixture builds don't share mutable state. Each fixture call gets
 * a fresh counter starting at 0; identical scenarios produce
 * identical UUIDs (important for React layout-id graph stability
 * across StrictMode double-invokes / scenario switches).
 */
function makeFixtureBuilders() {
  let cardIdCounter = 0;
  function nextId(): string {
    cardIdCounter += 1;
    // Fake but well-formed UUID. Slice 52a's cardId convention only
    // requires non-empty + matching across zones; format isn't checked.
    const hex = cardIdCounter.toString(16).padStart(12, '0');
    return `00000000-0000-0000-0000-${hex}`;
  }
  return { nextId };
}

// Module-level builder used by the per-card helpers below.
// `buildCommanderFFA` reseeds it via {@link makeFixtureBuilders}
// at the top of each call so closures see a fresh counter.
let nextId: () => string = makeFixtureBuilders().nextId;

function makeCard(overrides: Partial<WebCardView> = {}): WebCardView {
  const id = overrides.id ?? nextId();
  return {
    id,
    cardId: overrides.cardId ?? id,
    name: 'Card',
    displayName: 'Card',
    expansionSetCode: 'TST',
    cardNumber: '001',
    manaCost: '',
    manaValue: 0,
    typeLine: '',
    supertypes: [],
    types: [],
    subtypes: [],
    colors: [],
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
    sourceLabel: '',
    ...overrides,
  };
}

function makePerm(card: WebCardView, opts: Partial<WebPermanentView> = {}): WebPermanentView {
  return {
    card,
    controllerName: opts.controllerName ?? 'demo',
    tapped: false,
    flipped: false,
    transformed: false,
    phasedIn: true,
    summoningSickness: false,
    damage: 0,
    attachments: [],
    attachedTo: '',
    attachedToPermanent: false,
    goadingPlayerIds: [],
    ...opts,
  };
}

function makeCommander(name: string, code: string, num: string): WebCommandObjectView {
  return {
    id: nextId(),
    kind: 'commander',
    name,
    expansionSetCode: code,
    imageFileName: '',
    imageNumber: parseInt(num, 10) || 0,
    rules: [],
  };
}

function permsByCard(perms: WebPermanentView[]): Record<string, WebPermanentView> {
  const out: Record<string, WebPermanentView> = {};
  for (const p of perms) out[p.card.id] = p;
  return out;
}

function cardsById(cards: WebCardView[]): Record<string, WebCardView> {
  const out: Record<string, WebCardView> = {};
  for (const c of cards) out[c.id] = c;
  return out;
}

// --- Card library used across fixtures ------------------------------

function forest(): WebCardView {
  return makeCard({
    name: 'Forest',
    typeLine: 'Basic Land — Forest',
    supertypes: ['BASIC'],
    types: ['LAND'],
    subtypes: ['Forest'],
  });
}

function island(): WebCardView {
  return makeCard({
    name: 'Island',
    typeLine: 'Basic Land — Island',
    supertypes: ['BASIC'],
    types: ['LAND'],
    subtypes: ['Island'],
  });
}

function mountain(): WebCardView {
  return makeCard({
    name: 'Mountain',
    typeLine: 'Basic Land — Mountain',
    supertypes: ['BASIC'],
    types: ['LAND'],
    subtypes: ['Mountain'],
  });
}

function swamp(): WebCardView {
  return makeCard({
    name: 'Swamp',
    typeLine: 'Basic Land — Swamp',
    supertypes: ['BASIC'],
    types: ['LAND'],
    subtypes: ['Swamp'],
  });
}

function plains(): WebCardView {
  return makeCard({
    name: 'Plains',
    typeLine: 'Basic Land — Plains',
    supertypes: ['BASIC'],
    types: ['LAND'],
    subtypes: ['Plains'],
  });
}

function bear(): WebCardView {
  return makeCard({
    name: 'Grizzly Bears',
    typeLine: 'Creature — Bear',
    types: ['CREATURE'],
    subtypes: ['Bear'],
    colors: ['G'],
    manaCost: '{1}{G}',
    manaValue: 2,
    power: '2',
    toughness: '2',
    expansionSetCode: 'M21',
  });
}

function locustToken(): WebCardView {
  return makeCard({
    name: 'Insect',
    typeLine: 'Token Creature — Insect',
    types: ['CREATURE'],
    subtypes: ['Insect'],
    colors: ['U', 'R'],
    manaCost: '',
    manaValue: 0,
    power: '1',
    toughness: '1',
    expansionSetCode: 'HOU',
  });
}

function lightningBolt(): WebCardView {
  return makeCard({
    name: 'Lightning Bolt',
    typeLine: 'Instant',
    types: ['INSTANT'],
    colors: ['R'],
    manaCost: '{R}',
    manaValue: 1,
    rules: ['Lightning Bolt deals 3 damage to any target.'],
    expansionSetCode: 'M21',
  });
}

function counterspell(): WebCardView {
  return makeCard({
    name: 'Counterspell',
    typeLine: 'Instant',
    types: ['INSTANT'],
    colors: ['U'],
    manaCost: '{U}{U}',
    manaValue: 2,
    rules: ['Counter target spell.'],
    expansionSetCode: 'A25',
  });
}

function solRing(): WebCardView {
  return makeCard({
    name: 'Sol Ring',
    typeLine: 'Artifact',
    types: ['ARTIFACT'],
    colors: [],
    manaCost: '{1}',
    manaValue: 1,
    rules: ['{T}: Add {C}{C}.'],
    expansionSetCode: 'CMR',
  });
}

function damnation(): WebCardView {
  return makeCard({
    name: 'Damnation',
    typeLine: 'Sorcery',
    types: ['SORCERY'],
    colors: ['B'],
    manaCost: '{2}{B}{B}',
    manaValue: 4,
    rules: ['Destroy all creatures. They can’t be regenerated.'],
    expansionSetCode: 'PLC',
  });
}

function cathartic(): WebCardView {
  return makeCard({
    name: 'Cathartic Reunion',
    typeLine: 'Sorcery',
    types: ['SORCERY'],
    colors: ['R'],
    manaCost: '{1}{R}',
    manaValue: 2,
    rules: ['Discard 2 cards, then draw 3.'],
    expansionSetCode: 'KLD',
  });
}

// --- Fixture: 4-player Commander FFA, mid-game ---------------------

/**
 * Mid-game 4p commander FFA. Stack has Lightning Bolt (focal mode
 * with R color glow). Local player (Locust God, U) has priority +
 * is active; floating mana pool top-right of hand.
 *
 * <p>Top opponent (Korvold, BRG) — multicolor halo with rotation,
 * 6-card hand, 5 permanents.
 *
 * <p>Left opponent (Atraxa, WUBG) — 4-color rainbow halo, has
 * priority pill, mid-board. Big graveyard for tooltip-cap testing.
 *
 * <p>Right opponent (Meren, BG) — DISCONNECTED state to show pill +
 * desaturate. Smaller board.
 */
export function buildCommanderFFA(opts: { stackCount?: number } = {}): {
  gameView: WebGameView;
  myPlayerName: string;
} {
  // Reseed the fixture-id closure so repeated calls produce
  // identical UUIDs (React dev-mode strict re-renders + scenario
  // switches stay stable across the layout-id graph).
  nextId = makeFixtureBuilders().nextId;
  const stackCount = Math.max(1, Math.min(opts.stackCount ?? 1, 12));

  const myId = '11111111-1111-1111-1111-111111111111';
  const korvoldId = '22222222-2222-2222-2222-222222222222';
  const atraxaId = '33333333-3333-3333-3333-333333333333';
  const merenId = '44444444-4444-4444-4444-444444444444';

  // --- Local: Locust God ---
  const locustGod = makeCommander('The Locust God', 'HOU', '142');
  const myHand: WebCardView[] = [
    cathartic(),
    damnation(),
    counterspell(),
    cardWith({ name: 'Aletheia Study', typeLine: 'Enchantment', colors: ['U'], manaCost: '{2}{U}', manaValue: 3 }),
    solRing(),
    cardWith({ name: 'Brainstorm', typeLine: 'Instant', colors: ['U'], manaCost: '{U}', manaValue: 1 }),
  ];

  const myBattlefield: WebPermanentView[] = [
    makePerm(locustToken(), { controllerName: 'you', summoningSickness: false }),
    makePerm(locustToken(), { controllerName: 'you' }),
    makePerm(island(), { controllerName: 'you' }),
    makePerm(island(), { controllerName: 'you' }),
    makePerm(mountain(), { controllerName: 'you', tapped: true }),
    makePerm(solRing(), { controllerName: 'you', tapped: true }),
  ];

  const me: WebPlayerView = {
    playerId: myId,
    name: 'you',
    life: 38,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 67,
    handCount: myHand.length,
    graveyard: cardsById([island(), counterspell()]),
    exile: {},
    sideboard: {},
    battlefield: permsByCard(myBattlefield),
    manaPool: { red: 1, green: 0, blue: 2, white: 0, black: 0, colorless: 1 },
    controlled: true,
    isHuman: true,
    isActive: true,
    hasPriority: true,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    commandList: [locustGod],
    teamId: 0,
    timerCount: 0,
    goadingPlayerIds: [],
    colorIdentity: ['U'],
    connectionState: 'connected',
  };

  // --- Top opponent: Korvold (BRG, multicolor halo with rotation) ---
  const korvoldCmdr = makeCommander('Korvold, Fae-Cursed King', 'ELD', '329');
  const korvoldBattlefield: WebPermanentView[] = [
    makePerm(bear(), { controllerName: 'korvold' }),
    makePerm(bear(), { controllerName: 'korvold', tapped: true }),
    makePerm(forest(), { controllerName: 'korvold' }),
    makePerm(swamp(), { controllerName: 'korvold' }),
    makePerm(mountain(), { controllerName: 'korvold' }),
  ];
  const korvold: WebPlayerView = {
    playerId: korvoldId,
    name: 'korvold',
    life: 31,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 72,
    handCount: 5,
    graveyard: cardsById([forest(), forest(), bear()]),
    exile: cardsById([damnation()]),
    sideboard: {},
    battlefield: permsByCard(korvoldBattlefield),
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    commandList: [korvoldCmdr],
    teamId: 0,
    timerCount: 0,
    goadingPlayerIds: [],
    colorIdentity: ['B', 'R', 'G'],
    connectionState: 'connected',
  };

  // --- Left opponent: Atraxa (WUBG four-color halo) ---
  const atraxaCmdr = makeCommander("Atraxa, Praetors' Voice", 'C16', '28');
  const atraxaBattlefield: WebPermanentView[] = [
    makePerm(plains(), { controllerName: 'atraxa' }),
    makePerm(island(), { controllerName: 'atraxa' }),
    makePerm(swamp(), { controllerName: 'atraxa' }),
    makePerm(forest(), { controllerName: 'atraxa' }),
    makePerm(bear(), { controllerName: 'atraxa' }),
    makePerm(bear(), { controllerName: 'atraxa', tapped: true }),
  ];
  // Big graveyard for tooltip cap test (catalog §2.2 cap at 10).
  const atraxaGrave: WebCardView[] = [];
  for (let i = 0; i < 13; i++) atraxaGrave.push(makeCard({ name: `Mill ${i + 1}`, typeLine: 'Card' }));
  const atraxa: WebPlayerView = {
    playerId: atraxaId,
    name: 'atraxa',
    life: 27,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 51,
    handCount: 7,
    graveyard: cardsById(atraxaGrave),
    exile: {},
    sideboard: {},
    battlefield: permsByCard(atraxaBattlefield),
    manaPool: { red: 0, green: 1, blue: 0, white: 1, black: 0, colorless: 0 },
    controlled: false,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    commandList: [atraxaCmdr],
    teamId: 0,
    timerCount: 0,
    goadingPlayerIds: [],
    colorIdentity: ['W', 'U', 'B', 'G'],
    connectionState: 'connected',
  };

  // --- Right opponent: Meren (BG), DISCONNECTED ---
  const merenCmdr = makeCommander('Meren of Clan Nel Toth', 'C15', '40');
  const merenBattlefield: WebPermanentView[] = [
    makePerm(forest(), { controllerName: 'meren' }),
    makePerm(swamp(), { controllerName: 'meren' }),
    makePerm(bear(), { controllerName: 'meren' }),
  ];
  const meren: WebPlayerView = {
    playerId: merenId,
    name: 'meren',
    life: 22,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 60,
    handCount: 4,
    graveyard: cardsById([bear(), bear(), forest()]),
    exile: {},
    sideboard: {},
    battlefield: permsByCard(merenBattlefield),
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    commandList: [merenCmdr],
    teamId: 0,
    timerCount: 0,
    goadingPlayerIds: [],
    colorIdentity: ['B', 'G'],
    connectionState: 'disconnected',
  };

  // --- Stack: focal item + optional fan tiles ---
  // Stack is built bottom-first; the LAST card in the input array
  // is the topmost (resolves first / focal). Per picture-catalog
  // §3.1: items 2-5 fan behind the focal; 6+ collapse to "+N more"
  // pill. The demo URL flag `?stack=N` (1..12) lets the screenshot
  // reviewer scrub through stack depths.
  const stackCardSpec: ((cardName: string, colors: string[], manaCost: string) => WebCardView)[] = [];
  const STACK_SPELLS: Array<() => WebCardView> = [
    lightningBolt,         // 1: R focal
    counterspell,          // 2: U focal (LB now fan)
    () => makeCard({       // 3: W
      name: 'Path to Exile',
      typeLine: 'Instant',
      types: ['INSTANT'],
      colors: ['W'],
      manaCost: '{W}',
      manaValue: 1,
      rules: ['Exile target creature. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.'],
      expansionSetCode: 'CON',
    }),
    () => makeCard({       // 4: G
      name: 'Beast Within',
      typeLine: 'Instant',
      types: ['INSTANT'],
      colors: ['G'],
      manaCost: '{2}{G}',
      manaValue: 3,
      rules: ['Destroy target permanent. Its controller creates a 3/3 green Beast creature token.'],
      expansionSetCode: 'NPH',
    }),
    () => makeCard({       // 5: BG multicolor
      name: 'Maelstrom Pulse',
      typeLine: 'Sorcery',
      types: ['SORCERY'],
      colors: ['B', 'G'],
      manaCost: '{1}{B}{G}',
      manaValue: 3,
      rules: ['Destroy target nonland permanent. Each other permanent with the same name is also destroyed.'],
      expansionSetCode: 'ARB',
    }),
    () => makeCard({       // 6: B
      name: 'Doom Blade',
      typeLine: 'Instant',
      types: ['INSTANT'],
      colors: ['B'],
      manaCost: '{1}{B}',
      manaValue: 2,
      rules: ['Destroy target nonblack creature.'],
      expansionSetCode: 'M11',
    }),
    () => makeCard({       // 7: R
      name: 'Pyroblast',
      typeLine: 'Instant',
      types: ['INSTANT'],
      colors: ['R'],
      manaCost: '{R}',
      manaValue: 1,
      rules: ['Choose one — Counter target spell if it’s blue. / Destroy target permanent if it’s blue.'],
      expansionSetCode: 'ICE',
    }),
    () => makeCard({       // 8+: cycle generic instants
      name: 'Brainstorm',
      typeLine: 'Instant',
      types: ['INSTANT'],
      colors: ['U'],
      manaCost: '{U}',
      manaValue: 1,
      rules: ['Draw three cards, then put two cards from your hand on top of your library in any order.'],
      expansionSetCode: 'ICE',
    }),
  ];
  // Suppress unused var warning while leaving the alternative
  // signature documented for future spell variants.
  void stackCardSpec;

  const stackCards: WebCardView[] = [];
  for (let i = 0; i < stackCount; i++) {
    const builder = STACK_SPELLS[i % STACK_SPELLS.length]!;
    stackCards.push(builder());
  }

  const gameView: WebGameView = {
    turn: 8,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
    activePlayerName: me.name,
    priorityPlayerName: me.name,
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 1,
    myPlayerId: myId,
    myHand: cardsById(myHand),
    stack: cardsById(stackCards),
    combat: [],
    players: [me, korvold, atraxa, meren],
  };

  return { gameView, myPlayerName: me.name };
}

// Tiny escape hatch helper since the Card type doesn't accept partial
// objects directly via makeCard's second-arg pattern when colors etc.
// need overriding.
function cardWith(overrides: Partial<WebCardView>): WebCardView {
  return makeCard(overrides);
}

// --- Scenario registry ---------------------------------------------

export type DemoScenario = '4p-commander';

export function isKnownScenario(s: string | null): s is DemoScenario {
  return s === '4p-commander';
}

export function buildScenario(
  s: DemoScenario,
  opts: { stackCount?: number } = {},
): {
  gameView: WebGameView;
  myPlayerName: string;
} {
  switch (s) {
    case '4p-commander':
    default:
      return buildCommanderFFA(opts);
  }
}
