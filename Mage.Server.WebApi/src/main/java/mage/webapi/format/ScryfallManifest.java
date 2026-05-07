package mage.webapi.format;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Resolves Scryfall's bulk-data manifest to find the
 * {@code oracle_cards} download URL. Extracted from
 * {@link ScryfallBulkDataClient} during the Pauper-roadmap NIT
 * cleanup pass — the manifest path is logically distinct from the
 * file-download / streaming-parse path and gives that file room to
 * grow without crossing the soft cap.
 *
 * <p>Tree-mode parse is deliberate: the manifest is ~3 KB / 6
 * entries, and tree code reads more clearly here than streaming.
 * The streaming-parse logic stays in
 * {@link ScryfallBulkDataClient#parseLegalitiesFromFile}.
 */
final class ScryfallManifest {

    private static final String BULK_DATA_MANIFEST_URL = "https://api.scryfall.com/bulk-data";

    /**
     * Tree-mode mapper for the small manifest payload. Class-level
     * singleton so we don't reallocate per fetch.
     */
    private static final ObjectMapper TREE_MAPPER = new ObjectMapper();

    private final HttpClient http;
    private final String userAgent;
    private final Duration timeout;

    ScryfallManifest(HttpClient http, String userAgent, Duration timeout) {
        this.http = http;
        this.userAgent = userAgent;
        this.timeout = timeout;
    }

    /**
     * GET the manifest, find the {@code oracle_cards} entry, return
     * its {@code download_uri}. The CDN URL changes whenever Scryfall
     * regenerates the file (~daily) so we resolve it fresh every
     * fetch.
     */
    String resolveOracleCardsDownloadUri() throws IOException {
        HttpRequest manifestReq = HttpRequest.newBuilder(URI.create(BULK_DATA_MANIFEST_URL))
                .header("User-Agent", userAgent)
                .header("Accept", "application/json")
                .timeout(timeout)
                .GET()
                .build();

        HttpResponse<String> resp;
        try {
            resp = http.send(manifestReq, HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted while fetching Scryfall manifest", ex);
        }
        if (resp.statusCode() / 100 != 2) {
            throw new IOException(ScryfallBulkDataClient.buildHttpErrorMessage(
                    "manifest GET", BULK_DATA_MANIFEST_URL, resp.statusCode(),
                    asInputStream(resp.body())));
        }

        var root = TREE_MAPPER.readTree(resp.body());
        var data = root.get("data");
        if (data == null || !data.isArray()) {
            throw new IOException("Scryfall manifest missing 'data' array");
        }
        for (var entry : data) {
            var type = entry.get("type");
            if (type != null && "oracle_cards".equals(type.asText())) {
                var uri = entry.get("download_uri");
                if (uri == null) {
                    throw new IOException("oracle_cards manifest entry missing download_uri");
                }
                return uri.asText();
            }
        }
        throw new IOException("Scryfall manifest contained no oracle_cards entry");
    }

    /**
     * Wrap an in-memory string body as an {@link InputStream} so
     * {@link ScryfallBulkDataClient#buildHttpErrorMessage} can format
     * the error consistently with the streaming file-fetch path.
     */
    private static InputStream asInputStream(String body) {
        return new ByteArrayInputStream(
                body == null ? new byte[0] : body.getBytes());
    }
}
