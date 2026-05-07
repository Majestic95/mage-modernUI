package mage.webapi.format;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;



/**
 * Fetches Scryfall's {@code oracle_cards} bulk-data file and parses it
 * for Pauper legality verdicts. The client is deliberately a single,
 * stateless seam: it owns the {@link HttpClient}, but the cache file
 * lifecycle (path, freshness, atomicity) belongs to
 * {@link LegalityCacheStore} and the in-memory map belongs to
 * {@link PauperLegalityService}.
 *
 * <p>Design decisions:
 * <ul>
 *   <li><b>Streaming parse via {@link JsonParser}</b> — this is the
 *       FIRST place in the WebApi codebase that uses Jackson streaming.
 *       The oracle_cards file is ~30-40 MB; a {@code readTree} would
 *       balloon memory by 5-10× during parse and is wholly unnecessary
 *       since we only read two scalar fields per card
 *       ({@code name}, {@code legalities.pauper}) and one type tag
 *       ({@code layout}). Streaming keeps peak heap proportional to
 *       the result map, not the input.</li>
 *   <li><b>User-Agent</b> — Scryfall's API guidelines explicitly ASK
 *       for a descriptive User-Agent so they can contact us if our
 *       client misbehaves. Cf.
 *       https://scryfall.com/docs/api — "Always set a User-Agent".</li>
 *   <li><b>Atomic rename</b> — we stream to a temp file in the same
 *       directory and {@code Files.move} with {@code ATOMIC_MOVE} +
 *       {@code REPLACE_EXISTING}. A torn write would otherwise leave
 *       a half-file the next boot would happily parse and serve as
 *       legality data, with predictable horror.</li>
 *   <li><b>Layout filter</b> — Scryfall's bulk export contains tokens,
 *       emblems, art series, and other non-deck-legal layouts. They
 *       carry empty / nonsensical legality data and would pollute the
 *       map. The skip set is hard-coded; new layouts are rare enough
 *       (years between additions) that updating it as part of an
 *       upstream sync is cheaper than a more dynamic filter.</li>
 * </ul>
 */
public class ScryfallBulkDataClient {

    private static final Logger LOG = LoggerFactory.getLogger(ScryfallBulkDataClient.class);

    /**
     * Per Scryfall's API guidelines. The version is intentionally
     * "0.0.1" until we ship a real release tag; the GitHub URL is the
     * only contact path that's stable across forks. Shared with
     * {@link ScryfallManifest} so both Scryfall calls present the
     * same identity.
     */
    private static final String USER_AGENT =
            "xmage-modernUI/0.0.1 (https://github.com/Majestic95/mage-modernUI)";

    /**
     * Layouts that are not deck-legal cards and must be excluded from
     * the legality map. Scryfall ships these in oracle_cards because
     * they have oracle text (rules-relevant), but they're not things a
     * player can put in a deck and so don't have meaningful legality.
     */
    private static final Set<String> EXCLUDED_LAYOUTS = Set.of(
            "token",
            "double_faced_token",
            "emblem",
            "art_series",
            "vanguard",
            "scheme",
            "planar"
    );

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration RESPONSE_TIMEOUT = Duration.ofSeconds(30);

    /**
     * Number of bytes of an error-response body to include in
     * {@link IOException} messages when Scryfall returns a non-2xx
     * status. Just enough to surface the JSON {@code object:"error"}
     * envelope Scryfall emits, without dumping a giant HTML error page.
     */
    private static final int ERROR_BODY_PEEK_BYTES = 1024;

    /**
     * Lazily-shared singleton — {@link HttpClient} is thread-safe and
     * holds a connection pool we'd rather not rebuild on every refresh.
     * Constructed once per service instance.
     */
    private final HttpClient http;
    private final JsonFactory jsonFactory;
    private final ScryfallManifest manifest;

