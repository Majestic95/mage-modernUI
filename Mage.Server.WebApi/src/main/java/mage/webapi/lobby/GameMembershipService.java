package mage.webapi.lobby;

import mage.game.Game;
import mage.game.Table;
import mage.players.Player;
import mage.server.Session;
import mage.server.game.GameController;
import mage.webapi.SchemaVersion;
import mage.webapi.auth.SessionEntry;
import mage.webapi.dto.WebMyGame;
import mage.webapi.dto.WebMyGamesResponse;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.upstream.GameLookup;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Enumerates the games a user is rejoinable to — i.e. seated in the
 * engine per the canonical {@link Player#isInGame()} predicate. Powers the lobby's
 * "Rejoin Game" banner so a player who closed the tab, lost network,
 * or otherwise dropped off without conceding can get straight back
 * into the in-progress game.
 *
 * <p><b>Why this exists alongside {@code LobbyService}.</b>
 * {@code LobbyService} is already 950+ LOC. Rather than pile on a
 * cross-concern (game state, not table CRUD) onto that file and push
 * it further past the project's hard cap, this is a peer service with
 * its own focused surface.
 *
 * <p><b>Why {@code !isInGame()} and not just {@code hasLeft()}.</b>
 * The engine's "is this player still in the game" state isn't a single
 * boolean. {@code hasLeft()=true} only fires under the CR 800.4a
 * "leaves the game" path ({@link mage.players.PlayerImpl#leave}) and
 * the pre-start join-punt. It does NOT fire on mid-game concede,
 * response-idle timeout, timer timeout, or "lost the game" effects
 * (life=0 / deck-out / poison / etc.) — those set {@code loses=true}
 * but leave {@code hasLeft()=false}. If we filtered on {@code hasLeft()}
 * alone, dead opponents in a still-running multi-player game would
 * keep advertising the game as rejoinable to themselves, and would
 * stay listed in their pod-mates' opponent rosters indefinitely. The
 * upstream canonical predicate {@link Player#isInGame()} composes
 * {@code !hasQuit() && !hasLost() && !hasWon() && !hasDrew() && !hasLeft()}
 * and is what every other engine call site uses to ask the same
 * question (Player.java line 289 has the upstream TODO explicitly
 * recommending this substitution).
 *
 * <p><b>Reflection caveat.</b> Reads of the upstream {@code Game} and
 * the {@code userPlayerMap} go through {@link GameLookup}, which uses
 * cached reflection because {@code GameController} does not expose
 * public accessors. The fail-mode is "empty list, single WARN" — if
 * upstream renames either field on a future merge, the endpoint
 * silently returns no rejoinable games (no false positives) and the
 * banner stays hidden.
 *
 * <p><b>Thread safety.</b> Walks {@code GameManager.getGameController()},
 * a {@link java.util.concurrent.ConcurrentMap}. Per-game reads of
 * {@code Player.hasLeft()} / {@code Player.getName()} are non-atomic
 * but safe to read concurrently with the engine event loop (same
 * pattern as {@link mage.webapi.auth.AuthService#connectionStateFor}).
 */
public final class GameMembershipService {

    private static final Logger LOG = LoggerFactory.getLogger(GameMembershipService.class);

    private final EmbeddedServer embedded;

    public GameMembershipService(EmbeddedServer embedded) {
        this.embedded = Objects.requireNonNull(embedded, "embedded server is required");
    }

    /**
     * Entry point for the {@code GET /api/games/mine} route. Returns
     * an empty response on every failure path (null session, unresolvable
     * user, reflection poisoned) — the endpoint is read-only and the
     * UX cost of "banner stays hidden" is strictly less than the cost
     * of a 500 on a polled lobby fetch.
     */
    public WebMyGamesResponse listGamesForSession(SessionEntry session) {
        UUID userId = resolveUserId(session);
        if (userId == null) {
            return emptyResponse();
        }
        return listGamesForUser(userId);
    }

    WebMyGamesResponse listGamesForUser(UUID userId) {
        if (userId == null) {
            return emptyResponse();
        }
        Map<UUID, GameController> controllers;
        try {
            controllers = embedded.managerFactory().gameManager().getGameController();
        } catch (RuntimeException ex) {
            LOG.warn("Failed to enumerate GameControllers for /api/games/mine: {}",
                    ex.toString());
            return emptyResponse();
        }
        if (controllers == null || controllers.isEmpty()) {
            return emptyResponse();
        }
        List<WebMyGame> out = new ArrayList<>(controllers.size());
        for (Map.Entry<UUID, GameController> entry : controllers.entrySet()) {
            UUID gameId = entry.getKey();
            GameController controller = entry.getValue();
            if (gameId == null || controller == null) {
                continue;
            }
            buildIfMember(gameId, controller, userId).ifPresent(out::add);
        }
        return new WebMyGamesResponse(SchemaVersion.CURRENT, List.copyOf(out));
    }

    private Optional<WebMyGame> buildIfMember(UUID gameId, GameController controller, UUID userId) {
        Map<UUID, UUID> userPlayerMap = GameLookup
                .findUserPlayerMap(gameId, embedded.managerFactory())
                .orElse(null);
        if (userPlayerMap == null) {
            return Optional.empty();
        }
        UUID myPlayerId = userPlayerMap.get(userId);
        if (myPlayerId == null) {
            return Optional.empty();
        }
        Game game = GameLookup
                .findGame(gameId, embedded.managerFactory())
                .orElse(null);
        if (game == null) {
            return Optional.empty();
        }
        // Player reads run on a thread distinct from the engine event
        // loop. Wrap in try-catch so a transient CME on the players
        // LinkedHashMap (rare but possible during game setup / teardown)
        // fails closed — banner just hides this game for one poll cycle.
        Player me;
        try {
            me = game.getPlayer(myPlayerId);
        } catch (RuntimeException ex) {
            return Optional.empty();
        }
        if (me == null || !me.isInGame()) {
            // !isInGame() covers all of: hasQuit / hasLost / hasWon /
            // hasDrew / hasLeft. See the class-level Javadoc for why we
            // use this composite predicate instead of hasLeft() alone.
            return Optional.empty();
        }
        List<String> opponentNames = collectOpponentNames(game, myPlayerId);
        UUID tableId = controller.getTableId();
        String tableName = resolveTableName(tableId);
        return Optional.of(new WebMyGame(
                gameId.toString(),
                tableId == null ? null : tableId.toString(),
                tableName,
                opponentNames));
    }

    private List<String> collectOpponentNames(Game game, UUID myPlayerId) {
        // Same concurrent-mutation guard as buildIfMember — the players
        // map is a (non-concurrent) LinkedHashMap; a CME during a full
        // walk is rare but real during game setup/teardown windows.
        try {
            Map<UUID, Player> players = game.getPlayers();
            if (players == null || players.isEmpty()) {
                return List.of();
            }
            List<String> names = new ArrayList<>(Math.max(0, players.size() - 1));
            for (Map.Entry<UUID, Player> entry : players.entrySet()) {
                if (myPlayerId.equals(entry.getKey())) {
                    continue;
                }
                Player p = entry.getValue();
                if (p == null) {
                    continue;
                }
                String name = p.getName();
                if (name != null && !name.isBlank()) {
                    names.add(name);
                }
            }
            return List.copyOf(names);
        } catch (RuntimeException ex) {
            return List.of();
        }
    }

    private String resolveTableName(UUID tableId) {
        if (tableId == null) {
            return "";
        }
        try {
            Table table = embedded.managerFactory().tableManager().getTable(tableId);
            return table == null || table.getName() == null ? "" : table.getName();
        } catch (RuntimeException ex) {
            return "";
        }
    }

    private UUID resolveUserId(SessionEntry session) {
        if (session == null || session.upstreamSessionId() == null) {
            return null;
        }
        try {
            Optional<Session> upstream = embedded.managerFactory()
                    .sessionManager()
                    .getSession(session.upstreamSessionId());
            return upstream.map(Session::getUserId).orElse(null);
        } catch (RuntimeException ex) {
            LOG.warn("Failed to resolve userId for /api/games/mine: {}", ex.toString());
            return null;
        }
    }

    private static WebMyGamesResponse emptyResponse() {
        return new WebMyGamesResponse(SchemaVersion.CURRENT, List.of());
    }
}
