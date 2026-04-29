package mage.webapi.mapper;

import mage.view.CardView;
import mage.webapi.dto.stream.WebCardView;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slice 52a — verifies the {@code cardId} field on {@link WebCardView}
 * resolves correctly across the three mapping paths:
 *
 * <ol>
 *   <li>Default (no explicit underlying-card UUID) →
 *       {@code cardId == id} (hand / battlefield / graveyard / exile /
 *       sideboard / library — every zone except the stack).</li>
 *   <li>Explicit underlying UUID supplied → {@code cardId} equals the
 *       supplied UUID's string form (the stack path; recovers the
 *       physical {@code Card.getId()} that {@code Spell.getId()}
 *       hides behind a fresh {@code SpellAbility} UUID).</li>
 *   <li>Recursive secondCardFace mapping → the back face's
 *       {@code cardId} resolves from its own {@code id}, never
 *       inheriting the front face's hint (back faces are separate
 *       Card instances upstream).</li>
 * </ol>
 *
 * <p>Direct mapper invocation in the {@link CombatFlowContractTest}
 * style — no embedded server, no WebSocket round-trip. Constructs
 * empty {@code CardView} instances and stamps UUIDs via {@code
 * overrideId} / reflection, then asserts on the produced wire DTO.
 */
class CardViewMapperCardIdTest {

    private static final UUID PHYSICAL_CARD_ID =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SPELL_ABILITY_ID =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID OTHER_SPELL_ABILITY_ID =
            UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID BACK_FACE_ID =
            UUID.fromString("44444444-4444-4444-4444-444444444444");

    @Test
    void toCardDto_noExplicitUuid_cardIdEqualsId() {
        CardView cv = newEmptyCard(PHYSICAL_CARD_ID);

        WebCardView dto = CardViewMapper.toCardDto(cv);

        assertEquals(PHYSICAL_CARD_ID.toString(), dto.id());
        assertEquals(PHYSICAL_CARD_ID.toString(), dto.cardId(),
                "with no underlyingCardId hint, cardId falls back to "
                        + "cv.getId() — the hand/battlefield/graveyard path");
    }

    @Test
    void toCardDto_explicitUuid_cardIdUsesExplicit() {
        // Stack path: cv.getId() carries the SpellAbility UUID, the
        // explicit param carries the underlying physical Card UUID.
        CardView cv = newEmptyCard(SPELL_ABILITY_ID);

        WebCardView dto = CardViewMapper.toCardDto(cv, PHYSICAL_CARD_ID);

        assertEquals(SPELL_ABILITY_ID.toString(), dto.id(),
                "id stays as the SpellAbility UUID (wire-format key)");
        assertEquals(PHYSICAL_CARD_ID.toString(), dto.cardId(),
                "cardId uses the supplied underlying Card UUID");
    }

    @Test
    void toCardDto_explicitNull_cardIdFallsBackToId() {
        // Defensive — null explicit UUID equivalent to no-arg overload.
        CardView cv = newEmptyCard(PHYSICAL_CARD_ID);

        WebCardView dto = CardViewMapper.toCardDto(cv, null);

        assertEquals(PHYSICAL_CARD_ID.toString(), dto.id());
        assertEquals(PHYSICAL_CARD_ID.toString(), dto.cardId());
    }

    @Test
    void toStackMap_withMixedHints_correctlyAssignsCardId() {
        // Two stack entries: one is a Spell (has a hint), one is a
        // StackAbility (no hint, falls back to its own id). Wire-
        // format key is always cv.getId() (SpellAbility / ability id).
        CardView spellView = newEmptyCard(SPELL_ABILITY_ID);
        CardView triggeredAbilityView = newEmptyCard(OTHER_SPELL_ABILITY_ID);

        Map<UUID, CardView> stack = new LinkedHashMap<>();
        stack.put(SPELL_ABILITY_ID, spellView);
        stack.put(OTHER_SPELL_ABILITY_ID, triggeredAbilityView);

        Map<UUID, UUID> hints = new HashMap<>();
        hints.put(SPELL_ABILITY_ID, PHYSICAL_CARD_ID);
        // OTHER_SPELL_ABILITY_ID intentionally absent.

        Map<String, WebCardView> result = CardViewMapper.toStackMap(stack, hints);

        assertEquals(2, result.size());
        WebCardView spellDto = result.get(SPELL_ABILITY_ID.toString());
        assertNotNull(spellDto);
        assertEquals(SPELL_ABILITY_ID.toString(), spellDto.id());
        assertEquals(PHYSICAL_CARD_ID.toString(), spellDto.cardId(),
                "Spell entry: cardId comes from the hint map");

        WebCardView abilityDto = result.get(OTHER_SPELL_ABILITY_ID.toString());
        assertNotNull(abilityDto);
        assertEquals(OTHER_SPELL_ABILITY_ID.toString(), abilityDto.id());
        assertEquals(OTHER_SPELL_ABILITY_ID.toString(), abilityDto.cardId(),
                "StackAbility entry without hint: cardId falls back to id");
    }

