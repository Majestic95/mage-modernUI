/**
 * Zod schemas mirroring every WebApi wire type. One source of truth
 * for runtime validation; component code consumes the inferred TS
 * types via {@link Web*} aliases below.
 *
 * <p>Schemas allow unknown extra fields by default (Zod's default
 * passthrough). Server may add fields in a minor schema bump; clients
 * keep working. Major bumps are caught by the schemaVersion check
 * inside the apiClient.
 */
import { z } from 'zod';

/** Expected wire-format major version. Bump in lock-step with the
 *  WebApi's {@code SchemaVersion.CURRENT}. */
export const EXPECTED_SCHEMA_MAJOR = 1;

/* ---------- core ---------- */

export const webErrorSchema = z.object({
  schemaVersion: z.string(),
  code: z.string(),
  message: z.string(),
});
export type WebError = z.infer<typeof webErrorSchema>;

export const webVersionSchema = z.object({
  schemaVersion: z.string(),
  mageVersion: z.string(),
  buildTime: z.string(),
});
export type WebVersion = z.infer<typeof webVersionSchema>;

export const webHealthSchema = z.object({
  schemaVersion: z.string(),
  status: z.string(),
});
export type WebHealth = z.infer<typeof webHealthSchema>;

/* ---------- session ---------- */

export const webSessionSchema = z.object({
  schemaVersion: z.string(),
  token: z.string(),
  username: z.string(),
  isAnonymous: z.boolean(),
  isAdmin: z.boolean(),
  expiresAt: z.string(),
});
export type WebSession = z.infer<typeof webSessionSchema>;

/* ---------- server state ---------- */

export const webGameTypeSchema = z.object({
  name: z.string(),
  minPlayers: z.number(),
  maxPlayers: z.number(),
  numTeams: z.number(),
  playersPerTeam: z.number(),
  useRange: z.boolean(),
  useAttackOption: z.boolean(),
});
export type WebGameType = z.infer<typeof webGameTypeSchema>;

export const webTournamentTypeSchema = z.object({
  name: z.string(),
  minPlayers: z.number(),
  maxPlayers: z.number(),
  numBoosters: z.number(),
  draft: z.boolean(),
  limited: z.boolean(),
  cubeBooster: z.boolean(),
  elimination: z.boolean(),
  random: z.boolean(),
  reshuffled: z.boolean(),
  richMan: z.boolean(),
  jumpstart: z.boolean(),
});
export type WebTournamentType = z.infer<typeof webTournamentTypeSchema>;

export const webServerStateSchema = z.object({
  schemaVersion: z.string(),
  gameTypes: z.array(webGameTypeSchema),
  tournamentTypes: z.array(webTournamentTypeSchema),
  playerTypes: z.array(z.string()),
  deckTypes: z.array(z.string()),
  draftCubes: z.array(z.string()),
  testMode: z.boolean(),
});
export type WebServerState = z.infer<typeof webServerStateSchema>;

/* ---------- cards ---------- */

export const webCardInfoSchema = z.object({
  name: z.string(),
  setCode: z.string(),
  cardNumber: z.string(),
  manaValue: z.number(),
  manaCosts: z.array(z.string()),
  rarity: z.string(),
  types: z.array(z.string()),
  subtypes: z.array(z.string()),
  supertypes: z.array(z.string()),
  colors: z.array(z.string()),
  power: z.string(),
  toughness: z.string(),
  startingLoyalty: z.string(),
  rules: z.array(z.string()),
});
export type WebCardInfo = z.infer<typeof webCardInfoSchema>;

export const webCardListingSchema = z.object({
  schemaVersion: z.string(),
  cards: z.array(webCardInfoSchema),
  truncated: z.boolean(),
});
export type WebCardListing = z.infer<typeof webCardListingSchema>;

/* ---------- rooms + tables ---------- */

export const webRoomRefSchema = z.object({
  schemaVersion: z.string(),
  roomId: z.string(),
  chatId: z.string(),
});
export type WebRoomRef = z.infer<typeof webRoomRefSchema>;

export const webSeatSchema = z.object({
  playerName: z.string(),
  playerType: z.string(),
  occupied: z.boolean(),
});
export type WebSeat = z.infer<typeof webSeatSchema>;

export const webTableSchema = z.object({
  tableId: z.string(),
  tableName: z.string(),
  gameType: z.string(),
  deckType: z.string(),
  tableState: z.string(),
  createTime: z.string(),
  controllerName: z.string(),
  skillLevel: z.string(),
  isTournament: z.boolean(),
  passworded: z.boolean(),
  spectatorsAllowed: z.boolean(),
  rated: z.boolean(),
  limited: z.boolean(),
  seats: z.array(webSeatSchema),
});
export type WebTable = z.infer<typeof webTableSchema>;

export const webTableListingSchema = z.object({
  schemaVersion: z.string(),
  tables: z.array(webTableSchema),
});
export type WebTableListing = z.infer<typeof webTableListingSchema>;

/* ---------- WebSocket stream (Phase 3 / ADR 0007) ---------- */

