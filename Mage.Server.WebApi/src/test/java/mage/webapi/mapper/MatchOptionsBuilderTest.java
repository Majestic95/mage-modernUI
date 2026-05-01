package mage.webapi.mapper;

import mage.constants.MatchTimeLimit;
import mage.constants.MultiplayerAttackOption;
import mage.constants.RangeOfInfluence;
import mage.constants.SkillLevel;
import mage.game.match.MatchOptions;
import mage.game.mulligan.MulliganType;
import mage.players.PlayerType;
import mage.webapi.WebApiException;
import mage.webapi.dto.WebCreateTableRequest;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Slice 70-X.13 (Wave 2) — locks {@link MatchOptionsBuilder#build}
 * contract. Pre-Wave-2 the builder had no test file at all; the only
 * coverage came indirectly via the {@code WebApiServerTest} HTTP path
 * which doesn't pin the seat-construction edge cases.
 *
 * <p>Wave-1 hardening (see slice 70-X.13 commit) replaced the
 * {@code getPlayerTypes().add(...)} mutation with a build-local
 * {@code List<PlayerType>} + {@code clear()}+{@code addAll()}, and
 * added a {@link MatchOptionsBuilder#MAX_SEATS} cap. These tests pin
 * both the new and the previously-unverified behavior.
 */
class MatchOptionsBuilderTest {

    private static WebCreateTableRequest req(List<String> seats) {
        return new WebCreateTableRequest(
                "Two Player Duel", "Limited", 1,
                null, null, null, null,
                null, null, null, null, null, null,
                seats);
    }

    private static WebCreateTableRequest req(
            String gameType, String deckType, Integer winsNeeded) {
        return new WebCreateTableRequest(
                gameType, deckType, winsNeeded,
                null, null, null, null,
                null, null, null, null, null, null,
                null);
    }

    @Test
    void build_nullRequest_throws400() {
        WebApiException ex = assertThrows(WebApiException.class,
                () -> MatchOptionsBuilder.build(null, "default"));
        assertEquals(400, ex.status());
    }

    @Test
    void build_missingGameType_throws400() {
        WebApiException ex = assertThrows(WebApiException.class,
                () -> MatchOptionsBuilder.build(req(null, "Limited", 1), "default"));
        assertEquals(400, ex.status());
    }

    @Test
    void build_missingDeckType_throws400() {
        WebApiException ex = assertThrows(WebApiException.class,
                () -> MatchOptionsBuilder.build(req("Two Player Duel", null, 1), "default"));
        assertEquals(400, ex.status());
    }

    @Test
    void build_zeroWins_throws400() {
        WebApiException ex = assertThrows(WebApiException.class,
                () -> MatchOptionsBuilder.build(req("Two Player Duel", "Limited", 0), "default"));
        assertEquals(400, ex.status());
    }

    @Test
    void build_nullSeats_defaultsToTwoHumans() {
        MatchOptions o = MatchOptionsBuilder.build(req(null), "default");
        assertEquals(List.of(PlayerType.HUMAN, PlayerType.HUMAN), o.getPlayerTypes());
    }

    @Test
    void build_emptySeats_defaultsToTwoHumans() {
        MatchOptions o = MatchOptionsBuilder.build(req(List.of()), "default");
        assertEquals(List.of(PlayerType.HUMAN, PlayerType.HUMAN), o.getPlayerTypes());
    }

    @Test
    void build_explicitHumanComputerMix_preservesOrder() {
        MatchOptions o = MatchOptionsBuilder.build(
                req(List.of("HUMAN", "COMPUTER_MONTE_CARLO")), "default");
        assertEquals(
                List.of(PlayerType.HUMAN, PlayerType.COMPUTER_MONTE_CARLO),
                o.getPlayerTypes());
    }

    @Test
    void build_blankSeat_throws400() {
        WebApiException ex = assertThrows(WebApiException.class,
                () -> MatchOptionsBuilder.build(req(List.of("HUMAN", "  ")), "default"));
        assertEquals(400, ex.status());
    }

    @Test
    void build_unknownEnumSeat_throws400() {
        WebApiException ex = assertThrows(WebApiException.class,
                () -> MatchOptionsBuilder.build(
                        req(List.of("HUMAN", "ROBOTIC_OVERLORD")), "default"));
        assertEquals(400, ex.status());
    }

    @Test
    void build_seatsOverMax_throws400() {
        // Slice 70-X.13 cap — defends against pathological allocations.
        List<String> oversized = new java.util.ArrayList<>();
        for (int i = 0; i < MatchOptionsBuilder.MAX_SEATS + 1; i++) {
            oversized.add("HUMAN");
        }
        WebApiException ex = assertThrows(WebApiException.class,
                () -> MatchOptionsBuilder.build(req(oversized), "default"));
        assertEquals(400, ex.status());
    }

    @Test
    void build_seatsAtMax_isAllowed() {
        List<String> exactlyMax = new java.util.ArrayList<>();
        for (int i = 0; i < MatchOptionsBuilder.MAX_SEATS; i++) {
            exactlyMax.add("HUMAN");
        }
        MatchOptions o = MatchOptionsBuilder.build(req(exactlyMax), "default");
        assertEquals(MatchOptionsBuilder.MAX_SEATS, o.getPlayerTypes().size());
    }

    @Test
    void build_blankTableName_fallsBackToDefault() {
        WebCreateTableRequest r = new WebCreateTableRequest(
                "Two Player Duel", "Limited", 1,
                "  ", null, null, null, null, null,
                null, null, null, null, null);
        MatchOptions o = MatchOptionsBuilder.build(r, "fallback-name");
        assertEquals("fallback-name", o.getName());
    }

    @Test
    void build_defaultsForOptionalEnums_areSet() {
        MatchOptions o = MatchOptionsBuilder.build(req(null), "default");
        assertEquals(SkillLevel.CASUAL, o.getSkillLevel());
        assertEquals(MatchTimeLimit.NONE, o.getMatchTimeLimit());
        assertEquals(MulliganType.GAME_DEFAULT, o.getMulliganType());
        assertEquals(MultiplayerAttackOption.LEFT, o.getAttackOption());
        assertEquals(RangeOfInfluence.ALL, o.getRange());
        assertEquals(true, o.isSpectatorsAllowed());
        assertEquals(false, o.isRated());
        assertEquals(0, o.getFreeMulligans());
    }

    @Test
    void build_unknownSkillLevel_throws400() {
        WebCreateTableRequest r = new WebCreateTableRequest(
                "Two Player Duel", "Limited", 1,
                null, null, "GODLIKE", null, null, null,
                null, null, null, null, null);
        WebApiException ex = assertThrows(WebApiException.class,
                () -> MatchOptionsBuilder.build(r, "default"));
        assertEquals(400, ex.status());
    }
}
