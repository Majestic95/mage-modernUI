package mage.webapi.dto.stream;

import java.util.List;
import java.util.Map;

/**
 * Per-player state inside a {@link WebGameView}.
 *
 * <p>Slice 4 promoted {@code battlefield} from a count to a full
 * {@code Map<UUID, WebPermanentView>}. Slice 5 promotes the remaining
 * three zone counts ({@code graveyard}, {@code exile},
 * {@code sideboard}) to card-detail maps. {@code library} and
 * {@code hand} retain their counts because card content is private to
 * the controlling player (the controlling player's hand lives on
 * {@link WebGameView#myHand}; library content remains hidden).
 *
 * @param playerId        upstream player UUID
 * @param name            display name
 * @param life            current life total
 * @param wins            wins in the current match
 * @param winsNeeded      target win count for this match
 * @param libraryCount    cards remaining in library (private —
 *     content not exposed)
 * @param handCount       cards in hand (face-down — opponents see only
 *     the count; the controlling player gets card detail via
 *     {@link WebGameView#myHand})
 * @param graveyard       cards in graveyard, keyed by card UUID.
 *     Insertion order matches upstream's {@code LinkedHashMap}
 *     traversal — top of the graveyard pile (most recently put there)
 *     is the last entry.
 * @param exile           cards in this player's exile, keyed by card
 *     UUID
 * @param sideboard       cards in sideboard, keyed by card UUID. Only
 *     populated for the {@code controlled} player or AI players —
 *     opponents see an empty map.
 * @param battlefield     permanents this player controls, keyed by
 *     UUID. Insertion order matches upstream's {@code LinkedHashMap}
 *     traversal so the webclient gets a stable layout.
 * @param manaPool        per-color mana totals
 * @param controlled      true if this {@link WebGameView} was rendered
 *     from this player's perspective ("you")
 * @param isHuman         true if this player is human (vs AI)
 * @param isActive        true if it is currently this player's turn
 * @param hasPriority     true if this player currently holds priority
 * @param hasLeft         true if this player has left the match
 * @param monarch         true if this player is the monarch
 * @param initiative      true if this player has the initiative
 * @param designationNames any active designations (Day/Night, City's
 *     Blessing, etc.) on this player
 * @param commandList     entries in this player's command zone
 *     (commander, emblems, dungeons, planes). Empty list when none —
 *     never null. Each entry's {@code kind} field discriminates render
 *     mode on the client. Added in schema 1.13.
 * @param teamId          team UUID for 2HG / multi-team formats; null
 *     for FFA and 1v1 (every player a "team of one" is not modeled).
 *     Added in schema 1.20 (ADR 0010 v2 D3a). Slice 69a ships the
 *     wire shape; population from {@code MatchType.getPlayersPerTeam()}
 *     + seat-index lands in slice 69b alongside the live-game-access
 *     plumbing.
 */
public record WebPlayerView(
        String playerId,
        String name,
        int life,
        int wins,
        int winsNeeded,
        int libraryCount,
        int handCount,
        Map<String, WebCardView> graveyard,
        Map<String, WebCardView> exile,
        Map<String, WebCardView> sideboard,
        Map<String, WebPermanentView> battlefield,
        WebManaPoolView manaPool,
        boolean controlled,
        boolean isHuman,
        boolean isActive,
        boolean hasPriority,
        boolean hasLeft,
        boolean monarch,
        boolean initiative,
        List<String> designationNames,
        List<WebCommandObjectView> commandList,
        String teamId
) {
}