/**
 * Outbound envelope every server-to-client frame is wrapped in.
 * {@code method} is the discriminator; {@code data} carries the
 * method-specific payload (validated separately once {@code method}
 * is known).
 */
export const webStreamFrameSchema = z.object({
  schemaVersion: z.string(),
  method: z.string(),
  messageId: z.number(),
  objectId: z.string().nullable(),
  data: z.unknown(),
});
export type WebStreamFrame = z.infer<typeof webStreamFrameSchema>;

export const webStreamHelloSchema = z.object({
  gameId: z.string(),
  username: z.string(),
  mode: z.string(),
});
export type WebStreamHello = z.infer<typeof webStreamHelloSchema>;

export const webStreamErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type WebStreamError = z.infer<typeof webStreamErrorSchema>;

export const webChatMessageSchema = z.object({
  username: z.string(),
  message: z.string(),
  time: z.string(),
  turnInfo: z.string(),
  color: z.string(),
  messageType: z.string(),
  soundToPlay: z.string(),
});
export type WebChatMessage = z.infer<typeof webChatMessageSchema>;

export const webStartGameInfoSchema = z.object({
  tableId: z.string(),
  gameId: z.string(),
  playerId: z.string(),
});
export type WebStartGameInfo = z.infer<typeof webStartGameInfoSchema>;

/**
 * Slim card record for deck-construction wire payloads (sideboard
 * picker, draft constructing). Mirrors server-side
 * {@code WebSimpleCardView} — name is server-resolved via
 * CardRepository, so the picker renders without a card-DB round trip.
 * Schema 1.14.
 */
export const webSimpleCardViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  expansionSetCode: z.string(),
  cardNumber: z.string(),
  usesVariousArt: z.boolean(),
});
export type WebSimpleCardView = z.infer<typeof webSimpleCardViewSchema>;

export const webDeckViewSchema = z.object({
  name: z.string(),
  mainList: z.array(webSimpleCardViewSchema),
  sideboard: z.array(webSimpleCardViewSchema),
});
export type WebDeckView = z.infer<typeof webDeckViewSchema>;

/**
 * Carried as the {@code data} payload of {@code sideboard} frames.
 * Server fires one per player at the start of each post-game-1
 * sideboarding window. Schema 1.14.
 */
export const webSideboardInfoSchema = z.object({
  deck: webDeckViewSchema,
  tableId: z.string(),
  parentTableId: z.string(),
  time: z.number(),
  limited: z.boolean(),
});
export type WebSideboardInfo = z.infer<typeof webSideboardInfoSchema>;

export const webManaPoolViewSchema = z.object({
  red: z.number(),
  green: z.number(),
  blue: z.number(),
  white: z.number(),
  black: z.number(),
  colorless: z.number(),
});
export type WebManaPoolView = z.infer<typeof webManaPoolViewSchema>;

/**
 * WebCardView with recursive secondCardFace. Recursion is capped at
 * one level on the wire (server-side guarantees the back face's
 * secondCardFace is null) so {@link z.lazy} is safe — the schema
 * graph is acyclic in practice.
 */
export type WebCardView = {
  id: string;
  name: string;
  displayName: string;
  expansionSetCode: string;
  cardNumber: string;
  manaCost: string;
  manaValue: number;
  typeLine: string;
  supertypes: string[];
  types: string[];
  subtypes: string[];
  colors: string[];
  rarity: string;
  power: string;
  toughness: string;
  startingLoyalty: string;
  rules: string[];
  faceDown: boolean;
  counters: Record<string, number>;
  transformable: boolean;
  transformed: boolean;
  secondCardFace: WebCardView | null;
};
export const webCardViewSchema: z.ZodType<WebCardView> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    displayName: z.string(),
    expansionSetCode: z.string(),
    cardNumber: z.string(),
    manaCost: z.string(),
    manaValue: z.number(),
    typeLine: z.string(),
    supertypes: z.array(z.string()),
    types: z.array(z.string()),
    subtypes: z.array(z.string()),
    colors: z.array(z.string()),
    rarity: z.string(),
    power: z.string(),
    toughness: z.string(),
    startingLoyalty: z.string(),
    rules: z.array(z.string()),
    faceDown: z.boolean(),
    counters: z.record(z.string(), z.number()),
    transformable: z.boolean(),
    transformed: z.boolean(),
    secondCardFace: webCardViewSchema.nullable(),
  }),
);

export const webPermanentViewSchema = z.object({
  card: webCardViewSchema,
  controllerName: z.string(),
  tapped: z.boolean(),
  flipped: z.boolean(),
  transformed: z.boolean(),
  phasedIn: z.boolean(),
  summoningSickness: z.boolean(),
  damage: z.number(),
  attachments: z.array(z.string()),
  attachedTo: z.string(),
  attachedToPermanent: z.boolean(),
});
export type WebPermanentView = z.infer<typeof webPermanentViewSchema>;

export const webCombatGroupViewSchema = z.object({
  defenderId: z.string(),
  defenderName: z.string(),
  attackers: z.record(z.string(), webPermanentViewSchema),
  blockers: z.record(z.string(), webPermanentViewSchema),
  blocked: z.boolean(),
});
export type WebCombatGroupView = z.infer<typeof webCombatGroupViewSchema>;

