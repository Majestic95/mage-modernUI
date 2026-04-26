package mage.webapi.mapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.view.ChatMessage;
import mage.webapi.dto.stream.WebChatMessage;
import org.junit.jupiter.api.Test;

import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Locks the {@link WebChatMessage} JSON shape so upstream
 * {@code ChatMessage} drift surfaces here, not on the wire.
 */
class ChatMessageMapperTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void toDto_mapsEveryUpstreamField() {
        // Use the 7-arg ChatMessage constructor (no Game so turnInfo is null)
        // to seed every field directly.
        ChatMessage cm = new ChatMessage(
                "alice",
                "ggwp",
                new Date(1714161660000L), // 2024-04-26T20:01:00Z
                null,
                ChatMessage.MessageColor.BLUE,
                ChatMessage.MessageType.TALK,
                ChatMessage.SoundToPlay.PlayerWhispered
        );

        WebChatMessage dto = ChatMessageMapper.toDto(cm);

        assertEquals("alice", dto.username());
        assertEquals("ggwp", dto.message());
        assertEquals("2024-04-26T20:01:00Z", dto.time());
        assertEquals("BLUE", dto.color());
        assertEquals("TALK", dto.messageType());
        assertEquals("PlayerWhispered", dto.soundToPlay());
        assertNotNull(dto.turnInfo(), "turnInfo must never be null on the wire");
    }

    @Test
    void toDto_handlesNullEnumsAndStrings() {
        ChatMessage cm = new ChatMessage(
                null, null, null, null, null,
                ChatMessage.MessageType.USER_INFO, null);

        WebChatMessage dto = ChatMessageMapper.toDto(cm);

        assertEquals("", dto.username(), "null username → empty string");
        assertEquals("", dto.message(), "null message → empty string");
        assertEquals("", dto.time(), "null time → empty string");
        assertEquals("", dto.color(), "null color → empty string");
        assertEquals("USER_INFO", dto.messageType());
        assertEquals("", dto.soundToPlay(), "null sound → empty string");
    }

    @Test
    void toDto_jsonShape_locksSevenFields() throws Exception {
        ChatMessage cm = new ChatMessage(
                "bob", "hi", new Date(0), null,
                ChatMessage.MessageColor.BLACK);
        WebChatMessage dto = ChatMessageMapper.toDto(cm);
        JsonNode node = JSON.valueToTree(dto);

        // Lock the 7-field shape. Adding a field breaks this test on
        // purpose so it gets reviewed deliberately.
        assertEquals(7, node.size(),
                "WebChatMessage must have exactly 7 fields; got: " + node);
        assertTrue(node.has("username"));
        assertTrue(node.has("message"));
        assertTrue(node.has("time"));
        assertTrue(node.has("turnInfo"));
        assertTrue(node.has("color"));
        assertTrue(node.has("messageType"));
        assertTrue(node.has("soundToPlay"));
    }

    @Test
    void toDto_nullInput_throws() {
        assertThrows(IllegalArgumentException.class,
                () -> ChatMessageMapper.toDto(null));
    }
}
