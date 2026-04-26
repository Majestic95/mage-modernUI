package mage.webapi.mapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.view.CommandObjectView;
import mage.view.TableClientMessage;
import mage.webapi.dto.stream.WebAbilityPickerView;
import mage.webapi.dto.stream.WebChoice;
import mage.webapi.dto.stream.WebCombatGroupView;
import mage.webapi.dto.stream.WebCommandObjectView;
import mage.webapi.dto.stream.WebGameClientMessage;
import mage.webapi.dto.stream.WebGameEndView;
import mage.webapi.dto.stream.WebManaPoolView;
import mage.webapi.dto.stream.WebStartGameInfo;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
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
        assertThrows(IllegalArgumentException.class,
                () -> GameViewMapper.toClientMessage(null));
        assertThrows(IllegalArgumentException.class,
                () -> GameViewMapper.toGameEndDto(null));
    }

    @Test
    void combatGroupView_jsonShape_locksFiveFields() throws Exception {
        WebCombatGroupView dto = new WebCombatGroupView(
                "11111111-1111-1111-1111-111111111111",
                "alice",
                Map.of(),
                Map.of(),
                false);
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(5, node.size(),
                "WebCombatGroupView must have exactly 5 fields; got: " + node);
        for (String f : List.of("defenderId", "defenderName",
                "attackers", "blockers", "blocked")) {
            assertTrue(node.has(f), "missing field: " + f);
        }
    }

    @Test
    void gameClientMessage_jsonShape_locksEightFields() throws Exception {
        WebGameClientMessage dto = new WebGameClientMessage(
                null, "ggwp", List.of(), Map.of(), 0, 0, false, null);
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(8, node.size(),
                "WebGameClientMessage must have exactly 8 fields (slice 7 added choice); got: " + node);
        for (String f : List.of("gameView", "message", "targets",
                "cardsView1", "min", "max", "flag", "choice")) {
            assertTrue(node.has(f), "missing field: " + f);
        }
    }

    @Test
    void toErrorMessage_synthesizesMessageOnlyShape() {
        WebGameClientMessage dto = GameViewMapper.toErrorMessage("oops");
        assertEquals("oops", dto.message());
        assertEquals(null, dto.gameView());
        assertTrue(dto.targets().isEmpty());
        assertTrue(dto.cardsView1().isEmpty());
        assertEquals(0, dto.min());
        assertEquals(0, dto.max());
        assertEquals(null, dto.choice());
    }

    @Test
    void choice_jsonShape_locksFourFields() throws Exception {
        WebChoice dto = new WebChoice(
                "Choose one —",
                "",
                true,
                Map.of("a", "Destroy target creature.",
                        "b", "Counter target spell."));
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(4, node.size(),
                "WebChoice must have exactly 4 fields; got: " + node);
        for (String f : List.of("message", "subMessage", "required", "choices")) {
            assertTrue(node.has(f), "missing field: " + f);
        }
    }

    @Test
    void abilityPickerView_jsonShape_locksThreeFields() throws Exception {
        WebAbilityPickerView dto = new WebAbilityPickerView(
                null, "Choose ability", Map.of("uuid-1", "1. Activate A"));
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(3, node.size(),
                "WebAbilityPickerView must have exactly 3 fields; got: " + node);
        for (String f : List.of("gameView", "message", "choices")) {
            assertTrue(node.has(f), "missing field: " + f);
        }
    }

    @Test
    void toAbilityPickerDto_nullInput_throws() {
        assertThrows(IllegalArgumentException.class,
                () -> GameViewMapper.toAbilityPickerDto(null));
    }

    @Test
    void toChoiceDto_nullInput_throws() {
        assertThrows(IllegalArgumentException.class,
                () -> GameViewMapper.toChoiceDto(null));
    }

    /* ---------- slice 11: command zone ---------- */

    @Test
    void commandObjectView_jsonShape_locksSevenFields() throws Exception {
        WebCommandObjectView dto = new WebCommandObjectView(
                "11111111-1111-1111-1111-111111111111",
                "commander",
                "Atraxa, Praetors' Voice",
                "C16",
                "atraxa-praetors-voice",
                1,
                List.of("Flying, vigilance, deathtouch, lifelink",
                        "At the beginning of your end step, proliferate."));
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(7, node.size(),
                "WebCommandObjectView must have exactly 7 fields; got: " + node);
        for (String f : List.of("id", "kind", "name", "expansionSetCode",
                "imageFileName", "imageNumber", "rules")) {
            assertTrue(node.has(f), "missing field: " + f);
        }
    }

    @Test
    void toCommandList_nullInput_returnsEmptyList() {
        assertEquals(List.of(), GameViewMapper.toCommandList(null));
        assertEquals(List.of(), GameViewMapper.toCommandList(List.of()));
    }

    @Test
    void toCommandList_unknownSubclass_defaultsToCommander() {
        // Anonymous CommandObjectView impl doesn't extend any of the
        // four upstream concrete classes — kindFor() must fall through
        // to "commander" rather than throw, so the wire format degrades
        // gracefully if upstream adds a fifth subclass later.
        UUID id = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        CommandObjectView mystery = new CommandObjectView() {
            @Override public String getExpansionSetCode() { return "TST"; }
            @Override public String getName() { return "Mystery thing"; }
            @Override public UUID getId() { return id; }
            @Override public String getImageFileName() { return ""; }
            @Override public int getImageNumber() { return 0; }
            @Override public List<String> getRules() { return List.of("does stuff"); }
            @Override public boolean isPlayable() { return false; }
            @Override public void setPlayableStats(mage.players.PlayableObjectStats s) {}
            @Override public mage.players.PlayableObjectStats getPlayableStats() {
                return new mage.players.PlayableObjectStats();
            }
            @Override public boolean isChoosable() { return false; }
            @Override public void setChoosable(boolean v) {}
            @Override public boolean isSelected() { return false; }
            @Override public void setSelected(boolean v) {}
        };

        List<WebCommandObjectView> out = GameViewMapper.toCommandList(List.of(mystery));
        assertEquals(1, out.size());
        assertEquals("commander", out.get(0).kind());
        assertEquals("Mystery thing", out.get(0).name());
        assertEquals(id.toString(), out.get(0).id());
        assertEquals(List.of("does stuff"), out.get(0).rules());
    }

    @Test
    void toCommandList_nullEntries_areSkipped() {
        // Defensive against upstream view drift — never null-out an
        // entry on the wire.
        List<CommandObjectView> input = new java.util.ArrayList<>();
        input.add(null);
        assertEquals(List.of(), GameViewMapper.toCommandList(input));
    }

    @Test
    void gameEndView_jsonShape_locksSevenFields() throws Exception {
        WebGameEndView dto = new WebGameEndView(
                "You won the game on turn 7.",
                "You won the match!",
                "",
                true,
                1,
                1,
                List.of());
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(7, node.size(),
                "WebGameEndView must have exactly 7 fields; got: " + node);
        for (String f : List.of("gameInfo", "matchInfo", "additionalInfo",
                "won", "wins", "winsNeeded", "players")) {
            assertTrue(node.has(f), "missing field: " + f);
        }
    }
}
