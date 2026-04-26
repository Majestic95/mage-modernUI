package mage.webapi.dto.stream;

/**
 * Outbound JSON envelope for every server-to-client WebSocket frame
 * (ADR 0007 D4). Tagged-union shape keyed by {@link #method}; the
 * {@code code} string of {@code ClientCallbackMethod} is reused as the
 * discriminator so upstream-method drift surfaces immediately.
 *
 * <p>Frames are self-contained — every frame carries its own
 * {@code schemaVersion} so a captured stream can be replayed against any
 * matching client without out-of-band setup.
 *
 * <p>Slice 1 (Phase 3) ships only the {@code streamHello} method, which
 * proves the wire-format contract end-to-end. Slice 2 adds the
 * {@code chatMessage} / {@code gameInit} / {@code gameUpdate} family;
 * slice 3 adds dialog frames.
 *
 * @param schemaVersion wire-format version (always {@code SchemaVersion.CURRENT})
 * @param method        camelCase method discriminator
 * @param messageId     server-monotonic counter (0 for synthetic frames
 *     not bound to an upstream callback, e.g. {@code streamHello})
 * @param objectId      target UUID — typically game or chat id; null
 *     where upstream sends null
 * @param data          method-specific payload; null for events that
 *     carry no payload
 */
public record WebStreamFrame(
        String schemaVersion,
        String method,
        int messageId,
        String objectId,
        Object data
) {
}
