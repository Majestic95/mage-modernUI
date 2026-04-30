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

/**
 * Slice 72-A — one entry in the deck validator's error report. Mirrors
 * upstream's {@code DeckValidatorError} fields plus the
 * {@code partlyLegal} + {@code synthetic} denormalizations.
 *
 * <p>{@code partlyLegal=true} means this specific error is satisfied
 * once the deck reaches its required size (DECK_SIZE only today).
 * {@code synthetic=true} marks the engine's overflow sentinel
 * ({@code OTHER, "...", "and more N error[s]"}); clients should
 * render synthetic entries as a non-clickable footer rather than a
 * real error.
 *
 * <p>The {@code default(false)} on the two booleans keeps older 1.20
 * fixtures (pre-72-A) parsing cleanly — older servers never emit
 * the fields. Today's 1.21+ servers always populate them.
 */
export const webDeckValidationErrorSchema = z.object({
  errorType: z.string(),
  group: z.string(),
  message: z.string(),
  cardName: z.string().nullable(),
  partlyLegal: z.boolean().default(false),
  synthetic: z.boolean().default(false),
});
export type WebDeckValidationError = z.infer<typeof webDeckValidationErrorSchema>;

export const webErrorSchema = z.object({
  schemaVersion: z.string(),
  code: z.string(),
  message: z.string(),
  // Slice 72-A — present (non-null) only when code === "DECK_INVALID";
  // server omits the field via @JsonInclude(NON_NULL) on every other
  // 4xx/5xx path. Older 1.20 servers never emit it; default null
  // keeps those parses clean.
  validationErrors: z.array(webDeckValidationErrorSchema).nullable().default(null),
});
export type WebError = z.infer<typeof webErrorSchema>;

/**
 * Slice 72-A — response payload for
 * {@code POST /api/decks/validate?deckType=...}. Always 200 OK; the
 * {@code valid} / {@code partlyLegal} / {@code errors} fields carry
 * the verdict.
 *
 * <p>{@code partlyLegal} is the deck-LEVEL rollup — true iff
 * {@code valid} is true OR every error is itself partly-legal. Drives
 * the deck builder's amber "legal once finished" badge vs red "needs
 * card changes". Clients should branch on this single boolean.
 */
export const webDeckValidationResultSchema = z.object({
  schemaVersion: z.string(),
  valid: z.boolean(),
  partlyLegal: z.boolean(),
  errors: z.array(webDeckValidationErrorSchema),
});
export type WebDeckValidationResult = z.infer<typeof webDeckValidationResultSchema>;

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

/* ---------- decks (request shapes) ---------- */

/**
 * One mainboard / sideboard entry in a deck submission. Matches the
 * server-side {@code WebDeckCardInfo} record consumed by
 * {@code DeckMapper.toUpstream}: name + set + collector number +
 * count. The set + collector number resolve a specific printing —
 * required because the server's CardRepository keys on those.
 *
 * <p>Pre-defined here (not auto-generated) because the type is
 * imported widely (decks/store.ts, decks/resolve.ts, JoinTableModal)
 * and was previously implicit. Slice 72-B made the gap explicit by
 * needing the same shape as the request body for
 * {@code POST /api/decks/validate}.
 */
export const webDeckCardInfoSchema = z.object({
  cardName: z.string(),
  setCode: z.string(),
  cardNumber: z.string(),
  amount: z.number().int().min(1),
});
export type WebDeckCardInfo = z.infer<typeof webDeckCardInfoSchema>;

/**
 * Full deck submission — name + author + mainboard + sideboard.
 * Posted as the body of {@code /join}, {@code /tables/{id}/deck}
 * (sideboard submit), and {@code /api/decks/validate} (slice 72-B).
 * The server-side {@code WebDeckCardLists} record is the matching
 * shape.
 */
