package mage.webapi.lobby;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Slice L5 (new-lobby-window) — per-table set of usernames that
 * have explicitly readied up. The new lobby's pre-game flow gates
 * the host's Start Game button on every human seat being ready;
 * AI seats are auto-ready and not represented here.
 *
 * <p>Why not on the upstream {@link mage.game.Table} object? The
 * upstream classes are kept rebase-clean per ADR 0001 — adding
 * fields to {@code Table} or {@code MatchPlayer} would diverge from
 * the magefree/mage source tree. The tracker lives in the WebApi
 * module instead, indexed by tableId + username.
 *
 * <p>Lifecycle:
 * <ul>
 *   <li>Table create — host's username is pre-readied (the design
 *       doc locks "host starts as ready" so they can hit Start as
 *       soon as guests are ready, no self-toggle required).</li>
 *   <li>Toggle — guests post {@code POST /seat/ready} to add or
 *       remove themselves from the set.</li>
 *   <li>Settings PATCH — every guest is removed; host stays ready.
 *       This is the "host changed something, please reconfirm" UX
 *       path called out in the design doc.</li>
 *   <li>Seat leave — that user's username is removed.</li>
 *   <li>Table remove — entire entry is dropped.</li>
 * </ul>
 *
 * <p>Thread safety: every public method is safe for concurrent
 * invocation from Javalin worker threads; backing collections are
 * {@link ConcurrentHashMap} + {@link ConcurrentHashMap#newKeySet()}.
 */
public final class SeatReadyTracker {

    private final ConcurrentHashMap<UUID, Set<String>> readyByTable =
            new ConcurrentHashMap<>();

    /** Mark a username ready (or un-ready) for a table. */
    public void setReady(UUID tableId, String username, boolean ready) {
        if (tableId == null || username == null || username.isBlank()) {
            return;
        }
        Set<String> set = readyByTable.computeIfAbsent(tableId,
                k -> ConcurrentHashMap.newKeySet());
        if (ready) {
            set.add(username);
        } else {
            set.remove(username);
        }
    }

    /** Whether {@code username} is currently flagged ready at {@code tableId}. */
    public boolean isReady(UUID tableId, String username) {
        if (tableId == null || username == null || username.isBlank()) {
            return false;
        }
        Set<String> set = readyByTable.get(tableId);
        return set != null && set.contains(username);
    }

    /**
     * Reset to a single ready user (the host). Used when settings
     * change — host stays ready, guests must re-confirm.
     */
    public void resetToHost(UUID tableId, String hostUsername) {
        if (tableId == null) return;
        Set<String> next = ConcurrentHashMap.newKeySet();
        if (hostUsername != null && !hostUsername.isBlank()) {
            next.add(hostUsername);
        }
        readyByTable.put(tableId, next);
    }

    /** Drop the entire entry for a removed table. */
    public void removeTable(UUID tableId) {
        if (tableId == null) return;
        readyByTable.remove(tableId);
    }

    /** Test/debug-only: how many users are flagged ready right now. */
    int countReady(UUID tableId) {
        Set<String> set = readyByTable.get(tableId);
        return set == null ? 0 : set.size();
    }
}
