package mage.webapi.mapper;

import mage.cards.Card;
import mage.cards.decks.Deck;
import mage.game.Table;
import mage.game.match.Match;
import mage.game.match.MatchPlayer;
import mage.players.PlayerType;
import mage.server.managers.TableManager;
import mage.view.SeatView;
import mage.view.TableView;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.WebSeat;
import mage.webapi.dto.WebTable;
import mage.webapi.dto.WebTableListing;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Translates upstream {@link TableView} / {@link SeatView} into our
 * public {@link WebTable} / {@link WebSeat} DTOs. Hand-written; the
 * upstream types stop here.
 *
 * <p>Computed display strings on {@link TableView}
 * ({@code additionalInfoShort/Full}, {@code seatsInfo},
 * {@code tableStateText}) are intentionally not exposed — clients
 * derive their own UI strings from structured fields.
 *
 * <p>Slice 70-X (user direction 2026-04-30) — to surface each
 * seat's commander identity in the lobby table list (before the
 * game starts), the mapper now accepts an optional upstream
 * {@link TableManager}. Per seat we look up the seat's
 * {@link MatchPlayer}, read its {@link Deck#getSideboard() sideboard},
 * and pull the first card's name + cardNumber. For Commander format
 * decks the sideboard is where the commander lives pre-game; for
 * non-Commander formats the sideboard is empty / unrelated and the
 * fields default to {@code ""} / {@code 0}. {@code TableManager}
 * being {@code null} is also tolerated (e.g. tests that don't wire
 * the manager) — falls back to "no commander info" silently.
 */
public final class TableMapper {

    private TableMapper() {
    }

    public static WebTableListing listing(List<TableView> views) {
        return listing(views, null);
    }

    public static WebTableListing listing(List<TableView> views, TableManager tableManager) {
        List<WebTable> tables = views.stream()
                .map((TableView v) -> table(v, tableManager))
                .toList();
        return new WebTableListing(SchemaVersion.CURRENT, tables);
    }

    public static WebTable table(TableView v) {
        return table(v, null);
    }

    public static WebTable table(TableView v, TableManager tableManager) {
        Objects.requireNonNull(v, "TableView is null");
        Match match = lookupMatch(v.getTableId(), tableManager);
        return new WebTable(
                v.getTableId().toString(),
                emptyIfNull(v.getTableName()),
                emptyIfNull(v.getGameType()),
                emptyIfNull(v.getDeckType()),
                v.getTableState() == null ? "" : v.getTableState().name(),
                isoOrEmpty(v.getCreateTime()),
                cleanControllerName(v.getControllerName()),
                v.getSkillLevel() == null ? "" : v.getSkillLevel().name(),
                v.isTournament(),
                v.isPassworded(),
                v.getSpectatorsAllowed(),
                v.isRated(),
                v.isLimited(),
                v.getSeats() == null ? List.of()
                        : v.getSeats().stream().map(s -> seat(s, match)).toList()
        );
    }

    /**
     * Upstream's {@link TableView} constructor mutates
     * {@code controllerName} to {@code "<controller>, <opp1>, <opp2>"}
     * for the Swing client's table-list rendering (see TableView.java
     * L86-100). The webclient gets seat names separately via the
     * {@code seats} array, so we strip the suffix and expose just the
     * controller's username — that's what client code needs to compare
     * against {@code session.username} when deciding whether to show
     * a Start button.
     */
    static String cleanControllerName(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        int comma = raw.indexOf(", ");
        return comma >= 0 ? raw.substring(0, comma) : raw;
    }

    private static WebSeat seat(SeatView s, Match match) {
        if (s == null) {
            return new WebSeat("", "", false, "", 0);
        }
        boolean occupied = s.getPlayerId() != null;
        PlayerType type = s.getPlayerType();
        // Look up the seated player's deck via the upstream Match.
        // Only populated when:
        //   - the seat is occupied (playerId non-null),
        //   - tableManager was supplied (production path; tests may
        //     skip this and the fields stay empty),
        //   - the player has a registered deck on the match,
        //   - that deck's sideboard has at least one card (Commander
        //     format convention; non-Commander formats land here too
        //     but with empty sideboards → empty commander fields,
        //     which is the correct "no commander to preview" state).
        String commanderName = "";
        int commanderImageNumber = 0;
        if (occupied && match != null) {
            MatchPlayer mp = match.getPlayer(s.getPlayerId());
            if (mp != null && mp.getDeck() != null) {
                Card commander = firstSideboardCard(mp.getDeck());
                if (commander != null) {
                    commanderName = emptyIfNull(commander.getName());
                    commanderImageNumber = parseCardNumber(commander.getCardNumber());
                }
            }
        }
        return new WebSeat(
                emptyIfNull(s.getPlayerName()),
                type == null ? "" : type.name(),
                occupied,
                commanderName,
                commanderImageNumber
        );
    }

    private static Match lookupMatch(UUID tableId, TableManager tableManager) {
        if (tableId == null || tableManager == null) {
            return null;
        }
        try {
            Table table = tableManager.getTable(tableId);
            return table == null ? null : table.getMatch();
        } catch (Exception ignored) {
            // Defensive: any upstream failure during table lookup
            // shouldn't break the lobby listing. Return null and the
            // seat falls back to "no commander info."
            return null;
        }
    }

    static Card firstSideboardCard(Deck deck) {
        if (deck == null || deck.getSideboard() == null || deck.getSideboard().isEmpty()) {
            return null;
        }
        return deck.getSideboard().iterator().next();
    }

    static int parseCardNumber(String s) {
        if (s == null || s.isBlank()) {
            return 0;
        }
        try {
            // Card numbers can have suffixes like "281a" — strip non-digit
            // suffix and parse the leading numeric portion. If the entire
            // value is non-numeric (e.g. "Hb"), fall back to 0.
            int end = 0;
            while (end < s.length() && Character.isDigit(s.charAt(end))) {
                end++;
            }
            return end == 0 ? 0 : Integer.parseInt(s.substring(0, end));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private static String isoOrEmpty(Date d) {
        return d == null ? "" : Instant.ofEpochMilli(d.getTime()).toString();
    }

    private static String emptyIfNull(String s) {
        return s == null ? "" : s;
    }
}
