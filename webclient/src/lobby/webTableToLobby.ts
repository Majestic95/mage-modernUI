/**
 * Slice L2 — pure mapping from a {@link WebTable} (server wire shape)
 * into the {@link LobbyFixture} shape consumed by the lobby
 * components. The fixture path keeps working in parallel; the live
 * path uses this function to translate poll responses.
 *
 * <p>Decks (My Decks panel + selected deck preview + commander
 * preview large art) intentionally come from the fixture for now.
 * Slice L6 wires the real deck path from {@code useDecksStore} +
 * client-side stat computation. L2 only swaps the seat row + match
 * options to live data.
 */
import type { WebTable } from '../api/schemas';
import type {
  LobbyColor,
  LobbyFixture,
  LobbyMatchOptions,
  LobbySeat,
} from './fixtures';
import { LOBBY_FIXTURE } from './fixtures';

const VALID_COLORS: ReadonlySet<LobbyColor> = new Set(['W', 'U', 'B', 'R', 'G']);

interface MapInput {
  webTable: WebTable;
  /** Logged-in user's display name; used for the host crown gating. */
  currentUsername: string;
}

export function webTableToLobby({
  webTable,
  currentUsername,
}: MapInput): LobbyFixture {
  // Slice L7 review fix — host detection at the table level. Compare
  // the cleaned controllerName to the current username (both
  // normalized). Independent of seat occupancy so the host sees their
  // host-flavored UI before they've taken their seat.
  const cleanedController = stripControllerSuffix(webTable.controllerName)
    .trim()
    .toLowerCase();
  const normalizedUser = currentUsername.trim().toLowerCase();
  const amIHost =
    cleanedController !== ''
    && normalizedUser !== ''
    && cleanedController === normalizedUser;
  return {
    matchOptions: deriveMatchOptions(webTable),
    seats: webTable.seats.map((seat, idx) => mapSeat(seat, idx, webTable)),
    // Slice L6 will replace these with the user's saved decks. Until
    // then, surface the L1 fixture decks so the My Decks panel and
    // deck preview keep showing recognizable visual content.
    selectedDeckId: LOBBY_FIXTURE.selectedDeckId,
    decks: LOBBY_FIXTURE.decks,
    currentUsername,
    amIHost,
  };
}

function deriveMatchOptions(webTable: WebTable): LobbyMatchOptions {
  const playerCount = webTable.seats.length;
  const isCommander = webTable.deckType.toLowerCase().includes('commander');
  return {
    // Lower-case canonical IDs feed the FORMAT_LABEL / MODE_LABEL
    // lookups. Unknown IDs fall back to the raw string in the
    // display components.
    format: deriveFormatId(webTable.deckType),
    mode: deriveModeId(webTable.gameType),
    playerCount,
    // O3 lock from the design doc: starting life is the format
    // default for v1, no host customization. Commander = 40, others
    // = 20.
    startingLife: isCommander ? 40 : 20,
    commanderDamage: 21,
    // Slice L4 will wire the real mulligan label off MatchOptions.
    // For L2 the value is informational only — placeholder that
    // matches the fixture default.
    mulliganLabel: 'London Mulligan',
    privacyLabel: webTable.passworded ? 'Password' : 'Public',
  };
}

function deriveFormatId(deckType: string): string {
  const s = deckType.toLowerCase();
  if (s.includes('commander')) return 'commander';
  if (s.includes('pauper')) return 'pauper';
  if (s.includes('modern')) return 'modern';
  if (s.includes('standard')) return 'standard';
  return deckType;
}

function deriveModeId(gameType: string): string {
  const s = gameType.toLowerCase();
  if (s.includes('two headed')) return 'two-headed-giant';
  if (s.includes('tiny')) return 'tiny-leaders';
  if (s.includes('two player')) return 'two-player-duel';
  if (s.includes('free for all') || s.includes('free-for-all')) {
    return 'free-for-all';
  }
  return gameType;
}

function mapSeat(
  webSeat: WebTable['seats'][number],
  index: number,
  webTable: WebTable,
): LobbySeat {
  // Slice L7 polish — normalize before compare so a wire-side variation
  // (controllerName carrying the post-suffix-strip "alice" while the
  // seat playerName is "alice " with whitespace, or vice-versa) doesn't
  // de-identify the host. Both ends are trimmed + case-preserved.
  const hostName = normalizeName(stripControllerSuffix(webTable.controllerName));
  const seatName = normalizeName(webSeat.playerName);
  const isHost = webSeat.occupied && seatName === hostName && seatName !== '';
  // Schema 1.28 — server emits colorIdentity per seat, derived from
  // the commander's Card.getColorIdentity(). Filter against the WUBRG
  // alphabet to defend against any future server-side oddity. Empty
  // list = neutral team-ring (no commander or non-Commander format).
  const colorIdentity = (webSeat.colorIdentity ?? []).filter(
    (c): c is LobbyColor => VALID_COLORS.has(c as LobbyColor),
  );
  const artUrl = webSeat.commanderName
    ? scryfallByName(webSeat.commanderName, 'art_crop')
    : null;
  const cardUrl = webSeat.commanderName
    ? scryfallByName(webSeat.commanderName, 'normal')
    : null;
  const subtitle = subtitleFromCommanderName(webSeat.commanderName);
  return {
    seatId: `${webTable.tableId}:${index}`,
    occupied: webSeat.occupied,
    isHost,
    ready: webSeat.ready,
    playerName: webSeat.playerName,
    subtitle,
    commanderName: webSeat.commanderName,
    commanderCardImageUrl: cardUrl,
    commanderArtUrl: artUrl,
    colorIdentity,
    deckName: webSeat.deckName,
    deckSize: webSeat.deckSize,
    deckRequired: webSeat.deckSizeRequired,
  };
}

/**
 * Slice L2 — derive a "Title" subtitle from a commander's full name.
 * Many MTG legendary cards follow the {@code "Name, Title"} pattern;
 * the lobby reference shows just the title under each player. We
 * pull what's after the comma; for non-comma names the subtitle is
 * empty (matches the design-doc lock for non-Commander formats).
 */
function subtitleFromCommanderName(commanderName: string): string {
  if (!commanderName) return '';
  const comma = commanderName.indexOf(', ');
  return comma >= 0 ? commanderName.substring(comma + 2) : '';
}

/**
 * Upstream's {@code TableView.controllerName} can be the bare
 * controller or {@code "<controller>, <opp1>, <opp2>"}. The server's
 * TableMapper already strips the suffix, but defend against historical
 * raw strings on the chance a fixture or 1.26 server slips through.
 */
function stripControllerSuffix(raw: string): string {
  if (!raw) return '';
  const comma = raw.indexOf(', ');
  return comma >= 0 ? raw.substring(0, comma) : raw;
}

/**
 * Slice L7 polish — canonicalize a player/controller name before
 * equality compare. Trims and lowercases; lowercase is the safer
 * comparison since xmage usernames are case-insensitive on registration
 * but the wire echoes the user's chosen casing.
 */
function normalizeName(raw: string): string {
  return raw.trim().toLowerCase();
}

function scryfallByName(name: string, kind: 'art_crop' | 'normal'): string {
  return `https://api.scryfall.com/cards/named?format=image&version=${kind}&exact=${encodeURIComponent(name)}`;
}
