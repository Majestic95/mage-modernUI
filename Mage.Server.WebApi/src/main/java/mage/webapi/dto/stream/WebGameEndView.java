package mage.webapi.dto.stream;

import java.util.List;

/**
 * Match-end summary. Mirrors upstream {@code mage.view.GameEndView}.
 *
 * <p>Carried as the {@code data} payload of {@code endGameInfo} frames
 * which fire when the upstream {@code GameSessionPlayer} pushes
 * {@code ClientCallbackMethod.END_GAME_INFO}. Distinct from
 * {@code gameOver} (which is a per-game-of-the-match wrapper); this
 * is the post-match summary the webclient renders on the result
 * screen.
 *
 * @param gameInfo       narrative status ({@code "You won the game on
 *     turn 7."} / {@code "You lost the game on turn 7."} / draw text)
 * @param matchInfo      match-level summary ({@code "You won the
 *     match!"} or progression text like {@code "You need one more
 *     win to win the match."})
 * @param additionalInfo any extra disconnection / timeout / quit
 *     reasons the upstream wants to surface
 * @param won            from the perspective of the player this view
 *     was rendered for: did they win this game?
 * @param wins           wins-so-far for this player in the match
 * @param winsNeeded     wins required for match victory
 * @param players        per-player snapshots at match end (slice 4
 *     WebPlayerView shape — battlefield will typically be empty since
 *     upstream tears down on game-over, but we keep the contract
 *     uniform)
 */
public record WebGameEndView(
        String gameInfo,
        String matchInfo,
        String additionalInfo,
        boolean won,
        int wins,
        int winsNeeded,
        List<WebPlayerView> players
) {
}
