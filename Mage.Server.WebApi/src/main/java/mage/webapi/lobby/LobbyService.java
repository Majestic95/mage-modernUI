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
     * Skill level for the {@code COMPUTER_MAD} (minimax) AI. See the comment
     * block in {@link #addAi} for why 4 — slice 47 mitigation for the
     * {@code ComputerPlayer7.calculateActions} empty-tree bug (skill must
     * land on the cliff that bumps {@code maxThinkTimeSecs} 3→12 so the
     * simulation tree builder produces children before the empty-tree
     * edge case fires).
     * <p>Package-private + visible-for-test so {@code LobbyServiceTest} can
     * pin the wired value without a mock framework.
     */
    static final int AI_SKILL_MAD = 4;
    /**
     * Skill level for the {@code COMPUTER_MONTE_CARLO} AI. MCTS doesn't
     * have the empty-tree bug — its skill maps directly to
     * {@code maxThinkTime = skill * 2} seconds per priority decision
     * ({@code ComputerPlayerMCTS.java:44}). Walked down the skill ladder
     * over UI iterations: 4 → 30-60s AI turns (unusable); 1 → 2-4s per
     * priority (still felt slow at 4-player Commander); 0 → MCTS's
     * `calculateThinkTime` returns 0 in every branch, the search runs
     * are skipped entirely, the AI passes priority immediately. Trade-
     * off: the AI does not strategically play spells / declare attackers
     * — it pretty much always passes. Acceptable for UI/UX testing runs
     * where AI play quality is irrelevant; bump back to 1+ for real
     * gameplay validation. User direction 2026-05-04: "I do not want
     * any delay on them."
     */
    static final int AI_SKILL_MONTE_CARLO = 0;
    /** Alias kept for tests that still reference the old constant name. */
    static final int AI_SKILL = AI_SKILL_MAD;

    private final EmbeddedServer embedded;
    private final SeatReadyTracker readyTracker;
    /**
     * Slice L7 — pushed-to on every mutation that changes the wire
     * shape (ready toggles, deck swaps, seat join/leave, settings
     * PATCH). Set via {@link #setStreamBroadcaster} after construction
     * to avoid a circular dependency between {@code LobbyService} and
     * {@code TableStreamHandler}. Null in test contexts; broadcast
     * calls are no-ops when null.
     */
    private volatile TableStreamBroadcaster streamBroadcaster;

    public LobbyService(EmbeddedServer embedded) {
        this(embedded, new SeatReadyTracker());
    }

    /** Visible-for-test ctor — test pins a tracker instance. */
    LobbyService(EmbeddedServer embedded, SeatReadyTracker readyTracker) {
        this.embedded = embedded;
        this.readyTracker = readyTracker;
    }

    /** Visible for {@link mage.webapi.ws.TableStreamHandler} + tests. */
    public SeatReadyTracker readyTracker() {
        return readyTracker;
    }

    /** Slice L7 — minimal broadcast contract; satisfied by TableStreamHandler. */
    public interface TableStreamBroadcaster {
        void broadcast(UUID tableId);
    }

    /**
     * Slice L7 review (security-CRITICAL #2) — caps on user-supplied
     * string fields. Without these a single host can churn a megabyte
     * password through PATCH; combined with no rate-limiting this
     * amplifies GC pressure. 64 chars is well above any real password.
     * Mirrors {@code MatchOptionsBuilder.MAX_PASSWORD_LEN} which now
     * caps the create-time path too (L8 review fix).
     */
    private static final int MAX_PASSWORD_LEN = 64;

    public void setStreamBroadcaster(TableStreamBroadcaster broadcaster) {
        this.streamBroadcaster = broadcaster;
    }

    private void broadcast(UUID tableId) {
        TableStreamBroadcaster b = streamBroadcaster;
        if (b != null && tableId != null) {
            try {
                b.broadcast(tableId);
            } catch (RuntimeException ex) {
                LOG.warn("Broadcast failed for table {}: {}", tableId, ex.getMessage());
            }
        }
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
        return listTables(roomId, null);
    }

    /**
     * Slice L8 review (security HIGH #1) — viewer-aware overload.
     * When {@code viewerUsername} is non-null, seat-level deck and
     * commander info is redacted on passworded tables for viewers
     * who aren't seated there. The route handler should always
     * pass the caller's username; the no-arg overload is for
     * test / internal paths.
     */
    public WebTableListing listTables(UUID roomId, String viewerUsername) {
        try {
            List<TableView> views = embedded.server().roomGetAllTables(roomId);
            // Slice 70-X — thread the TableManager through to the mapper
            // so each WebSeat can carry its commander identity, derived
            // from match.getPlayer(playerId).getDeck().getSideboard().
            // Slice L5 — also thread the SeatReadyTracker so per-seat
            // ready flags reflect the live opt-in state, not just the
            // L2 type-based default (true for AI / false for HUMAN).
            // Slice L8 review — also thread the viewer username so the
            // mapper can redact private-table seat info.
            return TableMapper.listing(
                    views == null ? List.of() : views,
                    embedded.managerFactory().tableManager(),
                    readyTracker,
                    viewerUsername
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
            // Slice L5 — host auto-readies on table creation. The
            // controllerName lives on the upstream TableView (post-
            // suffix-strip via TableMapper.cleanControllerName).
            String hostUsername = TableMapper.cleanControllerName(view.getControllerName());
            readyTracker.resetToHost(view.getTableId(), hostUsername);
            LOG.info("Table created: {} in room {} (host={})",
                    view.getTableId(), roomId, hostUsername);
            return TableMapper.table(view,
                    embedded.managerFactory().tableManager(),
                    readyTracker);
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
        // 2026-05-02 — root-cause fix for "Table closed instantly".
        // upstream's TableController.joinTable runs deck validation
        // against the table's format. If the deck fails AND the
        // submitting session belongs to the table OWNER (which our
        // upstreamSessionId always is), upstream calls
        // tableManager.removeTable(tableId) — destroying the entire
        // table. Pre-flight check the deck against a freshly-minted
        // validator FIRST so we surface 422 INVALID_AI_DECK without
        // letting upstream destroy the table.
        Table table = embedded.managerFactory().tableManager().getTable(tableId);
        if (table == null) {
            throw new WebApiException(404, "NOT_FOUND", "Table not found: " + tableId);
        }
        DeckCardLists fallbackDeck = buildFallbackDeckForTable(table);
        DeckValidator tableValidator = table.getValidator();
        if (tableValidator != null) {
            DeckValidator fresh = newValidatorLike(tableValidator);
            try {
                Deck loaded = Deck.load(fallbackDeck, false, false);
                if (!fresh.validate(loaded)) {
                    List<DeckValidatorError> errors =
                            fresh.getErrorsListSorted(DeckValidationMapper.DEFAULT_ERROR_LIMIT);
                    LOG.warn("AI fallback deck failed validation for {} format; "
                            + "skipping addAi to preserve table {}",
                            fresh.getName(), tableId);
                    throw new WebApiException(422, "AI_DECK_INVALID",
                            "AI fallback deck does not validate for the "
                                    + fresh.getName() + " format. "
                                    + "Add AI seats from inside the lobby instead.",
                            DeckValidationMapper.toDtoList(errors));
                }
            } catch (GameException ex) {
                throw new WebApiException(500, "UPSTREAM_ERROR",
                        "Could not load AI fallback deck: " + ex.getMessage());
            }
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
        // Per-AI skill split — see AI_SKILL_MAD / AI_SKILL_MONTE_CARLO
        // doc comments at the top of the class. MCTS gets a much lower
        // skill (1) so its per-priority think budget shrinks from 8s to
        // 2s, keeping AI turns inside ~10s during testing. The empty-
        // tree bug we mitigate with skill=4 lives in ComputerPlayer7,
        // not MCTS, so dropping MCTS skill here is safe.
        int aiSkill = aiType == PlayerType.COMPUTER_MONTE_CARLO
                ? AI_SKILL_MONTE_CARLO
                : AI_SKILL_MAD;
        boolean ok;
        try {
            ok = embedded.server().roomJoinTable(
                    upstreamSessionId, roomId, tableId,
                    aiType.toString(), aiType, aiSkill, fallbackDeck, /* password */ ""
            );
        } catch (MageException ex) {
            throw upstream("adding AI", ex);
        }
        if (!ok) {
            throw new WebApiException(422, "UPSTREAM_REJECTED",
                    "Server rejected the AI seat (table full, AI cap reached, etc.).");
        }
        broadcast(tableId);
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

    /**
     * Pick the right fallback deck shape for {@code table}'s format.
     * Commander tables need 99 mainboard + 1 commander in sideboard
     * (the legacy 60-card pile fails Commander validation, which made
     * upstream's joinTable destroy the entire table — see addAi).
     * Other formats fall through to the 60-card constructed pile.
     */
    private DeckCardLists buildFallbackDeckForTable(Table table) {
        String validatorName = table.getValidator() == null
                ? "" : table.getValidator().getName();
        if (validatorName != null
                && validatorName.toLowerCase().contains("commander")) {
            return buildCommanderFallbackDeck();
        }
        return buildFallbackBasicLandsDeck();
    }

    /**
     * 99-Forest mainboard + 1 legendary green creature in the sideboard
     * as the commander. We try a small list of widely-shipped legendary
     * green creatures so a missing card from one set doesn't break the
     * fallback. If none are available, throws — that's an unworkable
     * card DB and we surface it loudly.
     */
    private DeckCardLists buildCommanderFallbackDeck() {
        CardInfo forest = CardRepository.instance.findCard("Forest");
        if (forest == null) {
            throw new WebApiException(500, "UPSTREAM_ERROR",
                    "Card DB has no Forest — cannot build AI Commander deck.");
        }
        CardInfo commander = null;
        for (String candidate : new String[]{
                "Yeva, Nature's Herald",
                "Ezuri, Renegade Leader",
                "Omnath, Locus of Mana",
                "Ghalta, Primal Hunger",
                "Gaddock Teeg",
        }) {
            CardInfo c = CardRepository.instance.findCard(candidate);
            if (c != null) {
                commander = c;
                break;
            }
        }
        if (commander == null) {
            throw new WebApiException(500, "UPSTREAM_ERROR",
                    "Card DB has no legendary green creature — "
                            + "cannot build AI Commander fallback deck.");
        }
        DeckCardLists deck = new DeckCardLists();
        deck.setName("AI Commander Deck");
        deck.setAuthor("server");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Forest", forest, 99);
        deck.setCards(cards);
        List<DeckCardInfo> sideboard = new ArrayList<>();
        addEntry(sideboard, commander.getName(), commander, 1);
        deck.setSideboard(sideboard);
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
        // Slice L5 — drop the ready-tracker entry; the table is gone.
        readyTracker.removeTable(tableId);
        LOG.info("Table removed: {} from room {}", tableId, roomId);
        // Slice L7 — broadcast so any subscribers get a final close
        // (the handler returns null from currentSnapshot for a removed
        // table and closes the WS with code 4404).
        broadcast(tableId);
    }

    public void leaveSeat(String upstreamSessionId, UUID roomId, UUID tableId) {
        // Slice L5 — capture the username before delegating, so we can
        // remove them from the ready tracker. Failure to look up the
        // username is non-fatal — the upstream leave still proceeds and
        // the stale tracker entry is harmless (it'll be flushed when
        // the table is removed).
        String username = embedded.managerFactory().sessionManager()
                .getSession(upstreamSessionId)
                .map(Session::getUserId)
                .flatMap(userId ->
                        embedded.managerFactory().userManager().getUser(userId))
                .map(u -> u.getName())
                .orElse(null);
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
        if (username != null) {
            readyTracker.setReady(tableId, username, false);
        }
        broadcast(tableId);
    }

    public void startMatch(String upstreamSessionId, UUID roomId, UUID tableId) {
        // Slice L7 review (architecture HIGH #1, code-quality HIGH #8) —
        // server-side readiness gate. The L5 javadoc that lived here
        // claimed there was no public username→playerId bridge, but
        // setSeatReady and swapDeck both build that bridge by walking
        // table.getSeats() and matching player.getName(). We use the
        // same walk: every occupied HUMAN seat (other than the host,
        // who is implicitly ready per the design doc) must be in the
        // tracker before upstream is invoked.
        Optional<TableController> tcOpt =
                embedded.managerFactory().tableManager().getController(tableId);
        if (tcOpt.isPresent()) {
            Table table = tcOpt.get().getTable();
            if (table != null && table.getSeats() != null) {
                String hostName = TableMapper.cleanControllerName(
                        table.getControllerName());
                for (var seat : table.getSeats()) {
                    if (seat == null || seat.getPlayer() == null) continue;
                    PlayerType type = seat.getPlayerType();
                    if (type == null || type != PlayerType.HUMAN) continue;
                    String name = seat.getPlayer().getName();
                    if (name == null) continue;
                    if (hostName != null && hostName.equalsIgnoreCase(name)) continue;
                    if (!readyTracker.isReady(tableId, name)) {
                        throw new WebApiException(422, "NOT_ALL_READY",
                                "Not all guests have readied up.");
                    }
                }
            }
        }
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
        // Slice L5 — game's begun; drop the tracker entry.
        readyTracker.removeTable(tableId);
        // Slice L7 — broadcast so subscribers see state=DUELING and
        // can transition to the game window.
        broadcast(tableId);
    }

    /**
     * Slice L6 — submit (or re-submit) the caller's deck for their
     * seat at this table. Idempotent endpoint covering two cases:
     *
     * <ol>
     *   <li><b>First-time take seat</b> — caller is not yet seated;
     *       delegates to {@link #joinTable}, which runs full deck
     *       pre-validation and seats the user.</li>
     *   <li><b>Mid-lobby deck swap</b> — caller is already seated;
     *       validates the new deck against the table's validator,
     *       then calls {@code Match.updateDeck(playerId, deck, false)}
     *       to swap the deck in-place. We avoid {@code roomLeaveTable
     *       + joinTable} because upstream's
     *       {@code TableController.leaveTable} treats the owner
     *       leaving in WAITING state as "owner abandoned the table,
     *       remove it" — which would close the lobby for everyone
     *       just because the host wanted to change deck. The
     *       in-place update sidesteps that.</li>
     * </ol>
     *
     * <p>On success, resets the caller's ready flag to false — they
     * just changed deck and need to re-confirm.
     */
    public void swapDeck(String upstreamSessionId, UUID roomId, UUID tableId,
                          String name, int skill, DeckCardLists deck,
                          String password) {
        UUID userId = embedded.managerFactory().sessionManager()
                .getSession(upstreamSessionId)
                .map(Session::getUserId)
                .orElseThrow(() -> new WebApiException(401, "MISSING_SESSION",
                        "Upstream session expired."));
        Optional<TableController> tcOpt =
                embedded.managerFactory().tableManager().getController(tableId);
        if (tcOpt.isEmpty()) {
            throw new WebApiException(404, "TABLE_NOT_FOUND", "Table not found.");
        }
        TableController tc = tcOpt.get();
        Table table = tc.getTable();
        if (table == null) {
            throw new WebApiException(409, "TABLE_NOT_EDITABLE",
                    "Table is in a state that does not accept deck submissions.");
        }
        requireNotTournament(table);
        String username = embedded.managerFactory().userManager()
                .getUser(userId)
                .map(u -> u.getName())
                .orElse(null);

        if (!tc.hasPlayer(userId)) {
            // First-time take seat path. joinTable runs deck pre-
            // validation; if it throws, swap fails cleanly.
            joinTable(upstreamSessionId, roomId, tableId, name, skill, deck, password);
            // joinTable doesn't touch the ready tracker, so nothing
            // to reset here on first-take.
            broadcast(tableId);
            return;
        }

        // Already seated — in-place deck swap. Find the caller's
        // playerId by matching the seat's player.getName() against
        // their username. webclient passes username as the player
        // name on /join and PUT /seat/deck (default fallback in the
        // route handler), so the match is reliable in production.
        UUID playerId = null;
        if (username != null && table.getSeats() != null) {
            for (var s : table.getSeats()) {
                if (s != null && s.getPlayer() != null
                        && username.equals(s.getPlayer().getName())) {
                    playerId = s.getPlayer().getId();
                    break;
                }
            }
        }
        if (playerId == null) {
            throw new WebApiException(409, "TABLE_NOT_EDITABLE",
                    "Could not locate caller's seat for deck swap.");
        }
        // Validate the new deck against the table's format. Match
        // upstream's joinTable behavior — invalid deck rejected with
        // a structured error.
        preValidateDeck(tableId, deck);
        Deck loadedDeck;
        try {
            loadedDeck = Deck.load(deck, false, false);
        } catch (Exception ex) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "Could not load deck: " + ex.getMessage());
        }
        // Update the MatchPlayer's deck in place. ignoreMainBasicLands
        // = false matches upstream's auto-save semantics.
        //
        // Slice L8 review (code-quality HIGH #2) — lock BOTH monitors:
        // {@code tc} (TableController, which serializes vs other join /
        // leave / settings paths) AND {@code match} (which is the actual
        // object being mutated by {@code updateDeck}, and is what
        // {@code TableMapper.seat()} iterates via
        // {@code mp.getDeck().getCards()}). The previous draft locked
        // only on tc, missing the real read/write conflict. Lock order
        // is fixed (tc → match) to avoid deadlock with any future
        // path that might want both.
        if (table.getMatch() == null) {
            throw new WebApiException(409, "TABLE_NOT_EDITABLE",
                    "Table has no active match for deck submission.");
        }
        synchronized (tc) {
            synchronized (table.getMatch()) {
                table.getMatch().updateDeck(playerId, loadedDeck, false);
            }
        }
        readyTracker.setReady(tableId, username, false);
        LOG.info("Deck swapped: table={} user={} room={} (name/skill/password "
                + "only consumed on first-take path)",
                tableId, username, roomId);
        broadcast(tableId);
        // {@code name} / {@code skill} / {@code password} are used
        // only on the first-take path (joinTable above); harmless
        // unused parameters on the swap path. Java doesn't warn.
        assert name != null || skill >= 0 || password == null;
    }

    /**
     * Slice L5 — guest opts in or out of "ready". The host is
     * implicitly ready (set via {@link #createTable}); they MAY toggle
     * themselves but the typical host UX is to use the Start Game
     * button instead.
     */
    public void setSeatReady(String upstreamSessionId, UUID roomId, UUID tableId,
                              boolean ready) {
        UUID userId = embedded.managerFactory().sessionManager()
                .getSession(upstreamSessionId)
                .map(Session::getUserId)
                .orElseThrow(() -> new WebApiException(401, "MISSING_SESSION",
                        "Upstream session expired."));
        String username = embedded.managerFactory().userManager()
                .getUser(userId)
                .map(u -> u.getName())
                .orElseThrow(() -> new WebApiException(401, "MISSING_SESSION",
                        "Caller has no user record."));
        Optional<TableController> tcOpt =
                embedded.managerFactory().tableManager().getController(tableId);
        if (tcOpt.isEmpty()) {
            throw new WebApiException(404, "TABLE_NOT_FOUND", "Table not found.");
        }
        Table table = tcOpt.get().getTable();
        if (table == null || table.getSeats() == null) {
            throw new WebApiException(409, "TABLE_NOT_EDITABLE",
                    "Table is not in a state where ready can be toggled.");
        }
        requireNotTournament(table);
        // Verify the caller actually has a seat at this table —
        // otherwise the tracker would happily store a username with no
        // corresponding seat, and the start gate could be bypassed by
        // a non-seated user toggling on someone else's behalf. Note
        // upstream {@code Table.getSeats()} returns a Seat[] (not a
        // Collection); plain for-loop avoids a {@code Arrays.stream}
        // allocation per call.
        boolean seated = false;
        for (var s : table.getSeats()) {
            if (s != null && s.getPlayer() != null
                    && username.equals(s.getPlayer().getName())) {
                seated = true;
                break;
            }
        }
        if (!seated) {
            throw new WebApiException(403, "NOT_SEATED",
                    "Caller does not occupy a seat at this table.");
        }
        readyTracker.setReady(tableId, username, ready);
        LOG.info("Seat ready toggled: table={} room={} user={} ready={}",
                tableId, roomId, username, ready);
        broadcast(tableId);
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
        requireNotTournament(table);
        // Apply the partial update. Each non-null field maps to its
        // upstream setter. Enum-bearing fields parse into their
        // upstream type so an invalid value lands as 400 BAD_REQUEST
        // (via parseEnum) rather than reaching the live game state.
        //
        // Slice L7 review (code-quality HIGH #1) — synchronize the
        // mutate-block on the upstream TableController. The same
        // monitor is used by TableController.joinTable and other
        // mutating paths, so taking it serializes our setter cascade
        // against concurrent joins / leaves / starts and prevents
        // half-applied option states.
        MatchOptions options = table.getMatch().getOptions();
        WebTable result;
        synchronized (tc) {
        if (update.password() != null) {
            // Slice L7 review (security-CRITICAL #2) — cap password
            // length so a host can't churn megabyte passwords as a
            // GC-pressure amplifier. 64 is well above any real
            // password.
            if (update.password().length() > MAX_PASSWORD_LEN) {
                throw new WebApiException(400, "BAD_REQUEST",
                        "password must be at most " + MAX_PASSWORD_LEN + " chars.");
            }
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
        // Slice L8 review (code-quality HIGH #3) — extend the
        // synchronized block to cover the {@link TableView}
        // construction. The earlier draft exited the lock before
        // {@code new TableView(table)} ran, opening a torn-read window
        // where a concurrent join could land between our setter
        // cascade and the view-rebuild and the broadcast would ship
        // an inconsistent snapshot. Holding the lock through the view
        // construction makes the whole "mutate + snapshot + return"
        // operation atomic relative to other tc-synchronized callers.
        TableView freshView = new TableView(table);
        result = TableMapper.table(freshView,
                embedded.managerFactory().tableManager(),
                readyTracker);
        } // end synchronized (tc)
        // Slice L5 — settings change resets all guests to un-ready.
        // Host stays ready (preserved via resetToHost). Outside the
        // lock — readyTracker has its own internal synchronization
        // and doesn't share state with TableController's monitor.
        String hostUsername = TableMapper.cleanControllerName(table.getControllerName());
        readyTracker.resetToHost(tableId, hostUsername);
        LOG.info("Table options updated: {} (caller={}, ready reset to host)",
                tableId, userId);
        broadcast(tableId);
        return result;
    }

    /**
     * Slice L8 review (security HIGH #2) — reject lobby actions on
     * tournament tables. The new lobby flow (Pre/EditSettingsModal,
     * setSeatReady, swapDeck, startMatch via the new endpoint) was
     * not designed for the tournament state machine; quietly running
     * upstream calls against an {@code isTournament=true} table can
     * leave it in an inconsistent state. Tournament + draft flows
     * stay on the legacy table-list path.
     */
    private void requireNotTournament(Table table) {
        if (table != null && table.isTournament()) {
            throw new WebApiException(409, "WRONG_TABLE_KIND",
                    "Tournament tables are not supported by the new lobby flow.");
        }
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
