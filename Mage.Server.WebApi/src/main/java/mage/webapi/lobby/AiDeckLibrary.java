package mage.webapi.lobby;

import mage.cards.decks.DeckCardLists;
import mage.game.Table;
import mage.webapi.lobby.deck.BasicLandsFallback;
import mage.webapi.lobby.deck.CommanderDeckPool;
import mage.webapi.lobby.deck.CommanderDecksEasy;
import mage.webapi.lobby.deck.CommanderDecksHard;
import mage.webapi.lobby.deck.CommanderDecksMedium;
import mage.webapi.lobby.deck.PauperDeckPool;
import mage.webapi.lobby.deck.PauperDecksMedium;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * Dispatcher for server-side AI fallback decks. Picks a deck shape
 * appropriate to the table's format and the requested
 * {@link AiDifficulty}. Per-format / per-difficulty deck data lives
 * in the {@code deck} subpackage; this class only routes.
 *
 * <p>For Pauper tables: rotates predictably through 10 AI-friendly
 * creature decks. For Commander tables: rotates predictably through
 * W/U/B/R/G so a 4-AI lobby sees four distinct colors. Each format's
 * rotation index is shared across all difficulty tiers — only the
 * tier's deck pool changes.
 *
 * <p>For non-Pauper, non-Commander tables: returns the
 * {@link BasicLandsFallback} 60-card mono-green pile regardless of
 * difficulty. Per-format Standard pools land in future slices.
 *
 * <p>Slice B refactor (2026-05-07) — extracted the per-color deck
 * builders into {@link CommanderDecksHard} (verbatim move; current
 * card lists preserved), and added stubs {@link CommanderDecksMedium}
 * and {@link CommanderDecksEasy} that delegate to Hard pending Slice
 * C / C2's apply passes.
 */
public final class AiDeckLibrary {

    /**
     * Predictable WUBRG rotation across Commander AI fills. Index 0 →
     * white; +1 each fill cycles to blue, black, red, green, then
     * wraps. {@link Math#floorMod(int, int)} guards the
     * {@code Integer.MAX_VALUE} overflow case where plain {@code %}
     * would yield a negative index.
     *
     * <p>Predictable rather than random so the same lobby-create call
     * produces the same color split every time, which makes session
     * debugging easier.
     */
    private final AtomicInteger commanderRotation = new AtomicInteger(0);
    private final AtomicInteger pauperRotation = new AtomicInteger(0);

    private static final int COMMANDER_ROTATION_LENGTH = 5;
    private static final int PAUPER_ROTATION_LENGTH = 10;

    /**
     * Pick the right fallback deck shape for {@code table}'s format
     * and the requested {@code difficulty}. Pauper and Commander
     * tables rotate through the difficulty tier's pool; everything
     * else falls through to the basic-lands fallback.
     */
    public DeckCardLists buildFallbackDeckForTable(Table table, AiDifficulty difficulty) {
        String validatorName = table.getValidator() == null
                ? "" : table.getValidator().getName();
        if (validatorName.toLowerCase().contains("pauper")) {
            int idx = Math.floorMod(pauperRotation.getAndIncrement(),
                    PAUPER_ROTATION_LENGTH);
            return pauperDecksFor(difficulty).build(idx);
        }
        if (validatorName.toLowerCase().contains("commander")) {
            int idx = Math.floorMod(commanderRotation.getAndIncrement(),
                    COMMANDER_ROTATION_LENGTH);
            return commanderDecksFor(difficulty).build(idx);
        }
        return BasicLandsFallback.buildBearsDeck();
    }

    private static CommanderDeckPool commanderDecksFor(AiDifficulty difficulty) {
        switch (difficulty) {
            case EASY:
                return new CommanderDecksEasy();
            case MEDIUM:
                return new CommanderDecksMedium();
            case HARD:
                return new CommanderDecksHard();
            default:
                throw new IllegalStateException("Unreachable difficulty: " + difficulty);
        }
    }

    private static PauperDeckPool pauperDecksFor(AiDifficulty difficulty) {
        // Easy + Hard tiers deferred — Slice F shipped Medium only.
        // All three tiers route to PauperDecksMedium until follow-up
        // slices ship per-tier pools.
        return new PauperDecksMedium();
    }
}
