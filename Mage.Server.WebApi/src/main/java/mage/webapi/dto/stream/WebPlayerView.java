package mage.webapi.dto.stream;

import java.util.List;
import java.util.Map;

/**
 * Per-player state inside a {@link WebGameView}.
 *
 * <p>Slice 3 carried zone counts only. Slice 4 promotes
 * {@code battlefield} from a count to a full
 * {@code Map<UUID, WebPermanentView>} — the battlefield is what the
 * game window actually renders. Graveyard, exile, and sideboard remain
 * counts; slice 5 promotes them to card-detail maps.
 *
 * @param playerId        upstream player UUID
 * @param name            display name
 * @param life            current life total
 * @param wins            wins in the current match
 * @param winsNeeded      target win count for this match
 * @param libraryCount    cards remaining in library
 * @param handCount       cards in hand (face-down — opponents see only
 *     the count; the controlling player gets card detail via
 *     {@link WebGameView#myHand})
 * @param graveyardCount  cards in graveyard
 * @param exileCount      cards exiled by this player
 * @param sideboardCount  cards in sideboard (only populated for
 *     {@code controlled = true} or AI players upstream-side)
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
 */
public record WebPlayerView(
        String playerId,
        String name,
        int life,
        int wins,
        int winsNeeded,
        int libraryCount,
        int handCount,
        int graveyardCount,
        int exileCount,
        int sideboardCount,
        Map<String, WebPermanentView> battlefield,
        WebManaPoolView manaPool,
        boolean controlled,
        boolean isHuman,
        boolean isActive,
        boolean hasPriority,
        boolean hasLeft,
        boolean monarch,
        boolean initiative,
        List<String> designationNames
) {
}