/**
 * One entry in {@link WebPlayerView#commandList}. The {@code kind}
 * discriminator selects render mode (commander / emblem / dungeon /
 * plane); other fields are common metadata that line up with the
 * upstream {@code CommandObjectView} interface. Schema 1.13.
 */
export const webCommandObjectViewSchema = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  expansionSetCode: z.string(),
  imageFileName: z.string(),
  imageNumber: z.number(),
  rules: z.array(z.string()),
});
export type WebCommandObjectView = z.infer<typeof webCommandObjectViewSchema>;

export const webPlayerViewSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  life: z.number(),
  wins: z.number(),
  winsNeeded: z.number(),
  libraryCount: z.number(),
  handCount: z.number(),
  graveyard: z.record(z.string(), webCardViewSchema),
  exile: z.record(z.string(), webCardViewSchema),
  sideboard: z.record(z.string(), webCardViewSchema),
  battlefield: z.record(z.string(), webPermanentViewSchema),
  manaPool: webManaPoolViewSchema,
  controlled: z.boolean(),
  isHuman: z.boolean(),
  isActive: z.boolean(),
  hasPriority: z.boolean(),
  hasLeft: z.boolean(),
  monarch: z.boolean(),
  initiative: z.boolean(),
  designationNames: z.array(z.string()),
  // Default to [] so older fixtures (and any 1.12 server in dev) parse
  // cleanly — server is guaranteed to populate the field on schema
  // 1.13+, but the wire is forward-compatible either way.
  commandList: z.array(webCommandObjectViewSchema).default([]),
});
export type WebPlayerView = z.infer<typeof webPlayerViewSchema>;

export const webGameViewSchema = z.object({
  turn: z.number(),
  phase: z.string(),
  step: z.string(),
  activePlayerName: z.string(),
  priorityPlayerName: z.string(),
  special: z.boolean(),
  rollbackTurnsAllowed: z.boolean(),
  totalErrorsCount: z.number(),
  totalEffectsCount: z.number(),
  gameCycle: z.number(),
  myPlayerId: z.string(),
  myHand: z.record(z.string(), webCardViewSchema),
  stack: z.record(z.string(), webCardViewSchema),
  combat: z.array(webCombatGroupViewSchema),
  players: z.array(webPlayerViewSchema),
});
export type WebGameView = z.infer<typeof webGameViewSchema>;

export const webChoiceSchema = z.object({
  message: z.string(),
  subMessage: z.string(),
  required: z.boolean(),
  choices: z.record(z.string(), z.string()),
});
export type WebChoice = z.infer<typeof webChoiceSchema>;

/**
 * Whitelisted projection of upstream's GameClientMessage.options
 * map. Schema 1.15. Matches server-side WebClientMessageOptions
 * record. Older 1.14 fixtures default to all-empty via z.default
 * so this slice's schema bump doesn't force a fixture rewrite.
 */
export const webClientMessageOptionsSchema = z.object({
  leftBtnText: z.string().default(''),
  rightBtnText: z.string().default(''),
  possibleAttackers: z.array(z.string()).default([]),
  possibleBlockers: z.array(z.string()).default([]),
  specialButton: z.string().default(''),
});
export type WebClientMessageOptions = z.infer<typeof webClientMessageOptionsSchema>;

export const EMPTY_CLIENT_MESSAGE_OPTIONS: WebClientMessageOptions = {
  leftBtnText: '',
  rightBtnText: '',
  possibleAttackers: [],
  possibleBlockers: [],
  specialButton: '',
};

export const webGameClientMessageSchema = z.object({
  gameView: webGameViewSchema.nullable(),
  message: z.string(),
  targets: z.array(z.string()),
  cardsView1: z.record(z.string(), webCardViewSchema),
  min: z.number(),
  max: z.number(),
  flag: z.boolean(),
  choice: webChoiceSchema.nullable(),
  options: webClientMessageOptionsSchema.default(EMPTY_CLIENT_MESSAGE_OPTIONS),
});
export type WebGameClientMessage = z.infer<typeof webGameClientMessageSchema>;

export const webAbilityPickerViewSchema = z.object({
  gameView: webGameViewSchema.nullable(),
  message: z.string(),
  choices: z.record(z.string(), z.string()),
});
export type WebAbilityPickerView = z.infer<typeof webAbilityPickerViewSchema>;

export const webGameEndViewSchema = z.object({
  gameInfo: z.string(),
  matchInfo: z.string(),
  additionalInfo: z.string(),
  won: z.boolean(),
  wins: z.number(),
  winsNeeded: z.number(),
  players: z.array(webPlayerViewSchema),
});
export type WebGameEndView = z.infer<typeof webGameEndViewSchema>;

/* ---------- helpers ---------- */

/**
 * Parse the {@code schemaVersion} string ("1.12") into its major + minor
 * parts. Returns null on a malformed value (defensive — server only ever
 * sends well-formed versions, but a misconfigured proxy could mangle it).
 */
export function parseSchemaVersion(raw: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)$/.exec(raw);
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}
