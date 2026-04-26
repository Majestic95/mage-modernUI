package mage.webapi.auth;

import mage.MageException;
import mage.server.DisconnectReason;
import mage.server.Main;
import mage.server.managers.SessionManager;
import mage.webapi.SchemaVersion;
import mage.webapi.WebApiException;
import mage.webapi.dto.WebSession;
import mage.webapi.embed.EmbeddedServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
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
 *       {@link NoOpCallbackHandler}, call {@code MageServerImpl
 *       .connectUser/connectAdmin}, store the {@link SessionEntry},
 *       enforce newest-wins on duplicate usernames (ADR 0004 D7).</li>
 *   <li>Logout — disconnect the upstream session and remove the
 *       token.</li>
 *   <li>Resolve — middleware uses {@link #resolveAndBump(String)} to
 *       validate a Bearer token and pull the associated session.</li>
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

    private final EmbeddedServer embedded;
    private final WebSessionStore store;
    private final ScheduledExecutorService sweeper;

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
     * Anonymous or authenticated login. Empty/blank password ⇒
     * {@code isAnonymous=true}. Empty/blank username ⇒ generated
     * {@code guest-XXXXXXXX}.
     */
    public WebSession login(String username, String password) {
        String resolvedUsername = (username == null || username.isBlank())
                ? GUEST_PREFIX + randomHex(GUEST_SUFFIX_BYTES)
                : username.trim();
        boolean isAnonymous = (password == null || password.isBlank());
        String upstreamSessionId = UUID.randomUUID().toString();

        registerUpstreamSession(upstreamSessionId);

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
        registerUpstreamSession(upstreamSessionId);

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
     */
    public Optional<WebSession> resolveAndBump(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        return store.getAndBump(token).map(this::toDto);
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
        sweeper.shutdownNow();
    }

    // ---------- internals ----------

    private void registerUpstreamSession(String upstreamSessionId) {
        sessionManager().createSession(upstreamSessionId, new NoOpCallbackHandler());
    }

    private void silentDisconnect(String upstreamSessionId) {
        silentDisconnect(upstreamSessionId, DisconnectReason.LostConnection);
    }

    private void silentDisconnect(String upstreamSessionId, DisconnectReason reason) {
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
        // Snapshot tokens to disconnect upstream after eviction. The
        // store evicts atomically; we just need to know which upstream
        // sessions are now orphaned.
        try {
            int evicted = store.evictExpired();
            if (evicted > 0) {
                LOG.info("WebApi sweep: evicted {} expired tokens", evicted);
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

    private WebSession toDto(SessionEntry e) {
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
