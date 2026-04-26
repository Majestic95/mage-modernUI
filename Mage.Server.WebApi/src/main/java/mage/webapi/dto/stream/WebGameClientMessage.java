package mage.webapi.dto.stream;

/**
 * Wrapper around {@link WebGameView} + a status string.
 *
 * <p>Carried as the {@code data} payload of {@code gameInform} and
 * {@code gameOver} frames, both of which fire upstream as
 * {@code ClientCallbackMethod.GAME_UPDATE_AND_INFORM} /
 * {@code GAME_OVER} with a {@code GameClientMessage} payload.
 *
 * <p>Slice 5 carries the minimal {@code gameView + message} subset.
 * Slice 6 will extend with the dialog-family fields ({@code targets},
 * {@code min}/{@code max}, {@code cardsView1}, {@code flag}, etc.) once
 * the {@code gameAsk} / {@code gameTarget} / {@code gameSelectAmount}
 * outbound mappings land alongside the inbound {@code WebPlayerResponse}
 * envelope.
 *
 * @param gameView the snapshot at the moment of dispatch — slice 4's
 *     full WebGameView with hand + battlefield + stack + combat
 * @param message  human-friendly status text ({@code "alice has won
 *     the game!"}, {@code "Lightning Bolt resolves: target takes 3"},
 *     etc.); empty if upstream supplied none
 */
public record WebGameClientMessage(
        WebGameView gameView,
        String message
) {
}
