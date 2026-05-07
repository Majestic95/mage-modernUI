package mage.webapi.format;

import com.fasterxml.jackson.databind.ObjectMapper;
import mage.cards.decks.Deck;
import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.decks.DeckValidator;
import mage.cards.decks.DeckValidatorFactory;
import mage.cards.repository.CardScanner;
import mage.cards.repository.RepositoryUtil;
import mage.deck.Pauper;
import mage.game.GameException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit tests for {@link WebApiPauperValidator}. Bootstraps
 * {@link RepositoryUtil#bootstrapLocalDb()} + {@link CardScanner#scan()}
 * once at class load — the UNKNOWN-fallback path delegates to upstream's
 * rarity walk via {@link mage.cards.repository.CardRepository}, which
 * needs the local sqlite populated.
 *
 * <p>The injected {@link PauperLegalityService} is built from the
 * shared {@code pauper-legalities-fixture.json} resource using the
 * same {@code skipNetwork=true} pattern as
 * {@link PauperLegalityServiceTest}: stage the fixture file fresh at
 * a {@code @TempDir}, then construct the service with no wire access.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class WebApiPauperValidatorTest {

    private static final String FIXTURE_RESOURCE = "/scryfall/pauper-legalities-fixture.json";

    @BeforeAll
    static void bootstrap() {
        // Idempotent across the surefire JVM; mirrors PauperFormatTest.
        RepositoryUtil.bootstrapLocalDb();
        CardScanner.scan();
    }

    @AfterEach
    void restoreFactoryRegistration() {
        // The factoryRegistration test mutates the global
        // DeckValidatorFactory; reset to upstream's class so other
        // tests in the same JVM are unaffected.
        DeckValidatorFactory.instance.addDeckType(
                "Constructed - Pauper", Pauper.class);
        WebApiPauperValidator.clearServiceForTest();
    }

    // ---------------------------------------------------------------
    // Happy path
    // ---------------------------------------------------------------

    @Test
    void withService_legalCard_accepts(@TempDir Path tmp) throws IOException {
        PauperLegalityService service = newServiceFromFixture(tmp);
        WebApiPauperValidator validator = new WebApiPauperValidator(service);
        Deck deck = loadOrFail(makeDeck(
                entry("Lightning Bolt", "149", "M11", 4),
                entry("Counterspell", "61", "6ED", 4),
                entry("Mountain", "271", "M21", 52)
        ));

        boolean valid = validator.validate(deck);
        assertTrue(valid,
                "expected legal Pauper deck to validate. errors: "
                        + validator.getErrorsListInfo());
    }

    @Test
    void withService_bannedCard_rejects(@TempDir Path tmp) throws IOException {
        // Treasure Cruise is COMMON in KTK — upstream's rarity walk
        // would happily accept it. The Scryfall override is what
        // catches the ban here, since the constructor cleared the
        // upstream-hardcoded banlist.
        PauperLegalityService service = newServiceFromFixture(tmp);
        WebApiPauperValidator validator = new WebApiPauperValidator(service);
        Deck deck = loadOrFail(makeDeck(
                entry("Treasure Cruise", "59", "KTK", 4),
                entry("Island", "265", "M21", 56)
        ));

        boolean valid = validator.validate(deck);
        assertFalse(valid, "Treasure Cruise must be rejected via Scryfall ban");
        String errors = validator.getErrorsListInfo().toLowerCase(Locale.ROOT);
        assertTrue(errors.contains("treasure cruise"),
                "expected error mentioning Treasure Cruise, got: "
                        + validator.getErrorsListInfo());
        assertTrue(errors.contains("banned"),
                "expected error mentioning 'banned', got: "
                        + validator.getErrorsListInfo());
    }

    @Test
    void withService_notLegalCard_rejects(@TempDir Path tmp) throws IOException {
        // Force of Will is NOT_LEGAL per fixture and never printed
        // common upstream — both layers (super's rarity walk + the
        // Scryfall layer) flag it. Asserting on the Scryfall message
        // pins the override path explicitly rather than just
        // accidentally piggybacking on super's verdict.
        PauperLegalityService service = newServiceFromFixture(tmp);
        WebApiPauperValidator validator = new WebApiPauperValidator(service);
        Deck deck = loadOrFail(makeDeck(
                entry("Force of Will", "28", "ALL", 4),
                entry("Island", "265", "M21", 56)
        ));

        boolean valid = validator.validate(deck);
        assertFalse(valid, "Force of Will must be rejected as NOT_LEGAL");
        String errors = validator.getErrorsListInfo();
        assertTrue(errors.toLowerCase(Locale.ROOT).contains("force of will"),
                "expected error mentioning Force of Will, got: " + errors);
        assertTrue(errors.contains("Not legal in Pauper (Scryfall)"),
                "expected explicit Scryfall layer error, got: " + errors);
    }

    @Test
    void withService_notLegalCard_addsScryfallErrorEvenWhenSuperRejects(
            @TempDir Path tmp) throws IOException {
        // Hada Freeblade is NOT_LEGAL per fixture and UNCOMMON in every
        // xmage printing — super's rarity walk also rejects. The
        // Scryfall layer adds its own error on top, which the test
        // pins so the layer is provably exercised even when super's
        // verdict already happens to agree.
        PauperLegalityService service = newServiceFromFixture(tmp);
        WebApiPauperValidator validator = new WebApiPauperValidator(service);
        Deck deck = loadOrFail(makeDeck(
                entry("Hada Freeblade", "7", "WWK", 4),
                entry("Plains", "262", "M21", 56)
        ));

        boolean valid = validator.validate(deck);
        assertFalse(valid, "Hada Freeblade must be rejected as NOT_LEGAL");
        String errors = validator.getErrorsListInfo();
        assertTrue(errors.contains("Not legal in Pauper (Scryfall)"),
                "expected Scryfall NOT_LEGAL error layered onto super's "
                        + "rarity rejection, got: " + errors);
    }

    // ---------------------------------------------------------------
    // UNKNOWN fallback — defer to super
    // ---------------------------------------------------------------

    @Test
    void withService_unknownCardCommonPrinting_acceptedViaSuper(
            @TempDir Path tmp) throws IOException {
        // Wall of Wood is COMMON in 4ED and intentionally NOT in our
        // fixture — proves the UNKNOWN path defers to super, which
        // accepts on the rarity walk.
        PauperLegalityService service = newServiceFromFixture(tmp);
        WebApiPauperValidator validator = new WebApiPauperValidator(service);
        Deck deck = loadOrFail(makeDeck(
                entry("Wall of Wood", "284", "4ED", 4),
                entry("Forest", "267", "M21", 56)
        ));

        boolean valid = validator.validate(deck);
        assertTrue(valid,
                "Wall of Wood (COMMON, UNKNOWN to fixture) must accept "
                        + "via super.legalRarity. errors: "
                        + validator.getErrorsListInfo());
    }

    @Test
    void withService_unknownCardNeverCommon_rejectedBySuper(
            @TempDir Path tmp) throws IOException {
        // Mox Sapphire is RARE everywhere upstream and NOT in our
        // fixture. The UNKNOWN path defers to super, which rejects
        // via the rarity walk — proves the override doesn't silently
        // accept cards it has no opinion on.
        PauperLegalityService service = newServiceFromFixture(tmp);
        WebApiPauperValidator validator = new WebApiPauperValidator(service);
        Deck deck = loadOrFail(makeDeck(
                entry("Mox Sapphire", "266", "LEB", 4),
                entry("Island", "265", "M21", 56)
        ));

        boolean valid = validator.validate(deck);
        assertFalse(valid,
                "Mox Sapphire (RARE-only, UNKNOWN to fixture) must be "
                        + "rejected by super's rarity walk");
        String errors = validator.getErrorsListInfo().toLowerCase(Locale.ROOT);
        assertTrue(errors.contains("mox sapphire"),
                "expected error mentioning Mox Sapphire, got: "
                        + validator.getErrorsListInfo());
    }

    // ---------------------------------------------------------------
    // Service-null fallback — pure upstream behaviour
    // ---------------------------------------------------------------

    @Test
    void nullService_delegatesToSuper_acceptsLegalDeck() {
        WebApiPauperValidator validator = new WebApiPauperValidator((PauperLegalityService) null);
        Deck deck = loadOrFail(makeDeck(
                entry("Lightning Bolt", "149", "M11", 4),
                entry("Counterspell", "61", "6ED", 4),
                entry("Mountain", "271", "M21", 52)
        ));

        boolean valid = validator.validate(deck);
        assertTrue(valid,
                "null-service path must validate identically to upstream "
                        + "Pauper. errors: " + validator.getErrorsListInfo());
    }

    @Test
    void nullService_delegatesToSuper_rejectsUpstreamBanlist() {
        // With service null, the constructor does NOT clear the
        // upstream banlist — Treasure Cruise (a Pauper-banned card
        // hardcoded in mage.deck.Pauper) must still be rejected by
        // super's banlist loop.
        WebApiPauperValidator validator = new WebApiPauperValidator((PauperLegalityService) null);
        Deck deck = loadOrFail(makeDeck(
                entry("Treasure Cruise", "59", "KTK", 4),
                entry("Island", "265", "M21", 56)
        ));

        boolean valid = validator.validate(deck);
        assertFalse(valid,
                "null-service path must keep upstream banlist active");
        String errors = validator.getErrorsListInfo().toLowerCase(Locale.ROOT);
        assertTrue(errors.contains("treasure cruise"),
                "expected upstream banlist to flag Treasure Cruise, got: "
                        + validator.getErrorsListInfo());
    }

    // ---------------------------------------------------------------
    // Factory wiring
    // ---------------------------------------------------------------

    @Test
    void factoryRegistrationOverridesUpstream(@TempDir Path tmp) throws IOException {
        PauperLegalityService service = newServiceFromFixture(tmp);
        WebApiPauperValidator.setService(service);
        DeckValidatorFactory.instance.addDeckType(
                "Constructed - Pauper", WebApiPauperValidator.class);

        DeckValidator created = DeckValidatorFactory.instance
                .createDeckValidator("Constructed - Pauper");
        assertNotNull(created, "factory returned null for Constructed - Pauper");
        assertInstanceOf(WebApiPauperValidator.class, created,
                "factory must hand back our subclass after registration; "
                        + "got: " + created.getClass().getName());
        // Sanity: the constructed instance picks up the service from
        // the static holder and clears the upstream banlist as a
        // result. We can't read the protected `banned` field from
        // this package, but we can observe the behaviour: a
        // Treasure-Cruise deck passes super's banlist (no error from
        // the upstream path) and is rejected solely via the Scryfall
        // layer's "Banned in Pauper" message.
        Deck deck = loadOrFail(makeDeck(
                entry("Treasure Cruise", "59", "KTK", 4),
                entry("Island", "265", "M21", 56)
        ));
        assertFalse(created.validate(deck),
                "factory-built validator must reject Treasure Cruise");
        assertTrue(created.getErrorsListInfo()
                        .contains("Banned in Pauper"),
                "factory-built validator must use Scryfall ban message, got: "
                        + created.getErrorsListInfo());
    }

    @Test
    void withService_sideboardBannedCard_rejects(@TempDir Path tmp) throws IOException {
        // The override walks deck.getCards() + deck.getSideboard()
        // jointly. A banned card placed only in the sideboard must
        // fail validation just as it would in the maindeck — upstream
        // Pauper's banlist iteration applies across both, and our
        // Scryfall layer must preserve that semantic after we clear
        // the upstream banned set.
        WebApiPauperValidator v = new WebApiPauperValidator(newServiceFromFixture(tmp));
        Deck deck = loadOrFail(makeDeckWithSideboard(
                List.of(entry("Lightning Bolt", "149", "M11", 4),
                        entry("Mountain", "271", "M21", 56)),
                List.of(entry("Treasure Cruise", "59", "KTK", 4),
                        entry("Island", "265", "M21", 11))));

        assertFalse(v.validate(deck),
                "banned card in sideboard must reject the deck");
        String errors = v.getErrorsListInfo();
        assertTrue(errors.contains("Treasure Cruise") && errors.contains("Banned in Pauper"),
                "expected Scryfall ban error mentioning Treasure Cruise, got: " + errors);
    }

    @Test
    void withService_clearedStructuralBan_rejectedByScryfallLayer(@TempDir Path tmp) throws IOException {
        // Structural-ban regression pin. WebApiPauperValidator's
        // constructor calls banned.clear() when the service is wired,
        // dropping upstream Constructed's hardcoded structural bans
        // (Conspiracy / ante / dexterity / offensive / acorn-stamp).
        // Scryfall is supposed to re-flag those entries so the
        // cleared banlist doesn't become a permissiveness regression.
        // Pradesh Gypsies — printed COMMON in 4ED, banned officially
        // by Wizards in the 2020 racism removals — is the cleanest
        // test card: it's in xmage's CardRepository, it's in upstream
        // Constructed's hardcoded banlist (offensive group), and
        // Scryfall flags it banned. If the override ever stops
        // consulting Scryfall for these names, the COMMON rarity walk
        // would silently accept it.
        WebApiPauperValidator v = new WebApiPauperValidator(newServiceFromFixture(tmp));
        Deck deck = loadOrFail(makeDeck(
                entry("Pradesh Gypsies", "265", "4ED", 4),
                entry("Mountain", "271", "M21", 56)));

        assertFalse(v.validate(deck),
                "structural-ban card must be rejected via Scryfall banned verdict "
                        + "after banned.clear()");
        String errors = v.getErrorsListInfo();
        assertTrue(errors.contains("Pradesh Gypsies")
                        && errors.contains("Banned in Pauper"),
                "expected Scryfall banned error for Pradesh Gypsies, got: " + errors);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    private static PauperLegalityService newServiceFromFixture(Path tmp) throws IOException {
        Path cacheFile = tmp.resolve(LegalityCacheStore.CACHE_FILE_NAME);
        try (InputStream in = WebApiPauperValidatorTest.class
                .getResourceAsStream(FIXTURE_RESOURCE)) {
            if (in == null) {
                throw new IOException("fixture resource not found: " + FIXTURE_RESOURCE);
            }
            Files.createDirectories(cacheFile.getParent());
            Files.copy(in, cacheFile);
        }
        LegalityCacheStore store = new LegalityCacheStore(tmp);
        // skipNetwork=true — the fresh fixture is enough; if the test
        // ever reaches for the wire it's a regression in
        // PauperLegalityService's load orchestration.
        ScryfallBulkDataClient client = new ScryfallBulkDataClient(
                HttpClient.newHttpClient(), new ObjectMapper().getFactory()) {
            @Override
            public void fetchOracleCardsTo(Path destination) {
                throw new AssertionError("fetchOracleCardsTo must not be called "
                        + "when fresh fixture is staged");
            }
        };
        return new PauperLegalityService(store, client, true);
    }

    private static DeckCardInfo entry(String name, String number, String setCode, int count) {
        return new DeckCardInfo(name, number, setCode, count);
    }

    private static DeckCardLists makeDeck(DeckCardInfo... entries) {
        DeckCardLists deck = new DeckCardLists();
        deck.setName("WebApiPauperValidatorTest");
        deck.setAuthor("WebApiPauperValidatorTest");
        List<DeckCardInfo> cards = new ArrayList<>(entries.length);
        for (DeckCardInfo e : entries) {
            cards.add(e);
        }
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    private static DeckCardLists makeDeckWithSideboard(List<DeckCardInfo> main,
                                                        List<DeckCardInfo> sideboard) {
        DeckCardLists deck = new DeckCardLists();
        deck.setName("WebApiPauperValidatorTest");
        deck.setAuthor("WebApiPauperValidatorTest");
        deck.setCards(new ArrayList<>(main));
        deck.setSideboard(new ArrayList<>(sideboard));
        return deck;
    }

    private static Deck loadOrFail(DeckCardLists list) {
        try {
            return Deck.load(list, false, false);
        } catch (GameException ex) {
            throw new AssertionError(
                    "Deck.load failed — printing identifier mismatch? " + ex.getMessage(),
                    ex);
        }
    }
}
