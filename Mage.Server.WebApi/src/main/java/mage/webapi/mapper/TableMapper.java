package mage.webapi.mapper;

import mage.players.PlayerType;
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

/**
 * Translates upstream {@link TableView} / {@link SeatView} into our
 * public {@link WebTable} / {@link WebSeat} DTOs. Hand-written; the
 * upstream types stop here.
 *
 * <p>Computed display strings on {@link TableView}
 * ({@code additionalInfoShort/Full}, {@code seatsInfo},
 * {@code tableStateText}) are intentionally not exposed — clients
 * derive their own UI strings from structured fields.
 */
public final class TableMapper {

    private TableMapper() {
    }

    public static WebTableListing listing(List<TableView> views) {
        List<WebTable> tables = views.stream().map(TableMapper::table).toList();
        return new WebTableListing(SchemaVersion.CURRENT, tables);
    }

    public static WebTable table(TableView v) {
        Objects.requireNonNull(v, "TableView is null");
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
                        : v.getSeats().stream().map(TableMapper::seat).toList()
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

    private static WebSeat seat(SeatView s) {
        if (s == null) {
            return new WebSeat("", "", false);
        }
        boolean occupied = s.getPlayerId() != null;
        PlayerType type = s.getPlayerType();
        return new WebSeat(
                emptyIfNull(s.getPlayerName()),
                type == null ? "" : type.name(),
                occupied
        );
    }

    private static String isoOrEmpty(Date d) {
        return d == null ? "" : Instant.ofEpochMilli(d.getTime()).toString();
    }

    private static String emptyIfNull(String s) {
        return s == null ? "" : s;
    }
}
