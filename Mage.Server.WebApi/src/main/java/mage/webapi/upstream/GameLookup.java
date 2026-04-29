package mage.webapi.upstream;

import mage.game.Game;
import mage.server.game.GameController;
import mage.server.managers.ManagerFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.lang.reflect.Field;
import java.util.Collections;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Reflective accessor for upstream's {@link Game} instance behind a
 * {@link GameController}.
 *
 * <p><b>Why reflection?</b> {@code GameController} is upstream code
 * (forbidden to modify per repo policy — see {@code CLAUDE.md}). Its
 * public surface exposes game state through methods that operate on a
 * {@code gameId} (poll for chat, send actions, etc.) but does <em>not</em>
 * expose the {@link Game} object directly. For cross-zone animation
 * hints we need to look at {@code game.getStack()} to recover the
 * underlying {@code Card} UUID for each {@code Spell} on the stack
 * (the wire-format {@link mage.view.CardView} for stack entries
 * carries the {@code SpellAbility.getId()} — a fresh UUID per cast —
 * not the stable card UUID, so the webclient can't use it as a
 * Framer Motion {@code layoutId} for hand-to-stack-to-battlefield
 * animation).
 *
 * <p>Adding a public {@code getGame()} getter to {@code GameController}
 * would solve this cleanly but would require an upstream patch, which
 * the personal-fork policy forbids. Reflection is the next-best
 * option; it degrades gracefully if upstream renames the field by
 * returning empty (callers fall back to non-animated behavior — the
 * webclient still works, it just can't share a {@code layoutId}
 * across zones for stack entries).
 *
 * <p>The {@link Field} reference is cached lazily (resolved on first
 * call, not at class init) so unit tests that don't load
 * {@code GameController} don't fail at static initialization.
 *
 * <p>On the first reflection failure (NoSuchFieldException,
 * IllegalAccessException, etc.) a single WARN is logged via
 * {@link LoggerFactory}; subsequent calls return empty silently to
 * avoid log spam if the upstream layout changes.
 */
public final class GameLookup {

    private static final Logger LOG = LoggerFactory.getLogger(GameLookup.class);

    /** Cached reflective handle for {@code GameController.game}. */
    private static final AtomicReference<Field> GAME_FIELD = new AtomicReference<>();

    /**
     * Cached reflective handle for {@code GameController.userPlayerMap}.
     * Resolved lazily on first call to {@link #findUserPlayerMap}.
     * Slice 63 — needed for the WS upgrade game-membership gate and the
     * manaType ownership check (auditor #4 / recon agent BLOCKERs).
     */
    private static final AtomicReference<Field> USER_PLAYER_MAP_FIELD = new AtomicReference<>();

    /** Sentinel marking that {@code GameController.game} resolution has permanently failed. */
    private static final AtomicBoolean RESOLUTION_FAILED = new AtomicBoolean(false);

    /**
     * Sentinel marking that {@code GameController.userPlayerMap} reflection
     * has permanently failed. Independent of {@link #RESOLUTION_FAILED}
     * because the two fields fail independently and one missing field
     * shouldn't disable the other path.
     */
    private static final AtomicBoolean USER_PLAYER_MAP_FAILED = new AtomicBoolean(false);

    /** One-shot guard so the WARN-on-failure log fires at most once. */
    private static final AtomicBoolean WARNED = new AtomicBoolean(false);

    /** One-shot guard for {@link #findUserPlayerMap} reflection-failure WARN. */
    private static final AtomicBoolean USER_PLAYER_MAP_WARNED = new AtomicBoolean(false);

    private GameLookup() {
    }

    /**
     * Walk the {@link GameController} map managed by upstream's
     * {@code GameManager} and return the underlying {@link Game}
     * instance for the supplied {@code gameId}, or empty if the game
     * is not registered or reflection fails.
     *
     * @param gameId the upstream game UUID (typically
     *     {@code ClientCallback.getObjectId()})
     * @param mf the {@link ManagerFactory} owning the
     *     {@code gameManager()} (passed in by the caller because the
     *     handler is per-username and doesn't otherwise need a
     *     ManagerFactory reference)
     * @return Optional carrying the {@link Game} on success; empty on
     *     missing controller, null inputs, or reflection failure
     */
    public static Optional<Game> findGame(UUID gameId, ManagerFactory mf) {
        if (gameId == null || mf == null) {
            return Optional.empty();
        }
        if (RESOLUTION_FAILED.get()) {
            return Optional.empty();
        }
        Map<UUID, GameController> controllers;
        try {
            controllers = mf.gameManager().getGameController();
        } catch (RuntimeException ex) {
            warnOnce("GameManager.getGameController() failed", ex);
            return Optional.empty();
        }
        if (controllers == null) {
            return Optional.empty();
        }
        GameController controller = controllers.get(gameId);
        if (controller == null) {
            return Optional.empty();
        }
        Field field = resolveGameField();
        if (field == null) {
            return Optional.empty();
        }
        try {
            Object value = field.get(controller);
            return value instanceof Game game ? Optional.of(game) : Optional.empty();
        } catch (IllegalAccessException | RuntimeException ex) {
            warnOnce("Reading GameController.game via reflection failed", ex);
            return Optional.empty();
        }
    }

