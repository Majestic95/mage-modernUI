package mage.webapi.dto.stream;

/**
 * Slice 69c — synthetic teardown signal emitted when a player leaves
 * the game (concession, timeout, disconnect). Tells client UIs to
 * dismiss any open dialog (vote loop, target prompt, cost decision,
 * triggered-ability picker) targeting the leaver, since the engine
 * already skips them server-side per
 * {@code Mage/src/main/java/mage/choices/VoteHandler.java:33-39}
 * (and equivalent skip-leaver logic in target/cost code paths) but
 * does not emit a separate user-visible signal.
 *
 * <p>Per ADR 0010 v2 D11(b): "any open dialog targeting the leaver
 * dismisses via a new {@code dialogClear{playerId, reason: 'PLAYER_LEFT'}}
 * wire frame." This is fire-and-forget UI teardown, not a state-
 * machine transition — if the engine then re-prompts a different
 * player after the skip, that arrives as a fresh {@code gameAsk} /
 * {@code gameTarget} / {@code gameSelect} envelope. Clients do NOT
 * chain off {@code dialogClear}.
 *
 * <p>No upstream {@code PLAYER_LEFT} callback exists (verified slice-
 * 69c recon). The frame is synthesized at the WebApi layer when
 * {@code WebSocketCallbackHandler} detects a {@code hasLeft} 0→1
 * transition between consecutive {@code gameUpdate} / {@code gameInit}
 * / {@code gameInform} frames for the same gameId.
 *
 * @param playerId  UUID (stringified) of the player who left
 * @param reason    short machine-parseable reason code. v2 ships
 *                  {@code "PLAYER_LEFT"} for any hasLeft transition
 *                  (concession / engine-skipped / eliminated). Slice
 *                  70-H (schema 1.23) added {@code "TIMEOUT"} for
 *                  per-prompt disconnect-timer fires — the
 *                  disconnected player is NOT yet hasLeft (still
 *                  recoverable on reconnect), but their open prompt
 *                  has been cleaned up on every other client's UI
 *                  to prevent stuck "waiting on Bob" affordances.
 */
public record WebDialogClear(
        String playerId,
        String reason
) {

    /** Reason code emitted for any leaver detection in v2. */
    public static final String REASON_PLAYER_LEFT = "PLAYER_LEFT";

    /**
     * Slice 70-H — per-prompt disconnect-timer fired without the
     * player reconnecting. Distinct from {@link #REASON_PLAYER_LEFT}
     * (terminal) — TIMEOUT is recoverable; the player can reconnect
     * and their pod re-renders normally. The auto-pass response
     * to the engine is sub-slice 70-H.5; this slice ships only the
     * detection + UI-teardown signal.
     */
    public static final String REASON_TIMEOUT = "TIMEOUT";
}
