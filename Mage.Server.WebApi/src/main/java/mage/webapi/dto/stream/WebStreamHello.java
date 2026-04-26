package mage.webapi.dto.stream;

/**
 * Sent once on every successful WebSocket handshake. Confirms to the
 * client that auth + game-id parsing succeeded and announces the wire
 * format the server speaks.
 *
 * <p>Mode field exists for forward compatibility — slice 1 is
 * {@code "skeleton"} (no inbound dispatch, no upstream callback
 * mappers). Slice 2 changes it to {@code "live"}.
 *
 * @param gameId   the game UUID this socket is bound to
 * @param username the authenticated username on this socket
 * @param mode     stream mode tag (slice indicator)
 */
public record WebStreamHello(
        String gameId,
        String username,
        String mode
) {
}
