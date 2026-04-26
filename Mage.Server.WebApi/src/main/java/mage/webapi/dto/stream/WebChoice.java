package mage.webapi.dto.stream;

import java.util.Map;

/**
 * Modal choice prompt — the data shape inside a
 * {@code gameChooseChoice} frame's {@link WebGameClientMessage}.
 * Mirrors a narrowed view of upstream {@code mage.choices.Choice}.
 *
 * <p>Modal spells (every Charm, every Mode-of-N spell, Cryptic
 * Command, etc.) and most "choose one" replacement effects fire this
 * dialog. The player picks a key from {@code choices}; the response
 * goes back as {@code playerResponse{kind:"string", value: <key>}}.
 *
 * <p>Slice 7 ships the minimal subset: message text + the keyed
 * choices map + a {@code required} flag. Future slices add the UI
 * hints (search, sort, hint data, mana-color-choice marker) once a
 * renderer surfaces them.
 *
 * @param message    primary prompt text
 * @param subMessage secondary prompt text (often empty); some prompts
 *     use this for "remaining picks: 2" style status
 * @param required   true if the player MUST pick; false means the
 *     prompt accepts a "skip" (no-pick) response
 * @param choices    key → display label. Upstream uses two distinct
 *     APIs ({@code getChoices(): Set<String>} and
 *     {@code getKeyChoices(): Map<String, String>}); the wire format
 *     flattens both into this map. When upstream isn't in key-mode,
 *     the mapper synthesizes {@code key == label}.
 */
public record WebChoice(
        String message,
        String subMessage,
        boolean required,
        Map<String, String> choices
) {
}
