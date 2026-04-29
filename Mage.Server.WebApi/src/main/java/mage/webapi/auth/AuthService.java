package mage.webapi.auth;

import mage.MageException;
import mage.server.DisconnectReason;
import mage.server.Main;
import mage.server.managers.SessionManager;
import mage.webapi.SchemaVersion;
import mage.webapi.WebApiException;
import mage.webapi.dto.WebSession;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.ws.WebSocketCallbackHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Orchestrates the WebApi auth layer described by ADR 0004. Bridges
 * each WebApi token to exactly one upstream {@code SessionManagerImpl}
 * session.
 *
 * <p>Responsibilities:
 * <ul>
 *   <li>Login / loginAdmin — register an upstream session with a
 *       per-session {@link WebSocketCallbackHandler} (slice 5 used a
 *       {@code NoOpCallbackHandler}; Phase 3 slice 1 replaced it), call
 *       {@code MageServerImpl.connectUser/connectAdmin}, store the
 *       {@link SessionEntry}, enforce newest-wins on duplicate
 *       usernames (ADR 0004 D7).</li>
 *   <li>Logout — disconnect the upstream session and remove the
 *       token.</li>
 *   <li>Resolve — middleware uses {@link #resolveAndBump(String)} to
 *       validate a Bearer token and pull the associated session.</li>
 *   <li>Stream lookup — {@link #handlerFor(String)} returns the
 *       per-session WebSocket handler so the WS upgrade handler can
 *       register an open socket on it (ADR 0007 D3).</li>
 *   <li>Sweep — every 60 s, evict expired tokens. Disconnects the
 *       upstream session for each eviction so the upstream side
 *       doesn't leak.</li>
 * </ul>
 */
public final class AuthService implements AutoCloseable {

    private static final Logger LOG = LoggerFactory.getLogger(AuthService.class);
    private static final SecureRandom RNG = new SecureRandom();
    private static final String GUEST_PREFIX = "guest-";
    private static final int GUEST_SUFFIX_BYTES = 4; // 8 hex chars

    /**
     * Slice 64 — allowed user-supplied usernames: alphanumeric,
     * underscore, hyphen, 1-32 chars. Rejects spaces, control chars,
     * unicode confusables, and HTML-injection bait. Generated guest
     * names ({@link #GUEST_PREFIX}) are server-issued and bypass this
     * check.
     */
    private static final java.util.regex.Pattern USERNAME_PATTERN =
            java.util.regex.Pattern.compile("[a-zA-Z0-9_-]{1,32}");

    private final EmbeddedServer embedded;
    private final WebSessionStore store;
    private final ScheduledExecutorService sweeper;
    private final ConcurrentHashMap<String, WebSocketCallbackHandler> handlersBySessionId =
            new ConcurrentHashMap<>();

    public AuthService(EmbeddedServer embedded, WebSessionStore store) {
        this.embedded = embedded;
        this.store = store;
        this.sweeper = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "webapi-session-sweeper");
            t.setDaemon(true);
            return t;
        });
        this.sweeper.scheduleAtFixedRate(this::sweep, 60, 60, TimeUnit.SECONDS);
    }

    /**
     * Look up the per-session WebSocket callback handler. Used by the
     * WS upgrade handler ({@link mage.webapi.ws.GameStreamHandler}) to
     * register a freshly-opened socket on the handler that upstream is
     * already pushing callbacks to. Empty optional means the upstream
     * session no longer exists — the WS connect should reject.
     */
    public Optional<WebSocketCallbackHandler> handlerFor(String upstreamSessionId) {
        return Optional.ofNullable(handlersBySessionId.get(upstreamSessionId));
    }

    /**
     * Anonymous or authenticated login. Empty/blank password ⇒
     * {@code isAnonymous=true}. Empty/blank username ⇒ generated
     * {@code guest-XXXXXXXX}.
     *
     * <p>Slice 64 — user-supplied usernames are validated against
     * {@link #USERNAME_PATTERN} and rejected if they begin with the
     * reserved {@link #GUEST_PREFIX}. The anonymous path (null/blank
     * username) bypasses validation since the generated guest name is
     * server-issued, not user-supplied.
     */
    public WebSession login(String username, String password) {
        String resolvedUsername;
        if (username == null || username.isBlank()) {
            resolvedUsername = GUEST_PREFIX + randomHex(GUEST_SUFFIX_BYTES);
        } else {
            resolvedUsername = username.trim();
            validateUsername(resolvedUsername);
        }
        boolean isAnonymous = (password == null || password.isBlank());
        String upstreamSessionId = UUID.randomUUID().toString();

        registerUpstreamSession(upstreamSessionId, resolvedUsername);

        boolean ok;
        try {
            ok = embedded.server().connectUser(
                    resolvedUsername,
                    isAnonymous ? "" : password,
                    upstreamSessionId,
                    "",
                    Main.getVersion(),
                    ""
            );
        } catch (MageException ex) {
            silentDisconnect(upstreamSessionId);
            throw new WebApiException(500, "UPSTREAM_ERROR",
                    "Upstream server error during login: " + ex.getMessage());
        }
        if (!ok) {
            silentDisconnect(upstreamSessionId);
            throw new WebApiException(401, "INVALID_CREDENTIALS",
                    "Login failed. Check username and password.");
        }

        revokePriorTokensForSameUsername(resolvedUsername);

        SessionEntry entry = newEntry(upstreamSessionId, resolvedUsername, isAnonymous, false);
        store.put(entry);
        LOG.info("WebApi session created: user={}, anon={}", resolvedUsername, isAnonymous);
        return toDto(entry);
    }

    /**
     * Admin login. Upstream's {@code connectAdmin} throws
     * {@code MageException("Wrong password")} (with a built-in 3 s
     * delay) on bad credentials rather than returning false — we map
     * any {@code MageException} to {@code INVALID_ADMIN_PASSWORD}
     * since version mismatch is impossible in-process.
     */
    public WebSession loginAdmin(String adminPassword) {
        String upstreamSessionId = UUID.randomUUID().toString();
        registerUpstreamSession(upstreamSessionId, "Admin");

        boolean ok;
        try {
            ok = embedded.server().connectAdmin(
                    adminPassword == null ? "" : adminPassword,
                    upstreamSessionId,
                    Main.getVersion()
            );
        } catch (MageException ex) {
            silentDisconnect(upstreamSessionId);
            // Upstream already incurred its 3 s anti-brute-force delay inside
            // connectAdmin before throwing.
            throw new WebApiException(401, "INVALID_ADMIN_PASSWORD",
                    "Wrong admin password.");
        }
        if (!ok) {
            silentDisconnect(upstreamSessionId);
            throw new WebApiException(401, "INVALID_ADMIN_PASSWORD",
                    "Wrong admin password.");
        }

        revokePriorTokensForSameUsername("Admin");

        SessionEntry entry = newEntry(upstreamSessionId, "Admin", false, true);
        store.put(entry);
        LOG.info("WebApi admin session created: token={}", maskToken(entry.token()));
        return toDto(entry);
    }

    /**
     * Resolve a Bearer token. Bumps sliding expiry on the way through.
     * Empty Optional ⇒ token unknown or expired (the middleware turns
     * this into 401).
     *
     * <p>Returns the internal {@link SessionEntry} so callers (the
     * middleware, routes that need the upstream sessionId) get full
     * context. Build the public {@link WebSession} DTO via
     * {@link #toDto(SessionEntry)}.
     */
    public Optional<SessionEntry> resolveAndBump(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        return store.getAndBump(token);
    }

    /** Build the public {@link WebSession} DTO from an internal entry. */
    public WebSession toDto(SessionEntry entry) {
        return toDtoInternal(entry);
    }

    /** Logout. Removes the WebApi token and disconnects the upstream session. */
    public boolean logout(String token) {
        Optional<SessionEntry> removed = store.remove(token);
        removed.ifPresent(e -> {
            silentDisconnect(e.upstreamSessionId(), DisconnectReason.DisconnectedByUser);
            LOG.info("WebApi session ended: user={}", e.username());
        });
        return removed.isPresent();
    }

    @Override
    public void close() {
        // Graceful shutdown: stop accepting new sweep ticks, then wait
        // briefly for any in-flight sweep to finish so its cleanup
        // (close sockets + disconnect upstream) doesn't get interrupted
        // mid-iteration. Hardening fix 2026-04-26.
        sweeper.shutdown();
        try {
            if (!sweeper.awaitTermination(5, TimeUnit.SECONDS)) {
                sweeper.shutdownNow();
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            sweeper.shutdownNow();
        }
    }

    // ---------- internals ----------

    /**
     * Slice 64 — username validation. Rejects:
     * <ul>
     *   <li>usernames not matching {@link #USERNAME_PATTERN} (alphanumeric +
     *     underscore + hyphen, 1-32 chars)</li>
     *   <li>usernames starting with {@link #GUEST_PREFIX} (reserved for
     *     anonymous-session generation)</li>
     * </ul>
     *
     * <p>Anonymous sessions (no username supplied) bypass this check —
     * the generated guest-XXXXXXXX name is server-issued, not user-supplied.
     * The case-insensitive prefix check catches {@code Guest-foo} and
     * {@code GUEST-FOO} so an attacker cannot impersonate a guest by
     * varying letter case.
     */
    private void validateUsername(String username) {
        if (!USERNAME_PATTERN.matcher(username).matches()) {
            throw new WebApiException(400, "INVALID_USERNAME",
                    "Username must match [a-zA-Z0-9_-]{1,32} (alphanumeric, "
                    + "underscore, hyphen, 1-32 chars).");
        }
        if (username.toLowerCase().startsWith(GUEST_PREFIX)) {
            throw new WebApiException(400, "RESERVED_PREFIX",
                    "Username prefix '" + GUEST_PREFIX + "' is reserved for "
                    + "anonymous sessions.");
        }
    }

    private void registerUpstreamSession(String upstreamSessionId, String username) {
        // Slice 52a — pass the EmbeddedServer through so the handler
        // can resolve stack-cardId hints via GameLookup. The
        // alternative (a static accessor) would couple every test to
        // a live embedded singleton; ctor injection keeps the unit
        // tests that synthesize a handler directly working.
        WebSocketCallbackHandler handler = new WebSocketCallbackHandler(username, embedded);
        handlersBySessionId.put(upstreamSessionId, handler);
        sessionManager().createSession(upstreamSessionId, handler);
    }

    private void silentDisconnect(String upstreamSessionId) {
        silentDisconnect(upstreamSessionId, DisconnectReason.LostConnection);
    }

    private void silentDisconnect(String upstreamSessionId, DisconnectReason reason) {
        // Close any registered WebSockets so connected clients observe
        // the close instead of holding TCP open until Jetty timeout.
        // Then drop the handler from the map and disconnect upstream.
        // Hardening fix 2026-04-26.
        WebSocketCallbackHandler handler = handlersBySessionId.remove(upstreamSessionId);
        if (handler != null) {
            handler.closeAllSockets(1000, "session ended: " + reason);
        }
        try {
            sessionManager().disconnect(upstreamSessionId, reason, false);
        } catch (RuntimeException ex) {
            LOG.debug("ignored exception while disconnecting upstream session {}: {}",
                    upstreamSessionId, ex.getMessage());
        }
    }

    private void revokePriorTokensForSameUsername(String username) {
        store.removeAllByUsername(username).forEach(prior ->
                silentDisconnect(prior.upstreamSessionId(), DisconnectReason.AnotherUserInstance));
    }

    private void sweep() {
        // Per-entry cleanup: close sockets, drop handler, disconnect
        // upstream Session. The slice-1 sweep used to drop only the
        // token from the store, leaving handlers + upstream Sessions
        // resident as a slow leak (~1 KB per idle session, growing
        // with idle population). Hardening fix 2026-04-26.
        try {
            List<SessionEntry> evicted = store.evictExpiredEntries();
            for (SessionEntry e : evicted) {
                silentDisconnect(e.upstreamSessionId(), DisconnectReason.SessionExpired);
            }
            if (!evicted.isEmpty()) {
                LOG.info("WebApi sweep: evicted {} expired tokens", evicted.size());
            }
        } catch (RuntimeException ex) {
            LOG.warn("WebApi sweep error", ex);
        }
    }

    private SessionEntry newEntry(String upstreamSessionId, String username,
                                   boolean isAnonymous, boolean isAdmin) {
        Instant now = store.now();
        return new SessionEntry(
                UUID.randomUUID().toString(),
                upstreamSessionId,
                username,
                isAnonymous,
                isAdmin,
                now,
                now.plus(WebSessionStore.TOKEN_TTL)
        );
    }

    private WebSession toDtoInternal(SessionEntry e) {
        return new WebSession(
                SchemaVersion.CURRENT,
                e.token(),
                e.username(),
                e.isAnonymous(),
                e.isAdmin(),
                e.expiresAt().toString()
        );
    }

    private SessionManager sessionManager() {
        return embedded.managerFactory().sessionManager();
    }

    private static String randomHex(int bytes) {
        byte[] buf = new byte[bytes];
        RNG.nextBytes(buf);
        StringBuilder out = new StringBuilder(bytes * 2);
        for (byte b : buf) {
            out.append(String.format("%02x", b));
        }
        return out.toString();
    }

    private static String maskToken(String token) {
        if (token == null || token.length() < 8) {
            return "***";
        }
        return token.substring(0, 4) + "…" + token.substring(token.length() - 4);
    }
}
