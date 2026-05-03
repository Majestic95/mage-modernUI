package mage.webapi.mapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.webapi.dto.stream.WebCardView;
import mage.webapi.dto.stream.WebPermanentView;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Locks the JSON shape of {@link WebCardView} and
 * {@link WebPermanentView} so upstream {@code CardView} drift surfaces
 * here, not on the wire.
 *
 * <p>The end-to-end mapping (real {@code CardView} → {@code WebCardView})
 * is covered by the lifecycle e2e in {@code GameStreamHandlerTest}
 * which spins up an embedded server, plays a real Forest into the
 * battlefield, and asserts on the resulting frame. This test focuses
 * on the wire-format shape contract.
 */
class CardViewMapperTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void cardView_jsonShape_locksTwentyFiveFields() throws Exception {
        WebCardView dto = new WebCardView(
                "550e8400-e29b-41d4-a716-446655440000",
                "550e8400-e29b-41d4-a716-446655440000",
                "Lightning Bolt",
                "Lightning Bolt",
                "LEA",
                "161",
                "{R}",
                1,
                "Instant",
                List.of(),
                List.of("INSTANT"),
                List.of(),
                List.of("R"),
                "COMMON",
                "",
                "",
                "",
                List.of("Lightning Bolt deals 3 damage to any target."),
                false,
                Map.of(),
                false,
                false,
                null,
                "",
                null
        );
        JsonNode node = JSON.valueToTree(dto);

