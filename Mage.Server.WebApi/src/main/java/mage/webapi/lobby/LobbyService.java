package mage.webapi.lobby;

import mage.MageException;
import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.repository.CardInfo;
import mage.cards.repository.CardRepository;
import mage.game.match.MatchOptions;
import mage.players.PlayerType;
import mage.view.TableView;
import mage.webapi.WebApiException;
import mage.webapi.dto.WebRoomRef;
import mage.webapi.dto.WebTable;
import mage.webapi.dto.WebTableListing;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.mapper.TableMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Orchestrates lobby + table calls against the embedded server (ADR
 * 0006). Each public method maps to one upstream {@code MageServerImpl}
 * call plus translation. Routes call this; this calls upstream.
 */
public final class LobbyService {

    private static final Logger LOG = LoggerFactory.getLogger(LobbyService.class);

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
            return TableMapper.listing(views == null ? List.of() : views);
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
            return TableMapper.table(view);
        } catch (MageException ex) {
            throw upstream("creating table", ex);
        }
    }

    public void joinTable(String upstreamSessionId, UUID roomId, UUID tableId,
                          String name, int skill, DeckCardLists deck, String password) {
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
            throw new WebApiException(422, "UPSTREAM_REJECTED",
                    "Server rejected the join (illegal deck, wrong password, table full, etc.).");
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
        DeckCardLists fallbackDeck = buildFallbackBasicLandsDeck();
        boolean ok;
        try {
            ok = embedded.server().roomJoinTable(
                    upstreamSessionId, roomId, tableId,
                    aiType.toString(), aiType, /* skill */ 1, fallbackDeck, /* password */ ""
            );
        } catch (MageException ex) {
            throw upstream("adding AI", ex);
        }
        if (!ok) {
            throw new WebApiException(422, "UPSTREAM_REJECTED",
                    "Server rejected the AI seat (table full, AI cap reached, etc.).");
        }
    }

    private DeckCardLists buildFallbackBasicLandsDeck() {
        CardInfo forest = CardRepository.instance.findCard("Forest");
        if (forest == null) {
            throw new WebApiException(500, "UPSTREAM_ERROR",
                    "Card DB has no Forest — cannot build AI fallback deck.");
        }
        DeckCardLists deck = new DeckCardLists();
        deck.setName("AI Fallback Deck");
        deck.setAuthor("server");
        List<DeckCardInfo> cards = new ArrayList<>();
        cards.add(new DeckCardInfo("Forest", forest.getCardNumber(), forest.getSetCode(), 60));
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
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

    private WebApiException upstream(String action, Exception cause) {
        return new WebApiException(500, "UPSTREAM_ERROR",
                "Upstream error while " + action + ": " + cause.getMessage());
    }
}
