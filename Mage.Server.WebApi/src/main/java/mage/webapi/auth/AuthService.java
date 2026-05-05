package mage.webapi.auth;

import mage.MageException;
import mage.players.net.UserData;
import mage.server.DisconnectReason;
import mage.server.Main;
import mage.server.managers.SessionManager;
import mage.webapi.SchemaVersion;
import mage.webapi.WebApiException;
import mage.webapi.dto.WebSession;
import mage.webapi.dto.stream.WebPlayerView;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.upstream.GameLookup;
import mage.webapi.ws.WebSocketCallbackHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.List;
import java.util.Map;
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
     * Slice 70-X.13 — reserved upstream username for admin sessions.
     * Used both by {@link #loginAdmin} (passed verbatim to
     * {@code connectAdmin}) and by {@link #validateUsername} to reject
     * normal logins squatting the same display name. The literal must
     * match upstream's {@code MageServerImpl.connectAdmin} hard-coded
     * "Admin" string — keep in sync if upstream ever renames it.
     *
     * <p>Without this reserve, a regular {@code POST /api/session}
     * with {@code {"username":"Admin"}} would match
     * {@link #USERNAME_PATTERN}, call
     * {@code revokePriorTokensForSameUsername("Admin")} (case-
     * insensitive) which kicks the live admin offline, and squat the
     * "Admin" upstream display name in chat / logs.
     */
    private static final String ADMIN_USERNAME = "Admin";

    /**
     * Slice 64 — allowed user-supplied usernames: alphanumeric,
     * underscore, hyphen. Rejects spaces, control chars, unicode
     * confusables, and HTML-injection bait. Generated guest names
     * ({@link #GUEST_PREFIX}) are server-issued and bypass this
     * check.
     *
     * <p>Slice F21 (2026-05-04) — length tightened from {1,32} to
     * {3,14} to mirror upstream's hard cap. Upstream's
     * {@code Session.connectUserHandling} reads
     * {@code config.getMaxUserNameLength()} (default 14) and rejects
     * longer names with "User name may not be longer than 14
     * characters", returning false from {@code connectUser}. Our
     * lenient pre-cap silently produced 401s on the upstream side.
     * Min 3 because upstream rejects names ≤ 2 chars at line 156 of
     * Session.java. Adjust BOTH if upstream's config changes.
     */
    private static final java.util.regex.Pattern USERNAME_PATTERN =
            java.util.regex.Pattern.compile("[a-zA-Z0-9_-]{3,14}");

    private final EmbeddedServer embedded;
    private final WebSessionStore store;
    private final ScheduledExecutorService sweeper;
    /**
     * Slice F21.3 (audit Sec B2) — per-username login-attempt
     * lockout tracker. Defends against credential brute-force from
     * rotating IPs (which defeat the per-IP rate limiter). In-
     * memory; resets on JVM restart. See {@link LoginAttemptTracker}.
     */
    private final LoginAttemptTracker loginAttempts = new LoginAttemptTracker();
    /**
     * Slice 70-H.5 — single shared {@link ScheduledExecutorService} for
     * the per-prompt disconnect-timers (per critic N11 of slice 70-H
     * technical critic). One daemon thread services every handler's
     * timer; bounded ownership beats N daemon threads for N users.
     * Cleanly shut down in {@link #close()} alongside the session
     * sweeper.
     */
    private final ScheduledExecutorService disconnectTimerScheduler;
    private final ConcurrentHashMap<String, WebSocketCallbackHandler> handlersBySessionId =
            new ConcurrentHashMap<>();
    /**
     * Slice 70-X.13 (Wave 3) — secondary index keyed by lowercase
     * username. Atomically maintained alongside
     * {@link #handlersBySessionId} so {@link #handlerByUsername} is
     * O(1) AND cannot observe both an OLD revoked handler and the
     * NEW handler simultaneously during a duplicate-login race.
     *
     * <p>Pre-Wave-3, {@code handlerByUsername} did a linear scan
     * over {@code handlersBySessionId.values()} and returned the
     * first match. Between {@code registerUpstreamSession(NEW)}
     * (line in login flow) and {@code revokePriorTokensForSameUsername}
     * (after login success), BOTH old and new handlers were in the
     * primary map. Iteration could return EITHER — meaning
     * {@code connectionStateFor} could surface a connection state
     * for the about-to-be-killed handler, painting a stale frame.
     *
     * <p>Atomicity contract: every {@code put} on
     * {@link #handlersBySessionId} also puts here (overwrite-OK,
     * keyed by lowercase username). Every {@code remove} on the
     * primary uses {@code remove(key, value)} on this secondary,
     * so a pending revoke does NOT inadvertently remove a NEWER
     * handler that overwrote in the window between the two calls.
     * Concurrent register-new + revoke-old yield exactly one
     * surviving entry.
     */
    private final ConcurrentHashMap<String, WebSocketCallbackHandler> handlersByUsername =
            new ConcurrentHashMap<>();
    /**
     * Slice 70-H.5 — disconnect-timeout in seconds, read from
     * {@code XMAGE_DISCONNECT_TIMEOUT_SEC} at construction time.
     * Default 60; clamped to [30, 180]. Bad values fall back to the
     * default with a WARN log (per critic N10 — soft-fail, not throw,
     * since this is non-load-bearing UX timing).
     */
    private final int disconnectTimeoutSeconds;

    public AuthService(EmbeddedServer embedded, WebSessionStore store) {
        // F21.6 (audit Corr E1) — startup self-test for the
        // reflective password-verify path. Fails fast at WebApi
        // construction if upstream's AuthorizedUser shape has
        // drifted (renamed fields, type changes). Without this, a
        // future upstream rebase that renames any of the four
        // reflected fields would silently break ALL registered-user
        // logins (verifyPasswordReflective returns false; users see
        // INVALID_CREDENTIALS indistinguishable from real bad creds).
        verifyReflectionShapeOrFail();
        this.embedded = embedded;
        this.store = store;
        this.sweeper = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "webapi-session-sweeper");
            t.setDaemon(true);
            return t;
        });
        this.sweeper.scheduleAtFixedRate(this::sweep, 60, 60, TimeUnit.SECONDS);
        this.disconnectTimerScheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "webapi-disconnect-timer");
            t.setDaemon(true);
            return t;
        });
        this.disconnectTimeoutSeconds = readDisconnectTimeoutSeconds();
        LOG.info("Disconnect-timer policy: {}s on prompt-open + last-socket-close",
                disconnectTimeoutSeconds);
    }

    /**
     * Slice 70-H.5 — accessor for the shared disconnect-timer
     * scheduler. Per critic N11, one scheduler at AuthService level
     * (one daemon thread, predictable shutdown) beats N per-handler
     * schedulers for N users.
     */
    public ScheduledExecutorService disconnectTimerScheduler() {
        return disconnectTimerScheduler;
    }

    /**
     * Slice 70-H.5 — disconnect-timer duration in seconds. Read from
     * {@code XMAGE_DISCONNECT_TIMEOUT_SEC} env var at AuthService
     * construction; clamped to [30, 180] with WARN-on-fallback (per
     * critic N10). The bound matches reasonable network-blip tolerance
     * (30s lower bound prevents flickering on brief re-connects;
     * 180s upper bound caps the worst-case "stuck game" window).
     */
    public int disconnectTimeoutSeconds() {
        return disconnectTimeoutSeconds;
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
     * Slice 70-H — find the active {@link WebSocketCallbackHandler}
     * (if any) for {@code username}. Returns the first matching
     * handler in iteration order; the newest-wins login policy
     * (ADR 0004 D7) ensures at most one handler exists per username
     * at any time, so iteration order is observable but not load-
     * bearing.
     *
     * <p>Used by {@link #connectionStateFor(UUID, UUID)} to ask "is
     * the player whose username is X currently connected on a
     * player-route socket in this game?" — a building block for the
     * schema-1.23 {@link WebPlayerView#connectionState} wire field.
     *
     * <p>Linear scan over a {@link ConcurrentHashMap}; O(N) in
     * active sessions, but N is small (mostly &lt;100 across a
     * playtest) and the call is made at most once per opponent per
     * mapped frame. If session counts grow large, a secondary index
     * by username can be added to the registry; benchmark first.
     */
    public Optional<WebSocketCallbackHandler> handlerByUsername(String username) {
        if (username == null) {
            return Optional.empty();
        }
        // Slice 70-X.13 (Wave 3) — O(1) lookup via the secondary
        // index. Eliminates the duplicate-login race where the linear
        // scan could observe an OLD doomed handler before revoke
        // removed it.
        WebSocketCallbackHandler indexed =
                handlersByUsername.get(usernameKey(username));
        if (indexed != null) {
            return Optional.of(indexed);
        }
        // Fallback: defensive linear scan in case the secondary index
        // is briefly out of sync with the primary (every put happens
        // in registerUpstreamSession, but a future code path that
        // forgets to update both maps would silently degrade lookup
        // unless we keep this fallback).
        for (WebSocketCallbackHandler h : handlersBySessionId.values()) {
            if (username.equals(h.username())) {
                return Optional.of(h);
            }
        }
        return Optional.empty();
    }

    /**
     * Slice 70-H (ADR 0011 D3 / ADR 0010 v2 D11(e)) — return the
     * connection state of {@code playerId} in {@code gameId} for the
     * schema-1.23 {@link WebPlayerView#connectionState} wire field.
     * Implements the {@code WebSocketConnectionTracker} contract that
     * the per-frame {@link mage.webapi.upstream.MultiplayerFrameContext}
     * threads into the mapper.
     *
     * <p>Resolution chain:
     * <ol>
     *   <li>{@code playerId} → {@code userId} via the engine's
     *       per-game {@code userPlayerMap} (reverse-lookup since
     *       upstream stores it as userId → playerId).</li>
     *   <li>{@code userId} → {@code username} via the
     *       {@code UserManager}.</li>
     *   <li>{@code username} → handler via
     *       {@link #handlerByUsername}.</li>
     *   <li>{@code handler.gamePlayerSocketCount(gameId) &gt; 0}
     *       (route-filtered, per critic C3) → connected.</li>
     * </ol>
     *
     * <p>Defensive fail-open at every step: any null intermediate
     * returns {@code "connected"}. Reasons:
     * <ul>
     *   <li>AI players have no entry in {@code userPlayerMap} — they
     *       are always "connected" semantically (no socket needed).</li>
     *   <li>A transient lookup failure must not paint a healthy
     *       player as disconnected — the DISCONNECTED overlay is
     *       visible UX, fail-open is the safer default.</li>
     *   <li>Username with no active handler IS a real disconnected
     *       case (logged out without {@code hasLeft}) — that path
     *       returns DISCONNECTED.</li>
     * </ul>
     */
    public String connectionStateFor(UUID gameId, UUID playerId) {
        if (gameId == null || playerId == null) {
            return WebPlayerView.CONNECTION_STATE_CONNECTED;
        }
        Optional<Map<UUID, UUID>> userPlayerMap = GameLookup.findUserPlayerMap(
                gameId, embedded.managerFactory());
        if (userPlayerMap.isEmpty()) {
            return WebPlayerView.CONNECTION_STATE_CONNECTED;
        }
        UUID userId = null;
        for (Map.Entry<UUID, UUID> e : userPlayerMap.get().entrySet()) {
            if (playerId.equals(e.getValue())) {
                userId = e.getKey();
                break;
            }
        }
        if (userId == null) {
            // AI player or unknown — fail-open. AI never disconnects.
            return WebPlayerView.CONNECTION_STATE_CONNECTED;
        }
        String otherUsername = embedded.managerFactory().userManager()
                .getUser(userId)
                .map(mage.server.User::getName)
                .orElse(null);
        if (otherUsername == null) {
            return WebPlayerView.CONNECTION_STATE_CONNECTED;
        }
        WebSocketCallbackHandler handler = handlerByUsername(otherUsername).orElse(null);
        if (handler == null) {
            // No active handler = logged out / never logged in.
            // Treat as disconnected (intermediate state — hasLeft is
            // the terminal state). Recoverable on re-login.
            return WebPlayerView.CONNECTION_STATE_DISCONNECTED;
        }
        return handler.gamePlayerSocketCount(gameId) > 0
                ? WebPlayerView.CONNECTION_STATE_CONNECTED
                : WebPlayerView.CONNECTION_STATE_DISCONNECTED;
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
        // Slice F19 (2026-05-04, audit C1 + C3 fix) — WebApi-side
        // password verification against the upstream
        // AuthorizedUserRepository. F18 left this entirely to upstream's
        // Session.connectUserHandling, which only verifies when
        // configSettings().isAuthenticationActivated() is true (default
        // false in xmage). That meant a registered user could be
        // impersonated with any password. Now: if a row exists for
        // this username, the supplied password MUST match the stored
        // hash regardless of the upstream flag. Anonymous login for
        // usernames WITHOUT a row continues to work unchanged.
        mage.server.AuthorizedUser stored = mage.server.AuthorizedUserRepository
                .getInstance().getByName(resolvedUsername);
        if (stored != null) {
            // F21.3 (audit Sec B2) — per-username lockout check.
            // Fires BEFORE the password verify so a locked-out
            // attacker can't even time the verification call.
            long lockedUntilMs = loginAttempts.lockedUntil(resolvedUsername);
            if (lockedUntilMs > 0L) {
                long remainingSec =
                        Math.max(1L, (lockedUntilMs - System.currentTimeMillis()) / 1000L);
                throw new WebApiException(429, "ACCOUNT_LOCKED",
                        "Too many sign-in attempts for this account. "
                                + "Try again in " + remainingSec + " seconds.");
            }
            if (password == null || password.isBlank()) {
                throw new WebApiException(401, "PASSWORD_REQUIRED",
                        "This username is registered. Provide the password.");
            }
            // Slice F19 — verify the password ourselves by reproducing
            // upstream's SimpleHash math (see verifyPasswordReflective).
            // This is the SECURITY-CRITICAL fix from audit C1: wrong
            // passwords for a registered user MUST be rejected at the
            // WebApi layer regardless of upstream's authenticationActivated
            // flag. Right-password happy path past this point is currently
            // broken by an unrelated upstream issue: Session.connectUser
            // returns false for a known username when the password
            // verifies but `authenticationActivated=false`. Tracking that
            // as a flip-blocker in `docs/decisions/auth-roadmap.md`. F19's
            // contribution is the wrong-password REJECTION; the right-
            // password ACCEPT path follows in a separate slice that fixes
            // upstream's connectUser interaction.
            // F21.5 — NFKC normalize the supplied password so a
            // user who typed "café" (composed) at register time can
            // sign in with "café" (decomposed) and vice versa.
            // verifyPasswordReflective re-computes the hash with
            // password.getBytes(UTF-8); if the bytes differ from
            // what register stored, it returns false. Normalizing
            // both sides at the same boundary point ensures the
            // hash math sees identical input.
            String normalizedPassword =
                    java.text.Normalizer.normalize(password, java.text.Normalizer.Form.NFKC);
            if (!verifyPasswordReflective(stored, normalizedPassword)) {
                // F21.3 — count this failure toward per-username
                // lockout so 5 wrong-password attempts trigger a
                // 15-minute lock (with exponential backoff after).
                loginAttempts.recordFailure(resolvedUsername);
                throw new WebApiException(401, "INVALID_CREDENTIALS",
                        "Login failed. Check username and password.");
            }
            // Verified — clear any prior failure streak.
            loginAttempts.recordSuccess(resolvedUsername);
            isAnonymous = false;
        }
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

        // Slice 70-X.7 — push default UserData so HumanPlayer's
        // checkPassStep() can read UserSkipPrioritySteps and auto-pass
        // through phases the player has nothing to do in (otherwise
        // every player must manually click "End turn" / "Next phase"
        // at every step, including the opponent's end-of-turn step
        // — verified failure mode reported by user).
        //
        // upstream HumanPlayer.checkPassStep at HumanPlayer.java:1427
        // returns false when UserData is null, which makes the engine
        // STOP at every priority window. UserData.getDefaultUserDataView()
        // ships sensible defaults: stop at main1/main2/declare-attackers/
        // declare-blockers, auto-pass through everything else.
        try {
            embedded.server().connectSetUserData(
                    resolvedUsername,
                    upstreamSessionId,
                    UserData.getDefaultUserDataView(),
                    "",
                    ""
            );
        } catch (MageException ex) {
            // Slice 70-X.13 (Wave 3) — fail fatally. Pre-Wave-3 we
            // logged a warn and let login succeed; the user then hit
            // the engine "stop at every priority window" failure mode
            // this slice was specifically introduced to fix
            // (HumanPlayer.checkPassStep returns false for null
            // UserData → manual click required at every step incl.
            // opponent's end-of-turn). A logged warn is invisible
            // during a playtest; the user just experiences a broken
            // game with no visible error. Better to fail loudly at
            // the auth boundary so a regression in upstream's
            // connectSetUserData contract surfaces immediately.
            silentDisconnect(upstreamSessionId);
            LOG.error("connectSetUserData failed for user={}: {}",
                    resolvedUsername, ex.getMessage());
            throw new WebApiException(500, "UPSTREAM_ERROR",
                    "Upstream server failed to apply UserData; login aborted: "
                    + ex.getMessage());
        }

        revokePriorTokensForSameUsername(resolvedUsername);

        SessionEntry entry = newEntry(upstreamSessionId, resolvedUsername, isAnonymous, false);
        store.put(entry);
        LOG.info("WebApi session created: user={}, anon={}", resolvedUsername, isAnonymous);
        return toDto(entry);
    }

    /**
     * Slice F18 (2026-05-04) — register a new authorized user.
     * Validates input, ensures the username isn't already taken, then
     * delegates to upstream's {@code AuthorizedUserRepository.add()}.
     * Does NOT issue a session token — the user must call
     * {@link #login(String, String)} as a second step.
     *
     * <p>Behaviour is gated by {@link #isRegistrationEnabled()} which
     * reads the {@code XMAGE_REGISTRATION_ENABLED} env var (default
     * {@code false}). When the flag is off, this throws 403; the
     * {@code POST /api/auth/register} route also enforces the same
     * gate so the body is never parsed when registration is disabled.
     *
     * <p>Throws:
     * <ul>
     *   <li>403 {@code REGISTRATION_DISABLED} — flag is off</li>
     *   <li>400 {@code INVALID_USERNAME} — fails {@link #USERNAME_PATTERN}</li>
     *   <li>400 {@code RESERVED_PREFIX} / {@code RESERVED_USERNAME}</li>
     *   <li>400 {@code INVALID_PASSWORD} — empty or under 8 chars</li>
     *   <li>400 {@code INVALID_EMAIL} — no '@' or empty</li>
     *   <li>409 {@code USERNAME_TAKEN} — already in the repository</li>
     *   <li>500 {@code UPSTREAM_ERROR} — repository.add silently
     *       failed (the upstream API swallows SQLException; we verify
     *       by re-querying after add)</li>
     * </ul>
     */
    public void register(String username, String password, String email) {
        if (!isRegistrationEnabled()) {
            throw new WebApiException(403, "REGISTRATION_DISABLED",
                    "User registration is disabled on this server.");
        }
        if (username == null || username.isBlank()) {
            throw new WebApiException(400, "INVALID_USERNAME",
                    "Username is required.");
        }
        String trimmed = username.trim();
        validateUsername(trimmed);
        // F21.5 (audit Sec A4) — password length policy.
        // - Min 8 (NIST SP 800-63B §5.1.1.2 minimum).
        // - Max 128 (cap a multi-megabyte password to prevent DoS
        //   amplification via the SHA-256 × 1024 hash loop in
        //   AuthorizedUserRepository.add()).
        // - NFKC normalize so users who registered "café" (composed)
        //   can sign in with "café" (decomposed) too.
        if (password == null) {
            throw new WebApiException(400, "INVALID_PASSWORD",
                    "Password must be at least 8 characters.");
        }
        password = java.text.Normalizer.normalize(password, java.text.Normalizer.Form.NFKC);
        if (password.length() < 8) {
            throw new WebApiException(400, "INVALID_PASSWORD",
                    "Password must be at least 8 characters.");
        }
        if (password.length() > 128) {
            throw new WebApiException(400, "INVALID_PASSWORD",
                    "Password must be 128 characters or fewer.");
        }
        if (email == null || email.isBlank() || !email.contains("@")) {
            throw new WebApiException(400, "INVALID_EMAIL",
                    "A valid email address is required.");
        }
        // Slice F19 (audit C2 fix) — synchronize the pre-check + add
        // + verify on the repository singleton. Mirrors upstream's own
        // Session.registerUser at line 94 of Session.java. Without
        // this, two concurrent register calls for the same username
        // race past the existence check and BOTH succeed (upstream
        // add() swallows SQLException on PK collision). The lock is
        // process-wide on the repo instance and is cheap enough for
        // a low-rate path like registration.
        synchronized (mage.server.AuthorizedUserRepository.getInstance()) {
            // F21.2 (audit Sec D3 + D4) — pre-check for duplicate
            // username AND duplicate email. Both surface a single
            // generic 409 REGISTRATION_FAILED so an attacker can't
            // tell which constraint fired (username-taken vs email-
            // taken). The username-echo in the message body has been
            // dropped — earlier 409s included the literal username,
            // which functions as an enumeration oracle (try a
            // username, see whether the response confirms it
            // exists).
            //
            // Upstream's add() swallows SQLException on PK or unique-
            // index collision, so without these pre-checks a
            // duplicate would silently no-op AND return 200 — leaving
            // the user thinking they registered when their data
            // wasn't stored.
            if (mage.server.AuthorizedUserRepository.getInstance().getByName(trimmed) != null) {
                throw new WebApiException(409, "REGISTRATION_FAILED",
                        "Registration could not be completed. If you "
                                + "already have an account, sign in. "
                                + "If not, try a different username "
                                + "or email.");
            }
            if (mage.server.AuthorizedUserRepository.getInstance().getByEmail(email.trim()) != null) {
                throw new WebApiException(409, "REGISTRATION_FAILED",
                        "Registration could not be completed. If you "
                                + "already have an account, sign in. "
                                + "If not, try a different username "
                                + "or email.");
            }
            mage.server.AuthorizedUserRepository.getInstance().add(trimmed, password, email.trim());
            // Verify by re-query — upstream's add() swallows
            // SQLException so a non-PK error (e.g. malformed field,
            // DB lock) would leave the user thinking they registered
            // when nothing happened. Generic 500 message — F20
            // audit L2: don't leak "see server logs" detail.
            if (mage.server.AuthorizedUserRepository.getInstance().getByName(trimmed) == null) {
                throw new WebApiException(500, "UPSTREAM_ERROR",
                        "Server error during registration. Please try again.");
            }
        }
        LOG.info("User registered: username={}", trimmed);
    }

    /**
     * Slice F21.6 (audit Corr E1) — startup self-test for the
     * reflective password-verify path. Asserts that
     * {@code AuthorizedUser} still has the four fields
     * {@link #verifyPasswordReflective} reads, with the expected
     * types. Throws {@link IllegalStateException} on drift —
     * surfaces immediately at WebApi construction so an operator
     * sees the failure at boot rather than discovering it as a
     * silent INVALID_CREDENTIALS for every registered user.
     *
     * <p>This is a SHAPE check, not a full round-trip — running an
     * actual register+verify cycle at boot would write to the
     * user_data DB on every restart. The full round-trip is
     * exercised by {@code AuthServiceRegisterTest}; this is the
     * production-time canary.
     */
    private static void verifyReflectionShapeOrFail() {
        Class<?> klass = mage.server.AuthorizedUser.class;
        Object[][] required = {
                {"salt", String.class},
                {"password", String.class},
                {"hashAlgorithm", String.class},
                {"hashIterations", int.class},
        };
        for (Object[] row : required) {
            String name = (String) row[0];
            Class<?> expected = (Class<?>) row[1];
            try {
                java.lang.reflect.Field f = klass.getDeclaredField(name);
                if (!f.getType().equals(expected)) {
                    throw new IllegalStateException(
                            "Auth self-test failed: AuthorizedUser." + name
                                    + " has type " + f.getType().getName()
                                    + " but expected " + expected.getName()
                                    + ". Upstream shape drifted.");
                }
            } catch (NoSuchFieldException ex) {
                throw new IllegalStateException(
                        "Auth self-test failed: AuthorizedUser." + name
                                + " field not found. Upstream shape drifted.",
                        ex);
            }
        }
    }

    /**
     * Slice F19 — manual password verification via reflection over
     * upstream's {@code AuthorizedUser} fields. We cannot call
     * {@code AuthorizedUser.doCredentialsMatch} because Shiro's
     * {@code HashedCredentialsMatcher} doesn't enable salt by default
     * unless {@code setHashSalted(true)} is set, and upstream's
     * helper omits that call — so the built-in matcher returns false
     * even for the right password. Recomputing the {@code SimpleHash}
     * with the stored salt + algorithm + iterations and comparing the
     * base64 strings sidesteps the bug.
     *
     * <p>Constant-time string comparison via
     * {@code MessageDigest.isEqual} on the byte arrays prevents the
     * timing side-channel that {@code String.equals} would leak.
     */
    private static boolean verifyPasswordReflective(
            mage.server.AuthorizedUser stored, String password) {
        try {
            java.lang.reflect.Field saltField = mage.server.AuthorizedUser.class
                    .getDeclaredField("salt");
            java.lang.reflect.Field passwordField = mage.server.AuthorizedUser.class
                    .getDeclaredField("password");
            java.lang.reflect.Field algoField = mage.server.AuthorizedUser.class
                    .getDeclaredField("hashAlgorithm");
            java.lang.reflect.Field iterField = mage.server.AuthorizedUser.class
                    .getDeclaredField("hashIterations");
            saltField.setAccessible(true);
            passwordField.setAccessible(true);
            algoField.setAccessible(true);
            iterField.setAccessible(true);

            String saltB64 = (String) saltField.get(stored);
            String storedHashB64 = (String) passwordField.get(stored);
            String algo = (String) algoField.get(stored);
            int iter = iterField.getInt(stored);

            // Recompute the hash using java.security.MessageDigest
            // directly, mirroring Shiro's SimpleHash.hash() byte-for-
            // byte. Avoids Shiro's HashedCredentialsMatcher which has
            // a salt-handling default that's incompatible with how
            // upstream stored the original hash.
            //
            // SimpleHash sequence (from Shiro source): digest.update(salt),
            // hash = digest.digest(input), loop (iter - 1) times: hash =
            // digest.digest(hash). Result is base64-encoded for storage.
            byte[] saltBytes = org.apache.shiro.codec.Base64.decode(saltB64);
            byte[] inputBytes = password.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            java.security.MessageDigest md = java.security.MessageDigest.getInstance(algo);
            md.reset();
            md.update(saltBytes);
            byte[] hashed = md.digest(inputBytes);
            for (int i = 0; i < iter - 1; i++) {
                md.reset();
                hashed = md.digest(hashed);
            }
            String recomputedB64 = java.util.Base64.getEncoder().encodeToString(hashed);
            byte[] a = recomputedB64.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            byte[] b = storedHashB64.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            // Constant-time compare — no information leak via timing.
            return java.security.MessageDigest.isEqual(a, b);
        } catch (ReflectiveOperationException
                | java.security.NoSuchAlgorithmException
                | IllegalArgumentException
                | NullPointerException ex) {
            // F20 (audit follow-up correctness B3): broadened catch.
            // A corrupted / null row in the upstream user_data DB would
            // throw IllegalArgumentException (Base64.decode rejecting
            // a non-base64 salt/hash) or NPE (null field). Without
            // this, a single bad row 500s every subsequent login. Now
            // those errors fail-closed at 401 INVALID_CREDENTIALS,
            // matching the wrong-password path. The error is logged
            // server-side so an operator can clean up the offending
            // row.
            LOG.error("Password verification failed; row may be " +
                    "corrupted or upstream AuthorizedUser shape changed", ex);
            return false;
        }
    }

    /**
     * Slice F18 — registration feature flag. Reads
     * {@code XMAGE_REGISTRATION_ENABLED}; "true" or "1" enables.
     * Default is disabled so the existing anonymous + named-no-
     * password flow stays the production path until an operator
     * explicitly opts in.
     *
     * <p>Slice F19 (test hook) — also reads the JVM system property
     * {@code xmage.registrationEnabled} when the env var isn't set,
     * so unit tests can toggle the gate without modifying the
     * process environment (Java doesn't allow runtime env mutation).
     * Env wins over property; either alone works.
     */
    public static boolean isRegistrationEnabled() {
        String env = System.getenv("XMAGE_REGISTRATION_ENABLED");
        if (env != null) {
            String norm = env.trim().toLowerCase();
            return norm.equals("true") || norm.equals("1");
        }
        String prop = System.getProperty("xmage.registrationEnabled");
        if (prop != null) {
            String norm = prop.trim().toLowerCase();
            return norm.equals("true") || norm.equals("1");
        }
        return false;
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
        registerUpstreamSession(upstreamSessionId, ADMIN_USERNAME);

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

        revokePriorTokensForSameUsername(ADMIN_USERNAME);

        SessionEntry entry = newEntry(upstreamSessionId, ADMIN_USERNAME, false, true);
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
        // Slice 70-H.5 — also tear down the disconnect-timer scheduler
        // on AuthService close. Per-handler timer cancellation already
        // ran via closeAllSockets in silentDisconnect; this is the
        // belt-and-suspenders cleanup for tasks that leaked past
        // those hooks.
        disconnectTimerScheduler.shutdown();
        try {
            if (!sweeper.awaitTermination(5, TimeUnit.SECONDS)) {
                sweeper.shutdownNow();
            }
            if (!disconnectTimerScheduler.awaitTermination(5, TimeUnit.SECONDS)) {
                disconnectTimerScheduler.shutdownNow();
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            sweeper.shutdownNow();
            disconnectTimerScheduler.shutdownNow();
        }
    }

    /**
     * Slice 70-H.5 (ADR 0010 v2 D11(e)) — broadcast a synthesized
     * {@code dialogClear} frame to every handler whose user is
     * seated in {@code gameId}. Used when one player's per-prompt
     * disconnect-timer fires; the other players' UIs need the
     * teardown signal so the "waiting on Bob" affordance dismisses.
     *
     * <p>Walks {@link #handlersBySessionId} and resolves each
     * handler's user ID. If that user ID appears in the engine's
     * per-game {@code userPlayerMap}, the handler receives the
     * synthesized frame (appended to its buffer for reconnect-
     * replay safety, then broadcast to live sockets via the
     * handler's {@code appendAndBroadcastSynthetic} hook).
     *
     * <p>Best-effort: per-handler failures are logged at DEBUG and
     * skipped — the contract is "every handler that CAN receive
     * gets the frame," not "every handler atomically receives it."
     * The reason field on the wire (e.g. {@code "TIMEOUT"}) tells
     * clients which dialogClear flavor this is.
     */
    public void broadcastDialogClearToGame(UUID gameId, UUID leaverPlayerId, String reason) {
        if (gameId == null || leaverPlayerId == null || reason == null) {
            return;
        }
        java.util.Optional<Map<UUID, UUID>> userPlayerMap =
                GameLookup.findUserPlayerMap(gameId, embedded.managerFactory());
        if (userPlayerMap.isEmpty()) {
            LOG.debug("broadcastDialogClearToGame: no userPlayerMap for game {}; "
                    + "skipping broadcast (game may have ended)", gameId);
            return;
        }
        java.util.Set<UUID> seatedUserIds = userPlayerMap.get().keySet();
        int delivered = 0;
        for (WebSocketCallbackHandler h : handlersBySessionId.values()) {
            UUID handlerUserId = embedded.managerFactory().userManager()
                    .getUserByName(h.username())
                    .map(mage.server.User::getId)
                    .orElse(null);
            if (handlerUserId == null || !seatedUserIds.contains(handlerUserId)) {
                continue;
            }
            try {
                h.appendAndBroadcastSyntheticDialogClear(gameId, leaverPlayerId, reason);
                delivered++;
            } catch (RuntimeException ex) {
                LOG.debug("broadcastDialogClearToGame: handler for user={} threw "
                        + "while emitting dialogClear: {}", h.username(), ex.toString());
            }
        }
        if (LOG.isDebugEnabled()) {
            LOG.debug("broadcastDialogClearToGame: game={}, leaver={}, reason={}, "
                    + "handlersDelivered={}", gameId, leaverPlayerId, reason, delivered);
        }
    }

    /**
     * Slice 70-H.5 — read {@code XMAGE_DISCONNECT_TIMEOUT_SEC} env
     * with soft-fail semantics (per critic N10). Returns the default
     * 60s on unset / blank / unparseable / out-of-bounds; logs WARN
     * for the unparseable / out-of-bounds branches so an operator
     * misconfig surfaces. Bounds [30, 180] match reasonable network-
     * blip tolerance (30s lower; 180s upper caps the stuck-game
     * window).
     */
    private static int readDisconnectTimeoutSeconds() {
        final int defaultSeconds = 60;
        final int minSeconds = 30;
        final int maxSeconds = 180;
        String env = System.getenv("XMAGE_DISCONNECT_TIMEOUT_SEC");
        if (env == null || env.isBlank()) {
            return defaultSeconds;
        }
        int parsed;
        try {
            parsed = Integer.parseInt(env.trim());
        } catch (NumberFormatException ex) {
            LOG.warn("XMAGE_DISCONNECT_TIMEOUT_SEC unparseable ('{}') — falling back "
                    + "to {}s", env, defaultSeconds);
            return defaultSeconds;
        }
        if (parsed < minSeconds || parsed > maxSeconds) {
            LOG.warn("XMAGE_DISCONNECT_TIMEOUT_SEC out of bounds ({}, must be in "
                    + "[{}, {}]) — falling back to {}s",
                    parsed, minSeconds, maxSeconds, defaultSeconds);
            return defaultSeconds;
        }
        return parsed;
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
                    "Username must be 3-14 characters using letters, "
                    + "numbers, hyphens, or underscores.");
        }
        if (username.toLowerCase().startsWith(GUEST_PREFIX)) {
            throw new WebApiException(400, "RESERVED_PREFIX",
                    "Username prefix '" + GUEST_PREFIX + "' is reserved for "
                    + "anonymous sessions.");
        }
        // Slice 70-X.13 — reject "admin" / "ADMIN" / "Admin" etc. so a
        // normal login can't squat the upstream admin display name and
        // its case-insensitive revoke path can't kick the live admin
        // offline.
        if (username.equalsIgnoreCase(ADMIN_USERNAME)) {
            throw new WebApiException(400, "RESERVED_USERNAME",
                    "Username '" + ADMIN_USERNAME + "' is reserved.");
        }
    }

    private void registerUpstreamSession(String upstreamSessionId, String username) {
        // Slice 52a — pass the EmbeddedServer through so the handler
        // can resolve stack-cardId hints via GameLookup. The
        // alternative (a static accessor) would couple every test to
        // a live embedded singleton; ctor injection keeps the unit
        // tests that synthesize a handler directly working.
        //
        // Slice 70-H — also pass {@code this} so the handler can
        // build a per-frame WebSocketConnectionTracker that consults
        // {@link #connectionStateFor(UUID, UUID)} for the schema-1.23
        // connectionState wire field. AuthService → handler → AuthService
        // is a non-circular reference (AuthService is fully constructed
        // before any handler is registered).
        //
        // Slice 70-H.5 — pass {@code upstreamSessionId} so the
        // disconnect-timer fire body can route auto-pass dispatch
        // through {@code MageServerImpl.sendPlayerXxx} (which all
        // require sessionId to identify the responding player). The
        // handler doesn't otherwise need its sessionId; it's a
        // single-use hint for the auto-pass code path.
        WebSocketCallbackHandler handler =
                new WebSocketCallbackHandler(
                        username, embedded, this, upstreamSessionId);
        handlersBySessionId.put(upstreamSessionId, handler);
        // Slice 70-X.13 (Wave 3) — overwrite-OK on the username key.
        // If a stale OLD handler is still indexed here under the same
        // username (mid-revoke window), the put replaces it with NEW;
        // the OLD revoke's conditional remove(key, value) then does
        // not match and leaves NEW intact.
        handlersByUsername.put(usernameKey(username), handler);
        sessionManager().createSession(upstreamSessionId, handler);
    }

    /**
     * Slice 70-X.13 (Wave 3) — case-insensitive username key for the
     * secondary index. Mirrors the case-insensitive contract of
     * {@code revokePriorTokensForSameUsername} (which uses
     * {@code WebSessionStore.removeAllByUsername} → equalsIgnoreCase).
     */
    private static String usernameKey(String username) {
        return username == null ? "" : username.toLowerCase(java.util.Locale.ROOT);
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
            // Slice 70-X.13 (Wave 3) — conditional remove on the
            // secondary index. If a NEWER handler under the same
            // username already overwrote this entry (duplicate-login
            // race), the conditional remove does NOT match and leaves
            // the NEWER handler indexed correctly. Without this, an
            // unconditional remove would clobber the NEW handler's
            // index entry on every revoke of an OLD session.
            handlersByUsername.remove(usernameKey(handler.username()), handler);
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
