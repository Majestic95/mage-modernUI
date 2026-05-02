package mage.webapi.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.websocket.WsCloseContext;
import io.javalin.websocket.WsConfig;
import io.javalin.websocket.WsConnectContext;
import io.javalin.websocket.WsContext;
import mage.MageException;
import mage.view.TableView;
import mage.webapi.SchemaVersion;
import mage.webapi.auth.AuthService;
import mage.webapi.auth.SessionEntry;
import mage.webapi.dto.WebTable;
import mage.webapi.dto.stream.WebStreamFrame;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.lobby.SeatReadyTracker;
import mage.webapi.mapper.TableMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * Slice L7 (new-lobby-window) — per-table WebSocket stream that pushes
 * {@link WebTable} snapshots whenever the table mutates. Replaces the
 * 5s polling on {@code GET /api/rooms/{r}/tables} for the new lobby
 * screen, so ready toggles, deck swaps, seat joins, and settings
 * edits propagate &lt;100ms.
 *
 * <p>Frame shape (mirrors {@link WebStreamFrame}):
 * <pre>{@code
 * {
 *   schemaVersion: "1.27",
 *   method: "tableUpdate",
 *   messageId: <monotonic>,
 *   objectId: "<tableId>",
 *   data: { ...WebTable }
 * }
 * }</pre>
 *
 * <p>Inbound surface: none. Clients use the existing REST endpoints
 * for mutations ({@code POST /seat/ready}, {@code PUT /seat/deck},
 * {@code PATCH /tables/{t}}, etc.); this stream is push-only.
 *
 * <p>Close codes:
 * <ul>
 *   <li>{@code 1000} — normal close</li>
 *   <li>{@code 4001} — auth failed at upgrade</li>
 *   <li>{@code 4003} — tableId malformed</li>
 *   <li>{@code 4404} — table not found at the moment of connect (the
 *       client should drop back to the table-list screen)</li>
 * </ul>
 */
public final class TableStreamHandler implements Consumer<WsConfig> {