    public ScryfallBulkDataClient() {
        this(HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NORMAL)
                .connectTimeout(CONNECT_TIMEOUT)
                .build(),
                new ObjectMapper().getFactory());
    }

    /** Test seam: inject a mock client + factory. Package-private. */
    ScryfallBulkDataClient(HttpClient http, JsonFactory jsonFactory) {
        this.http = http;
        this.jsonFactory = jsonFactory;
        this.manifest = new ScryfallManifest(http, USER_AGENT, RESPONSE_TIMEOUT);
    }

    /**
     * Resolve the latest {@code oracle_cards} download URI from the
     * Scryfall manifest, GET it, and stream the bytes to
     * {@code destination} via a sibling temp file + atomic rename.
     *
     * @throws IOException any network or filesystem failure. Wrapped
     *                     by {@link PauperLegalityService} into a
     *                     {@link PauperLegalityService.LegalityDataUnavailableException}.
     */
    public void fetchOracleCardsTo(Path destination) throws IOException {
        String downloadUri = manifest.resolveOracleCardsDownloadUri();
        LOG.info("Downloading Scryfall oracle_cards from {}", downloadUri);

        HttpRequest req = HttpRequest.newBuilder(URI.create(downloadUri))
                .header("User-Agent", USER_AGENT)
                .header("Accept", "application/json")
                .timeout(RESPONSE_TIMEOUT)
                .GET()
                .build();

        // Defensive: callers normally route through LegalityCacheStore
        // which creates the directory in its constructor, but the
        // public method invites direct calls — make this self-sufficient.
        Path parent = destination.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Path tempFile = Files.createTempFile(parent, "scryfall-oracle-", ".json.tmp");
        try {
            HttpResponse<InputStream> resp;
            try {
                resp = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted while downloading oracle_cards", ex);
            }
            if (resp.statusCode() / 100 != 2) {
                throw new IOException(buildHttpErrorMessage(
                        "oracle_cards GET", downloadUri, resp.statusCode(), resp.body()));
            }
            try (InputStream body = resp.body()) {
                Files.copy(body, tempFile, StandardCopyOption.REPLACE_EXISTING);
            }
            Files.move(tempFile, destination,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
            LOG.info("Saved Scryfall oracle_cards to {} ({} bytes)",
                    destination, Files.size(destination));
        } catch (IOException ex) {
            // Best-effort cleanup; ignore failure here — the original
            // exception is the one the caller cares about.
            try {
                Files.deleteIfExists(tempFile);
            } catch (IOException ignored) {
                // Swallow; primary failure already in flight.
            }
            throw ex;
        }
    }

    /**
     * Walk the bulk-data file and return name → Pauper legality.
     * Uses streaming Jackson — see class-level Javadoc for rationale.
     */
    public Map<String, PauperLegality> parseLegalitiesFromFile(Path source) throws IOException {
        Map<String, PauperLegality> result = new HashMap<>(32_000);
        try (JsonParser parser = jsonFactory.createParser(source.toFile())) {
            JsonToken token = parser.nextToken();
            if (token != JsonToken.START_ARRAY) {
                throw new IOException("Expected top-level JSON array in " + source
                        + ", got " + token);
            }
            while (parser.nextToken() == JsonToken.START_OBJECT) {
                consumeCardObject(parser, result);
            }
        }
        LOG.info("Parsed {} card legality entries from {}", result.size(), source);
        return result;
    }

    /**
     * Consume one card object from the parser stream, advancing past
     * its closing {@code }}. Extracts only {@code name}, {@code layout},
     * and {@code legalities.pauper}; everything else is skipped.
     */
    private void consumeCardObject(JsonParser parser,
                                    Map<String, PauperLegality> sink) throws IOException {
        String name = null;
        String layout = null;
        String pauper = null;
        while (parser.nextToken() != JsonToken.END_OBJECT) {
            String field = parser.currentName();
            parser.nextToken(); // advance to value
            if (field == null) {
                // Defensive: should not happen between FIELD_NAME pairs.
                parser.skipChildren();
                continue;
            }
            switch (field) {
                case "name" -> name = parser.getValueAsString();
                case "layout" -> layout = parser.getValueAsString();
                case "legalities" -> pauper = readPauperFromLegalities(parser);
                default -> parser.skipChildren();
            }
        }

        if (name == null) {
            return;
        }
        if (layout != null && EXCLUDED_LAYOUTS.contains(layout)) {
            return;
        }
        PauperLegality verdict = PauperLegality.fromScryfall(pauper);
        PauperLegality prev = sink.put(name, verdict);
        if (prev != null && prev != verdict) {
            // Multiple printings of the same card with conflicting
            // legality is "shouldn't happen" per Scryfall's data model
            // — legality is per-oracle-name, not per-printing. Log
            // loud if it ever does so we can investigate rather than
            // silently last-wins.
            LOG.warn("Conflicting Pauper legality for '{}': {} vs {} (last-wins)",
                    name, prev, verdict);
        }
    }

    /**
     * Read the {@code pauper} value out of the {@code legalities}
     * sub-object. Skips every other format silently.
     */
    private String readPauperFromLegalities(JsonParser parser) throws IOException {
        if (parser.currentToken() != JsonToken.START_OBJECT) {
            // Malformed entry — skip rather than fail the whole parse.
            parser.skipChildren();
            return null;
        }
        String pauper = null;
        while (parser.nextToken() != JsonToken.END_OBJECT) {
            String field = parser.currentName();
            parser.nextToken();
            if ("pauper".equals(field)) {
                pauper = parser.getValueAsString();
            } else {
                parser.skipChildren();
            }
        }
        return pauper;
    }

    /**
     * Build a diagnostic message for non-2xx HTTP responses. Includes
     * the request label, URL, status, and up to
     * {@link #ERROR_BODY_PEEK_BYTES} of the response body — enough to
     * surface Scryfall's machine-readable {@code object:"error"}
     * envelope without dumping a giant HTML error page.
     *
     * <p>Package-private so {@link ScryfallManifest} can format manifest
     * GET errors with the same shape; both Scryfall paths produce
     * uniform diagnostic output for the operator.
     */
    static String buildHttpErrorMessage(String label, String url, int status,
                                         InputStream body) {
        String bodyPeek = "(unreadable)";
        try (InputStream stream = body) {
            byte[] buf = stream.readNBytes(ERROR_BODY_PEEK_BYTES);
            if (buf.length > 0) {
                bodyPeek = new String(buf);
            } else {
                bodyPeek = "(empty)";
            }
        } catch (IOException ignored) {
            // Best-effort; keep the (unreadable) sentinel.
        }
        return "Scryfall " + label + " " + url + " returned HTTP " + status
                + "; body preview: " + bodyPeek;
    }
}
