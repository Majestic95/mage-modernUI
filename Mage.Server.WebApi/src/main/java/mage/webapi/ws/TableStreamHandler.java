package mage.webapi.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.websocket.WsCloseContext;
import io.javalin.websocket.WsConfig;
import io.javalin.websocket.WsConnectContext;
import io.javalin.websocket.WsContext;
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

    /**
     * Slice L7 review (security-CRITICAL #1) — Origin allowlist for the
     * WS upgrade handshake. Browsers do NOT enforce same-origin on
     * {@code new WebSocket(...)}, so without an explicit Origin check
     * a malicious page could open a WS to localhost:18080 / the ngrok
     * tunnel and read table state for any authenticated user.
     *
     * <p>Set via {@link #allowOrigins} after construction; mirrors the
     * CORS list installed on the HTTP routes. Empty list = allow all
     * (dev default; tests don't carry an Origin header).
     */
    private volatile List<String> allowedOrigins = List.of();

    /**
     * Slice L7 review (security-MEDIUM #8) — per-token subscriber cap.
     * Without this, a single token can churn {@code new WebSocket(url)}
     * to exhaust file descriptors / the WS thread pool.
     */
    private static final int MAX_SUBS_PER_TOKEN_PER_TABLE = 4;

    public TableStreamHandler(AuthService authService,
                               EmbeddedServer embedded,
                               SeatReadyTracker readyTracker) {
        this.authService = authService;
        this.embedded = embedded;
        this.readyTracker = readyTracker;
    }

    /** Slice L7 review — install the Origin allowlist post-ctor. */
    public TableStreamHandler allowOrigins(List<String> origins) {
        this.allowedOrigins = List.copyOf(origins);
        return this;
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
        // Slice L7 review (security-CRITICAL #1) — Origin allowlist
        // BEFORE any auth or work. Cross-origin WS upgrades that don't
        // match the HTTP CORS allowlist get closed at the handshake.
        // Empty allowlist = dev mode (no enforcement).
        if (!allowedOrigins.isEmpty()) {
            String origin = ctx.header("Origin");
            if (origin != null && !allowedOrigins.contains(origin)) {
                closeWith(ctx, 4001, "Origin not allowed: " + origin);
                return;
            }
        }

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
        SessionEntry session = resolved.get();

        // Snapshot the current WebTable. If the table doesn't exist
        // (mid-restart, race against removeTable, etc.) we close 4404
        // rather than suspend a useless WebSocket.
        WebTable initial = currentSnapshot(tableId);
        if (initial == null) {
            closeWith(ctx, 4404, "Table not found: " + tableId);
            return;
        }

        // Slice L7 review (security-HIGH #3) — visibility check.
        // Public tables (passworded=false AND spectatorsAllowed=true)
        // are visible to any authed user. Otherwise the caller must be
        // seated at this table. Without this gate any authed user can
        // subscribe to any table's stream and read commander / deck /
        // ready info before joining.
        boolean publiclyVisible = !initial.passworded() && initial.spectatorsAllowed();
        boolean seated = isUserSeated(initial, session.username());
        if (!publiclyVisible && !seated) {
            closeWith(ctx, 4003, "Subscribe denied: caller is not seated.");
            return;
        }

        // Slice L7 review (security-MEDIUM #8) — per-(token, table)
        // subscriber cap. Counts existing subs from this token at this
        // table; reject if at the cap.
        Set<WsContext> existing = subscribers.get(tableId);
        if (existing != null) {
            int sameToken = 0;
            for (WsContext s : existing) {
                if (token.equals(s.queryParam("token"))) sameToken++;
            }
            if (sameToken >= MAX_SUBS_PER_TOKEN_PER_TABLE) {
                closeWith(ctx, 4029, "Subscriber cap reached.");
                return;
            }
        }

        ctx.attribute(ATTR_TABLE_ID, tableId);
        subscribers
                .computeIfAbsent(tableId, k -> ConcurrentHashMap.newKeySet())
                .add(ctx);
        LOG.info("WS table connect: user={} table={} ({} subscribers)",
                session.username(), tableId,
                subscribers.get(tableId).size());

        sendFrame(ctx, tableId, initial);
    }

    /**
     * Slice L7 review — case-insensitive trim-aware seat membership
     * check, mirroring the client's identity normalization in
     * {@code webTableToLobby.ts}. Used by the visibility gate in
     * {@link #onConnect} to decide whether an authed caller may
     * subscribe to a non-public table.
     */
    private static boolean isUserSeated(WebTable table, String username) {
        if (username == null) return false;
        String norm = username.trim().toLowerCase();
        if (norm.isEmpty()) return false;
        for (mage.webapi.dto.WebSeat s : table.seats()) {
            if (!s.occupied()) continue;
            if (norm.equals(s.playerName().trim().toLowerCase())) return true;
        }
        return false;
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

    /**
     * Build a {@link WebTable} from current upstream + tracker state.
     *
     * <p>Slice L7 review fix — read directly from
     * {@code TableManager.getController(tableId).getTable()} rather
     * than {@code roomGetAllTables}. The latter returns the
     * {@code GamesRoomImpl.lobbyTables} cache which refreshes only
     * every 2s, so a freshly-created table failed its own first WS
     * snapshot for that window — clients connecting immediately after
     * {@code POST /tables} got a 4404 close and "Table closed."
     * Reading the live {@link Table} via the manager bypasses the
     * cache entirely.
     */
    private WebTable currentSnapshot(UUID tableId) {
        try {
            var tableManager = embedded.managerFactory().tableManager();
            var tcOpt = tableManager.getController(tableId);
            if (tcOpt.isEmpty()) return null;
            mage.game.Table table = tcOpt.get().getTable();
            if (table == null) return null;
            TableView view = new TableView(table);
            return TableMapper.table(view, tableManager, readyTracker);
        } catch (RuntimeException ex) {
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