    private static final Logger LOG = LoggerFactory.getLogger(TableStreamHandler.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String ATTR_TABLE_ID = "webapi.lobbyTableId";

    private final AuthService authService;
    private final EmbeddedServer embedded;
    private final SeatReadyTracker readyTracker;

    /** tableId → set of subscribed contexts. */
    private final ConcurrentHashMap<UUID, Set<WsContext>> subscribers =
            new ConcurrentHashMap<>();
    private final AtomicInteger messageId = new AtomicInteger(0);

    public TableStreamHandler(AuthService authService,
                               EmbeddedServer embedded,
                               SeatReadyTracker readyTracker) {
        this.authService = authService;
        this.embedded = embedded;
        this.readyTracker = readyTracker;
    }

    @Override
    public void accept(WsConfig ws) {
        ws.onConnect(this::onConnect);
        ws.onClose(this::onClose);
        ws.onError(ctx -> LOG.warn("WS error on /api/rooms/{}/tables/{}/stream: {}",
                ctx.pathParam("roomId"), ctx.pathParam("tableId"),
                ctx.error() == null ? "<no detail>" : ctx.error().toString()));
    }

    private void onConnect(WsConnectContext ctx) {
        String tableIdRaw = ctx.pathParam("tableId");
        UUID tableId;
        try {
            tableId = UUID.fromString(tableIdRaw);
        } catch (IllegalArgumentException ex) {
            closeWith(ctx, 4003, "tableId must be a UUID: " + tableIdRaw);
            return;
        }

        String token = ctx.queryParam("token");
        if (token == null || token.isBlank()) {
            closeWith(ctx, 4001, "MISSING_TOKEN");
            return;
        }
        Optional<SessionEntry> resolved = authService.resolveAndBump(token);
        if (resolved.isEmpty()) {
            closeWith(ctx, 4001, "INVALID_TOKEN");
            return;
        }

        // Snapshot the current WebTable. If the table doesn't exist
        // (mid-restart, race against removeTable, etc.) we close 4404
        // rather than suspend a useless WebSocket.
        WebTable initial = currentSnapshot(tableId);
        if (initial == null) {
            closeWith(ctx, 4404, "Table not found: " + tableId);
            return;
        }

        ctx.attribute(ATTR_TABLE_ID, tableId);
        subscribers
                .computeIfAbsent(tableId, k -> ConcurrentHashMap.newKeySet())
                .add(ctx);
        LOG.info("WS table connect: user={} table={} ({} subscribers)",
                resolved.get().username(), tableId,
                subscribers.get(tableId).size());

        sendFrame(ctx, tableId, initial);
    }

    private void onClose(WsCloseContext ctx) {
        Object attr = ctx.attribute(ATTR_TABLE_ID);
        if (!(attr instanceof UUID tableId)) {
            return;
        }
        Set<WsContext> set = subscribers.get(tableId);
        if (set == null) return;
        set.remove(ctx);
        if (set.isEmpty()) {
            subscribers.remove(tableId);
        }
    }

    /**
     * Push the current state to every subscriber of {@code tableId}.
     * Called by {@link mage.webapi.lobby.LobbyService} after every
     * mutation that changes the wire shape.
     */
    public void broadcast(UUID tableId) {
        Set<WsContext> subs = subscribers.get(tableId);
        if (subs == null || subs.isEmpty()) return;
        WebTable snapshot = currentSnapshot(tableId);
        if (snapshot == null) {
            // Table got removed before broadcast fired. Close all
            // subscribers so they fall back to the table-list screen.
            for (WsContext ctx : subs) {
                closeWith(ctx, 4404, "Table closed.");
            }
            subscribers.remove(tableId);
            return;
        }
        for (WsContext ctx : subs) {
            try {
                sendFrame(ctx, tableId, snapshot);
            } catch (RuntimeException ex) {
                // One bad subscriber shouldn't tank the broadcast.
                LOG.warn("Broadcast send failed: table={}: {}",
                        tableId, ex.getMessage());
            }
        }
    }

    /** Build a {@link WebTable} from current upstream + tracker state. */
    private WebTable currentSnapshot(UUID tableId) {
        try {
            // We don't have a direct "get one table" endpoint upstream;
            // the listing is the only path that yields TableViews. Free-
            // tier cost: O(rooms × tables); for the singleton lobby this
            // is just iterating a small list per broadcast.
            UUID roomId = embedded.server().serverGetMainRoomId();
            List<TableView> views = embedded.server().roomGetAllTables(roomId);
            if (views == null) return null;
            for (TableView v : views) {
                if (tableId.equals(v.getTableId())) {
                    return TableMapper.table(v,
                            embedded.managerFactory().tableManager(),
                            readyTracker);
                }
            }
            // Not in the listing — table likely removed or just-created
            // and not yet visible (GamesRoomImpl refreshes lobbyTables
            // every 2s). The poll-fallback the client retains will
            // pick it up on the next refresh.
            return null;
        } catch (MageException ex) {
            LOG.warn("Snapshot failed for table {}: {}", tableId, ex.getMessage());
            return null;
        }
    }

    private void sendFrame(WsContext ctx, UUID tableId, WebTable table) {
        WebStreamFrame frame = new WebStreamFrame(
                SchemaVersion.CURRENT,
                "tableUpdate",
                messageId.incrementAndGet(),
                tableId.toString(),
                table
        );
        try {
            ctx.send(JSON.writeValueAsString(frame));
        } catch (Exception ex) {
            LOG.warn("Frame serialize failed for table {}: {}",
                    tableId, ex.getMessage());
        }
    }

    private static void closeWith(WsContext ctx, int code, String reason) {
        try {
            ctx.session.close(code, reason);
        } catch (RuntimeException ignored) {
            // Best-effort; underlying session may already be closed.
        }
    }
}
