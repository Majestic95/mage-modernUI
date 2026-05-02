package mage.webapi.lobby;

import mage.MageException;
import mage.cards.decks.Deck;
import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.decks.DeckValidator;
import mage.cards.decks.DeckValidatorError;
import mage.cards.repository.CardInfo;
import mage.cards.repository.CardRepository;
import mage.constants.MatchTimeLimit;
import mage.constants.MultiplayerAttackOption;
import mage.constants.RangeOfInfluence;
import mage.constants.SkillLevel;
import mage.game.GameException;
import mage.game.Table;
import mage.game.match.MatchOptions;
import mage.game.mulligan.MulliganType;
import mage.players.PlayerType;
import mage.server.Session;
import mage.server.TableController;
import mage.view.TableView;
import mage.webapi.WebApiException;
import mage.webapi.dto.WebMatchOptionsUpdate;
import mage.webapi.dto.WebRoomRef;
import mage.webapi.dto.WebTable;
import mage.webapi.dto.WebTableListing;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.mapper.DeckValidationMapper;
import mage.webapi.mapper.TableMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Orchestrates lobby + table calls against the embedded server (ADR
 * 0006). Each public method maps to one upstream {@code MageServerImpl}
 * call plus translation. Routes call this; this calls upstream.
 */
public final class LobbyService {

    private static final Logger LOG = LoggerFactory.getLogger(LobbyService.class);

    /**
     * Skill level passed to upstream when adding an AI seat. See the comment
     * block in {@link #addAi} for why 4 (slice 47 mitigation, not cure).
     * Package-private + visible-for-test so {@code LobbyServiceTest} can
     * pin the wired value without a mock framework.
     */
    static final int AI_SKILL = 4;

    private final EmbeddedServer embedded;

    public LobbyService(EmbeddedServer embedded) {
        this.embedded = embedded;
    }

    /** Discover the singleton main lobby. */
    public WebRoomRef mainRoom() {
        try {
            UUID roomId = embedded.server().serverGetMainRoomId();
            UUID chatId = embedded.server().chatFindByRoom(roomId);
            return new WebRoomRef(
                    mage.webapi.SchemaVersion.CURRENT,
                    roomId.toString(),
                    chatId == null ? "" : chatId.toString()
            );
        } catch (MageException ex) {
            throw upstream("looking up main room", ex);
        }
    }

    public WebTableListing listTables(UUID roomId) {
        try {
            List<TableView> views = embedded.server().roomGetAllTables(roomId);
            // Slice 70-X — thread the TableManager through to the mapper
            // so each WebSeat can carry its commander identity, derived
            // from match.getPlayer(playerId).getDeck().getSideboard().
            return TableMapper.listing(
                    views == null ? List.of() : views,
                    embedded.managerFactory().tableManager()
            );
        } catch (MageException ex) {
            throw upstream("listing tables", ex);
        }
    }

    public WebTable createTable(String upstreamSessionId, UUID roomId, MatchOptions options) {
        try {
            TableView view = embedded.server().roomCreateTable(upstreamSessionId, roomId, options);
            if (view == null) {
                throw new WebApiException(422, "UPSTREAM_REJECTED",
                        "Server refused to create the table.");
            }
            LOG.info("Table created: {} in room {}", view.getTableId(), roomId);
            // Slice 70-X — same TableManager threading for the
            // create-table response shape (returns the new WebTable
            // with empty seats; commander fields naturally empty
            // since no players have joined yet).
            return TableMapper.table(view, embedded.managerFactory().tableManager());
        } catch (MageException ex) {
            throw upstream("creating table", ex);
        }
    }