    @Test
    void toStackMap_nullInputs_returnsEmptyMap() {
        // No NPE on null stack or null hint map.
        assertTrue(CardViewMapper.toStackMap(null, null).isEmpty());
        assertTrue(CardViewMapper.toStackMap(null, Map.of()).isEmpty());
        assertTrue(CardViewMapper.toStackMap(Map.of(), null).isEmpty());
    }

    @Test
    void toStackMap_nullHintWithEntries_fallsBackToId() {
        // A non-null stack with a null hint map: every entry's cardId
        // falls back to its id (the no-information path).
        CardView cv = newEmptyCard(SPELL_ABILITY_ID);
        Map<UUID, CardView> stack = new LinkedHashMap<>();
        stack.put(SPELL_ABILITY_ID, cv);

        Map<String, WebCardView> result = CardViewMapper.toStackMap(stack, null);

        assertEquals(1, result.size());
        WebCardView dto = result.get(SPELL_ABILITY_ID.toString());
        assertEquals(SPELL_ABILITY_ID.toString(), dto.cardId());
    }

    @Test
    void toCardDto_withSecondCardFace_recursionFallsBackToBackId() {
        // Front face is a Spell on the stack (explicit hint set);
        // back face is a separate CardView with its own UUID. The
        // recursive mapping passes null for the back face's
        // underlyingCardId so its cardId resolves from BACK_FACE_ID.
        CardView front = newEmptyCard(SPELL_ABILITY_ID);
        CardView back = newEmptyCard(BACK_FACE_ID);
        installSecondFace(front, back);

        WebCardView dto = CardViewMapper.toCardDto(front, PHYSICAL_CARD_ID);

        assertEquals(SPELL_ABILITY_ID.toString(), dto.id());
        assertEquals(PHYSICAL_CARD_ID.toString(), dto.cardId(),
                "front cardId uses the explicit hint");
        assertNotNull(dto.secondCardFace(), "secondCardFace mapped");
        assertEquals(BACK_FACE_ID.toString(), dto.secondCardFace().id());
        assertEquals(BACK_FACE_ID.toString(), dto.secondCardFace().cardId(),
                "back-face cardId falls back to its own id (recursive "
                        + "call passes null underlyingCardId)");
    }

    // ---------- helpers ----------

    /**
     * Construct an empty {@link CardView} with the given id stamped
     * via {@link CardView#overrideId(UUID)}. The empty-ctor path
     * fills in defaults for everything else; we only care about id
     * + secondCardFace for these tests.
     */
    private static CardView newEmptyCard(UUID id) {
        CardView cv = new CardView(true);
        cv.overrideId(id);
        return cv;
    }

    /**
     * Install a back face on a CardView. {@code secondCardFace} is
     * a protected field with no public setter; reflection is the
     * least-invasive path for a test that doesn't need a real
     * upstream Card / Game pair.
     */
    private static void installSecondFace(CardView front, CardView back) {
        try {
            Field f = CardView.class.getDeclaredField("secondCardFace");
            f.setAccessible(true);
            f.set(front, back);
        } catch (ReflectiveOperationException ex) {
            throw new AssertionError(
                    "Test setup: failed to install secondCardFace via "
                            + "reflection; if upstream renamed the field, "
                            + "update this helper", ex);
        }
    }
}
