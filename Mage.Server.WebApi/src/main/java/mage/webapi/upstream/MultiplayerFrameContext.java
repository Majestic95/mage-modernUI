package mage.webapi.upstream;

import mage.constants.RangeOfInfluence;
import mage.game.Game;
import mage.game.permanent.Permanent;
import mage.players.Player;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Per-frame derived data the WebApi mapper needs from upstream live
 * state to populate schema-1.20 multiplayer wire fields and apply the
 * D1 range-of-influence filter (ADR 0010 v2).
 *
 * <p><b>Computed once per {@code mapToFrame} invocation, shared across
 * recipients.</b> The fan-out path in
 * {@code WebSocketCallbackHandler.dispatch} produces one frame per
 * recipient; each recipient gets a different RoI filter result, but
 * the source data ({@code goadingByPermanent}) is recipient-
 * independent. Per the slice-69c recon, computing once amortizes
 * iteration of {@code battlefield.getAllPermanents()} (~60-100 entries
 * mid-game, 4 recipients per frame in 4p FFA = 240→60 reads per turn
 * advance — a 4× win when permanents are populated).
 *
 * <p><b>Thread safety.</b> The {@code mapToFrame} call site runs
 * inside the engine's {@code synchronized GameController.updateGame()}
 * block (verified in slice-69c recon). All reads of {@code Game} state
 * happen inside that lock — no defensive copy is needed for visibility.
 *
 * <p><b>Defensive on every read.</b> Engine state during callback
 * dispatch is consistent but the upstream API is not documented as
 * thread-safe; we treat any {@code RuntimeException} or {@code null}
 * as "skip this entry." Hint failure costs a missing badge on the
 * client, never a crashed frame.
 */
public final class MultiplayerFrameContext {

    private static final Logger LOG =
            LoggerFactory.getLogger(MultiplayerFrameContext.class);

    /**
     * Empty context for tests / legacy call sites that don't have a
     * live {@link Game} reference. Callers that pass {@link #EMPTY}
     * receive {@code null}/{@code List.of()} for every multiplayer
     * field — wire-shape is preserved but no value population.
     *
     * <p>Slice 70-H — the bundled
     * {@link WebSocketConnectionTracker} is
     * {@link WebSocketConnectionTracker#EVERY_PLAYER_CONNECTED} so
     * tests don't need a live AuthService.
     */
    public static final MultiplayerFrameContext EMPTY =
            new MultiplayerFrameContext(
                    Map.of(),
                    WebSocketConnectionTracker.EVERY_PLAYER_CONNECTED);

    /**
     * Permanent UUID → set of player UUIDs that have goaded this
     * permanent (CR 701.42). Empty entries omitted (callers default
     * to empty list).
     */
    private final Map<UUID, Set<UUID>> goadingByPermanent;

    /**
     * Slice 70-H (ADR 0011 D3 / ADR 0010 v2 D11(e)) — per-player
     * WS-layer connection-state oracle. Built by the production
     * caller {@code WebSocketCallbackHandler.mapGameView} from a
     * lambda over {@code AuthService} + route-filtered socket counts
     * (see {@code WebSocketCallbackHandler.gamePlayerSocketCount}).
     * Tests / legacy paths use
     * {@link WebSocketConnectionTracker#EVERY_PLAYER_CONNECTED} so
     * the wire-shape contract test doesn't need a real WS layer.
     *
     * <p>Never null — defensive null-replace happens in
     * {@link #withConnectionTracker(WebSocketConnectionTracker)}.
     */
    private final WebSocketConnectionTracker connectionTracker;

    private MultiplayerFrameContext(
            Map<UUID, Set<UUID>> goadingByPermanent,
            WebSocketConnectionTracker connectionTracker) {
        this.goadingByPermanent = goadingByPermanent;
        this.connectionTracker = connectionTracker == null
                ? WebSocketConnectionTracker.EVERY_PLAYER_CONNECTED
                : connectionTracker;
    }

    /**
     * Slice 70-H — return a copy of this context with the supplied
     * connection tracker swapped in. Used by
     * {@code WebSocketCallbackHandler.mapGameView} to thread its
     * route-filtered socket-count oracle into the per-frame context
     * without forcing every {@link #extract(Game)} caller to know
     * about the WS layer.
     *
     * <p>{@code tracker == null} → EVERY_PLAYER_CONNECTED default.
     * Idempotent — calling with the same tracker reuses the existing
     * goading map by reference.
     */
    public MultiplayerFrameContext withConnectionTracker(
            WebSocketConnectionTracker tracker) {
        WebSocketConnectionTracker effective = tracker == null
                ? WebSocketConnectionTracker.EVERY_PLAYER_CONNECTED
                : tracker;
        if (effective == this.connectionTracker) {
            return this;
        }
        return new MultiplayerFrameContext(this.goadingByPermanent, effective);
    }

    /**
     * Slice 70-H — resolve the connection state of {@code playerId}
     * via the bundled tracker. Defensive: a null playerId (malformed
     * PlayerView) defaults to "connected" so we never paint a
     * healthy player as disconnected on a transient lookup failure.
     */
    public String connectionStateFor(UUID playerId) {
        if (playerId == null) {
            return mage.webapi.dto.stream.WebPlayerView.CONNECTION_STATE_CONNECTED;
        }
        return connectionTracker.connectionStateFor(playerId);
    }

