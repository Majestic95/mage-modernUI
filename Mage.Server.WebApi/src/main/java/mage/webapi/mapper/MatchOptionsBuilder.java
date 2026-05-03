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

    /**
     * Slice L8 review (security CRITICAL #1) — caps on user-supplied
     * strings at table-create time. The L7 fix added a 64-char password
     * cap to {@code LobbyService.updateMatchOptions} (PATCH path) but
     * left the create path uncapped. A guest could POST a multi-megabyte
     * password and pin the resulting MatchOptions in memory until the
     * table was reaped. 64 chars is well above any real password.
     * 80 chars is the same tableName cap that was declared in
     * LobbyService but never enforced.
     */
    public static final int MAX_PASSWORD_LEN = 64;
    public static final int MAX_TABLE_NAME_LEN = 80;

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
        if (tableName.length() > MAX_TABLE_NAME_LEN) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "tableName must be at most " + MAX_TABLE_NAME_LEN + " chars.");
        }
        String password = nullToEmpty(req.password());
        if (password.length() > MAX_PASSWORD_LEN) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "password must be at most " + MAX_PASSWORD_LEN + " chars.");
        }

        MatchOptions options = new MatchOptions(tableName, req.gameType(), /* multiPlayer */ false);
        options.setDeckType(req.deckType());
        options.setWinsNeeded(req.winsNeeded());
        options.setPassword(password);
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
        // Audit fix — MatchOptions.quitRatio defaults to 0 (java int
        // default). The MageServerImpl create-table check rejects when
        // quitRatio < user.getMatchQuitRatio(); a user with ANY non-
        // zero historical quit ratio (single concede in a prior game,
        // network drop, etc.) gets blocked from creating a table with
        // "incompatible quit ratio". The new lobby has no UI to set
        // this — default to 100 (allow all). Same default for minimum
        // rating + minimum age so neither blocks playtest accounts.
        options.setQuitRatio(100);
        options.setMinimumRating(0);

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
