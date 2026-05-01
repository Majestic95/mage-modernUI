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
import static org.junit.jupiter.api.Assertions.assertFalse;
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
    void playerView_jsonShape_locksTwentyFourFields_schema123() throws Exception {
        // Schema 1.20 (slice 69a, ADR 0010 v2 D3a) added teamId.
        // Schema 1.22 (slice 70-D, ADR 0011 D5) added colorIdentity.
        // Schema 1.23 (slice 70-H, ADR 0011 D3 / ADR 0010 v2 D11(e))
        //   added connectionState.
        // Lock the wire shape so any future field add/remove fails here
        // first instead of leaking into the webclient.
        mage.webapi.dto.stream.WebPlayerView dto =
                new mage.webapi.dto.stream.WebPlayerView(
                        "11111111-1111-1111-1111-111111111111", "alice",
                        20, 0, 1, 60, 7,
                        Map.of(), Map.of(), Map.of(), Map.of(),
                        new WebManaPoolView(0, 0, 0, 0, 0, 0),
                        true, true, true, true, false, false, false,
                        List.of(), List.of(), null, List.of(),
                        mage.webapi.dto.stream.WebPlayerView
                                .CONNECTION_STATE_CONNECTED);
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(24, node.size(),
                "WebPlayerView must have exactly 24 fields; got: " + node);
        for (String field : List.of(
                "playerId", "name", "life", "wins", "winsNeeded",
                "libraryCount", "handCount", "graveyard", "exile",
                "sideboard", "battlefield", "manaPool", "controlled",
                "isHuman", "isActive", "hasPriority", "hasLeft",
                "monarch", "initiative", "designationNames",
                "commandList", "teamId", "colorIdentity",
                "connectionState")) {
            assertTrue(node.has(field), "missing field: " + field);
        }
        assertTrue(node.get("teamId").isNull(),
                "Slice 69a ships teamId=null; slice 69b populates from "
                        + "MatchType.getPlayersPerTeam() + seat-index.");
        assertTrue(node.get("colorIdentity").isArray()
                        && node.get("colorIdentity").isEmpty(),
                "Slice 70-D — colorIdentity defaults to [] for the "
                        + "non-Commander player fixture; mapper must emit "
                        + "List.of() not null per N9 (Zod default fires "
                        + "only on missing key, not null value).");
        assertEquals("connected", node.get("connectionState").asText(),
                "Slice 70-H — connectionState is a non-null string; "
                        + "the wire format always carries one of "
                        + "CONNECTION_STATE_CONNECTED / "
                        + "CONNECTION_STATE_DISCONNECTED. Old (1.22) "
                        + "clients tolerate the new field via Zod's "
                        + ".default('connected'); new clients receiving "
                        + "an old (1.22) frame default to 'connected' "
                        + "for the missing key (Zod default fires on "
                        + "missing key, not null value).");
    }

    @Test
    void shouldIncludePlayer_nullFilter_keepsEveryone() {
        // Slice 69c (ADR 0010 v2 D1) — the null sentinel = "no filter"
        // (RoI.ALL or unknown recipient). Every PlayerId, including
        // null, is kept. This is the v2 shippable-format default
        // (FreeForAll defaults to RoI.ALL; only an explicit
        // RangeOfInfluence.ONE/TWO selection at table-creation time
        // produces a non-null filter set).
        assertTrue(GameViewMapper.shouldIncludePlayer(
                UUID.randomUUID(), null));
        assertTrue(GameViewMapper.shouldIncludePlayer(null, null));
    }

    @Test
    void shouldIncludePlayer_inRange_keepsPlayer() {
        // Recipient + their in-range opponent both survive. Lock the
        // happy path — this is what runs every frame in any
        // non-RoI.ALL multiplayer game.
        UUID alice = UUID.fromString("aaaaaaaa-1111-1111-1111-111111111111");
        UUID bob = UUID.fromString("bbbbbbbb-2222-2222-2222-222222222222");
        assertTrue(GameViewMapper.shouldIncludePlayer(
                alice, java.util.Set.of(alice, bob)));
        assertTrue(GameViewMapper.shouldIncludePlayer(
                bob, java.util.Set.of(alice, bob)));
    }

    @Test
    void shouldIncludePlayer_outOfRange_dropsPlayer() {
        // The load-bearing security case. CR 801.7 requires hidden
        // information (life totals, hand counts, battlefield
        // permanents) of out-of-range opponents NOT to surface to
        // the recipient. RangeOfInfluence.ONE 4p FFA: alice is the
        // recipient; her in-range set is {alice, bob}; carol and
        // dave are out of range and must be dropped from
        // WebGameView.players.
        UUID alice = UUID.fromString("aaaaaaaa-1111-1111-1111-111111111111");
        UUID bob = UUID.fromString("bbbbbbbb-2222-2222-2222-222222222222");
        UUID carol = UUID.fromString("cccccccc-3333-3333-3333-333333333333");
        UUID dave = UUID.fromString("dddddddd-4444-4444-4444-444444444444");
        java.util.Set<UUID> aliceRange = java.util.Set.of(alice, bob);
        assertFalse(GameViewMapper.shouldIncludePlayer(carol, aliceRange));
        assertFalse(GameViewMapper.shouldIncludePlayer(dave, aliceRange));
    }

    @Test
    void shouldIncludePlayer_nullPlayerId_defensiveKeep() {
        // Defensive — a malformed PlayerView with playerId=null
        // shouldn't crash the frame. We keep it; downstream the
        // mapped WebPlayerView.playerId is empty-string per
        // toPlayerDto's null-handling. Better a degraded survivor
        // than a thrown frame on the engine thread.
        UUID alice = UUID.fromString("aaaaaaaa-1111-1111-1111-111111111111");
        assertTrue(GameViewMapper.shouldIncludePlayer(
                null, java.util.Set.of(alice)));
    }

    @Test
    void shouldIncludePlayer_emptyRange_dropsEveryoneExceptDefensiveKeeps() {
        // An empty in-range set is unusual in practice (recipient is
        // always in their own range) but if it happens we filter
        // accordingly — every non-null playerId is dropped, null
        // playerId still defensively kept.
        java.util.Set<UUID> empty = java.util.Set.of();
        assertFalse(GameViewMapper.shouldIncludePlayer(
                UUID.randomUUID(), empty));
        assertTrue(GameViewMapper.shouldIncludePlayer(null, empty),
                "null playerId is defensively kept regardless of "
                        + "filter set contents");
    }

    @Test
    void streamHello_jsonShape_locksFourFields_schema120() throws Exception {
        // Schema 1.20 (slice 69a, ADR 0010 v2 D12) added protocolVersion.
        mage.webapi.dto.stream.WebStreamHello hello =
                new mage.webapi.dto.stream.WebStreamHello(
                        "g1", "alice", "live",
                        mage.webapi.ProtocolVersion.CURRENT);
        JsonNode node = JSON.valueToTree(hello);
        assertEquals(4, node.size(),
                "WebStreamHello must have exactly 4 fields; got: " + node);
        for (String field : List.of("gameId", "username", "mode", "protocolVersion")) {
            assertTrue(node.has(field), "missing field: " + field);
        }
        assertEquals(2, node.get("protocolVersion").asInt(),
                "ProtocolVersion.CURRENT == 2 in v2 (ADR 0010 v2 D12)");
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
    void gameClientMessage_jsonShape_locksNineFields() throws Exception {
        WebGameClientMessage dto = new WebGameClientMessage(
                null, "ggwp", List.of(), Map.of(), 0, 0, false, null,
                mage.webapi.dto.stream.WebClientMessageOptions.EMPTY);
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(9, node.size(),
                "WebGameClientMessage must have exactly 9 fields "
                        + "(slice 7 added choice; slice 17 added options); got: " + node);
        for (String f : List.of("gameView", "message", "targets",
                "cardsView1", "min", "max", "flag", "choice", "options")) {
            assertTrue(node.has(f), "missing field: " + f);
        }
    }

    @Test
    void clientMessageOptions_jsonShape_locksSixFields() throws Exception {
        mage.webapi.dto.stream.WebClientMessageOptions opts =
                new mage.webapi.dto.stream.WebClientMessageOptions(
                        "Mulligan", "Keep",
                        List.of("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
                        List.of(),
                        "All attack",
                        false);
        JsonNode node = JSON.valueToTree(opts);
        assertEquals(6, node.size(),
                "WebClientMessageOptions must have exactly 6 fields "
                        + "(slice 26 / ADR 0009 added isTriggerOrder); got: " + node);
        for (String f : List.of("leftBtnText", "rightBtnText",
                "possibleAttackers", "possibleBlockers", "specialButton",
                "isTriggerOrder")) {
            assertTrue(node.has(f), "missing field: " + f);
        }
        assertEquals("Mulligan", node.get("leftBtnText").asText());
        assertEquals("Keep", node.get("rightBtnText").asText());
        assertTrue(node.get("possibleAttackers").isArray());
        assertEquals(1, node.get("possibleAttackers").size());
        assertEquals("All attack", node.get("specialButton").asText());
        assertFalse(node.get("isTriggerOrder").asBoolean());
    }

    @Test
    void extractOptions_nullInput_returnsEmpty() {
        assertEquals(mage.webapi.dto.stream.WebClientMessageOptions.EMPTY,
                GameViewMapper.extractOptions(null));
    }

    @Test
    void extractOptions_buttonLabels_forwardsLeftAndRight() {
        java.util.Map<String, java.io.Serializable> source = new java.util.HashMap<>();
        source.put("UI.left.btn.text", "Mulligan");
        source.put("UI.right.btn.text", "Keep");
        mage.webapi.dto.stream.WebClientMessageOptions out =
                GameViewMapper.extractOptions(source);
        assertEquals("Mulligan", out.leftBtnText());
        assertEquals("Keep", out.rightBtnText());
        assertTrue(out.possibleAttackers().isEmpty());
        assertTrue(out.possibleBlockers().isEmpty());
        assertEquals("", out.specialButton());
    }

    @Test
    void extractOptions_combatLists_forwardsUuidStringsFromUuidCollection() {
        java.util.UUID a1 = java.util.UUID.fromString("11111111-1111-1111-1111-111111111111");
        java.util.UUID a2 = java.util.UUID.fromString("22222222-2222-2222-2222-222222222222");
        java.util.Map<String, java.io.Serializable> source = new java.util.HashMap<>();
        source.put("POSSIBLE_ATTACKERS",
                new java.util.ArrayList<>(List.of(a1, a2)));
        source.put("SPECIAL_BUTTON", "All attack");
        mage.webapi.dto.stream.WebClientMessageOptions out =
                GameViewMapper.extractOptions(source);
        assertEquals(List.of(a1.toString(), a2.toString()), out.possibleAttackers());
        assertEquals("All attack", out.specialButton());
    }

    @Test
    void extractOptions_unknownKeys_areDropped() {
        // Closed-surface contract: anything outside the whitelist is
        // discarded, not forwarded as a passthrough. Locks against
        // accidental wire-format expansion if upstream adds a new key.
        java.util.Map<String, java.io.Serializable> source = new java.util.HashMap<>();
        source.put("INTERNAL_ENGINE_KEY", "leak-me");
        source.put("UI.left.btn.text", "OK");
        mage.webapi.dto.stream.WebClientMessageOptions out =
                GameViewMapper.extractOptions(source);
        assertEquals("OK", out.leftBtnText());
        // No way to assert the key is dropped beyond proving the
        // record only has 6 fields, which the shape-lock test covers.
    }

    /* ---------- slice 26 / ADR 0009: isTriggerOrder discriminator ---------- */

    @Test
    void extractOptions_queryTypePickAbility_setsIsTriggerOrderTrue() {
        java.util.Map<String, java.io.Serializable> source = new java.util.HashMap<>();
        source.put("queryType", mage.game.events.PlayerQueryEvent.QueryType.PICK_ABILITY);
        mage.webapi.dto.stream.WebClientMessageOptions out =
                GameViewMapper.extractOptions(source);
        assertTrue(out.isTriggerOrder());
    }

    @Test
    void extractOptions_queryTypePickTarget_leavesIsTriggerOrderFalse() {
        java.util.Map<String, java.io.Serializable> source = new java.util.HashMap<>();
        source.put("queryType", mage.game.events.PlayerQueryEvent.QueryType.PICK_TARGET);
        mage.webapi.dto.stream.WebClientMessageOptions out =
                GameViewMapper.extractOptions(source);
        assertFalse(out.isTriggerOrder());
    }

    @Test
    void extractOptions_missingQueryType_leavesIsTriggerOrderFalse() {
        java.util.Map<String, java.io.Serializable> source = new java.util.HashMap<>();
        source.put("UI.left.btn.text", "OK");
        mage.webapi.dto.stream.WebClientMessageOptions out =
                GameViewMapper.extractOptions(source);
        assertFalse(out.isTriggerOrder());
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
    void commandObjectView_jsonShape_locksEightFields() throws Exception {
        WebCommandObjectView dto = new WebCommandObjectView(
                "11111111-1111-1111-1111-111111111111",
                "commander",
                "Atraxa, Praetors' Voice",
                "C16",
                "atraxa-praetors-voice",
                1,
                "190",
                List.of("Flying, vigilance, deathtouch, lifelink",
                        "At the beginning of your end step, proliferate."));
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(8, node.size(),
                "WebCommandObjectView must have exactly 8 fields; got: " + node);
        for (String f : List.of("id", "kind", "name", "expansionSetCode",
                "imageFileName", "imageNumber", "cardNumber", "rules")) {
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

    /* ---------- slice 70-D: colorIdentity union helper ---------- */

    @Test
    void unionColorIdentity_emptyInput_returnsEmptyList() {
        // Non-commander format — no CommanderView entries → empty
        // commanderIdentities → empty union. Critic N9: must return
        // List.of() not null.
        assertEquals(List.of(), GameViewMapper.unionColorIdentity(List.of()));
        assertEquals(List.of(), GameViewMapper.unionColorIdentity(null));
    }

    @Test
    void unionColorIdentity_allEmptyStrings_returnsEmptyList() {
        // Colorless commanders (Karn, Eldrazi) → empty identity string
        // → empty union. Drives the neutral-grey halo per spec §7.3.
        assertEquals(List.of(),
                GameViewMapper.unionColorIdentity(List.of("", "")));
    }

    @Test
    void unionColorIdentity_singleMonoCommander_returnsOneColor() {
        assertEquals(List.of("R"),
                GameViewMapper.unionColorIdentity(List.of("R")));
        assertEquals(List.of("U"),
                GameViewMapper.unionColorIdentity(List.of("U")));
    }

    @Test
    void unionColorIdentity_singleMulticolorCommander_sortedWUBRG() {
        // Atraxa is WUBG. Must come back sorted in WUBRG order
        // regardless of input character order.
        assertEquals(List.of("W", "U", "B", "G"),
                GameViewMapper.unionColorIdentity(List.of("WUBG")));
        // Same colors arrived in different order from upstream → same
        // wire shape (stability across renders).
        assertEquals(List.of("W", "U", "B", "G"),
                GameViewMapper.unionColorIdentity(List.of("BGWU")));
    }

    @Test
    void unionColorIdentity_partnerPair_unionsBothIdentities() {
        // Partner / background pairings — TWO CommanderView entries.
        // Critic C1: spec §7.3 says union; mono-only logic would be
        // wrong for ~5% of Commander games.
        assertEquals(List.of("W", "U", "B", "G"),
                GameViewMapper.unionColorIdentity(List.of("WU", "BG")));
        // Overlap dedupes — partners with WU + UB share blue, output
        // is W,U,B (not W,U,U,B).
        assertEquals(List.of("W", "U", "B"),
                GameViewMapper.unionColorIdentity(List.of("WU", "UB")));
    }

    @Test
    void unionColorIdentity_partnerWithColorlessAndMono_returnsMono() {
        // Edge case: one partner is colorless (empty string), the
        // other is mono. Union is just the mono color — colorless
        // contributes nothing.
        assertEquals(List.of("R"),
                GameViewMapper.unionColorIdentity(List.of("", "R")));
    }

    @Test
    void unionColorIdentity_fiveColor_returnsAllSorted() {
        // 5-color commander (Sliver Overlord, Cromat) drives the full
        // WUBRG band rendering on the halo.
        assertEquals(List.of("W", "U", "B", "R", "G"),
                GameViewMapper.unionColorIdentity(List.of("WUBRG")));
    }

    @Test
    void unionColorIdentity_resultIsImmutable() {
        // The mapper passes this list into a record; defensive
        // immutability prevents downstream mutation from surprising
        // the wire format.
        List<String> result = GameViewMapper.unionColorIdentity(List.of("WU"));
        assertThrows(UnsupportedOperationException.class,
                () -> result.add("X"));
    }
}
