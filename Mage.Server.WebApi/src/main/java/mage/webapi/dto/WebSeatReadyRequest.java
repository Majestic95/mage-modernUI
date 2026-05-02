package mage.webapi.dto;

/**
 * Slice L5 (new-lobby-window) — body for {@code POST
 * /api/rooms/{roomId}/tables/{tableId}/seat/ready}.
 *
 * @param ready  {@code true} to mark the caller ready, {@code false}
 *               to opt out
 */
public record WebSeatReadyRequest(Boolean ready) {
}
