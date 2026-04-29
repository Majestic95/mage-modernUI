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
 * <p>{@code protocolVersion} (slice 69a, ADR 0010 v2 D12) carries the
 * negotiated handshake contract version. Echoes the client's
 * {@code ?protocolVersion=} query param when present; otherwise
 * defaults to {@link mage.webapi.ProtocolVersion#CURRENT}. Distinct
 * from {@code schemaVersion} (the JSON wire-format version) — see
 * {@link mage.webapi.ProtocolVersion}.
 *
 * @param gameId          the game UUID this socket is bound to
 * @param username        the authenticated username on this socket
 * @param mode            stream mode tag (slice indicator)
 * @param protocolVersion negotiated handshake protocol version
 */
public record WebStreamHello(
        String gameId,
        String username,
        String mode,
        int protocolVersion
) {
}
