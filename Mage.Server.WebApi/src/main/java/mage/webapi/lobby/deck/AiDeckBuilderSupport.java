package mage.webapi.lobby.deck;

import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.repository.CardInfo;
import mage.cards.repository.CardRepository;
import mage.webapi.WebApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

/**
 * Shared building blocks for the per-difficulty deck-builder classes
 * in this package. Stateless static helpers — no per-builder state
 * means simulation cloning is automatic and the helpers can be reused
 * freely across difficulty tiers.
 *
 * <p>Extracted from {@code AiDeckLibrary} on 2026-05-07 so per-tier
 * deck classes can share the lookup-and-fallback machinery without
 * duplicating it. Behavior preserved verbatim from the original
 * private helpers; visibility is package-private — only sibling
 * deck-builder classes in this package depend on these helpers.
 */
public final class AiDeckBuilderSupport {

    private static final Logger LOG = LoggerFactory.getLogger(AiDeckBuilderSupport.class);

    private AiDeckBuilderSupport() {}

    /**
     * Resolve a basic land that MUST exist in the local card DB. Used
     * for the deck's mana base — failure here means the local DB is
     * broken and the AI cannot be served.
     */
    static CardInfo requireBasic(String name) {
        CardInfo info = CardRepository.instance.findCard(name);
        if (info == null) {
            throw new WebApiException(500, "UPSTREAM_ERROR",
                    "Card DB has no " + name + " — cannot build AI fallback deck.");
        }
        return info;
    }

    /**
     * Walk a candidate ladder for a mono-color legendary creature; pick
     * the first one present in the local DB. Lets the deck still build
     * when the primary commander is missing from a thinned card pool.
     */
    static CardInfo pickCommander(String colorLabel, String... candidates) {
        for (String candidate : candidates) {
            CardInfo c = CardRepository.instance.findCard(candidate);
            if (c != null) {
                return c;
            }
        }
        throw new WebApiException(500, "UPSTREAM_ERROR",
                "Card DB has no mono-" + colorLabel + " legendary creature from "
                        + "the candidate list — cannot build AI Commander fallback deck.");
    }

    static DeckCardLists newDeck(String name) {
        DeckCardLists deck = new DeckCardLists();
        deck.setName(name);
        deck.setAuthor("server");
        return deck;
    }

    static void attachCommander(DeckCardLists deck, CardInfo commander) {
        List<DeckCardInfo> sideboard = new ArrayList<>();
        addEntry(sideboard, commander.getName(), commander, 1);
        deck.setSideboard(sideboard);
    }

    static void addEntry(List<DeckCardInfo> out, String name,
                         CardInfo info, int n) {
        out.add(new DeckCardInfo(name, info.getCardNumber(), info.getSetCode(), n));
    }

    /**
     * Lookup-then-insert with substitution: if {@code name} is missing
     * from the local card DB, substitute {@code n} extra copies of
     * {@code fallback}. Lets the 99-card target survive an incomplete
     * card pool. Logs a WARN per substitution so DB gaps surface.
     */
    static void addEntryOrFallback(List<DeckCardInfo> out, String name,
                                   CardInfo fallback, int n) {
        CardInfo info = CardRepository.instance.findCard(name);
        if (info == null) {
            LOG.warn("AI deck card '{}' missing from repository — substituting {} extra {}",
                    name, n, fallback.getName());
            out.add(new DeckCardInfo(fallback.getName(),
                    fallback.getCardNumber(), fallback.getSetCode(), n));
            return;
        }
        out.add(new DeckCardInfo(name, info.getCardNumber(), info.getSetCode(), n));
    }

    /** Bulk variant of {@link #addEntryOrFallback} for terse decklist sections. */
    static void addAll(List<DeckCardInfo> out, CardInfo fallback,
                       int n, String... names) {
        for (String name : names) {
            addEntryOrFallback(out, name, fallback, n);
        }
    }
}
