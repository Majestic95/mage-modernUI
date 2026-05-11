package mage.webapi.dto;

import java.util.List;

/**
 * Response payload for {@code GET /api/games/mine} — the list of games
 * the authenticated user can rejoin (seated, {@code hasLeft=false}).
 * Empty {@code games} is the common case (most users have no active
 * games at lobby-time); the banner hides itself when the list is empty.
 *
 * <p>Per the REST-endpoint convention (vs. the in-game stream wire),
 * additive endpoints stamp {@link mage.webapi.SchemaVersion#CURRENT}
 * but do not own a versioned migration story — clients parse via Zod
 * with passthrough on unknown fields, and new fields here are an
 * additive (non-breaking) change.
 *
 * @param schemaVersion the current WebApi schema version stamp
 * @param games         zero or more rejoinable games for this user
 */
public record WebMyGamesResponse(
        String schemaVersion,
        List<WebMyGame> games
) {
}
