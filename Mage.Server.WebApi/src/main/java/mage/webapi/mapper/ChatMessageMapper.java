package mage.webapi.mapper;

import mage.view.ChatMessage;
import mage.webapi.dto.stream.WebChatMessage;

import java.time.Instant;
import java.util.Date;

/**
 * Maps upstream {@link ChatMessage} into the wire-format
 * {@link WebChatMessage}. Pure record-to-record translation — no
 * upstream type leaks past this method.
 *
 * <p>Null-safe: the mapper turns every absent enum/field into the empty
 * string so the wire format never carries {@code null}. The webclient
 * Zod schema (slice 2 webclient work) enforces non-null strings.
 */
public final class ChatMessageMapper {

    private ChatMessageMapper() {
    }

    public static WebChatMessage toDto(ChatMessage cm) {
        if (cm == null) {
            throw new IllegalArgumentException("ChatMessage must not be null");
        }
        return new WebChatMessage(
                nullToEmpty(cm.getUsername()),
                nullToEmpty(cm.getMessage()),
                isoTime(cm.getTime()),
                nullToEmpty(cm.getTurnInfo()),
                cm.getColor() == null ? "" : cm.getColor().name(),
                cm.getMessageType() == null ? "" : cm.getMessageType().name(),
                cm.getSoundToPlay() == null ? "" : cm.getSoundToPlay().name()
        );
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    private static String isoTime(Date d) {
        if (d == null) {
            return "";
        }
        return Instant.ofEpochMilli(d.getTime()).toString();
    }
}
