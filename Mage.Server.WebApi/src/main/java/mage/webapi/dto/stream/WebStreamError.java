package mage.webapi.dto.stream;

/**
 * Generic in-band error frame — sent when an inbound message is
 * unparseable or its {@code type} is not (yet) supported by the current
 * slice. Mirrors the {@code WebError} REST envelope on the WS side.
 *
 * @param code    stable enum-style identifier ({@code BAD_REQUEST},
 *     {@code NOT_IMPLEMENTED}, {@code UNKNOWN_TYPE}, …)
 * @param message human-friendly text safe to display
 */
public record WebStreamError(
        String code,
        String message
) {
}
