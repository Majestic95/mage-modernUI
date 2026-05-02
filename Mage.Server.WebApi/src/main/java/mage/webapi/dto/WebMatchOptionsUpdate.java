package mage.webapi.dto;

/**
 * Request body for {@code PATCH /api/rooms/{roomId}/tables/{tableId}}.
 * Slice L3 (new-lobby-window) — host-only edit of the table's editable
 * {@link mage.game.match.MatchOptions} subset.
 *
 * <p>Every field is nullable / boxed; the server treats {@code null}
 * as "no change for this field" so the client can send a sparse
 * update. Format ({@code deckType}), mode ({@code gameType}), and
 * win count ({@code winsNeeded}) are NOT in this DTO — they are
 * locked at table creation per the design doc (changing them
 * invalidates submitted decks / reshapes the seat layout).
 *
 * <p>Player count change + AI seat add/remove are handled via the
 * existing seat endpoints ({@code POST /ai}, {@code DELETE /seat})
 * rather than through this PATCH; they are structural operations
 * not pure option mutations.
 *
 * @param password           string; empty unsets the password
 * @param skillLevel         upstream {@code SkillLevel} enum name
 *     (BEGINNER / CASUAL / SERIOUS)
 * @param matchTimeLimit     upstream {@code MatchTimeLimit} enum name
 *     (NONE / MIN_5 / MIN_10 / ... / MIN_120)
 * @param freeMulligans      0..5
 * @param mulliganType       upstream {@code MulliganType} enum name
 *     (GAME_DEFAULT / LONDON / SMOOTHED_LONDON / VANCOUVER / PARIS /
 *     CANADIAN_HIGHLANDER)
 * @param spectatorsAllowed  whether spectators can join
 * @param rated              whether the match counts toward ratings
 * @param attackOption       upstream {@code MultiplayerAttackOption}
 *     enum name (LEFT / RIGHT / MULTIPLE) — host can change even on
 *     game types where the option is non-default; client gates UI by
 *     {@link WebGameType#useAttackOption}
 * @param range              upstream {@code RangeOfInfluence} enum
 *     name (ALL / ONE / TWO) — same gating rule as attackOption
 */
public record WebMatchOptionsUpdate(
        String password,
        String skillLevel,
        String matchTimeLimit,
        Integer freeMulligans,
        String mulliganType,
        Boolean spectatorsAllowed,
        Boolean rated,
        String attackOption,
        String range
) {
}