        assertEquals(25, node.size(),
                "WebCardView must have exactly 25 fields "
                        + "(slice 70-Z added source for ability-stack rendering); got: " + node);
        // Snapshot the field set explicitly so adding a field forces
        // a CHANGELOG bump. transformable/transformed/secondCardFace
        // landed in 1.12 — DFC + MDFC support per audit §3.
        // sourceLabel landed in 1.18 — trigger-order source attribution.
        // cardId landed in 1.19 (slice 52a) — stack/spell underlying
        // card UUID for Framer Motion layoutId cross-zone animation.
        // source landed in 1.26 (slice 70-Z) — full source CardView
        // for ability stack objects so the focal stack can render the
        // source card's visual instead of a blank "Ability" placeholder.
        for (String field : List.of(
                "id", "cardId", "name", "displayName", "expansionSetCode",
                "cardNumber", "manaCost", "manaValue", "typeLine",
                "supertypes", "types", "subtypes", "colors", "rarity",
                "power", "toughness", "startingLoyalty", "rules",
                "faceDown", "counters",
                "transformable", "transformed", "secondCardFace",
                "sourceLabel", "source")) {
            assertTrue(node.has(field), "missing field: " + field);
        }
    }

    @Test
    void permanentView_jsonShape_locksGoadingPlayerIds_populated() throws Exception {
        // Slice 69c (ADR 0010 v2 D3c) — when the multiplayer frame
        // context carries goading data for a permanent, the wire
        // field surfaces it. Lock the populated path so a future
        // mapper refactor can't silently drop the populate.
        java.util.UUID permId = java.util.UUID.fromString(
                "aaaaaaaa-1111-1111-1111-111111111111");
        java.util.UUID goader1 = java.util.UUID.fromString(
                "bbbbbbbb-2222-2222-2222-222222222222");
        java.util.UUID goader2 = java.util.UUID.fromString(
                "cccccccc-3333-3333-3333-333333333333");
        WebPermanentView dto = new WebPermanentView(
                new WebCardView(
                        permId.toString(), permId.toString(),
                        "Marauding Raptor", "Marauding Raptor", "RIX", "151",
                        "{1}{R}", 2,
                        "Creature — Dinosaur", List.of(),
                        List.of("CREATURE"), List.of("Dinosaur"),
                        List.of("R"), "UNCOMMON",
                        "3", "2", "",
                        List.of("Goad target creature."),
                        false, Map.of(),
                        false, false, null, "", null),
                "alice", false, false, false, true, false, 0,
                List.of(), "", false,
                // Slice 69c: populated by mapper from
                // Permanent.getGoadingPlayers() — represents
                // alice + bob having both goaded this Raptor in 4p FFA.
                List.of(goader1.toString(), goader2.toString()));
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(12, node.size(),
                "WebPermanentView must have exactly 12 fields; got: " + node);
        assertTrue(node.get("goadingPlayerIds").isArray());
        assertEquals(2, node.get("goadingPlayerIds").size(),
                "two goaders should round-trip to a 2-element JSON array");
    }

    @Test
    void permanentView_jsonShape_locksTwelveFields() throws Exception {
        WebCardView card = new WebCardView(
                "id", "id", "Forest", "Forest", "M21", "281", "", 0,
                "Basic Land — Forest", List.of("BASIC"), List.of("LAND"),
                List.of("Forest"), List.of(), "COMMON",
                "", "", "", List.of("({T}: Add {G}.)"),
                false, Map.of(),
                false, false, null, "", null);
        WebPermanentView dto = new WebPermanentView(
                card, "alice", false, false, false, true, false, 0,
                List.of(), "", false, List.of());
        JsonNode node = JSON.valueToTree(dto);

        // Schema 1.20 (slice 69a): added goadingPlayerIds → 12 fields.
        assertEquals(12, node.size(),
                "WebPermanentView must have exactly 12 fields; got: " + node);
        for (String field : List.of(
                "card", "controllerName", "tapped", "flipped",
                "transformed", "phasedIn", "summoningSickness",
                "damage", "attachments", "attachedTo",
                "attachedToPermanent", "goadingPlayerIds")) {
            assertTrue(node.has(field), "missing field: " + field);
        }
        // Composition: the nested card carries the full WebCardView shape.
        assertEquals(25, node.get("card").size(),
                "permanent.card must be a full WebCardView");
        // Schema 1.20 wire shape: empty array until slice 69b plumbs
        // live Permanent access through the mapper (ADR 0010 v2 D3c).
        assertTrue(node.get("goadingPlayerIds").isArray());
        assertEquals(0, node.get("goadingPlayerIds").size());
    }

    @Test
    void cardMap_emptyInput_returnsEmptyMap() {
        assertTrue(CardViewMapper.toCardMap(null).isEmpty());
        assertTrue(CardViewMapper.toCardMap(Map.of()).isEmpty());
    }

    @Test
    void permanentMap_emptyInput_returnsEmptyMap() {
        assertTrue(CardViewMapper.toPermanentMap(null).isEmpty());
        assertTrue(CardViewMapper.toPermanentMap(Map.of()).isEmpty());
    }

    @Test
    void toStackMap_preservesInsertionOrder_newestFirstSurvivesToJson() throws Exception {
        // Wire invariant — the upstream GameView constructor (see
        // mage.view.GameView, "for (StackObject stackObject : state.getStack()) ...")
        // iterates the engine's SpellStack head-to-tail and inserts into
        // a LinkedHashMap. SpellStack is an ArrayDeque pushed at the head,
        // so head→tail iteration yields newest-first order — the topmost
        // (next-to-resolve) spell is the FIRST entry. The mapper must
        // preserve that order all the way through to the wire JSON: the
        // client treats Object.values(stack)[0] as the focal / topmost
        // entry, so any re-sort here misrenders every multi-spell stack
        // and leaks back to the playtester as "the spell I just cast
        // ended up at the back of the fan." Locks both the in-memory
        // map iteration order AND the Jackson-serialized JSON field
        // order. See docs/schema/CHANGELOG.md "Documented invariants".
        java.util.UUID newest = java.util.UUID.fromString(
                "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        java.util.UUID middle = java.util.UUID.fromString(
                "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
        java.util.UUID oldest = java.util.UUID.fromString(
                "cccccccc-cccc-cccc-cccc-cccccccccccc");

        mage.view.CardView newestCv = new mage.view.CardView(true);
        newestCv.overrideId(newest);
        mage.view.CardView middleCv = new mage.view.CardView(true);
        middleCv.overrideId(middle);
        mage.view.CardView oldestCv = new mage.view.CardView(true);
        oldestCv.overrideId(oldest);

        java.util.LinkedHashMap<java.util.UUID, mage.view.CardView> input =
                new java.util.LinkedHashMap<>();
        input.put(newest, newestCv);
        input.put(middle, middleCv);
        input.put(oldest, oldestCv);

        Map<String, WebCardView> out =
                CardViewMapper.toStackMap(input, Map.of());

        java.util.List<String> keysInOrder =
                new java.util.ArrayList<>(out.keySet());
        assertEquals(
                List.of(newest.toString(), middle.toString(), oldest.toString()),
                keysInOrder,
                "toStackMap must preserve LinkedHashMap iteration order — "
                        + "the client treats Object.values(stack)[0] as the "
                        + "topmost / next-to-resolve spell.");

        String json = JSON.writeValueAsString(out);
        JsonNode tree = JSON.readTree(json);
        java.util.List<String> jsonKeys = new java.util.ArrayList<>();
        tree.fieldNames().forEachRemaining(jsonKeys::add);
        assertEquals(
                List.of(newest.toString(), middle.toString(), oldest.toString()),
                jsonKeys,
                "Jackson JSON serialization must preserve the LinkedHashMap "
                        + "key order so the wire emits newest-first. UUID keys "
                        + "are non-integer strings, so JS Object insertion "
                        + "order is preserved through JSON.parse and zod's "
                        + "z.record on the client.");
    }

    @Test
    void mappers_nullInputs_throw() {
        assertThrows(IllegalArgumentException.class,
                () -> CardViewMapper.toCardDto(null));
        assertThrows(IllegalArgumentException.class,
                () -> CardViewMapper.toPermanentDto(null));
    }

    @Test
    void cardView_ordinaryCard_sourceIsNull() throws Exception {
        // Slice 70-Z — for non-AbilityView inputs (battlefield, hand,
        // graveyard, exile, stack-spells), `source` is null. Only
        // ability stack objects carry a populated source.
        mage.view.CardView cv = new mage.view.CardView(true);
        cv.overrideId(java.util.UUID.fromString(
                "11111111-1111-1111-1111-111111111111"));

        WebCardView dto = CardViewMapper.toCardDto(cv);

        org.junit.jupiter.api.Assertions.assertNull(dto.source(),
                "ordinary CardViews must have null source");
        assertEquals("", dto.sourceLabel(),
                "ordinary CardViews must have empty sourceLabel");
    }

    @Test
    void cardView_stackAbilityView_populatesSource() throws Exception {
        // Slice 70-Z bug fix — the focal stack failed to render the
        // source for triggered/activated abilities ACTUALLY ON THE
        // STACK because those use StackAbilityView (not AbilityView).
        // Both classes extend CardView directly; both have a
        // getSourceCard() method; the mapper must check both. The
        // user reported the bug after a Quirion Sentinel ETB trigger
        // showed as a blank "Ability" placeholder despite the slice
        // 70-Z deploy.
        java.util.UUID sourceId = java.util.UUID.fromString(
                "44444444-4444-4444-4444-444444444444");
        mage.view.CardView sourceCv = new mage.view.CardView(true);
        sourceCv.overrideId(sourceId);
        java.lang.reflect.Field nameField =
                mage.view.CardView.class.getDeclaredField("name");
        nameField.setAccessible(true);
        nameField.set(sourceCv, "Quirion Sentinel");

        mage.view.StackAbilityView stackAv = newStackAbilityView(
                java.util.UUID.fromString(
                        "55555555-5555-5555-5555-555555555555"),
                sourceCv);

        WebCardView dto = CardViewMapper.toCardDto(stackAv);

        org.junit.jupiter.api.Assertions.assertNotNull(dto.source(),
                "StackAbilityView must populate source — this is the "
                        + "actual stack path for triggered/activated abilities");
        assertEquals("Quirion Sentinel", dto.source().name());
        assertEquals(sourceId.toString(), dto.source().id());
        org.junit.jupiter.api.Assertions.assertNull(dto.source().source(),
                "source must not chain — recursion capped");
    }

    @Test
    void cardView_abilityView_populatesSourceAndCapsRecursion() throws Exception {
        // Slice 70-Z / schema 1.26 — for an upstream AbilityView the
        // mapper populates `source` with a full WebCardView of the
        // source card so the focal stack can render the source's
        // visual instead of a blank "Ability" placeholder.
        //
        // AbilityView has no no-arg constructor (it requires an
        // Ability + sourceName + sourceCard); we build it via JDK
        // serialization-bypass reflection so the test stays decoupled
        // from upstream Ability subclass choices. Same pattern the
        // existing CardViewMapperCardIdTest uses for installing a
        // back face — reflection over package-private upstream
        // internals is acceptable in test setup.
        java.util.UUID sourceId = java.util.UUID.fromString(
                "22222222-2222-2222-2222-222222222222");
        mage.view.CardView sourceCv = new mage.view.CardView(true);
        sourceCv.overrideId(sourceId);
        // Stamp a name on the source so the assertion has something
        // to read; CardView's `name` field is package-private with
        // no public setter so reflection sets it directly.
        java.lang.reflect.Field nameField =
                mage.view.CardView.class.getDeclaredField("name");
        nameField.setAccessible(true);
        nameField.set(sourceCv, "Soul Warden");

        mage.view.AbilityView abilityView = newAbilityView(
                java.util.UUID.fromString(
                        "33333333-3333-3333-3333-333333333333"),
                "Soul Warden", sourceCv);

        WebCardView dto = CardViewMapper.toCardDto(abilityView);

        // sourceLabel surface (schema 1.18) — backwards compat.
        assertEquals("Soul Warden", dto.sourceLabel());
        // source full CardView surface (schema 1.26) — new in 70-Z.
        org.junit.jupiter.api.Assertions.assertNotNull(dto.source(),
                "ability stack objects must populate source");
        assertEquals("Soul Warden", dto.source().name());
        assertEquals(sourceId.toString(), dto.source().id());
        // Recursion cap: source-of-source is null on the wire.
        org.junit.jupiter.api.Assertions.assertNull(dto.source().source(),
                "source must not chain — recursion capped at one level");
    }

    /**
     * Construct an {@link mage.view.AbilityView} without going through
     * its public constructor (which requires a real Ability). Uses
     * {@code sun.reflect.ReflectionFactory} to bypass the constructor —
     * same JVM API the JDK serialization machinery uses, so the
     * surefire {@code --add-opens} flag bundle already covers it.
     *
     * <p>After bypass-allocation we populate the same fields the real
     * constructor at {@code AbilityView.java:19-36} would set, so the
     * mapper's {@code cv.getManaCostStr()} / {@code cv.getRules()} /
     * {@code cv.getColor()} / etc. don't NPE on uninitialized fields.
     */
    @SuppressWarnings("unused")
    private static mage.view.AbilityView newAbilityView(
            java.util.UUID id, String sourceName, mage.view.CardView sourceCard)
            throws Exception {
        sun.reflect.ReflectionFactory rf =
                sun.reflect.ReflectionFactory.getReflectionFactory();
        java.lang.reflect.Constructor<Object> objCtor =
                Object.class.getDeclaredConstructor();
        java.lang.reflect.Constructor<?> avCtor =
                rf.newConstructorForSerialization(
                        mage.view.AbilityView.class, objCtor);
        mage.view.AbilityView av =
                (mage.view.AbilityView) avCtor.newInstance();
        // Mirror AbilityView's constructor field-init so the mapper's
        // accessors (getManaCostStr, getRules, getColor, etc.) don't
        // NPE on null collections.
        setField(mage.view.SimpleCardView.class, av, "id", id);
        setField(mage.view.CardView.class, av, "name", "Ability");
        setField(mage.view.CardView.class, av, "displayName", "Ability");
        setField(mage.view.CardView.class, av, "rules", new java.util.ArrayList<String>());
        setField(mage.view.CardView.class, av, "power", "");
        setField(mage.view.CardView.class, av, "toughness", "");
        setField(mage.view.CardView.class, av, "loyalty", "");
        setField(mage.view.CardView.class, av, "defense", "");
        setField(mage.view.CardView.class, av, "cardTypes", new java.util.ArrayList<>());
        setField(mage.view.CardView.class, av, "subTypes", new mage.util.SubTypes());
        setField(mage.view.CardView.class, av, "superTypes", new java.util.ArrayList<>());
        setField(mage.view.CardView.class, av, "color", new mage.ObjectColor());
        setField(mage.view.CardView.class, av, "manaCostLeftStr", new java.util.ArrayList<String>());
        setField(mage.view.CardView.class, av, "manaCostRightStr", new java.util.ArrayList<String>());
        setField(mage.view.AbilityView.class, av, "sourceName", sourceName);
        setField(mage.view.AbilityView.class, av, "sourceCard", sourceCard);
        return av;
    }

    private static void setField(Class<?> cls, Object target, String name, Object value)
            throws Exception {
        java.lang.reflect.Field f = cls.getDeclaredField(name);
        f.setAccessible(true);
        f.set(target, value);
    }

    /**
     * Construct a {@link mage.view.StackAbilityView} via reflection
     * bypass — its public constructor requires Game + StackAbility +
     * MageObject, none of which are available in a unit test scope.
     * Same pattern as {@link #newAbilityView}.
     */
    @SuppressWarnings("unused")
    private static mage.view.StackAbilityView newStackAbilityView(
            java.util.UUID id, mage.view.CardView sourceCard) throws Exception {
        sun.reflect.ReflectionFactory rf =
                sun.reflect.ReflectionFactory.getReflectionFactory();
        java.lang.reflect.Constructor<Object> objCtor =
                Object.class.getDeclaredConstructor();
        java.lang.reflect.Constructor<?> savCtor =
                rf.newConstructorForSerialization(
                        mage.view.StackAbilityView.class, objCtor);
        mage.view.StackAbilityView sav =
                (mage.view.StackAbilityView) savCtor.newInstance();
        // Mirror StackAbilityView's constructor field-init enough that
        // the mapper's accessors don't NPE.
        setField(mage.view.SimpleCardView.class, sav, "id", id);
        setField(mage.view.CardView.class, sav, "name", "Ability");
        setField(mage.view.CardView.class, sav, "displayName", "Ability");
        setField(mage.view.CardView.class, sav, "rules", new java.util.ArrayList<String>());
        setField(mage.view.CardView.class, sav, "power", "");
        setField(mage.view.CardView.class, sav, "toughness", "");
        setField(mage.view.CardView.class, sav, "loyalty", "");
        setField(mage.view.CardView.class, sav, "defense", "");
        setField(mage.view.CardView.class, sav, "cardTypes", new java.util.ArrayList<>());
        setField(mage.view.CardView.class, sav, "subTypes", new mage.util.SubTypes());
        setField(mage.view.CardView.class, sav, "superTypes", new java.util.ArrayList<>());
        setField(mage.view.CardView.class, sav, "color", new mage.ObjectColor());
        setField(mage.view.CardView.class, sav, "manaCostLeftStr", new java.util.ArrayList<String>());
        setField(mage.view.CardView.class, sav, "manaCostRightStr", new java.util.ArrayList<String>());
        setField(mage.view.StackAbilityView.class, sav, "sourceCard", sourceCard);
        return sav;
    }
}