export const webDeckCardListsSchema = z.object({
  name: z.string(),
  author: z.string(),
  cards: z.array(webDeckCardInfoSchema),
  sideboard: z.array(webDeckCardInfoSchema),
});
export type WebDeckCardLists = z.infer<typeof webDeckCardListsSchema>;

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
  // Schema 1.20 (ADR 0010 v2 D12) — negotiated handshake protocol
  // version. Server echoes the client's ?protocolVersion= query param
  // back through this field, so the client can confirm what the server
  // negotiated. Default to 1 marks the "field absent on the wire" case
  // (a 1.19 server) as v1 — explicit and parseable rather than letting
  // a stripped field pretend to be v2. Real v2 servers populate the
  // field with the negotiated integer; the default never fires there.
  protocolVersion: z.number().default(1),
});
export type WebStreamHello = z.infer<typeof webStreamHelloSchema>;

export const webStreamErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type WebStreamError = z.infer<typeof webStreamErrorSchema>;

/**
 * Slice 69c (ADR 0010 v2 D11b) — synthetic teardown signal emitted
 * when a player leaves the game (concession, timeout, disconnect).
 * Tells client UIs to dismiss any open dialog (vote loop, target
 * prompt, cost decision, triggered-ability picker) targeting the
 * leaver. Fire-and-forget UX teardown, not a state-machine
 * transition — if the engine then re-prompts a different player
 * after the skip, that arrives as a fresh {@code gameAsk} /
 * {@code gameTarget} / {@code gameSelect} envelope. Clients do NOT
 * chain off {@code dialogClear}.
 *
 * <p>{@code reason} is a short machine-parseable code; v2 emits
 * {@code "PLAYER_LEFT"} for any leaver detection.
 */
