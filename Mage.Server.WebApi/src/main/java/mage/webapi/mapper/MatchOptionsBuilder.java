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

/**
 * Translates {@link WebCreateTableRequest} into upstream
 * {@link MatchOptions}, applying defaults per ADR 0006 D3.
 *
 * <p>Required fields: {@code gameType}, {@code deckType},
 * {@code winsNeeded}. Missing → 400 BAD_REQUEST.
 *
 * <p>Optional enum fields are parsed by name (case-sensitive); unknown
 * values → 400 BAD_REQUEST.
 */
public final class MatchOptionsBuilder {

    private MatchOptionsBuilder() {
    }

    public static MatchOptions build(WebCreateTableRequest req, String defaultTableName) {
        if (req == null) {
            throw new WebApiException(400, "BAD_REQUEST", "Request body is required.");
        }
        requireString(req.gameType(), "gameType");
        requireString(req.deckType(), "deckType");
        if (req.winsNeeded() == null || req.winsNeeded() < 1) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "winsNeeded is required and must be >= 1");
        }

        String tableName = (req.tableName() == null || req.tableName().isBlank())
                ? defaultTableName : req.tableName().trim();

        MatchOptions options = new MatchOptions(tableName, req.gameType(), /* multiPlayer */ false);
        options.setDeckType(req.deckType());
        options.setWinsNeeded(req.winsNeeded());
        options.setPassword(nullToEmpty(req.password()));
        options.setSkillLevel(parseEnum(SkillLevel.class, req.skillLevel(), SkillLevel.CASUAL, "skillLevel"));
        options.setMatchTimeLimit(parseEnum(MatchTimeLimit.class, req.matchTimeLimit(),
                MatchTimeLimit.NONE, "matchTimeLimit"));
        options.setSpectatorsAllowed(boolOr(req.spectatorsAllowed(), true));
        options.setRated(boolOr(req.rated(), false));
        options.setFreeMulligans(req.freeMulligans() == null ? 0 : req.freeMulligans());
        options.setMullgianType(parseEnum(MulliganType.class, req.mulliganType(),
                MulliganType.GAME_DEFAULT, "mulliganType"));
        options.setAttackOption(parseEnum(MultiplayerAttackOption.class, req.attackOption(),
                MultiplayerAttackOption.LEFT, "attackOption"));
        options.setRange(parseEnum(RangeOfInfluence.class, req.range(),
                RangeOfInfluence.ALL, "range"));

        // Per-seat playerType composition. Defaults to [HUMAN, HUMAN] —
        // a 1v1 table. Clients declaring AI opponents must list them
        // upfront, e.g. ["HUMAN", "COMPUTER_MONTE_CARLO"], because
        // upstream's getNextAvailableSeat(playerType) filters by the
        // declared type. AI seats then fill via POST /tables/{id}/ai.
        java.util.List<String> seatTypes = (req.seats() == null || req.seats().isEmpty())
                ? java.util.List.of("HUMAN", "HUMAN")
                : req.seats();
        for (int i = 0; i < seatTypes.size(); i++) {
            String raw = seatTypes.get(i);
            if (raw == null || raw.isBlank()) {
                throw new WebApiException(400, "BAD_REQUEST",
                        "seats[" + i + "] is required");
            }
            try {
                options.getPlayerTypes().add(Enum.valueOf(PlayerType.class, raw.trim()));
            } catch (IllegalArgumentException ex) {
                throw new WebApiException(400, "BAD_REQUEST",
                        "Unknown seats[" + i + "] PlayerType: " + raw);
            }
        }

        return options;
    }

    private static <E extends Enum<E>> E parseEnum(Class<E> type, String raw,
                                                    E defaultValue, String fieldName) {
        if (raw == null || raw.isBlank()) {
            return defaultValue;
        }
        try {
            return Enum.valueOf(type, raw.trim());
        } catch (IllegalArgumentException ex) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "Unknown " + fieldName + ": " + raw);
        }
    }

    private static void requireString(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new WebApiException(400, "BAD_REQUEST",
                    fieldName + " is required");
        }
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    private static boolean boolOr(Boolean value, boolean fallback) {
        return value == null ? fallback : value;
    }
}