    /**
     * Resolve and cache the {@code GameController.game} {@link Field}
     * lazily. Returns null on failure (poisoning future calls via
     * {@link #RESOLUTION_FAILED}).
     */
    private static Field resolveGameField() {
        Field cached = GAME_FIELD.get();
        if (cached != null) {
            return cached;
        }
        try {
            Field field = GameController.class.getDeclaredField("game");
            field.setAccessible(true);
            // Use compareAndSet so two threads racing to resolve land
            // on the same cached Field; benign either way since both
            // resolve to the same upstream member.
            GAME_FIELD.compareAndSet(null, field);
            return GAME_FIELD.get();
        } catch (NoSuchFieldException | RuntimeException ex) {
            RESOLUTION_FAILED.set(true);
            warnOnce("GameController.game field not found via reflection — "
                    + "stack cardId hints disabled (cross-zone animation will "
                    + "fall back to per-zone UUIDs)", ex);
            return null;
        }
    }

    private static void warnOnce(String message, Throwable cause) {
        if (WARNED.compareAndSet(false, true)) {
            LOG.warn("{}: {}", message, cause == null ? "(no cause)" : cause.toString());
        }
    }

    /**
     * Slice 63 — return an unmodifiable view of {@code userId → playerId}
     * for the supplied {@code gameId}, or {@link Optional#empty()} if the
     * game is unknown or reflection fails.
     *
     * <p>Both auditor #4 BLOCKERs (manaType ownership and WS-upgrade
     * game-membership gate) need to ask "is this user seated at this
     * game" / "what's their playerId" — answers that {@code GameController}
     * doesn't expose publicly. Reflection mirrors the existing
     * {@link #findGame} pattern: lazy field cache, one-shot WARN on
     * failure, fail-closed (empty) on any error.
     *
     * <p>The returned map is wrapped via {@link Collections#unmodifiableMap}
     * so callers can't mutate upstream state through this hole.
     *
     * @param gameId the upstream game UUID
     * @param mf the {@link ManagerFactory} owning {@code gameManager()}
     * @return Optional carrying the immutable map on success; empty on
     *     missing controller, null inputs, or reflection failure
     */
    @SuppressWarnings("unchecked")
    public static Optional<Map<UUID, UUID>> findUserPlayerMap(UUID gameId, ManagerFactory mf) {
        if (gameId == null || mf == null) {
            return Optional.empty();
        }
        if (USER_PLAYER_MAP_FAILED.get()) {
            return Optional.empty();
        }
        Map<UUID, GameController> controllers;
        try {
            controllers = mf.gameManager().getGameController();
        } catch (RuntimeException ex) {
            warnUserPlayerMapOnce("GameManager.getGameController() failed", ex);
            return Optional.empty();
        }
        if (controllers == null) {
            return Optional.empty();
        }
        GameController controller = controllers.get(gameId);
        if (controller == null) {
            return Optional.empty();
        }
        Field field = resolveUserPlayerMapField();
        if (field == null) {
            return Optional.empty();
        }
        try {
            Object value = field.get(controller);
            if (!(value instanceof Map<?, ?> raw)) {
                return Optional.empty();
            }
            return Optional.of(Collections.unmodifiableMap((Map<UUID, UUID>) raw));
        } catch (IllegalAccessException | RuntimeException ex) {
            warnUserPlayerMapOnce("Reading GameController.userPlayerMap via reflection failed", ex);
            return Optional.empty();
        }
    }

    private static Field resolveUserPlayerMapField() {
        Field cached = USER_PLAYER_MAP_FIELD.get();
        if (cached != null) {
            return cached;
        }
        try {
            Field field = GameController.class.getDeclaredField("userPlayerMap");
            field.setAccessible(true);
            USER_PLAYER_MAP_FIELD.compareAndSet(null, field);
            return USER_PLAYER_MAP_FIELD.get();
        } catch (NoSuchFieldException | RuntimeException ex) {
            USER_PLAYER_MAP_FAILED.set(true);
            warnUserPlayerMapOnce("GameController.userPlayerMap field not found via "
                    + "reflection — WS game-membership gate disabled (fail-closed: "
                    + "all WS upgrades will be rejected)", ex);
            return null;
        }
    }

    private static void warnUserPlayerMapOnce(String message, Throwable cause) {
        if (USER_PLAYER_MAP_WARNED.compareAndSet(false, true)) {
            LOG.warn("{}: {}", message, cause == null ? "(no cause)" : cause.toString());
        }
    }
}
