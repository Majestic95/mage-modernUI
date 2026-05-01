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

    /**
     * Slice 70-X.13 — defensive cap on seat count. Upstream's
     * {@code TableManager.createTable} probably rejects oversized
     * tables eventually, but without an explicit cap here a request
     * for {@code seats: ["HUMAN"] * 10000} would build a 10k-element
     * {@code List<PlayerType>} (and the same-size mirrors in
     * upstream's table state) before the rejection lands. 20 is well
     * above any real game size (4-8 player FFA is the practical
     * ceiling).
     */
    public static final int MAX_SEATS = 20;

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
        //
        // Slice 70-X.13 — cap seat count and parse seats into a local
        // list BEFORE touching upstream's internal collection. The
        // earlier shape called {@code options.getPlayerTypes().add(...)}
        // directly, which is load-bearing on two upstream contracts:
        // (a) {@link MatchOptions} ships an empty mutable list (true
        //     today: {@code playerTypes = new ArrayList<>()});
        // (b) {@code getPlayerTypes()} returns the live internal list,
        //     not an unmodifiable view.
        // If either changes upstream — pre-seeded list, defensive copy,
        // or {@code Collections.unmodifiableList} — seats silently break
        // or throw {@code UnsupportedOperationException}. We can't
        // {@code setPlayerTypes(local)} (no setter exists), so we
        // {@code clear()} the live list first to neutralize (a). If
        // upstream ever wraps the getter in an immutable view, the
        // {@code clear()} fails fast with a useful stack trace at the
        // boundary instead of confused downstream seat-mismatch bugs.
        java.util.List<String> rawSeats = (req.seats() == null || req.seats().isEmpty())
                ? java.util.List.of("HUMAN", "HUMAN")
                : req.seats();
        if (rawSeats.size() > MAX_SEATS) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "seats[] exceeds maximum of " + MAX_SEATS);
        }
        java.util.List<PlayerType> resolved = new java.util.ArrayList<>(rawSeats.size());
        for (int i = 0; i < rawSeats.size(); i++) {
            String raw = rawSeats.get(i);
            if (raw == null || raw.isBlank()) {
                throw new WebApiException(400, "BAD_REQUEST",
                        "seats[" + i + "] is required");
            }
            try {
                resolved.add(Enum.valueOf(PlayerType.class, raw.trim()));
            } catch (IllegalArgumentException ex) {
                throw new WebApiException(400, "BAD_REQUEST",
                        "Unknown seats[" + i + "] PlayerType: " + raw);
            }
        }
        options.getPlayerTypes().clear();
        options.getPlayerTypes().addAll(resolved);

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