export const webDialogClearSchema = z.object({
  playerId: z.string(),
  reason: z.string(),
});
export type WebDialogClear = z.infer<typeof webDialogClearSchema>;

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
  /**
   * Schema 1.19 (slice 52a). Stable underlying-Card UUID — same value
   * across stack / battlefield / hand / graveyard for the same physical
   * Magic card. Used by the webclient as a Framer Motion {@code
   * layoutId} for cross-zone animation (stack → battlefield glide on
   * spell resolution). For non-stack zones {@code cardId === id}; the
   * stack is the only zone where they differ (server recovers
   * {@code Spell.getCard().getId()} via a per-frame upstream lookup).
   */
  cardId: string;
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
  /**
   * Schema 1.18 (ADR 0009 slice 28). Non-empty when this view came
   * through the {@code AbilityView} path — carries the source card's
   * name (e.g. "Soul Warden", "Atraxa, Praetors' Voice") so the
   * trigger-order panel can render "from: ‹source›" attribution
   * beneath each rule. Empty for ordinary cards.
   */
  sourceLabel: string;
};
export const webCardViewSchema: z.ZodType<WebCardView> = z.lazy(() =>
  z.object({
    id: z.string(),
    // Slice 52a / schema 1.19. Server always emits cardId for every
    // zone (== underlying Card UUID; for non-stack zones equal to
    // {@link id}). The default('') keeps test fixtures lightweight
    // (27 fixture sites would otherwise need explicit cardId).
    //
    // Wire-format defense for "server forgot to emit cardId" lives at
    // a higher layer:
    //   - Mapper *Test classes in Mage.Server.WebApi (snapshot-style
    //     JSON shape locks; CI-gated)
    //   - GameStreamHandlerTest e2e exercises the wire format with a
    //     real embedded server (asserts cardId == id for hand zone)
    //   - Slice 62 Playwright e2e exercises full animation flow
    // Empty-string cardId at runtime → animation layer treats as
    // "no layoutId, do not animate" — graceful degradation, not a
    // crash. Auditor #3 (2026-04-29) flagged this as a hidden mask
    // for server regressions; review concluded the defense at higher
    // layers is sufficient and the fixture-churn cost of removing the
    // default exceeds the marginal safety.
    cardId: z.string().default(''),
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
    sourceLabel: z.string().default(''),
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
  // Schema 1.20 (ADR 0010 v2 D3c) — UUIDs of players who have goaded
  // this permanent (CR 701.42). Empty array = not goaded. Default to
  // [] so older fixtures (and any 1.19 server still running) parse
  // cleanly. Populated from Permanent.getGoadingPlayers() in slice 69b.
  goadingPlayerIds: z.array(z.string()).default([]),
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
  // Schema 1.20 (ADR 0010 v2 D3a) — team UUID for 2HG / multi-team
  // formats; null for FFA and 1v1. Default to null so older fixtures
  // (and any 1.19 server still running) parse cleanly. Populated from
  // MatchType.getPlayersPerTeam() + seat-index in slice 69b.
  teamId: z.string().nullable().default(null),
  // Schema 1.22 (ADR 0011 D5, slice 70-D) — single-character MTG
  // color codes (W/U/B/R/G) representing the union color identity of
  // the player's commander(s). Empty list for non-commander formats.
  // Drives the PlayerFrame halo (single = solid ring, multi =
  // alternating bands, empty = neutral team-ring). Default to []
  // so older 1.21 servers (no field) parse cleanly. The default
  // fires only on a missing key, not on a literal null — server-side
  // mapper emits List.of() never null.
  colorIdentity: z.array(z.string()).default([]),
  // Schema 1.23 (ADR 0011 D3 / ADR 0010 v2 D11(e), slice 70-H) —
  // WS-layer connection state. "connected" when the player has
  // ≥1 active player-route socket in this game; "disconnected"
  // when all such sockets have closed but the player is still
  // seated (recoverable on reconnect — distinct from terminal
  // hasLeft). Drives the PlayerFrame DISCONNECTED overlay
  // (desaturate + label, design-system §7.3).
  //
  // Three guards layer here:
  //   - z.enum locks the literal set so a typo in PlayerFrame's
  //     comparison ('Disconnected' vs 'disconnected') is caught at
  //     the type level. Critic UI-I2 of slice 70-H surfaced this
  //     as a silent-misclassification risk on the prior z.string().
  //   - .catch('connected') gracefully tolerates a future server
  //     emitting a new state value (e.g. 'reconnecting' in some
  //     v3 expansion) by coercing it to "connected" rather than
  //     hard-failing the parse — the consuming UI must work even
  //     against a one-version-ahead server, and connectionState is
  //     non-load-bearing (the worst case is a brief stale overlay
  //     state until the next gameUpdate frame).
  //   - .default('connected') fires on missing key (a 1.22 server
  //     sending a frame with no connectionState field). Critic I8
  //     of slice 70-H technical critic — default must NOT be
  //     .optional() or Zod emits undefined and the UI mishandles
  //     "missing" vs "explicitly connected".
  connectionState: z
    .enum(['connected', 'disconnected'])
    .catch('connected')
    .default('connected'),
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
 * map. Schema 1.16. Matches server-side WebClientMessageOptions
 * record. Older fixtures default to all-empty via z.default so
 * schema bumps don't force a fixture rewrite.
 *
 * <p>Schema 1.16 (ADR 0009): added {@code isTriggerOrder} —
 * discriminator that flips the {@code gameTarget} renderer into
 * the trigger-ordering panel when upstream's {@code queryType ==
 * QueryType.PICK_ABILITY}. The wire frame stays {@code gameTarget};
 * the boolean controls the client-side dialog branch.
 */
export const webClientMessageOptionsSchema = z.object({
  leftBtnText: z.string().default(''),
  rightBtnText: z.string().default(''),
  possibleAttackers: z.array(z.string()).default([]),
  possibleBlockers: z.array(z.string()).default([]),
  specialButton: z.string().default(''),
  isTriggerOrder: z.boolean().default(false),
});
export type WebClientMessageOptions = z.infer<typeof webClientMessageOptionsSchema>;

export const EMPTY_CLIENT_MESSAGE_OPTIONS: WebClientMessageOptions = {
  leftBtnText: '',
  rightBtnText: '',
  possibleAttackers: [],
  possibleBlockers: [],
  specialButton: '',
  isTriggerOrder: false,
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
