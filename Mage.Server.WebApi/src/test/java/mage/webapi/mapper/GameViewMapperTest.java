package mage.webapi.mapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.view.TableClientMessage;
import mage.webapi.dto.stream.WebManaPoolView;
import mage.webapi.dto.stream.WebStartGameInfo;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Snapshot tests for the slice 3 mappers. Locks the JSON shape so
 * upstream view drift surfaces here, not on the wire.
 *
 * <p>The {@code GameView} / {@code PlayerView} round-trip is exercised
 * by the WS integration tests against a real game in
 * {@code GameStreamHandlerTest}; this test focuses on the simple
 * mappers that are practical to unit-test directly.
 */
class GameViewMapperTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void toManaPoolDto_nullInput_returnsZeroes() {
        WebManaPoolView dto = GameViewMapper.toManaPoolDto(null);
        assertEquals(0, dto.red());
        assertEquals(0, dto.green());
        assertEquals(0, dto.blue());
        assertEquals(0, dto.white());
        assertEquals(0, dto.black());
        assertEquals(0, dto.colorless());
    }

    @Test
    void manaPoolDto_jsonShape_locksSixFields() throws Exception {
        WebManaPoolView dto = new WebManaPoolView(1, 2, 3, 4, 5, 6);
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(6, node.size(),
                "WebManaPoolView must have exactly 6 fields; got: " + node);
        assertTrue(node.has("red"));
        assertTrue(node.has("green"));
        assertTrue(node.has("blue"));
        assertTrue(node.has("white"));
        assertTrue(node.has("black"));
        assertTrue(node.has("colorless"));
    }

    @Test
    void toStartGameInfo_mapsThreeIds() {
        UUID tableId = UUID.fromString("11111111-1111-1111-1111-111111111111");
        UUID gameId = UUID.fromString("22222222-2222-2222-2222-222222222222");
        UUID playerId = UUID.fromString("33333333-3333-3333-3333-333333333333");
        TableClientMessage tcm = new TableClientMessage()
                .withTable(tableId, null)
                .withGame(gameId)
                .withPlayer(playerId);

        WebStartGameInfo dto = GameViewMapper.toStartGameInfo(tcm);

        assertEquals(tableId.toString(), dto.tableId());
        assertEquals(gameId.toString(), dto.gameId());
        assertEquals(playerId.toString(), dto.playerId());
    }

    @Test
    void toStartGameInfo_nullIds_mapToEmptyString() {
        WebStartGameInfo dto = GameViewMapper.toStartGameInfo(new TableClientMessage());
        assertEquals("", dto.tableId());
        assertEquals("", dto.gameId());
        assertEquals("", dto.playerId());
    }

    @Test
    void startGameInfo_jsonShape_locksThreeFields() throws Exception {
        WebStartGameInfo dto = new WebStartGameInfo("a", "b", "c");
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(3, node.size(),
                "WebStartGameInfo must have exactly 3 fields; got: " + node);
        assertTrue(node.has("tableId"));
        assertTrue(node.has("gameId"));
        assertTrue(node.has("playerId"));
    }

    @Test
    void toDto_nullInputs_throw() {
        assertThrows(IllegalArgumentException.class,
                () -> GameViewMapper.toDto(null));
        assertThrows(IllegalArgumentException.class,
                () -> GameViewMapper.toPlayerDto(null));
        assertThrows(IllegalArgumentException.class,
                () -> GameViewMapper.toStartGameInfo(null));
    }
}
