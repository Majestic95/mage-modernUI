package mage.webapi.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.server.WebApiServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.parallel.Execution;
import org.junit.jupiter.api.parallel.ExecutionMode;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slice F19 (2026-05-04) — integration tests for the registration
 * surface added in F18, plus the WebApi-side login verification F19
 * adds on top. Boots an embedded Mage server + WebApi and exercises
 * the {@code POST /api/auth/register} + {@code POST /api/session}
 * routes end-to-end.
 *
 * <p>Each test that exercises the enabled path toggles the
 * {@code xmage.registrationEnabled} JVM property in {@code @BeforeEach}
 * and clears it in {@code @AfterEach} so tests neither leak state into
 * each other nor depend on the host's environment.
 *
 * <p>Each test uses a unique username (UUID-suffixed) so the embedded
 * server's {@link mage.server.AuthorizedUserRepository} (a JVM
 * singleton over an H2 file) doesn't see collisions across runs.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
// F20 (audit correctness A5): force same-thread execution. The
// `xmage.registrationEnabled` JVM property toggle in @BeforeEach +
// @AfterEach is process-wide; if Surefire is ever flipped to
// parallel-classes execution, the property leak would race
// `register_flagOff_returns403` against happy-path tests and produce
// flaky 403/201 confusion. SAME_THREAD pins this class even when
// the project's surefire config relaxes.
@Execution(ExecutionMode.SAME_THREAD)
class AuthServiceRegisterTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();

    private WebApiServer server;

    @BeforeAll
    void start() {
        EmbeddedServer embedded = EmbeddedServer.boot(CONFIG_PATH);
        server = new WebApiServer(embedded).start(0);
        // Disable rate limiting so tests can fire register attempts at
        // high cadence without 429s.
        server.setSessionMintLimiter(
                new IpRateLimiter(Integer.MAX_VALUE, 60_000L));
    }

    @AfterAll
    void stop() {
        if (server != null) server.stop();
    }

    @BeforeEach
    void enableRegistration() {
        // Default for each test is REGISTRATION ENABLED so the happy
        // paths can run. Tests that exercise the disabled path
        // explicitly clear the property at the top.
        System.setProperty("xmage.registrationEnabled", "true");
    }

    @AfterEach
    void clearRegistrationFlag() {
        System.clearProperty("xmage.registrationEnabled");
    }

    private static String uniqueUsername() {
        // Username pattern is [a-zA-Z0-9_-]{3,14}. UUID has dashes
        // which are allowed but we strip them to keep names short.
        // Truncate to 14 (upstream's `maxUserNameLength` config cap)
        // so each unique name fits the WebApi validation AND
        // upstream's `Session.connectUserHandling` length check.
        return ("u" + UUID.randomUUID().toString().replace("-", "")).substring(0, 14);
    }

    /**
     * 2026-05-04 — discovery during F19 test authoring: the upstream
     * H2 schema enforces a UNIQUE constraint on the email column too,
     * not just the username. Tests must use unique emails per call
     * to avoid cross-test interference (the H2 file persists across
     * test runs at {@code Mage.Server.WebApi/db/authorized_user.*}).
     * Production note: this means the existing register endpoint
     * returns 500 UPSTREAM_ERROR on a duplicate email collision —
     * an audit follow-up should add an email-pre-check + return 409
     * EMAIL_TAKEN instead. Out of scope for F19 (which fixes the
     * critical login + race issues); queued as a polish item.
     */
    private static String uniqueEmail() {
        return UUID.randomUUID().toString().substring(0, 8) + "@test.example.com";
    }

    @Test
    void register_happyPath_returns201() throws Exception {
        String name = uniqueUsername();
        HttpResponse<String> r = postJson("/api/auth/register",
                "{\"username\":\"" + name
                        + "\",\"password\":\"hunter2hunter2\",\"email\":\""
                        + uniqueEmail() + "\"}");
        assertEquals(201, r.statusCode(), r.body());
        JsonNode body = JSON.readTree(r.body());
        assertEquals(name, body.get("username").asText());
        assertEquals("1.30", body.get("schemaVersion").asText());
    }

    @Test
    void register_flagOff_returns403() throws Exception {
        System.clearProperty("xmage.registrationEnabled");
        HttpResponse<String> r = postJson("/api/auth/register",
                "{\"username\":\"" + uniqueUsername()
                        + "\",\"password\":\"hunter2hunter2\",\"email\":\""
                        + uniqueEmail() + "\"}");
        assertEquals(403, r.statusCode(), r.body());
        assertEquals("REGISTRATION_DISABLED",
                JSON.readTree(r.body()).get("code").asText());
    }

    @Test
    void register_duplicateUsername_returns409() throws Exception {
        String name = uniqueUsername();
        String body = "{\"username\":\"" + name
                + "\",\"password\":\"hunter2hunter2\",\"email\":\""
                + uniqueEmail() + "\"}";
        HttpResponse<String> first = postJson("/api/auth/register", body);
        assertEquals(201, first.statusCode(), first.body());
        HttpResponse<String> second = postJson("/api/auth/register", body);
        assertEquals(409, second.statusCode(), second.body());
        // F21.2 — collapsed enumeration oracle: 409 returns the
        // generic REGISTRATION_FAILED code regardless of whether the
        // username OR the email collided. Server log distinguishes
        // for ops; the wire response does not.
        assertEquals("REGISTRATION_FAILED",
                JSON.readTree(second.body()).get("code").asText());
    }

    @Test
    void register_invalidUsername_returns400() throws Exception {
        HttpResponse<String> r = postJson("/api/auth/register",
                "{\"username\":\"bad name\",\"password\":\"hunter2hunter2\",\"email\":\""
                        + uniqueEmail() + "\"}");
        assertEquals(400, r.statusCode(), r.body());
        assertEquals("INVALID_USERNAME",
                JSON.readTree(r.body()).get("code").asText());
    }

    @Test
    void register_shortPassword_returns400() throws Exception {
        HttpResponse<String> r = postJson("/api/auth/register",
                "{\"username\":\"" + uniqueUsername()
                        + "\",\"password\":\"short\",\"email\":\""
                        + uniqueEmail() + "\"}");
        assertEquals(400, r.statusCode(), r.body());
        assertEquals("INVALID_PASSWORD",
                JSON.readTree(r.body()).get("code").asText());
    }

    @Test
    void register_invalidEmail_returns400() throws Exception {
        HttpResponse<String> r = postJson("/api/auth/register",
                "{\"username\":\"" + uniqueUsername()
                        + "\",\"password\":\"hunter2hunter2\",\"email\":\"no-at-sign\"}");
        assertEquals(400, r.statusCode(), r.body());
        assertEquals("INVALID_EMAIL",
                JSON.readTree(r.body()).get("code").asText());
    }

    @Test
    void register_concurrentRace_exactlyOneSucceeds() throws Exception {
        // Audit C2: two parallel POSTs racing the same username. With
        // F19's synchronized block in AuthService.register, exactly
        // one returns 201 and the other returns 409 — never both
        // succeed (which would corrupt the repo).
        String name = uniqueUsername();
        String body = "{\"username\":\"" + name
                + "\",\"password\":\"hunter2hunter2\",\"email\":\""
                + uniqueEmail() + "\"}";
        ExecutorService exec = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger created = new AtomicInteger();
        AtomicInteger conflicted = new AtomicInteger();
        AtomicInteger other = new AtomicInteger();
        try {
            Runnable task = () -> {
                try {
                    start.await();
                    HttpResponse<String> r = postJson("/api/auth/register", body);
                    int code = r.statusCode();
                    if (code == 201) created.incrementAndGet();
                    else if (code == 409) conflicted.incrementAndGet();
                    else other.incrementAndGet();
                } catch (Exception ignored) {
                    other.incrementAndGet();
                }
            };
            exec.submit(task);
            exec.submit(task);
            start.countDown();
            exec.shutdown();
            assertTrue(exec.awaitTermination(15, TimeUnit.SECONDS),
                    "Concurrent register tasks did not finish in time.");
        } finally {
            if (!exec.isTerminated()) exec.shutdownNow();
        }
        assertEquals(1, created.get(),
                "Exactly one concurrent registration must succeed (got "
                        + created.get() + " created, " + conflicted.get()
                        + " conflicted, " + other.get() + " other).");
        assertEquals(1, conflicted.get(),
                "The losing concurrent registration must report 409.");
        assertEquals(0, other.get(),
                "No third outcome allowed (no 5xx, no other status).");
    }

    @Test
    void loginAfterRegister_correctPassword_returns200AndAuthenticated() throws Exception {
        // F21 (2026-05-04) — re-enabled after diagnosing the F19 "flip-
        // blocker": upstream's connectUser was rejecting our test
        // usernames because they exceeded `maxUserNameLength=14`
        // (Session.java:153). Our WebApi validation was {1,32}; tightened
        // to {3,14} to match upstream + uniqueUsername() in this test
        // truncates to 14. With the cap aligned, the F19 password-verify
        // path fully works end-to-end: register → login with correct
        // password → 200 authenticated.
        String name = uniqueUsername();
        String pw = "hunter2hunter2";
        HttpResponse<String> reg = postJson("/api/auth/register",
                "{\"username\":\"" + name
                        + "\",\"password\":\"" + pw + "\",\"email\":\""
                        + uniqueEmail() + "\"}");
        assertEquals(201, reg.statusCode(), reg.body());

        HttpResponse<String> login = postJson("/api/session",
                "{\"username\":\"" + name + "\",\"password\":\"" + pw + "\"}");
        assertEquals(200, login.statusCode(), login.body());
        JsonNode body = JSON.readTree(login.body());
        assertEquals(name, body.get("username").asText());
        // F19 — registered user with correct password → authenticated,
        // not anonymous. F18 left this entirely to upstream's gated
        // authenticationActivated flag; F19's WebApi-side verification
        // makes this hold regardless of the upstream flag.
        assertEquals(false, body.get("isAnonymous").asBoolean(),
                "Registered user with correct password must be authenticated, not anon.");
    }

    @Test
    void loginAfterRegister_wrongPassword_returns401() throws Exception {
        String name = uniqueUsername();
        HttpResponse<String> reg = postJson("/api/auth/register",
                "{\"username\":\"" + name
                        + "\",\"password\":\"hunter2hunter2\",\"email\":\""
                        + uniqueEmail() + "\"}");
        assertEquals(201, reg.statusCode(), reg.body());

        HttpResponse<String> login = postJson("/api/session",
                "{\"username\":\"" + name + "\",\"password\":\"wrongpassword\"}");
        // Audit C1: wrong password MUST be rejected.
        assertEquals(401, login.statusCode(),
                "Wrong password for a registered user must return 401 (got "
                        + login.statusCode() + " " + login.body() + ").");
        assertEquals("INVALID_CREDENTIALS",
                JSON.readTree(login.body()).get("code").asText());
    }

    @Test
    void loginAfterRegister_emptyPassword_returns401() throws Exception {
        // Audit C1 corollary: a registered username cannot fall back to
        // anonymous login by omitting the password.
        String name = uniqueUsername();
        HttpResponse<String> reg = postJson("/api/auth/register",
                "{\"username\":\"" + name
                        + "\",\"password\":\"hunter2hunter2\",\"email\":\""
                        + uniqueEmail() + "\"}");
        assertEquals(201, reg.statusCode(), reg.body());

        HttpResponse<String> login = postJson("/api/session",
                "{\"username\":\"" + name + "\"}");
        assertEquals(401, login.statusCode(), login.body());
        // F21.7 — collapsed wire-shape for the enumeration oracle.
        // Was PASSWORD_REQUIRED; now identical INVALID_CREDENTIALS
        // to the wrong-password path. Server log captures the
        // distinction for ops; the wire response does not.
        assertEquals("INVALID_CREDENTIALS",
                JSON.readTree(login.body()).get("code").asText());
    }

    @Test
    void loginAfterRegister_lockoutAfterFiveFailures_returns429() throws Exception {
        // F21.3 (audit Sec B2) — five consecutive wrong-password
        // attempts trigger a 15-minute account lockout, even if the
        // attacker rotates IPs.
        String name = uniqueUsername();
        String pw = "hunter2hunter2";
        HttpResponse<String> reg = postJson("/api/auth/register",
                "{\"username\":\"" + name
                        + "\",\"password\":\"" + pw + "\",\"email\":\""
                        + uniqueEmail() + "\"}");
        assertEquals(201, reg.statusCode(), reg.body());

        // Five wrong-password attempts — first 4 return 401
        // INVALID_CREDENTIALS, the 5th increments the counter past
        // the threshold AND triggers the lockout, but the threshold
        // check happens AFTER the verify so the 5th attempt ALSO
        // returns 401 INVALID_CREDENTIALS.
        for (int i = 0; i < LoginAttemptTracker.FAILURE_THRESHOLD; i++) {
            HttpResponse<String> bad = postJson("/api/session",
                    "{\"username\":\"" + name + "\",\"password\":\"wrong\"}");
            assertEquals(401, bad.statusCode(),
                    "Attempt " + (i + 1) + " expected 401, got: " + bad.body());
        }

        // The NEXT attempt (correct or not) must hit the lockout.
        HttpResponse<String> locked = postJson("/api/session",
                "{\"username\":\"" + name + "\",\"password\":\"" + pw + "\"}");
        assertEquals(429, locked.statusCode(), locked.body());
        assertEquals("ACCOUNT_LOCKED",
                JSON.readTree(locked.body()).get("code").asText());
    }

    @Test
    void serverState_mirrorsRegistrationFlag() throws Exception {
        // Test boots with flag enabled (per @BeforeEach). The
        // WebServerState response should reflect that.
        // Note: server-state requires auth; we mint an anonymous
        // session first.
        String token = mintAnonToken();
        HttpResponse<String> state = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + "/api/server/state"))
                        .header("Authorization", "Bearer " + token)
                        .timeout(Duration.ofSeconds(10))
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, state.statusCode(), state.body());
        JsonNode node = JSON.readTree(state.body());
        assertNotNull(node.get("registrationEnabled"));
        assertTrue(node.get("registrationEnabled").asBoolean(),
                "registrationEnabled must mirror the runtime flag value.");
    }

    private String mintAnonToken() throws Exception {
        HttpResponse<String> r = postJson("/api/session", "{}");
        assertEquals(200, r.statusCode(), r.body());
        String token = JSON.readTree(r.body()).get("token").asText();
        assertNotEquals("", token);
        return token;
    }

    private HttpResponse<String> postJson(String path, String body) throws Exception {
        return HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + path))
                        .header("Content-Type", "application/json")
                        .timeout(Duration.ofSeconds(10))
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }
}
