package mage.webapi.mapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.cards.decks.Deck;
import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.repository.CardInfo;
import mage.cards.repository.CardRepository;
import mage.view.DeckView;
import mage.view.TableClientMessage;
import mage.webapi.dto.stream.WebDeckView;
import mage.webapi.dto.stream.WebSideboardInfo;
import mage.webapi.embed.EmbeddedServer;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Locks the wire shape for the slice 13 sideboard frame and verifies
 * that {@link DeckViewMapper#resolveCardName} resolves names against
 * the upstream {@link CardRepository} (not just echoing the
 * setCode:cardNumber hint).
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class DeckViewMapperTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";
    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeAll
    void boot() {
        EmbeddedServer.boot(CONFIG_PATH);
    }

    @Test
    void resolveCardName_findsRealCardByPrint() {
        // Pick a known printing — the LobbyService bootstrap test uses
        // Forest, so it's guaranteed to be in the DB. Find any Forest
        // print to grab a valid setCode/cardNumber pair.
        CardInfo forest = CardRepository.instance.findCard("Forest");
        assertNotNull(forest, "Forest must exist in the card repository");

        String resolved = DeckViewMapper.resolveCardName(
                forest.getSetCode(), forest.getCardNumber());
        assertEquals("Forest", resolved);
    }

    @Test
    void resolveCardName_unknownPrint_fallsBackToSetColonNumber() {
        String resolved = DeckViewMapper.resolveCardName("ZZZZ", "999");
        assertEquals("ZZZZ:999", resolved);
    }

    @Test
    void resolveCardName_blankInputs_returnsPlaceholder() {
        assertEquals("<unknown card>", DeckViewMapper.resolveCardName(null, null));
        assertEquals("<unknown card>", DeckViewMapper.resolveCardName("", "1"));
        assertEquals("<unknown card>", DeckViewMapper.resolveCardName("DOM", ""));
    }

    @Test
    void toDeckDto_nullInput_returnsEmpty() {
        WebDeckView dto = DeckViewMapper.toDeckDto(null);
        assertEquals("", dto.name());
        assertTrue(dto.mainList().isEmpty());
        assertTrue(dto.sideboard().isEmpty());
    }

    @Test
    void toSideboardInfo_jsonShape_locksFiveTopFields() throws Exception {
        UUID tableId = UUID.fromString("11111111-1111-1111-1111-111111111111");
        TableClientMessage tcm = new TableClientMessage()
                .withDeck(buildSimpleForestDeck())
                .withTable(tableId, null)
                .withTime(600)
                .withFlag(false);

        WebSideboardInfo info = DeckViewMapper.toSideboardInfo(tcm);
        JsonNode node = JSON.valueToTree(info);

        assertEquals(5, node.size(),
                "WebSideboardInfo must have exactly 5 fields; got: " + node);
        for (String f : List.of("deck", "tableId", "parentTableId", "time", "limited")) {
            assertTrue(node.has(f), "missing field: " + f);
        }
        assertEquals(tableId.toString(), info.tableId());
        assertEquals("", info.parentTableId());
        assertEquals(600, info.time());
        assertFalse(info.limited());
    }

    @Test
    void deckView_jsonShape_locksThreeFields() throws Exception {
        WebDeckView dto = DeckViewMapper.toDeckDto(new DeckView(buildSimpleForestDeck()));
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(3, node.size(),
                "WebDeckView must have exactly 3 fields; got: " + node);
        assertTrue(node.has("name"));
        assertTrue(node.has("mainList"));
        assertTrue(node.has("sideboard"));

        assertFalse(dto.mainList().isEmpty());
        // Server resolved the name from the print.
        assertEquals("Forest", dto.mainList().get(0).name());
    }

    @Test
    void simpleCardView_jsonShape_locksFiveFields() throws Exception {
        WebDeckView dto = DeckViewMapper.toDeckDto(new DeckView(buildSimpleForestDeck()));
        JsonNode entry = JSON.valueToTree(dto.mainList().get(0));
        assertEquals(5, entry.size(),
                "WebSimpleCardView must have exactly 5 fields; got: " + entry);
        for (String f : List.of("id", "name", "expansionSetCode",
                "cardNumber", "usesVariousArt")) {
            assertTrue(entry.has(f), "missing field: " + f);
        }
    }

    private static Deck buildSimpleForestDeck() {
        try {
            CardInfo forest = CardRepository.instance.findCard("Forest");
            DeckCardLists list = new DeckCardLists();
            list.setName("Mono-green");
            List<DeckCardInfo> mainList = new ArrayList<>();
            mainList.add(new DeckCardInfo("Forest", forest.getCardNumber(),
                    forest.getSetCode(), 60));
            list.setCards(mainList);
            list.setSideboard(new ArrayList<>());
            return Deck.load(list, false, false);
        } catch (mage.game.GameException ex) {
            throw new IllegalStateException("Failed to load Forest test deck", ex);
        }
    }
}
