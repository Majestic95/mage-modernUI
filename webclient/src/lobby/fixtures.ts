/**
 * Slice L1 — fixture data for the new lobby window static shell.
 *
 * <p>This file is dev-only and is consumed by the {@code ?lobby=fixture}
 * URL-param entry path in {@link App.tsx}. The fixtures mirror the
 * reference mockup (4-seat Commander FFA) and let the lobby render
 * pixel-quality without any wire calls.
 *
 * <p>Slice L2 wires real {@link WebTable} data; the fixture types
 * intentionally mirror the wire shape so the swap is one prop swap.
 */

/**
 * Slice L2 — relaxed from a strict union to {@code string}. The wire's
 * {@code WebTable.deckType} / {@code .gameType} are free-form strings
 * (e.g. "Commander - Brawl", "Constructed - Vintage"); display
 * components in {@link LobbyHeader} + {@link GameSettingsPanel} look
 * up known IDs in their respective label maps and fall back to the
 * raw string for unknown values, so untyped strings flow through
 * fine.
 */
export type LobbyFormatId = string;
export type LobbyModeId = string;

export interface LobbyMatchOptions {
  format: LobbyFormatId;
  mode: LobbyModeId;
  playerCount: number;
  startingLife: number;
  commanderDamage: number;
  mulliganLabel: string;
  privacyLabel: string;
}

export type LobbyColor = 'W' | 'U' | 'B' | 'R' | 'G';

export interface LobbyDeck {
  id: string;
  name: string;
  commanderName: string;
  /** Scryfall-style art-crop URL or null for fallback. */
  commanderArtUrl: string | null;
  /** Mainboard size, e.g. 100. */
  mainboardSize: number;
  /** Required size for the format, e.g. 100 for Commander. */
  requiredSize: number;
  colorIdentity: LobbyColor[];
  /** CMC histogram, indexed 0..7 where index 7 = "7+". */
  manaCurve: number[];
  typeCounts: {
    creatures: number;
    artifacts: number;
    enchantments: number;
    instantsAndSorceries: number;
  };
  /** Total mana symbols in the mainboard, per color. */
  colorPipCounts: Record<LobbyColor, number>;
}

export interface LobbySeat {
  seatId: string;
  occupied: boolean;
  isHost: boolean;
  ready: boolean;
  playerName: string;
  /** Subtitle under the player's name — commander title for Commander format. */
  subtitle: string;
  commanderName: string;
  /** Front-facing card image URL (hi-res normal). Null falls back to placeholder. */
  commanderCardImageUrl: string | null;
  /** Art-crop for the portrait halo. */
  commanderArtUrl: string | null;
  colorIdentity: LobbyColor[];
  deckName: string;
  deckSize: number;
  deckRequired: number;
}

export interface LobbyFixture {
  matchOptions: LobbyMatchOptions;
  seats: LobbySeat[];
  selectedDeckId: string;
  decks: LobbyDeck[];
  /** Username of the current viewer — drives the host crown / Start gating. */
  currentUsername: string;
}

/** Build Scryfall image URL from card name. Fallback path until L2 wires real cardNumber. */
function scryfallByName(name: string, kind: 'art_crop' | 'normal'): string {
  return `https://api.scryfall.com/cards/named?format=image&version=${kind}&exact=${encodeURIComponent(name)}`;
}

const ATRAXA_DECK: LobbyDeck = {
  id: 'deck-atraxa',
  name: 'Proliferate Control',
  commanderName: "Atraxa, Praetors' Voice",
  commanderArtUrl: scryfallByName("Atraxa, Praetors' Voice", 'art_crop'),
  mainboardSize: 100,
  requiredSize: 100,
  colorIdentity: ['W', 'U', 'B', 'G'],
  manaCurve: [8, 12, 16, 20, 18, 14, 7, 5],
  typeCounts: {
    creatures: 36,
    artifacts: 22,
    enchantments: 15,
    instantsAndSorceries: 27,
  },
  colorPipCounts: { W: 9, U: 9, B: 11, R: 0, G: 8 },
};

const URDRAGON_DECK: LobbyDeck = {
  id: 'deck-urdragon',
  name: 'Tyrant Tribal',
  commanderName: 'The Ur-Dragon',
  commanderArtUrl: scryfallByName('The Ur-Dragon', 'art_crop'),
  mainboardSize: 100,
  requiredSize: 100,
  colorIdentity: ['W', 'U', 'B', 'R', 'G'],
  manaCurve: [4, 6, 10, 18, 22, 18, 12, 10],
  typeCounts: {
    creatures: 42,
    artifacts: 14,
    enchantments: 8,
    instantsAndSorceries: 21,
  },
  colorPipCounts: { W: 12, U: 14, B: 13, R: 17, G: 19 },
};