    /**
     * Slice 72-A — pre-flight deck validation BEFORE delegating to
     * upstream. Upstream's {@code TableController.joinTable} runs the
     * same validation as a side effect and silently drops the error
     * list (returns boolean), then on failure removes the table when
     * the failing player is the owner — so reading
     * {@code Table.getValidator().getErrorsListSorted()} after-the-fact
     * is racey (the table object may already be gone).
     *
     * <p>Pre-validating here lets us throw {@code DECK_INVALID} with
     * the structured error payload before upstream ever sees the
     * request. We mint a fresh validator instance per call (same
     * class, no-arg constructor) rather than reusing
     * {@code Table.getValidator()} — that field is a per-table
     * singleton and concurrent {@code joinTable} calls on the same
     * table would corrupt its shared {@code errorsList}
     * (clear/add/clear/add interleavings under
     * {@code TableController.joinTable}'s {@code synchronized} that
     * doesn't extend to our pre-validation path).
     *
     * <p>If pre-validation passes, the upstream call's own validation
     * runs against the table's actual validator instance and produces
     * the same verdict (verdict-determinism is the validator-class
     * contract). On the upstream-rejection branch our 422 surface is
     * {@code UPSTREAM_REJECTED} for the non-deck failure modes — wrong
     * password, no seats, already joined.
     */
    public void joinTable(String upstreamSessionId, UUID roomId, UUID tableId,
                          String name, int skill, DeckCardLists deck, String password) {
        preValidateDeck(tableId, deck);

        boolean ok;
        try {
            ok = embedded.server().roomJoinTable(
                    upstreamSessionId, roomId, tableId, name,
                    PlayerType.HUMAN, skill, deck,
                    password == null ? "" : password
            );
        } catch (MageException ex) {
            throw upstream("joining table", ex);
        }
        if (!ok) {
            // Pre-validation already ruled out DECK_INVALID, so any
            // remaining false here is wrong password, no seats, etc.
            throw new WebApiException(422, "UPSTREAM_REJECTED",
                    "Server rejected the join (wrong password, table full, already seated, etc.).");
        }
    }

    /**
     * Slice 72-A — runs validation against a freshly-minted validator
     * (NOT {@link Table#getValidator()}, see the joinTable javadoc for
     * why) and throws {@code DECK_INVALID} with the structured error
     * payload if it fails. No-op when the table has no validator
     * (limited tournament tables that supply decks via draft).
     */
    private void preValidateDeck(UUID tableId, DeckCardLists deckList) {
        Table table = embedded.managerFactory().tableManager().getTable(tableId);
        if (table == null) {
            throw new WebApiException(404, "NOT_FOUND",
                    "Table not found: " + tableId);
        }
        DeckValidator tableValidator = table.getValidator();
        if (tableValidator == null) {
            return;
        }
        DeckValidator fresh = newValidatorLike(tableValidator);
        Deck loaded;
        try {
            loaded = Deck.load(deckList, false, false);
        } catch (GameException ex) {
            throw new WebApiException(400, "INVALID_DECK_FORMAT",
                    "Could not load deck: " + ex.getMessage());
        }
        if (fresh.validate(loaded)) {
            return;
        }
        List<DeckValidatorError> errors =
                fresh.getErrorsListSorted(DeckValidationMapper.DEFAULT_ERROR_LIMIT);
        throw new WebApiException(422, "DECK_INVALID",
                "Deck failed validation for the " + fresh.getName() + " format.",
                DeckValidationMapper.toDtoList(errors));
    }

    /**
     * Mints a fresh validator of the same class as the table's
     * validator. Used to avoid the shared-instance race described in
     * {@link #joinTable}. Falls back to logging + treating the table
     * as having no validator if reflective construction fails — that's
     * a paranoid path (every shipped {@code DeckValidator} subclass
     * has a public no-arg constructor; that's how
     * {@code DeckValidatorFactory} mints them in the first place).
     */
    private static DeckValidator newValidatorLike(DeckValidator template) {
        try {
            return template.getClass().getDeclaredConstructor().newInstance();
        } catch (ReflectiveOperationException ex) {
            // Defensive — should never happen in practice. Surface as
            // an upstream error rather than silently skipping
            // validation (which would let invalid decks through).
            LOG.error("Could not mint a fresh {} validator for pre-flight: {}",
                    template.getClass().getSimpleName(), ex.getMessage(), ex);
            throw new WebApiException(500, "UPSTREAM_ERROR",
                    "Could not construct a deck validator for pre-flight: "
                            + template.getClass().getSimpleName());
        }
    }

