package mage.webapi.dto.stream;

/**
 * Wire-format mirror of upstream {@code mage.view.ChatMessage}. Every
 * inbound chat callback the server pushes through a game-stream
 * WebSocket lands as the {@code data} payload of a frame whose
 * {@code method} is {@code "chatMessage"}.
 *
 * @param username    speaker's display name; empty for system messages
 * @param message     plain-text message body (HTML escaped client-side)
 * @param time        ISO-8601 UTC timestamp the message was authored
 * @param turnInfo    upstream turn-info string ("T2 — alice's turn") —
 *     populated only for game-room chat; empty elsewhere
 * @param color       upstream {@code MessageColor} enum name —
 *     {@code BLACK}, {@code RED}, {@code GREEN}, {@code BLUE},
 *     {@code ORANGE}, {@code YELLOW}; {@code null} maps to empty string
 * @param messageType upstream {@code MessageType} enum name —
 *     {@code USER_INFO}, {@code STATUS}, {@code GAME}, {@code TALK},
 *     {@code WHISPER_FROM}, {@code WHISPER_TO}; {@code null} maps to
 *     empty string
 * @param soundToPlay upstream {@code SoundToPlay} enum name or empty
 *     string; the webclient maps to its own SFX bank
 */
public record WebChatMessage(
        String username,
        String message,
        String time,
        String turnInfo,
        String color,
        String messageType,
        String soundToPlay
) {
}
