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
import mage.webapi.lobby.SeatReadyTracker;

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
        return listing(views, null, null, null);
    }

    public static WebTableListing listing(List<TableView> views, TableManager tableManager) {
        return listing(views, tableManager, null, null);
    }

    public static WebTableListing listing(List<TableView> views,
                                           TableManager tableManager,
                                           SeatReadyTracker readyTracker) {
        return listing(views, tableManager, readyTracker, null);
    }

    /**
     * Slice L8 review (security HIGH #1) — viewer-aware overload.
     * When {@code viewerUsername} is non-null, per-table seat info
     * (deckName, commanderName, deck stats) is redacted for any table
     * where the viewer is not seated AND the table is passworded.
     * Without this, GET /tables leaks pre-game commander identity
     * + deck names of passworded-table seats to anyone authed.
     */
    public static WebTableListing listing(List<TableView> views,
                                           TableManager tableManager,
                                           SeatReadyTracker readyTracker,
                                           String viewerUsername) {
        List<WebTable> tables = views.stream()
                .map((TableView v) -> table(v, tableManager, readyTracker, viewerUsername))
                .toList();
        return new WebTableListing(SchemaVersion.CURRENT, tables);
    }

    public static WebTable table(TableView v) {
        return table(v, null, null, null);
    }

    public static WebTable table(TableView v, TableManager tableManager) {
        return table(v, tableManager, null, null);
    }

    public static WebTable table(TableView v,
                                  TableManager tableManager,
                                  SeatReadyTracker readyTracker) {
        return table(v, tableManager, readyTracker, null);
    }

    public static WebTable table(TableView v,
                                  TableManager tableManager,
                                  SeatReadyTracker readyTracker,
                                  String viewerUsername) {
        Objects.requireNonNull(v, "TableView is null");
        Match match = lookupMatch(v.getTableId(), tableManager);
        String deckType = emptyIfNull(v.getDeckType());
        int deckSizeRequired = requiredMainboardSize(deckType);
        // Slice L5 — host needs to be identified per-seat to drive the
        // "host is implicitly ready" rule in seat(). cleanControllerName
        // is idempotent; if the upstream string is already stripped
        // (which it is post-slice 70-X.13) it's a no-op.
        String hostUsername = cleanControllerName(v.getControllerName());
        UUID tableId = v.getTableId();
        // Slice L8 — read MatchOptions for the round-trip-only fields.
        // Null-safe: if match is null (rare race against table removal)
        // the new fields land as defaults so EditSettings still
        // renders without crashing.
        String matchTimeLimit = "";
        int freeMulligans = 0;
        String mulliganType = "";
        String attackOption = "";
        String range = "";
        if (match != null && match.getOptions() != null) {
            var opts = match.getOptions();
            matchTimeLimit = opts.getMatchTimeLimit() == null
                    ? "" : opts.getMatchTimeLimit().name();
            freeMulligans = opts.getFreeMulligans();
            mulliganType = opts.getMulliganType() == null
                    ? "" : opts.getMulliganType().name();
            attackOption = opts.getAttackOption() == null
                    ? "" : opts.getAttackOption().name();
            range = opts.getRange() == null
                    ? "" : opts.getRange().name();
        }
        // Slice L8 review (security HIGH #1) — visibility filter on
        // seat-level deck/commander info for passworded tables. If the
        // viewer is not seated at this table AND the table is
        // passworded, redact the per-seat deck info before emitting.
        // Empty viewerUsername (e.g. internal server-to-server call)
        // skips the filter — only externally-driven callers pass a
        // viewer.
        boolean isPassworded = v.isPassworded();
        boolean redactSeats = isPassworded
                && viewerUsername != null && !viewerUsername.isBlank()
                && !viewerSeated(v.getSeats(), viewerUsername);
        List<WebSeat> seats;
        if (v.getSeats() == null) {
            seats = List.of();
        } else {
            seats = v.getSeats().stream()
                    .map(s -> {
                        WebSeat full = seat(s, match, deckSizeRequired,
                                readyTracker, tableId, hostUsername);
                        return redactSeats ? redact(full) : full;
                    })
                    .toList();
        }
        return new WebTable(
                tableId.toString(),
                emptyIfNull(v.getTableName()),
                emptyIfNull(v.getGameType()),
                deckType,
                v.getTableState() == null ? "" : v.getTableState().name(),
                isoOrEmpty(v.getCreateTime()),
                hostUsername,
                v.getSkillLevel() == null ? "" : v.getSkillLevel().name(),
                v.isTournament(),
                isPassworded,
                v.getSpectatorsAllowed(),
                v.isRated(),
                v.isLimited(),
                seats,
                matchTimeLimit,
                freeMulligans,
                mulliganType,
                attackOption,
                range
        );
    }

    /**
     * Slice L8 review — strip deck / commander info from a seat for
     * the visibility filter on passworded tables. Player name +
     * occupancy + ready state stay visible (so the table list still
     * reads "alice / open / open / open"); the deck-builder details
     * are scrubbed.
     */
    private static WebSeat redact(WebSeat full) {
        if (full == null) return null;
        return new WebSeat(
                full.playerName(),
                full.playerType(),
                full.occupied(),
                "",   // commanderName redacted
                0,    // commanderImageNumber redacted
                full.ready(),
                "",   // deckName redacted
                0,    // deckSize redacted
                full.deckSizeRequired()
        );
    }

    /**
     * Slice L8 review — viewer-seat check for the redaction gate.
     * Mirrors the client's normalize-and-compare so a casing/
     * whitespace mismatch on a username doesn't trigger inadvertent
     * redaction for a legitimately seated viewer.
     */
    private static boolean viewerSeated(List<? extends mage.view.SeatView> seats,
                                          String viewerUsername) {
        if (seats == null) return false;
        String norm = viewerUsername.trim().toLowerCase();
        if (norm.isEmpty()) return false;
        for (var s : seats) {
            if (s == null) continue;
            String name = s.getPlayerName();
            if (name == null) continue;
            if (norm.equals(name.trim().toLowerCase())) return true;
        }
        return false;
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
    public static String cleanControllerName(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        int comma = raw.indexOf(", ");
        return comma >= 0 ? raw.substring(0, comma) : raw;
    }

    private static WebSeat seat(SeatView s,
                                 Match match,
                                 int deckSizeRequired,
                                 SeatReadyTracker readyTracker,
                                 UUID tableId,
                                 String hostUsername) {
        if (s == null) {
            return new WebSeat("", "", false, "", 0, false, "", 0, deckSizeRequired);
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
        //
        // Slice 70-X.13 (Wave 3) — defensive try/catch around the
        // deck read. {@code MatchPlayer.getDeck()} and
        // {@code Deck.getSideboard()} return live engine-owned
        // collections. The lobby HTTP path iterates these from a
        // Javalin worker thread while the engine may be mutating them
        // (e.g. sideboarding window between games of a match). Even
        // the {@code .iterator().next()} in firstSideboardCard can
        // throw {@link ConcurrentModificationException} or surface a
        // half-mutated Card. Pre-game the risk is low (deck built
        // once); between games it's real. On any RuntimeException we
        // fall back to the "no commander info" state — better than a
        // 500 on the lobby listing endpoint that hangs the table list
        // for everyone.
        //
        // Slice L2 — same defensive pattern extended to deck name +
        // mainboard size; both read live engine state, so a failure
        // shouldn't break the lobby listing.
        String commanderName = "";
        int commanderImageNumber = 0;
        String deckName = "";
        int deckSize = 0;
        if (occupied && match != null) {
            try {
                MatchPlayer mp = match.getPlayer(s.getPlayerId());
                if (mp != null && mp.getDeck() != null) {
                    Deck deck = mp.getDeck();
                    deckName = emptyIfNull(deck.getName());
                    deckSize = deck.getCards() == null ? 0 : deck.getCards().size();
                    Card commander = firstSideboardCard(deck);
                    if (commander != null) {
                        commanderName = emptyIfNull(commander.getName());
                        commanderImageNumber =
                                parseCardNumber(commander.getCardNumber());
                    }
                }
            } catch (RuntimeException ex) {
                // Defensive — fall back to empty commander preview;
                // the seat itself is still rendered.
                commanderName = "";
                commanderImageNumber = 0;
                deckName = "";
                deckSize = 0;
            }
        }
        // Slice L5 — per-seat ready state:
        //   - Empty seat: false
        //   - AI seat: always true (auto-ready on join, no toggle)
        //   - Host's HUMAN seat: always true (host is implicitly ready;
        //     they hit Start when guests are ready)
        //   - Guest's HUMAN seat: tracker-backed (default false until
        //     they POST /seat/ready)
        boolean ready;
        String seatPlayerName = emptyIfNull(s.getPlayerName());
        if (!occupied || type == null) {
            ready = false;
        } else if (type != PlayerType.HUMAN) {
            ready = true;
        } else if (hostUsername != null && !hostUsername.isBlank()
                && hostUsername.equals(seatPlayerName)) {
            ready = true;
        } else if (readyTracker != null && tableId != null) {
            ready = readyTracker.isReady(tableId, seatPlayerName);
        } else {
            // No tracker available (e.g. tests using the legacy
            // listing(views, tableManager) overload). Fall back to
            // the L2 behavior: HUMAN guests are un-ready by default.
            ready = false;
        }
        return new WebSeat(
                seatPlayerName,
                type == null ? "" : type.name(),
                occupied,
                commanderName,
                commanderImageNumber,
                ready,
                deckName,
                deckSize,
                deckSizeRequired
        );
    }

    /**
     * Slice L2 — derive the format's required mainboard size from
     * the upstream deck-type string. {@code DeckType} names follow
     * the convention {@code "<Family> - <Variant>"} where Family is
     * "Constructed", "Commander", "Limited", etc. Heuristic match —
     * if a future format introduces a non-{60,100,40} size, this
     * method needs an extension; the lobby's deck plate validation
     * then surfaces the wrong "required" target.
     *
     * <p>{@code 0} means "unknown" — the lobby renders just the
     * mainboard size without a "/{required}" suffix.
     */
    static int requiredMainboardSize(String deckType) {
        if (deckType == null || deckType.isBlank()) {
            return 0;
        }
        String s = deckType.toLowerCase();
        if (s.contains("commander")) {
            return 100;
        }
        // Check constructed-family BEFORE limited so "Constructed -
        // Freeform Unlimited" classifies as constructed (60) rather
        // than tripping the "limited" substring inside "unlimited".
        if (s.contains("constructed")
                || s.contains("standard")
                || s.contains("modern")
                || s.contains("legacy")
                || s.contains("vintage")
                || s.contains("pauper")
                || s.contains("freeform")) {
            return 60;
        }
        if (s.contains("limited") || s.contains("draft") || s.contains("sealed")) {
            return 40;
        }
        return 0;
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
