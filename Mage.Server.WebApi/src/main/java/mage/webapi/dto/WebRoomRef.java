package mage.webapi.dto;

/**
 * Discovery payload for the singleton main lobby. Returned by
 * {@code GET /api/server/main-room}. Per ADR 0006 D1, upstream's
 * "rooms" model is functionally a singleton, so we don't expose a
 * list endpoint.
 *
 * @param schemaVersion JSON wire-format version
 * @param roomId        UUID of the main lobby (regenerated each
 *     server restart; not persisted)
 * @param chatId        UUID of the chat session bound to the room
 */
public record WebRoomRef(
        String schemaVersion,
        String roomId,
        String chatId
) {
}
