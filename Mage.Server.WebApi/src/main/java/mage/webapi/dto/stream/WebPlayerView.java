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
 * @param colorIdentity   list of MTG colors ({@code "W"}, {@code "U"},
 *     {@code "B"}, {@code "R"}, {@code "G"}) representing the union
 *     color identity of the player's commander(s). Empty list for
 *     non-commander formats. Drives the player-frame halo per
 *     design-system §7.3 — single colors render as a solid ring,
 *     multicolor renders as alternating bands, empty falls back to
 *     {@code --color-team-neutral}. For partner / background commander
 *     pairings the list is the union of both identities. Added in
 *     schema 1.22 (ADR 0011 D5).
 * @param connectionState live socket-state of the player from the
 *     WebApi facade's POV. {@code "connected"} when the player has
 *     ≥1 active game-stream WebSocket; {@code "disconnected"} when
 *     all sockets are closed but the player is still in the game
 *     (not {@code hasLeft}). Drives the PlayerFrame DISCONNECTED
 *     overlay per design-system §7.3 — desaturate + text label,
 *     player can recover by reconnecting. Distinct from
 *     {@code hasLeft} (terminal) — disconnected is recoverable.
 *     Added in schema 1.23 (ADR 0011 D3 / ADR 0010 v2 D11(e)
 *     deferred work, slice 70-H).
 * @param skipState       which {@code PASS_PRIORITY_UNTIL_*} skip
 *     mode this player has armed, if any. Empty string when no skip
 *     active. The engine sets exactly one of {@code passedAllTurns},
 *     {@code passedTurn}, {@code passedUntilEndOfTurn},
 *     {@code passedUntilNextMain}, {@code passedUntilStackResolved},
 *     {@code passedUntilEndStepBeforeMyTurn} (each PASS action calls
 *     {@code resetPlayerPassedActions()} first), so emit a single
 *     enum value rather than 6 booleans. Drives the ActionPanel's
 *     active-button visual + the global skip-status pill.
 *     Values: {@link #SKIP_STATE_NONE} ({@code ""}),
 *     {@link #SKIP_STATE_ALL_TURNS}, {@link #SKIP_STATE_NEXT_TURN},
 *     {@link #SKIP_STATE_END_OF_TURN}, {@link #SKIP_STATE_NEXT_MAIN},
 *     {@link #SKIP_STATE_STACK_RESOLVED},
 *     {@link #SKIP_STATE_END_STEP_BEFORE_MY_TURN}. Added in schema 1.30.
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
        String teamId,
        List<String> colorIdentity,
        String connectionState,
        String skipState
) {

    /** {@link #connectionState} — player has ≥1 active game-stream socket. */
    public static final String CONNECTION_STATE_CONNECTED = "connected";

    /** {@link #connectionState} — all game-stream sockets closed; player
     *  may still reconnect. {@code hasLeft} is the terminal state;
     *  this is the recoverable intermediate. */
    public static final String CONNECTION_STATE_DISCONNECTED = "disconnected";

    /** {@link #skipState} — no PASS_PRIORITY_UNTIL_* skip is armed. */
    public static final String SKIP_STATE_NONE = "";
    /** {@link #skipState} — F9 / passedAllTurns. Skips every priority
     *  window until the player's NEXT untap. Most aggressive. */
    public static final String SKIP_STATE_ALL_TURNS = "ALL_TURNS";
    /** {@link #skipState} — F4 / passedTurn. Skips priority windows
     *  until the next turn (any player's). */
    public static final String SKIP_STATE_NEXT_TURN = "NEXT_TURN";
    /** {@link #skipState} — F5 / passedUntilEndOfTurn. */
    public static final String SKIP_STATE_END_OF_TURN = "END_OF_TURN";
    /** {@link #skipState} — F7 / passedUntilNextMain. */
    public static final String SKIP_STATE_NEXT_MAIN = "NEXT_MAIN";
    /** {@link #skipState} — F8 / passedUntilStackResolved. Auto-passes
     *  until the current stack object resolves. */
    public static final String SKIP_STATE_STACK_RESOLVED = "STACK_RESOLVED";
    /** {@link #skipState} — F11 / passedUntilEndStepBeforeMyTurn. */
    public static final String SKIP_STATE_END_STEP_BEFORE_MY_TURN =
            "END_STEP_BEFORE_MY_TURN";
}