    public void addAi(String upstreamSessionId, UUID roomId, UUID tableId, PlayerType aiType) {
        if (aiType == PlayerType.HUMAN) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "playerType must be a COMPUTER_* value.");
        }
        // Upstream's TableController.joinTable runs deck validation even
        // for AI seats (no isComputer bypass). We supply a 60-card basic-
        // lands fallback deck so the join validates. Slice 6b will add a
        // request-side `deck` field and let clients customize.
        //
        // skill = 4 (slice 47 mitigation, see docs/decisions/mad-ai-no-plays-recon.md):
        //   - skill = 1 (the prior default) sets maxThinkTimeSecs = 3, which
        //     in practice produces zero plays — the simulation tree builder
        //     in ComputerPlayer7.calculateActions hits the empty-tree edge
        //     case (the upstream TODO at ComputerPlayer7.java:119) before
        //     populating root.children, and act() silently passes priority.
        //   - skill = 6 was the recon's first guess but is wasted budget:
        //     ComputerPlayer6.java:92-100 clamps maxDepth to 4 for any
        //     skill < 4, AND the simulation already passes through the same
        //     depth ceiling once skill = 4 — so any skill > 4 only buys
        //     extra wall time, not extra search.
        //   - skill = 4 is the cliff: maxDepth is unchanged from skill = 1
        //     (still 4) but maxThinkTimeSecs jumps from 3 to 12 — a 4× think
        //     budget at the same tree size. That's the headroom that lets
        //     the tree builder produce children before the empty-tree edge
        //     case fires. Mitigation, not cure — the upstream TODO is the
        //     real bug, and this slice deliberately doesn't touch it.
        DeckCardLists fallbackDeck = buildFallbackBasicLandsDeck();
        boolean ok;
        try {
            ok = embedded.server().roomJoinTable(
                    upstreamSessionId, roomId, tableId,
                    aiType.toString(), aiType, AI_SKILL, fallbackDeck, /* password */ ""
            );
        } catch (MageException ex) {
            throw upstream("adding AI", ex);
        }
        if (!ok) {
            throw new WebApiException(422, "UPSTREAM_REJECTED",
                    "Server rejected the AI seat (table full, AI cap reached, etc.).");
        }
    }

    /**
     * Build the AI's fallback deck used by {@code addAi}. Slice 24
     * upgrade — was a 60-Forest pile (no creatures, no combat
     * possible). Now a mono-green creature pile so the AI actually
     * casts spells and attacks. Lets us exercise the slice-20
     * combat panel + slice-21 manual mana paths in live testing.
     *
     * <p>Every entry is looked up via CardRepository — if a
     * specific card isn't in the DB we substitute Forest so the
     * total card count stays at 60 (deck-validation requirement).
     * In practice every card here has been in upstream's repository
     * for years; the substitute path is paranoia.
     */
    private DeckCardLists buildFallbackBasicLandsDeck() {
        CardInfo forest = CardRepository.instance.findCard("Forest");
        if (forest == null) {
            throw new WebApiException(500, "UPSTREAM_ERROR",
                    "Card DB has no Forest — cannot build AI fallback deck.");
        }
        DeckCardLists deck = new DeckCardLists();
        deck.setName("AI Bears Deck");
        deck.setAuthor("server");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Forest", forest, 24);
        addEntryOrFallback(cards, "Llanowar Elves", forest, 4);
        addEntryOrFallback(cards, "Grizzly Bears", forest, 4);
        addEntryOrFallback(cards, "Centaur Courser", forest, 4);
        addEntryOrFallback(cards, "Trained Armodon", forest, 4);
        addEntryOrFallback(cards, "Spined Wurm", forest, 4);
        addEntryOrFallback(cards, "Craw Wurm", forest, 4);
        addEntryOrFallback(cards, "Yavimaya Wurm", forest, 4);
        addEntryOrFallback(cards, "Plated Slagwurm", forest, 4);
        addEntryOrFallback(cards, "Quirion Sentinel", forest, 4);
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    private static void addEntry(List<DeckCardInfo> out, String name, CardInfo info, int n) {
        out.add(new DeckCardInfo(name, info.getCardNumber(), info.getSetCode(), n));
    }

    private static void addEntryOrFallback(List<DeckCardInfo> out, String name,
                                            CardInfo fallback, int n) {
        CardInfo info = CardRepository.instance.findCard(name);
        if (info == null) {
            // Substitute basic lands so the 60-card target is preserved
            // even if some cards are missing from the local DB.
            LOG.warn("AI deck card '{}' missing from repository — substituting {} extra Forests",
                    name, n);
            out.add(new DeckCardInfo("Forest",
                    fallback.getCardNumber(), fallback.getSetCode(), n));
            return;
        }
        out.add(new DeckCardInfo(name, info.getCardNumber(), info.getSetCode(), n));
    }

    /**
     * Remove a table from the room. Upstream's
     * {@code TableManagerImpl.removeTable} requires the caller to be
     * the table's owner (or an admin) — non-owners get a {@code false}
     * back, which we surface as a 403 so the UI can react.
     *
     * <p>We bypass {@code MageServerImpl.tableRemove} because it
     * discards the boolean. Going one level deeper to the manager
     * preserves the auth-failure signal.
     */
    public void removeTable(String upstreamSessionId, UUID roomId, UUID tableId) {
        UUID userId = embedded.managerFactory().sessionManager()
                .getSession(upstreamSessionId)
                .map(Session::getUserId)
                .orElseThrow(() -> new WebApiException(401, "MISSING_SESSION",
                        "Upstream session expired."));
        boolean ok;
        try {
            ok = embedded.managerFactory().tableManager().removeTable(userId, tableId);
        } catch (RuntimeException ex) {
            throw upstream("removing table", ex);
        }
        if (!ok) {
            throw new WebApiException(403, "NOT_OWNER",
                    "Only the table owner can remove the table.");
        }
        LOG.info("Table removed: {} from room {}", tableId, roomId);
    }

    public void leaveSeat(String upstreamSessionId, UUID roomId, UUID tableId) {
        boolean ok;
        try {
            ok = embedded.server().roomLeaveTableOrTournament(upstreamSessionId, roomId, tableId);
        } catch (MageException ex) {
            throw upstream("leaving table", ex);
        }
        if (!ok) {
            throw new WebApiException(422, "UPSTREAM_REJECTED",
                    "Server refused to vacate the seat (table not in WAITING state, not seated, etc.).");
        }
    }

    public void startMatch(String upstreamSessionId, UUID roomId, UUID tableId) {
        boolean ok;
        try {
            ok = embedded.server().matchStart(upstreamSessionId, roomId, tableId);
        } catch (MageException ex) {
            throw upstream("starting match", ex);
        }
        if (!ok) {
            throw new WebApiException(422, "UPSTREAM_REJECTED",
                    "Server refused to start the match (not owner, missing seats, wrong state).");
        }
    }

    /**
     * Submit a finalized deck for a sideboarding / construction
     * window. Routes through {@code MageServerImpl.deckSubmit} which
     * validates against the table's format and releases the player
     * into the next game.
     *
     * <p>{@code update=true} switches to {@code deckSave} (autosave
     * during sideboarding — no game-start trigger). Same wire body
     * either way; the discriminator selects dispatch.
     */
    public void submitDeck(String upstreamSessionId, UUID tableId,
                            DeckCardLists deckList, boolean update) {
        try {
            if (update) {
                embedded.server().deckSave(upstreamSessionId, tableId, deckList);
                return;
            }
            boolean ok = embedded.server().deckSubmit(upstreamSessionId, tableId, deckList);
            if (!ok) {
                throw new WebApiException(422, "UPSTREAM_REJECTED",
                        "Server refused to accept the deck (table not sideboarding/constructing, "
                                + "deck failed format validation, or player has quit).");
            }
        } catch (MageException ex) {
            throw upstream(update ? "updating deck" : "submitting deck", ex);
        }
    }

    /**
     * Slice L3 (new-lobby-window) — host-only edit of an existing
     * table's editable {@link MatchOptions} subset.
     *
     * <p>Format ({@code deckType}), mode ({@code gameType}), and
     * {@code winsNeeded} are NOT editable here — they are locked
     * at table creation. Player count + AI seat add/remove are
     * structural and go through the existing seat endpoints.
     *
     * <p>Owner check: {@link TableController#isOwner(UUID)}. Non-
     * owners get a 403 NOT_OWNER. Unknown table → 404 TABLE_NOT_FOUND.
     * Bad enum string → 400 BAD_REQUEST.
     *
     * @return the freshly-mapped {@link WebTable} reflecting the new
     *         options. Note that polling clients will pick up the
     *         change on their next poll regardless; the return value
     *         is a convenience so the caller doesn't have to re-poll.
     */
    public WebTable updateMatchOptions(String upstreamSessionId,
                                        UUID roomId,
                                        UUID tableId,
                                        WebMatchOptionsUpdate update) {
        if (update == null) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "Update body is required.");
        }
        UUID userId = embedded.managerFactory().sessionManager()
                .getSession(upstreamSessionId)
                .map(Session::getUserId)
                .orElseThrow(() -> new WebApiException(401, "MISSING_SESSION",
                        "Upstream session expired."));
        Optional<TableController> tcOpt =
                embedded.managerFactory().tableManager().getController(tableId);
        if (tcOpt.isEmpty()) {
            throw new WebApiException(404, "TABLE_NOT_FOUND",
                    "Table not found.");
        }
        TableController tc = tcOpt.get();
        if (!tc.isOwner(userId)) {
            throw new WebApiException(403, "NOT_OWNER",
                    "Only the table owner can edit settings.");
        }
        Table table = tc.getTable();
        if (table == null || table.getMatch() == null
                || table.getMatch().getOptions() == null) {
            throw new WebApiException(409, "TABLE_NOT_EDITABLE",
                    "Table is not in a state where settings can be edited.");
        }
        // Apply the partial update. Each non-null field maps to its
        // upstream setter. Enum-bearing fields parse into their
        // upstream type so an invalid value lands as 400 BAD_REQUEST
        // (via parseEnum) rather than reaching the live game state.
        MatchOptions options = table.getMatch().getOptions();
        if (update.password() != null) {
            options.setPassword(update.password());
        }
        if (update.skillLevel() != null) {
            options.setSkillLevel(parseEnum(SkillLevel.class,
                    update.skillLevel(), "skillLevel"));
        }
        if (update.matchTimeLimit() != null) {
            options.setMatchTimeLimit(parseEnum(MatchTimeLimit.class,
                    update.matchTimeLimit(), "matchTimeLimit"));
        }
        if (update.freeMulligans() != null) {
            int v = update.freeMulligans();
            if (v < 0 || v > 5) {
                throw new WebApiException(400, "BAD_REQUEST",
                        "freeMulligans must be 0..5; got " + v + ".");
            }
            options.setFreeMulligans(v);
        }
        if (update.mulliganType() != null) {
            // Upstream typo — `setMullgianType` (sic). Match it.
            options.setMullgianType(parseEnum(MulliganType.class,
                    update.mulliganType(), "mulliganType"));
        }
        if (update.spectatorsAllowed() != null) {
            options.setSpectatorsAllowed(update.spectatorsAllowed());
        }
        if (update.rated() != null) {
            options.setRated(update.rated());
        }
        if (update.attackOption() != null) {
            options.setAttackOption(parseEnum(MultiplayerAttackOption.class,
                    update.attackOption(), "attackOption"));
        }
        if (update.range() != null) {
            options.setRange(parseEnum(RangeOfInfluence.class,
                    update.range(), "range"));
        }
        LOG.info("Table options updated: {} (caller={})", tableId, userId);
        // Build a fresh {@link TableView} directly off the upstream
        // {@link Table} reference. Earlier draft re-fetched via
        // {@code roomGetAllTables}, but that view is rebuilt only when
        // the room emits its periodic listing — for a just-modified
        // table we want the immediately-current state. Constructing
        // the view from the live Table guarantees the response
        // reflects the mutation we just performed.
        TableView freshView = new TableView(table);
        return TableMapper.table(freshView, embedded.managerFactory().tableManager());
    }

    private static <E extends Enum<E>> E parseEnum(Class<E> enumClass,
                                                    String raw,
                                                    String field) {
        try {
            return Enum.valueOf(enumClass, raw);
        } catch (IllegalArgumentException ex) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "Invalid " + field + ": '" + raw + "'.");
        }
    }

    private WebApiException upstream(String action, Exception cause) {
        return new WebApiException(500, "UPSTREAM_ERROR",
                "Upstream error while " + action + ": " + cause.getMessage());
    }
}
