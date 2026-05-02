package mage.webapi.dto;

import java.util.List;

/**
 * Table descriptor — one game-in-progress or waiting-to-start. The
 * top-level response shape for {@code POST /api/rooms/.../tables}
 * (single create) and a nested element of {@link WebTableListing}.
 *
 * <p>Hand-written translation of upstream {@code mage.view.TableView};
 * computed display strings from upstream are intentionally omitted.
 *
 * <p>Slice L8 review (architecture #4) — added {@code matchTimeLimit},
 * {@code freeMulligans}, {@code mulliganType}, {@code attackOption},
 * {@code range}. These are the same fields {@link WebMatchOptionsUpdate}
 * accepts; without them on the wire the host's Edit Settings modal
 * fell back to {@code DEFAULT_INITIAL} for these fields, silently
 * lying about the table's actual state. Schema stays 1.27 — additive
 * fields are forward-compatible (1.26 clients ignore them).
 *
 * @param tableId            UUID
 * @param tableName          user-facing label
 * @param gameType           e.g. {@code "Two Player Duel"}
 * @param deckType           deck-construction format name
 * @param tableState         enum name (e.g. {@code "WAITING"},
 *     {@code "READY_TO_START"}, {@code "DUELING"}, {@code "FINISHED"})
 * @param createTime         ISO-8601 UTC
 * @param controllerName     creator's username
 * @param skillLevel         enum name ({@code "BEGINNER"},
 *     {@code "CASUAL"}, {@code "SERIOUS"})
 * @param isTournament       false for matches, true for tournament tables
 * @param passworded         a password is required to join
 * @param spectatorsAllowed  watchers permitted
 * @param rated              affects player ratings
 * @param limited            draft / sealed / cube format
 * @param seats              ordered seat list; same length as
 *     {@code MatchOptions.numSeats}
 * @param matchTimeLimit     enum name ({@code "NONE"}, {@code "MIN_5"},
 *     {@code "MIN_10"}, ..., {@code "MIN_120"})
 * @param freeMulligans      0..5
 * @param mulliganType       enum name ({@code "GAME_DEFAULT"},
 *     {@code "LONDON"}, {@code "SMOOTHED_LONDON"}, {@code "VANCOUVER"},
 *     {@code "PARIS"}, {@code "CANADIAN_HIGHLANDER"})
 * @param attackOption       enum name ({@code "LEFT"}, {@code "RIGHT"},
 *     {@code "MULTIPLE"})
 * @param range              enum name ({@code "ALL"}, {@code "ONE"},
 *     {@code "TWO"})
 */
public record WebTable(
        String tableId,
        String tableName,
        String gameType,
        String deckType,
        String tableState,
        String createTime,
        String controllerName,
        String skillLevel,
        boolean isTournament,
        boolean passworded,
        boolean spectatorsAllowed,
        boolean rated,
        boolean limited,
        List<WebSeat> seats,
        String matchTimeLimit,
        int freeMulligans,
        String mulliganType,
        String attackOption,
        String range
) {
}
