package mage.webapi.upstream;

import mage.game.Game;
import mage.server.game.GameController;
import mage.server.managers.ManagerFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.lang.reflect.Field;
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

    /** Sentinel marking that field-resolution has permanently failed. */
    private static final AtomicBoolean RESOLUTION_FAILED = new AtomicBoolean(false);

    /** One-shot guard so the WARN-on-failure log fires at most once. */
    private static final AtomicBoolean WARNED = new AtomicBoolean(false);

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
}
