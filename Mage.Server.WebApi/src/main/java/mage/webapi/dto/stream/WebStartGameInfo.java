package mage.webapi.dto.stream;

/**
 * Carried as the {@code data} payload of {@code startGame} frames.
 * Lets the webclient pivot to the game window when the upstream
 * server signals "your match has begun."
 *
 * <p>Mapped from the slim subset of {@code mage.view.TableClientMessage}
 * that {@code User.ccGameStarted} populates.
 *
 * @param tableId  the table this game belongs to
 * @param gameId   the game UUID (matches the {@code {gameId}} path
 *     parameter on the WebSocket route)
 * @param playerId this user's player UUID inside the game
 */
public record WebStartGameInfo(
        String tableId,
        String gameId,
        String playerId
) {
}
