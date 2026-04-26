package mage.webapi.dto;

/**
 * Game-mode descriptor (e.g. "Two Player Duel", "Free For All"). Hand-
 * written translation of upstream {@code mage.view.GameTypeView}; the
 * {@code mage.view} type does not appear in our wire format.
 *
 * <p>Nested DTO — does not carry {@code schemaVersion}; that lives on the
 * top-level response only.
 */
public record WebGameType(
        String name,
        int minPlayers,
        int maxPlayers,
        int numTeams,
        int playersPerTeam,
        boolean useRange,
        boolean useAttackOption
) {
}