const KARN_DECK: LobbyDeck = {
  id: 'deck-karn',
  name: 'Artifact Mayhem',
  commanderName: 'Karn, Scion of Urza',
  commanderArtUrl: scryfallByName('Karn, Scion of Urza', 'art_crop'),
  mainboardSize: 100,
  requiredSize: 100,
  colorIdentity: [],
  manaCurve: [10, 14, 22, 24, 14, 8, 5, 3],
  typeCounts: {
    creatures: 24,
    artifacts: 48,
    enchantments: 4,
    instantsAndSorceries: 16,
  },
  colorPipCounts: { W: 0, U: 0, B: 0, R: 0, G: 0 },
};

const TROSTANI_DECK: LobbyDeck = {
  id: 'deck-trostani',
  name: 'Tokens Everywhere',
  commanderName: "Trostani, Selesnya's Voice",
  commanderArtUrl: scryfallByName("Trostani, Selesnya's Voice", 'art_crop'),
  mainboardSize: 100,
  requiredSize: 100,
  colorIdentity: ['W', 'G'],
  manaCurve: [6, 14, 20, 22, 18, 12, 6, 2],
  typeCounts: {
    creatures: 38,
    artifacts: 8,
    enchantments: 22,
    instantsAndSorceries: 24,
  },
  colorPipCounts: { W: 24, U: 0, B: 0, R: 0, G: 26 },
};

export const LOBBY_FIXTURE: LobbyFixture = {
  matchOptions: {
    format: 'commander',
    mode: 'free-for-all',
    playerCount: 4,
    startingLife: 40,
    commanderDamage: 21,
    mulliganLabel: 'Free Mulligan',
    privacyLabel: 'Public',
  },
  seats: [
    {
      seatId: 'seat-1',
      occupied: true,
      isHost: true,
      ready: true,
      playerName: 'Atraxa',
      subtitle: 'Voice of Progress',
      commanderName: "Atraxa, Praetors' Voice",
      commanderCardImageUrl: scryfallByName("Atraxa, Praetors' Voice", 'normal'),
      commanderArtUrl: scryfallByName("Atraxa, Praetors' Voice", 'art_crop'),
      colorIdentity: ['W', 'U', 'B', 'G'],
      deckName: 'Proliferate Control',
      deckSize: 100,
      deckRequired: 100,
    },
    {
      seatId: 'seat-2',
      occupied: true,
      isHost: false,
      ready: true,
      playerName: 'Nicol Bolas',
      subtitle: 'Dragon-God',
      commanderName: 'Nicol Bolas, Dragon-God',
      commanderCardImageUrl: scryfallByName('Nicol Bolas, Dragon-God', 'normal'),
      commanderArtUrl: scryfallByName('Nicol Bolas, Dragon-God', 'art_crop'),
      colorIdentity: ['U', 'B', 'R'],
      deckName: 'Everything is Mine',
      deckSize: 100,
      deckRequired: 100,
    },
    {
      seatId: 'seat-3',
      occupied: true,
      isHost: false,
      ready: false,
      playerName: 'Kenrith',
      subtitle: 'The Returned King',
      commanderName: 'Kenrith, the Returned King',
      commanderCardImageUrl: scryfallByName('Kenrith, the Returned King', 'normal'),
      commanderArtUrl: scryfallByName('Kenrith, the Returned King', 'art_crop'),
      colorIdentity: ['W', 'U', 'B', 'R', 'G'],
      deckName: 'Goodstuff Toolbox',
      deckSize: 100,
      deckRequired: 100,
    },
    {
      seatId: 'seat-4',
      occupied: false,
      isHost: false,
      ready: false,
      playerName: '',
      subtitle: '',
      commanderName: '',
      commanderCardImageUrl: null,
      commanderArtUrl: null,
      colorIdentity: [],
      deckName: '',
      deckSize: 0,
      deckRequired: 0,
    },
  ],
  selectedDeckId: 'deck-atraxa',
  decks: [ATRAXA_DECK, URDRAGON_DECK, KARN_DECK, TROSTANI_DECK],
  currentUsername: 'Atraxa',
};

/** Look up a deck card image (front face) by exact card name. */
export function lobbyCardImageUrl(name: string): string {
  return scryfallByName(name, 'normal');
}

/** Helper used by stats panel — total mainboard cards across the curve. */
export function curveTotal(curve: number[]): number {
  return curve.reduce((sum, n) => sum + n, 0);
}