    /**
     * Slice 69c — package-private factory for unit tests. Production
     * code uses {@link #extract(Game)} which reads live engine state;
     * tests use this to build a synthetic context with hand-crafted
     * goading data, avoiding the impractical-to-mock {@code Game}/
     * {@code GameState} constructor chain.
     *
     * <p>The supplied map is held by reference. Callers that mutate
     * it after construction will see the mutations reflected in
     * {@link #goadingFor(UUID)} — fine for tests (which build the
     * map fully before passing it in), but production
     * {@link #extract(Game)} always wraps via {@link Set#copyOf} +
     * a fresh {@link java.util.HashMap}.
     */
    static MultiplayerFrameContext forTesting(
            Map<UUID, Set<UUID>> goadingByPermanent) {
        return new MultiplayerFrameContext(
                goadingByPermanent == null ? Map.of() : goadingByPermanent,
                WebSocketConnectionTracker.EVERY_PLAYER_CONNECTED);
    }

    /**
     * Snapshot the current battlefield's goading state. Returns
     * {@link #EMPTY} when {@code game} is null, the battlefield is
     * empty, or any iteration step throws. Defensive: a hint failure
     * only costs a missing goad badge on the client — it must never
     * propagate to the engine callback path.
     */
    public static MultiplayerFrameContext extract(Game game) {
        if (game == null) {
            return EMPTY;
        }
        try {
            var battlefield = game.getBattlefield();
            if (battlefield == null) {
                return EMPTY;
            }
            var permanents = battlefield.getAllPermanents();
            if (permanents == null || permanents.isEmpty()) {
                return EMPTY;
            }
            Map<UUID, Set<UUID>> goading = null;
            for (Permanent perm : permanents) {
                if (perm == null) continue;
                Set<UUID> goaders = perm.getGoadingPlayers();
                if (goaders == null || goaders.isEmpty()) continue;
                if (goading == null) {
                    goading = new HashMap<>();
                }
                goading.put(perm.getId(), Set.copyOf(goaders));
            }
            return goading == null
                    ? EMPTY
                    : new MultiplayerFrameContext(
                            goading,
                            WebSocketConnectionTracker.EVERY_PLAYER_CONNECTED);
        } catch (RuntimeException ex) {
            LOG.debug("MultiplayerFrameContext.extract failed; returning empty: {}",
                    ex.toString());
            return EMPTY;
        }
    }

    /**
     * UUIDs of players who have goaded the given permanent, as
     * stringified for the wire. Empty list when not goaded.
     * Sort order is undefined (set iteration); the wire format
     * doesn't promise stable order for this field.
     */
    public List<String> goadingFor(UUID permanentId) {
        if (permanentId == null) {
            return List.of();
        }
        Set<UUID> goaders = goadingByPermanent.get(permanentId);
        if (goaders == null || goaders.isEmpty()) {
            return List.of();
        }
        return goaders.stream().map(UUID::toString).toList();
    }

    /**
     * D1 range-of-influence filter — UUIDs of players visible to
     * {@code recipientPlayerId} in {@code game}. Returns {@code null}
     * (sentinel for "no filter") when:
     * <ul>
     *   <li>{@code game} or {@code recipientPlayerId} is null
     *       (legacy / test callsites)</li>
     *   <li>The recipient's {@link RangeOfInfluence} is
     *       {@link RangeOfInfluence#ALL} (FFA default — full roster,
     *       no filter needed)</li>
     *   <li>The recipient is not in the player roster (e.g. spectator
     *       — slice 71 owns the spectator-specific path)</li>
     * </ul>
     *
     * <p>For non-ALL ranges this returns the precomputed in-range
     * set. Caller filters {@code WebGameView.players} against it.
     *
     * <p>Static (not instance method) because the result depends on
     * the recipient, not on the per-game derived state — different
     * recipients in the same fan-out produce different sets.
     */
    public static Set<UUID> playersInRange(Game game, UUID recipientPlayerId) {
        if (game == null || recipientPlayerId == null) {
            return null;
        }
        try {
            Player recipient = game.getPlayer(recipientPlayerId);
            if (recipient == null) {
                return null;
            }
            RangeOfInfluence range = recipient.getRange();
            if (range == null || range == RangeOfInfluence.ALL) {
                return null;
            }
            var playersInRange = game.getState().getPlayersInRange(
                    recipientPlayerId, game);
            if (playersInRange == null) {
                return null;
            }
            Set<UUID> out = new HashSet<>();
            for (UUID id : playersInRange) {
                if (id != null) out.add(id);
            }
            return out;
        } catch (RuntimeException ex) {
            // Engine mid-mutation, missing player, etc. Defensive:
            // fall back to "no filter" rather than crash. The risk of
            // a momentary leak in a partial state is dwarfed by the
            // risk of taking down the WS pipe on a transient.
            // Slice 70 (ADR 0010 v2 R8) — count fail-open events on
            // the admin /metrics endpoint so the policy is observable.
            // Non-zero values flag transient frequency for ops; if it
            // becomes load-bearing, v3 may flip to fail-closed.
            mage.webapi.metrics.MetricsRegistry.increment(
                    mage.webapi.metrics.MetricsRegistry.ROI_FILTER_FAILURES_TOTAL);
            LOG.debug("MultiplayerFrameContext.playersInRange failed; "
                    + "returning null (no filter): {}", ex.toString());
            return null;
        }
    }
}
